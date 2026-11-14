/**
 * `orbit learn` CLI tests — learns a variant from a hierarchy dump
 * file (the command `detect` prints on the unknown path).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runLearnCommand } from './learn.js';
import { toElementId, toScreenId, toVariantId } from '../../domain/types.js';
import { freshNodes } from '../../test-fixtures/variants.js';

describe('runLearnCommand', () => {
  let projectRoot: string;
  let dumpFile: string;
  let output: string;

  beforeEach(() => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'testorbit-cli-learn-'));
    output = '';
    dumpFile = path.join(projectRoot, 'dump.json');
    fs.writeFileSync(
      dumpFile,
      JSON.stringify({
        nodes: freshNodes(toScreenId('login'), ['login.username', 'login.password', 'login.submit', 'login.help', 'login.back']),
        display: { width: 1080, height: 2400 },
      }),
      'utf8',
    );
  });

  afterEach(() => {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it('learns the variant and prints its path', async () => {
    const code = await runLearnCommand({
      projectRoot,
      platform: 'android',
      screenId: toScreenId('login'),
      variantId: toVariantId('login.password'),
      requiredIds: [toElementId('login.submit')],
      hierarchyFile: dumpFile,
      write: (text) => {
        output += text;
      },
    });
    expect(code).toBe(0);
    expect(output).toContain('login.password');
    expect(
      fs.existsSync(
        path.join(projectRoot, '.testorbit', 'android', 'screens', 'login', 'variants', 'login.password.json'),
      ),
    ).toBe(true);
  });
});
