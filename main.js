'use strict';
const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, powerMonitor, screen } = require('electron');
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const S = require('./lib/stats');

const isMac = process.platform === 'darwin';
const MODES = ['CPU', 'GPU', 'RAM'];
const WIN = { width: 260, height: 330 };
const INTERVAL = { visible: 1500, hidden: 3000, battery: 5000 }; // ms
const DESTROY_AFTER_MS = 60_000; // free the renderer once hidden this long
const IP_EVERY = 10; // refresh the IP every N ticks

// The UI is trivial; software rendering avoids keeping a GPU process awake.
app.disableHardwareAcceleration();
if (isMac && app.dock) app.dock.hide();

let tray = null;
let win = null;
let mode = 'CPU';
let timer = null;
let destroyTimer = null;
let paused = false;
let busy = false;
let hiddenAt = 0;
let tickNo = 0;
let lastTitle = '';
let lastCpus = os.cpus();
let last = { cpu: 0, gpu: null, memPct: 0, memUsed: 0, memTotal: os.totalmem() };
let swap = null;
let ip = 'Offline';
let gpuModel; // undefined = not looked up yet, null = unavailable

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');

function loadSettings() {
  try {
    const { mode: m } = JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
    if (MODES.includes(m)) mode = m;
  } catch { /* first run or unreadable: keep default */ }
}

function saveSettings() {
  fs.writeFile(settingsFile(), JSON.stringify({ mode }), () => {});
}

// Runs a binary directly (no shell). Resolves null on any failure.
const run = (cmd, args) => new Promise((resolve) => {
  execFile(cmd, args, { timeout: 3000, maxBuffer: 1 << 20 }, (err, out) => resolve(err ? null : out));
});

function getLocalIp() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const net of list || []) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return 'Offline';
}

async function sampleMem() {
  const total = os.totalmem();
  let used = null;
  if (isMac) used = S.parseVmStat(await run('vm_stat', []));
  if (used == null) used = total - os.freemem();
  return { used, total, pct: (used / total) * 100 };
}

async function sampleGpu() {
  if (!isMac) return null;
  const v = S.parseGpuUtil(await run('ioreg', ['-r', '-d', '1', '-w0', '-c', 'IOAccelerator']));
  return v == null ? last.gpu : v;
}

async function sampleSwap() {
  if (!isMac) return null;
  return S.parseSwap(await run('sysctl', ['-n', 'vm.swapusage'])) || swap;
}

async function getGpuModel() {
  if (gpuModel === undefined) {
    gpuModel = isMac
      ? S.parseGpuModel(await run('system_profiler', ['SPDisplaysDataType', '-json']))
      : null;
  }
  return gpuModel;
}

const isVisible = () => !!win && !win.isDestroyed() && win.isVisible();

async function tick() {
  if (busy || paused) return;
  busy = true;
  try {
    const visible = isVisible();
    const wantCpu = visible || mode === 'CPU';
    const wantGpu = visible || mode === 'GPU';
    const wantMem = visible || mode === 'RAM';

    if (wantCpu) {
      const cur = os.cpus();
      last.cpu = S.cpuUsage(lastCpus, cur);
      lastCpus = cur;
    }
    if (wantGpu) last.gpu = await sampleGpu();
    if (wantMem) {
      const m = await sampleMem();
      Object.assign(last, { memPct: m.pct, memUsed: m.used, memTotal: m.total });
    }

    const title = S.trayText(mode, last);
    if (title !== lastTitle) {
      lastTitle = title;
      if (isMac) tray.setTitle(title, { fontType: 'monospacedDigit' });
      else tray.setToolTip(title);
    }

    if (visible) {
      if (tickNo % IP_EVERY === 0) ip = getLocalIp();
      swap = await sampleSwap();
      if (isVisible()) {
        win.webContents.send('stats', {
          cpu: last.cpu,
          gpu: last.gpu,
          mem: last.memPct,
          memUsed: S.formatGb(last.memUsed),
          memTotal: S.formatGb(last.memTotal),
          swap: swap ? S.formatGb(swap.used) : null,
          uptime: S.formatUptime(os.uptime()),
          ip,
        });
      }
    }
    tickNo++;
  } catch (err) {
    console.error(err);
  } finally {
    busy = false;
    schedule();
  }
}

