import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const installRoot = path.resolve(process.argv[2] ?? '');
const expectedVersion = process.argv[3];
if (!process.argv[2] || !expectedVersion) throw new Error('Usage: node scripts/smoke-published-package.mjs <install-root> <expected-version>');
const pkg = JSON.parse(fs.readFileSync(path.join(installRoot, 'node_modules', 'testorbit', 'package.json'), 'utf8'));
if (pkg.version !== expectedVersion) throw new Error('Installed version mismatch: expected ' + expectedVersion + ', got ' + pkg.version);
const bin = path.join(installRoot, 'node_modules', '.bin', 'testorbit');
function run(args) { const r = spawnSync(bin, args, { encoding: 'utf8', timeout: 15000 }); if (r.error) throw r.error; if (r.status !== 0) throw new Error('CLI failed: ' + args.join(' ') + '\n' + r.stderr); return r.stdout; }
run(['--help']);
const inventory = JSON.parse(run(['tools', '--json']));
for (const name of ['run_unified_test_run', 'tap_text', 'clear_and_type_text', 'validate_test_evidence_bundle']) if (!inventory.some((x) => x.tool === name)) throw new Error('CLI inventory missing ' + name);
const client = new Client({ name: 'testorbit-published-smoke', version: '1.0.0' });
const transport = new StdioClientTransport({ command: bin, args: ['mcp'], cwd: installRoot });
try {
  await client.connect(transport);
  const listed = await client.listTools();
  for (const name of ['run_unified_test_run', 'tap_text', 'clear_and_type_text', 'validate_test_evidence_bundle']) if (!listed.tools.some((x) => x.name === name)) throw new Error('MCP tools/list missing ' + name);
  process.stdout.write(JSON.stringify({ status: 'passed', version: pkg.version, cliHelp: 'passed', cliToolCount: inventory.length, mcpInitialize: 'passed', mcpToolsList: 'passed' }, null, 2) + '\n');
} finally { await client.close(); }
