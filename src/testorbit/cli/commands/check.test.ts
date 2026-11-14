/**
 * `orbit check` CLI tests — the command prints the check report and
 * exits 0 on the clean tree, 1 when a rule fails.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCheckCommand } from './check.js';
import { GenerateMapUseCase } from '../../application/generate-map.js';
import { toScreenId } from '../../domain/types.js';
import { writeFixtureScreenTree } from '../../test-fixtures/variants.js';

describe('runCheckCommand', () => {
  let projectRoot: string;
  let output: string;

  beforeEach(() => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'testorbit-cli-check-'));
    output = '';
    writeFixtureScreenTree(projectRoot, 'android', toScreenId('login'));
  });

  afterEach(() => {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it('exits 0 on the clean tree and prints the report', async () => {
    new GenerateMapUseCase().generate({ projectRoot, platform: 'android' });
    const code = await runCheckCommand({
      projectRoot,
      platform: 'android',
      write: (text) => {
        output += text;
      },
    });
    expect(code).toBe(0);
    expect(output).toContain('"passed": true');
  });

  it('exits 1 when the map was never generated', async () => {
    const code = await runCheckCommand({
      projectRoot,
      platform: 'android',
      write: (text) => {
        output += text;
      },
    });
    expect(code).toBe(1);
    expect(output).toContain('MAP_MISSING');
  });
});
