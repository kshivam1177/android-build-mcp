/**
 * `orbit record` CLI tests — dry-run (the default) prints the
 * resolved plan and writes nothing; `--no-dry-run` still touches no
 * device and says the live path is MCP.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runRecordCommand } from './record.js';
import { toScreenId } from '../../domain/types.js';
import { writeFixtureScreenTree } from '../../test-fixtures/variants.js';

describe('runRecordCommand', () => {
  let projectRoot: string;
  let planFile: string;
  let output: string;

  beforeEach(() => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'testorbit-cli-record-'));
    output = '';
    writeFixtureScreenTree(projectRoot, 'android', toScreenId('login'));
    planFile = path.join(projectRoot, 'plan.json');
    fs.writeFileSync(
      planFile,
      JSON.stringify({
        actions: [{ type: 'tap', selector: { resourceId: 'com.shop.app:id/submit' } }],
      }),
      'utf8',
    );
  });

  afterEach(() => {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it('dry-run prints the resolved steps and writes nothing', async () => {
    const before = fs.readdirSync(path.join(projectRoot, '.testorbit', 'android')).sort();
    const code = await runRecordCommand({
      projectRoot,
      platform: 'android',
      planFile,
      write: (text) => {
        output += text;
      },
    });
    expect(code).toBe(0);
    expect(output).toContain('would execute tap on login / login.password / login.submit');
    expect(output).toContain('dry-run: nothing was recorded');
    expect(fs.readdirSync(path.join(projectRoot, '.testorbit', 'android')).sort()).toEqual(before);
  });

  it('--no-dry-run prints the plan and points at the MCP recording path', async () => {
    const code = await runRecordCommand({
      projectRoot,
      platform: 'android',
      planFile,
      dryRun: false,
      write: (text) => {
        output += text;
      },
    });
    expect(code).toBe(0);
    expect(output).toContain('orbit_start_recording');
    expect(output).toContain('would execute tap');
  });
});
