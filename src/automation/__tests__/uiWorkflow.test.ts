import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadConfig, resetConfigCache } from '../../config/loader.js';
import { runUiWorkflow } from '../uiWorkflow.js';

describe('runUiWorkflow validation and path safety', () => {
  it('uses paths.androidCliPath from project config unless ANDROID_CLI_PATH overrides it', async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'ui-workflow-config-test-'));
    const root = path.join(cwd, '.testorbit');
    const workflows = path.join(root, 'workflows');
    const screens = path.join(root, 'screens');
    const cliLauncher = path.join(cwd, 'fake-android-cli');
    const previousPath = process.env.ANDROID_CLI_PATH;
    const execSpy = vi.spyOn(await import('../../utils/exec.js'), 'execCommand');

    try {
      await mkdir(workflows, { recursive: true });
      await mkdir(screens, { recursive: true });
      await writeFile(path.join(root, 'config.yaml'), `schemaVersion: 1\npaths:\n  androidCliPath: ${JSON.stringify(cliLauncher)}\n`);
      await writeFile(path.join(screens, 'home.json'), JSON.stringify({
        id: 'home',
        form: [{ id: 'hello', selector: { text: 'Hello' }, required: true }],
      }));
      await writeFile(path.join(workflows, 'smoke.json'), JSON.stringify({
        id: 'config-path-test',
        forms: { home: 'home.json' },
        actions: [{ id: 'assert-home', type: 'assert_screen', screen: 'home', timeoutMs: 1000, intervalMs: 10 }],
      }));

      delete process.env.ANDROID_CLI_PATH;
      resetConfigCache();
      const config = loadConfig({ cwd, forceReload: true });
      expect(config.paths.androidCliPath).toBe(cliLauncher);
      execSpy.mockResolvedValue({ stdout: JSON.stringify({ elements: [] }), stderr: '', exitCode: 0, command: 'fake-android', durationMs: 1 });
      const result = await runUiWorkflow({ cwd, workflowFile: 'smoke.json' });
      expect(result.success).toBe(false);
      expect(execSpy).toHaveBeenCalledWith(cliLauncher, expect.arrayContaining(['layout', '--pretty']), expect.objectContaining({ cwd: path.resolve(cwd) }));
    } finally {
      if (previousPath === undefined) delete process.env.ANDROID_CLI_PATH;
      else process.env.ANDROID_CLI_PATH = previousPath;
      execSpy.mockRestore();
      resetConfigCache();
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('rejects traversal paths before executing commands', async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'ui-workflow-test-'));
    try {
      await mkdir(path.join(cwd, '.testorbit', 'workflows'), { recursive: true });
      await expect(runUiWorkflow({ cwd, workflowFile: '../outside.json' })).rejects.toThrow(/escapes|Absolute paths/);
    } finally { await rm(cwd, { recursive: true, force: true }); }
  });

  it('rejects unsupported action types without launching Android CLI', async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'ui-workflow-test-'));
    try {
      const root = path.join(cwd, '.testorbit');
      await mkdir(path.join(root, 'workflows'), { recursive: true });
      await mkdir(path.join(root, 'screens'), { recursive: true });
      await writeFile(path.join(root, 'workflows', 'invalid.json'), JSON.stringify({
        id: 'bad-flow', forms: {}, actions: [{ id: 'bad-step', type: 'exec', command: 'whoami' }]
      }));
      await expect(runUiWorkflow({ cwd, workflowFile: 'invalid.json' })).rejects.toThrow(/supported type/);
    } finally { await rm(cwd, { recursive: true, force: true }); }
  });
});
