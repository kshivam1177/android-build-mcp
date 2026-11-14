/**
 * `orbit rename-screen` CLI tests — the command renames the screen
 * and prints the backup path and rewritten files.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runRenameScreenCommand } from './rename-screen.js';
import { toScreenId } from '../../domain/types.js';
import { writeFixtureScreenTree } from '../../test-fixtures/variants.js';

describe('runRenameScreenCommand', () => {
  let projectRoot: string;
  let output: string;

  beforeEach(() => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'testorbit-cli-rename-'));
    output = '';
    writeFixtureScreenTree(projectRoot, 'android', toScreenId('login'));
  });

  afterEach(() => {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it('renames the screen and prints the summary', async () => {
    const code = await runRenameScreenCommand({
      projectRoot,
      platform: 'android',
      fromScreenId: toScreenId('login'),
      toScreenId: toScreenId('signin'),
      write: (text) => {
        output += text;
      },
    });
    expect(code).toBe(0);
    expect(output).toContain('signin');
    expect(output).toContain('.rename-backup-login-');
    expect(fs.existsSync(path.join(projectRoot, '.testorbit', 'android', 'screens', 'signin'))).toBe(true);
  });
});
