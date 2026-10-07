'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../lib/stats');

const cpu = (idle, busy) => ({ times: { user: busy, nice: 0, sys: 0, idle, irq: 0 } });

test('cpuUsage: busy share between snapshots', () => {
  const prev = [cpu(100, 100), cpu(100, 100)];
  const cur = [cpu(175, 125), cpu(150, 150)]; // idle +125, busy +75 => 37.5%
  assert.equal(S.cpuUsage(prev, cur), 37.5);
});

test('cpuUsage: no elapsed time or core-count mismatch is safe', () => {
  const snap = [cpu(10, 10)];
  assert.equal(S.cpuUsage(snap, snap), 0);
  assert.equal(S.cpuUsage([], snap), 0);
});

test('parseGpuUtil', () => {
  const out = '    | |   "PerformanceStatistics" = {"Device Utilization %"=37,"Renderer Utilization %"=12}';
  assert.equal(S.parseGpuUtil(out), 37);
  assert.equal(S.parseGpuUtil('"Device Utilization %" = 5'), 5);
  assert.equal(S.parseGpuUtil('nothing here'), null);
  assert.equal(S.parseGpuUtil(''), null);
  assert.equal(S.parseGpuUtil(undefined), null);
});

const VM = `Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                               5000.
Pages active:                           100000.
Pages inactive:                          90000.
Pages wired down:                        50000.
Pages occupied by compressor:            10000.
`;

test('parseVmStat sums active + wired + compressor', () => {
  assert.equal(S.parseVmStat(VM), 160000 * 16384);
  assert.equal(S.parseVmStat('garbage'), null);
  assert.equal(S.parseVmStat(null), null);
});

test('parseSwap', () => {
  const r = S.parseSwap('vm.swapusage: total = 2048.00M  used = 1024.50M  free = 1023.50M  (encrypted)');
  assert.equal(r.total, 2048 * 2 ** 20);
  assert.equal(r.used, 1024.5 * 2 ** 20);
  assert.equal(S.parseSwap('x'), null);
});

test('parseGpuModel', () => {
  const json = JSON.stringify({ SPDisplaysDataType: [{ _name: 'kHack', sppci_model: 'Apple M2' }] });
  assert.equal(S.parseGpuModel(json), 'Apple M2');
  assert.equal(S.parseGpuModel(JSON.stringify({ SPDisplaysDataType: [{ _name: 'AMD' }] })), 'AMD');
  assert.equal(S.parseGpuModel('not json'), null);
  assert.equal(S.parseGpuModel('{}'), null);
});

test('formatters', () => {
  assert.equal(S.formatUptime(59), '0h 0m');
  assert.equal(S.formatUptime(3 * 3600 + 120), '3h 2m');
  assert.equal(S.formatUptime(2 * 86400 + 3600), '2d 1h 0m');
  assert.equal(S.formatGb(8 * 2 ** 30), '8.0 GB');
});

test('trayText', () => {
  const s = { cpu: 12.4, gpu: null, memPct: 55.5 };
  assert.equal(S.trayText('CPU', s), 'CPU 12%');
  assert.equal(S.trayText('GPU', s), 'GPU --%');
  assert.equal(S.trayText('RAM', s), 'RAM 56%');
});