function schedule(delay) {
  clearTimeout(timer);
  timer = null;
  if (paused) return;
  const next = delay ?? (isVisible() ? INTERVAL.visible
    : powerMonitor.isOnBatteryPower() ? INTERVAL.battery : INTERVAL.hidden);
  timer = setTimeout(tick, next);
}

function setPaused(value) {
  paused = value;
  if (value) {
    clearTimeout(timer);
    timer = null;
  } else {
    lastCpus = os.cpus(); // don't average over the sleep gap
    schedule(500);
  }
}

function createWindow() {
  win = new BrowserWindow({
    ...WIN,
    show: false,
    frame: false,
    resizable: false,
    transparent: true,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      devTools: !app.isPackaged,
    },
  });
  win.on('blur', () => win && win.hide());
  win.on('hide', () => {
    hiddenAt = Date.now();
    clearTimeout(destroyTimer);
    destroyTimer = setTimeout(() => win && !win.isVisible() && win.destroy(), DESTROY_AFTER_MS);
  });
  win.on('closed', () => { win = null; });
  win.loadFile(path.join(__dirname, 'index.html'));
}

function placeWindow(bounds) {
  const { width, height } = win.getBounds();
  const area = screen.getDisplayMatching(bounds).workArea;
  const x = Math.round(bounds.x + bounds.width / 2 - width / 2);
  const y = Math.round(bounds.y + bounds.height + 4);
  win.setPosition(
    Math.min(Math.max(x, area.x), area.x + area.width - width),
    Math.min(Math.max(y, area.y), area.y + area.height - height),
    false,
  );
}

function toggleWindow(bounds = tray.getBounds()) {
  if (isVisible()) return win.hide();
  // Clicking the tray blurs (hides) the window first; don't reopen it right away.
  if (Date.now() - hiddenAt < 250) return;
  clearTimeout(destroyTimer);
  const fresh = !win;
  if (fresh) createWindow();
  placeWindow(bounds);
  const show = () => { win.show(); win.focus(); schedule(0); };
  if (fresh) win.once('ready-to-show', show);
  else show();
}

// Tiny solid-colour icon so the tray is visible where text titles are unsupported.
function trayIcon() {
  if (isMac) return nativeImage.createEmpty();
  const size = 16;
  const buf = Buffer.alloc(size * size * 4);
  for (let i = 0; i < buf.length; i += 4) buf.set([0xff, 0x84, 0x0a, 0xff], i); // BGRA
  return nativeImage.createFromBitmap(buf, { width: size, height: size });
}

function createTray() {
  tray = new Tray(trayIcon());
  tray.setToolTip('System Monitor');
  if (isMac) tray.setTitle(S.trayText(mode, last), { fontType: 'monospacedDigit' });
  const menu = Menu.buildFromTemplate([
    { label: 'Show / Hide', click: () => toggleWindow() },
    { type: 'separator' },
    { label: 'Quit System Monitor', role: 'quit' },
  ]);
  tray.on('click', (_e, bounds) => toggleWindow(bounds));
  if (isMac) tray.on('right-click', () => tray.popUpContextMenu(menu));
  else tray.setContextMenu(menu);
}

ipcMain.handle('static-info', async () => {
  const cpus = os.cpus();
  return {
    mode,
    cpuModel: (cpus[0] && cpus[0].model.trim()) || 'Unknown CPU',
    cores: cpus.length,
    os: `${os.type()} ${os.release()}`,
    gpuModel: await getGpuModel(),
    gpuSupported: isMac,
  };
});

ipcMain.on('set-mode', (_e, m) => {
  if (!MODES.includes(m) || m === mode) return;
  mode = m;
  saveSettings();
  schedule(0);
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('window-all-closed', () => { /* tray app: keep running */ });
  app.whenReady().then(() => {
    loadSettings();
    createTray();
    powerMonitor.on('suspend', () => setPaused(true));
    powerMonitor.on('lock-screen', () => setPaused(true));
    powerMonitor.on('resume', () => setPaused(false));
    powerMonitor.on('unlock-screen', () => setPaused(false));
    schedule(0);
  });
}
