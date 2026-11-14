import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const root = process.cwd();
const targetId = process.env.TESTORBIT_DEVICE_ID || '5200f9c0b49f25b9';
const packages = (process.env.TESTORBIT_TEST_PACKAGES || 'com.pgi.savera_storewell,com.pgi.saverastaff').split(',').map((x) => x.trim()).filter(Boolean);
const date = new Date().toISOString().slice(0, 10), time = new Date().toISOString().slice(11, 19).replace(/:/g, '');
const reportDir = path.join(root, '.testorbit', 'test-reports', date, time + '-samsung-device-' + randomUUID().slice(0, 8));
await fs.mkdir(reportDir, { recursive: true });
const checks = [];
let deviceInfo = null;
const client = new Client({ name: 'testorbit-samsung-device-regression', version: '1.0.0' });
const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(root, 'build', 'cli', 'index.js'), 'mcp'], cwd: root });
const textOf = (r) => (r.content || []).filter((x) => x.type === 'text').map((x) => x.text).join('\n');
async function call(name, args) { const r = await client.callTool({ name, arguments: args }); if (r.isError) throw new Error(name + ' failed: ' + textOf(r)); return textOf(r).slice(0, 4000); }
try {
  await client.connect(transport);
  const devices = await call('list_devices', {}); checks.push({ name: 'list_devices', status: 'passed', details: devices });
  if (!devices.includes(targetId)) throw new Error('Configured device ' + targetId + ' is not listed by TestOrbit. Connect/unlock the phone and authorize ADB.');
  const doctor = await call('doctor', {});
  checks.push({ name: 'doctor', status: /\[FAIL\]/i.test(doctor) ? 'failed' : 'passed', details: doctor.slice(0, 1000) });
  if (/\[FAIL\]/i.test(doctor)) throw new Error('TestOrbit doctor reported required toolchain failures.');
  const adb = process.env.ADB_PATH || 'adb';
  const model = execFileSync(adb, ['-s', targetId, 'shell', 'getprop', 'ro.product.model'], { encoding: 'utf8', timeout: 10000 }).trim();
  const release = execFileSync(adb, ['-s', targetId, 'shell', 'getprop', 'ro.build.version.release'], { encoding: 'utf8', timeout: 10000 }).trim();
  deviceInfo = { model, androidRelease: release };
  checks.push({ name: 'device-identity', status: /SM-J720|J7|Samsung/i.test(model) && release === '10' ? 'passed' : 'failed', details: deviceInfo });
  if (!/SM-J720|J7|Samsung/i.test(model) || release !== '10') throw new Error('Connected device does not match the expected Samsung Galaxy J7 Duo / Android 10 profile: ' + JSON.stringify(deviceInfo));
  for (const packageId of packages) {
    const entry = { name: 'app-smoke', packageId, checks: [], status: 'passed' };
    try {
      await call('launch_app_device', { packageId, targetId }); entry.checks.push({ name: 'launch_app_device', status: 'passed' });
      await new Promise((resolve) => setTimeout(resolve, 1800));
      entry.checks.push({ name: 'snapshot_ui', status: 'passed', details: (await call('snapshot_ui', { targetId, projectPath: root })).slice(0, 1200) });
      entry.checks.push({ name: 'screenshot', status: 'passed', details: (await call('screenshot', { targetId, projectPath: root })).slice(0, 500) });
      entry.checks.push({ name: 'is_keyboard_visible', status: 'passed', details: (await call('is_keyboard_visible', { targetId })).slice(0, 500) });
    } catch (e) { entry.status = 'failed'; entry.error = e instanceof Error ? e.message : String(e); entry.checks.push({ name: 'app-smoke', status: 'failed', error: entry.error }); }
    checks.push(entry);
  }
} catch (e) { checks.push({ name: 'device-preflight', status: 'failed', error: e instanceof Error ? e.message : String(e) }); }
finally { try { await client.close(); } catch { /* client may already be closed */ } }
const failed = checks.some((x) => x.status === 'failed' || (Array.isArray(x.checks) && x.checks.some((c) => c.status === 'failed')));
const report = { schemaVersion: 1, deviceInfo, runId: path.basename(reportDir).split('-').slice(-1)[0], deviceId: targetId, expectedDevice: 'Samsung Galaxy J7 Duo / Android 10', packages, status: failed ? 'failed' : 'passed', checks, note: 'Device-backed launch/snapshot/screenshot/keyboard smoke only; this is not full business-flow E2E coverage.' };
await fs.writeFile(path.join(reportDir, 'summary.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');
await fs.writeFile(path.join(reportDir, 'summary.md'), ['# Samsung Device Regression', '', '- Status: ' + report.status.toUpperCase(), '- Device ID: ' + targetId, '- Expected device: Samsung Galaxy J7 Duo / Android 10', '- Packages: ' + packages.join(', '), '', '## Checks', ...checks.map((x) => '- **' + x.status.toUpperCase() + '** ' + x.name + (x.packageId ? ' (' + x.packageId + ')' : '') + (x.error ? ' — ' + x.error : '')), '', report.note, ''].join('\n'), 'utf8');
process.stdout.write(JSON.stringify({ ...report, reportDirectory: path.relative(root, reportDir).split(path.sep).join('/') }, null, 2) + '\n');
if (failed) process.exitCode = 1;
