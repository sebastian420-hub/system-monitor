'use strict';
// Pure helpers: no Electron, no I/O, so they can be unit-tested with node:test.

const GB = 2 ** 30;
const clamp = (n, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, n));

/** Overall CPU busy % between two os.cpus() snapshots. */
function cpuUsage(prev, cur) {
  let idle = 0;
  let total = 0;
  const n = Math.min(prev.length, cur.length);
  for (let i = 0; i < n; i++) {
    const a = prev[i].times;
    const b = cur[i].times;
    for (const k in b) total += b[k] - a[k];
    idle += b.idle - a.idle;
  }
  return total > 0 ? clamp(100 - (100 * idle) / total) : 0;
}

/** GPU % from `ioreg -r -c IOAccelerator` output, or null if absent. */
function parseGpuUtil(text) {
  const m = /"Device Utilization %"\s*=\s*(\d+)/.exec(text || '');
  return m ? clamp(parseInt(m[1], 10)) : null;
}

/** Used bytes (active + wired + compressed) from `vm_stat`, or null. */
function parseVmStat(text) {
  const size = /page size of (\d+) bytes/.exec(text || '');
  if (!size) return null;
  const pages = (label) => {
    const m = new RegExp(`^${label}:\\s+(\\d+)`, 'm').exec(text);
    return m ? parseInt(m[1], 10) : 0;
  };
  const used = pages('Pages active') + pages('Pages wired down') + pages('Pages occupied by compressor');
  return used * parseInt(size[1], 10);
}

/** {used,total} bytes from `sysctl -n vm.swapusage`, or null. */
function parseSwap(text) {
  const m = /total = ([\d.]+)([MG]).*?used = ([\d.]+)([MG])/.exec(text || '');
  if (!m) return null;
  const bytes = (v, u) => parseFloat(v) * (u === 'G' ? GB : 2 ** 20);
  return { total: bytes(m[1], m[2]), used: bytes(m[3], m[4]) };
}

/** Primary GPU name from `system_profiler SPDisplaysDataType -json`, or null. */
function parseGpuModel(text) {
  try {
    const first = JSON.parse(text).SPDisplaysDataType[0];
    return first.sppci_model || first._name || null;
  } catch {
    return null;
  }
}

function formatUptime(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return d > 0 ? `${d}d ${h}h ${m}m` : `${h}h ${m}m`;
}

const formatGb = (bytes) => `${(bytes / GB).toFixed(1)} GB`;

/** Menu-bar text for the selected mode; `--` when a value is unavailable. */
function trayText(mode, { cpu, gpu, memPct }) {
  const v = mode === 'CPU' ? cpu : mode === 'GPU' ? gpu : memPct;
  return `${mode} ${v == null ? '--' : Math.round(v)}%`;
}

module.exports = {
  cpuUsage, parseGpuUtil, parseVmStat, parseSwap, parseGpuModel,
  formatUptime, formatGb, trayText,
};
