import { runAdbShell, getAdbPath } from '../utils/adb.js';
import { execCommandBinary } from '../utils/exec.js';
import { AndroidBuildMcpError } from '../types.js';
import type { AutomationBackend } from './backend.js';

const DUMP_PATH = '/data/local/tmp/androidmcp_dump.xml';

/**
 * `input text` interprets the literal sequence "%s" as a space. adb's shell
 * relay re-joins argv entries and can also re-tokenize on shell
 * metacharacters before they reach the on-device `input` binary, so both
 * need escaping here rather than relying on local (non-existent, since we
 * never spawn through a shell) argument quoting.
 */
export function escapeAdbInputText(text: string): string {
  let escaped = text.replace(/\\/g, '\\\\');
  escaped = escaped.replace(/([&;()<>|'"$`~*?{}[\]!#])/g, '\\$1');
  escaped = escaped.replace(/ /g, '%s');
  return escaped;
}

export const adbBackend: AutomationBackend = {
  name: 'adb',

  async isAvailable(): Promise<boolean> {
    // Plain adb input/uiautomator commands need nothing beyond adb itself
    // reaching a "device" state target, which resolveTarget() already checks
    // before any backend method is called.
    return true;
  },

  async dumpHierarchy(targetId: string, signal?: AbortSignal): Promise<string> {
    try {
      await runAdbShell(targetId, ['uiautomator', 'dump', '--compressed', DUMP_PATH], { timeoutMs: 20_000, signal });
    } catch (error) {
      if (signal?.aborted) throw error;
      await runAdbShell(targetId, ['uiautomator', 'dump', DUMP_PATH], { timeoutMs: 20_000, signal });
    }
    const result = await runAdbShell(targetId, ['cat', DUMP_PATH], { timeoutMs: 20_000, signal });
    if (!result.stdout.includes('<hierarchy')) {
      throw new AndroidBuildMcpError(
        'COMMAND_FAILED',
        'uiautomator dump did not produce a hierarchy XML - is the screen on and unlocked?',
        { stdout: result.stdout.slice(0, 2000), stderr: result.stderr.slice(0, 2000) }
      );
    }
    return result.stdout;
  },

  async tap(targetId: string, x: number, y: number, signal?: AbortSignal): Promise<void> {
    await runAdbShell(targetId, ['input', 'tap', String(Math.round(x)), String(Math.round(y))], { signal });
  },

  async longPress(targetId: string, x: number, y: number, durationMs = 600, signal?: AbortSignal): Promise<void> {
    // No dedicated "long press" input subcommand - a swipe with identical
    // start/end coordinates held for `durationMs` is the standard trick.
    const xi = String(Math.round(x));
    const yi = String(Math.round(y));
    await runAdbShell(targetId, ['input', 'swipe', xi, yi, xi, yi, String(durationMs)], { signal });
  },

  async swipe(targetId: string, startX: number, startY: number, endX: number, endY: number, durationMs = 300, signal?: AbortSignal): Promise<void> {
    await runAdbShell(targetId, [
      'input',
      'swipe',
      String(Math.round(startX)),
      String(Math.round(startY)),
      String(Math.round(endX)),
      String(Math.round(endY)),
      String(durationMs),
    ], { signal });
  },

  async drag(targetId: string, startX: number, startY: number, endX: number, endY: number, durationMs = 800, signal?: AbortSignal): Promise<void> {
    await runAdbShell(targetId, [
      'input',
      'draganddrop',
      String(Math.round(startX)),
      String(Math.round(startY)),
      String(Math.round(endX)),
      String(Math.round(endY)),
      String(durationMs),
    ], { signal });
  },

  async typeText(targetId: string, text: string, signal?: AbortSignal): Promise<void> {
    await runAdbShell(targetId, ['input', 'text', escapeAdbInputText(text)], { signal });
  },

  async keyEvent(targetId: string, keyCode: string, signal?: AbortSignal): Promise<void> {
    await runAdbShell(targetId, ['input', 'keyevent', keyCode], { signal });
  },

  async screenshot(targetId: string, signal?: AbortSignal): Promise<{ data: Buffer; mimeType: string }> {
    const result = await execCommandBinary(getAdbPath(), ['-s', targetId, 'exec-out', 'screencap', '-p'], {
      timeoutMs: 20_000, signal
    });
    if (result.exitCode !== 0 || result.stdout.length === 0) {
      throw new AndroidBuildMcpError('COMMAND_FAILED', 'screencap produced no image data.', {
        stderr: result.stderr.slice(0, 2000),
        exitCode: result.exitCode,
      });
    }
    return { data: result.stdout, mimeType: 'image/png' };
  },
};
