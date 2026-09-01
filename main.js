const { app, BrowserWindow, Tray, ipcMain } = require('electron');
const path = require('path');
const os = require('os');
const si = require('systeminformation');

let tray = null;
let window = null;
let lastCpus = os.cpus();

if (app.dock) app.dock.hide();

app.whenReady().then(() => {
  createTray();
  createWindow();
  startMonitoring();
  
  window.on('blur', () => window.hide());
});

app.on('window-all-closed', (e) => e.preventDefault());

function createTray() {
  const { nativeImage } = require('electron');
  tray = new Tray(nativeImage.createEmpty());
  tray.setTitle('CPU --%');
  tray.setToolTip('System Monitor');
  tray.on('click', (event, bounds) => toggleWindow(bounds));
}

function createWindow() {
  window = new BrowserWindow({
    width: 280,
    height: 520,
    show: false,
    frame: false,
    resizable: false,
    transparent: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });
  window.loadFile('index.html');
}

function toggleWindow(trayBounds) {
  if (window.isVisible()) {
    window.hide();
  } else {
    if (!trayBounds) trayBounds = tray.getBounds();
    const windowBounds = window.getBounds();
    const x = Math.round(trayBounds.x + (trayBounds.width / 2) - (windowBounds.width / 2));
    const y = Math.round(trayBounds.y + trayBounds.height + 4);
    window.setPosition(x, y, false);
    window.show();
    window.focus();
  }
}

function getCpuUsage() {
  const cpus = os.cpus();
  let idleDiff = 0;
  let totalDiff = 0;

  for (let i = 0; i < cpus.length; i++) {
    const cpu = cpus[i];
    const lastCpu = lastCpus[i];

    for (const type in cpu.times) {
      totalDiff += cpu.times[type] - lastCpu.times[type];
    }
    idleDiff += cpu.times.idle - lastCpu.times.idle;
  }
  
  lastCpus = cpus;
  if (totalDiff === 0) return 0;
  return 100 - (100 * idleDiff / totalDiff);
}

function getLocalIp() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return 'Offline';
}

const { exec } = require('child_process');

let displayMode = 'CPU'; // 'CPU' or 'GPU'
let currentGpuUsage = 0;

ipcMain.on('set-display-mode', (event, mode) => {
  displayMode = mode;
});

let gpuModelName = 'Unknown GPU';
si.graphics().then(data => {
  if (data.controllers && data.controllers.length > 0) {
    gpuModelName = data.controllers[0].model;
  }
}).catch(console.error);

function getGpuUsage() {
  return new Promise((resolve) => {
    if (os.platform() !== 'darwin') return resolve(0); // ioreg is macOS only
    exec('ioreg -l | grep "Device Utilization %"', (err, stdout) => {
      if (err || !stdout) return resolve(currentGpuUsage);
      const match = stdout.match(/"Device Utilization %"=(\d+)/);
      if (match) {
        currentGpuUsage = parseInt(match[1], 10);
      }
      resolve(currentGpuUsage);
    });
  });
}

function startMonitoring() {
  setInterval(async () => {
    try {
      const cpuUsage = getCpuUsage();
      const gpuUsage = await getGpuUsage();
      
      const memData = await si.mem();
      const memPercent = (memData.active / memData.total) * 100;
      
      if (displayMode === 'CPU') {
        tray.setTitle(`CPU ${Math.round(cpuUsage)}%`);
      } else if (displayMode === 'GPU') {
        tray.setTitle(`GPU ${gpuUsage}%`);
      } else if (displayMode === 'RAM') {
        tray.setTitle(`RAM ${Math.round(memPercent)}%`);
      }

      if (window && window.isVisible()) {
        window.webContents.send('stats-update', {
          cpu: cpuUsage,
          gpu: gpuUsage,
          gpuModel: gpuModelName,
          memPercent: memPercent,
          usedMemMb: memData.active / 1024 / 1024,
          totalMemMb: memData.total / 1024 / 1024,
          swapUsedMb: memData.swapused / 1024 / 1024,
          swapTotalMb: memData.swaptotal / 1024 / 1024,
          uptime: os.uptime(),
          ip: getLocalIp(),
          os: `${os.type()} ${os.release()}`
        });
      }
    } catch (err) {
      console.error(err);
    }
  }, 2000);
}
