/**
 * `orbit generate-map` CLI tests — the command generates the map and
 * prints its path and coverage summary.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runGenerateMapCommand } from './generate-map.js';
import { toScreenId } from '../../domain/types.js';
import { writeFixtureScreenTree } from '../../test-fixtures/variants.js';

describe('runGenerateMapCommand', () => {
  let projectRoot: string;
  let output: string;

  beforeEach(() => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'testorbit-cli-genmap-'));
    output = '';
    writeFixtureScreenTree(projectRoot, 'android', toScreenId('login'));
  });

  afterEach(() => {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it('generates the map and prints the summary', async () => {
    const code = await runGenerateMapCommand({
      projectRoot,
      platform: 'android',
      write: (text) => {
        output += text;
      },
    });
    expect(code).toBe(0);
    expect(output).toContain('screen-map.json');
    expect(output).toContain('login');
    expect(fs.existsSync(path.join(projectRoot, '.testorbit', 'android', 'screen-map.json'))).toBe(true);
  });
});
