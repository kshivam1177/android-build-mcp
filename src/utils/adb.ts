import { execCommand } from './exec.js';
import type { ExecOptions } from './exec.js';
import { loadConfig } from '../config/loader.js';
import { getEffectiveSessionDefaults } from '../session/defaults.js';
import { AndroidBuildMcpError } from '../types.js';
import type { TargetInfo } from '../types.js';

export function getAdbPath(): string {
  return loadConfig().paths.adbPath || 'adb';
}

export async function runAdb(args: string[], options: Pick<ExecOptions, 'timeoutMs' | 'cwd' | 'signal'> = {}) {
  try {
    return await execCommand(getAdbPath(), args, options);
  } catch (err) {
    if (err instanceof AndroidBuildMcpError && err.code === 'COMMAND_FAILED' && /not found on PATH/.test(err.message)) {
      throw new AndroidBuildMcpError(
        'ADB_NOT_FOUND',
        `adb was not found (looked for "${getAdbPath()}"). Set paths.adbPath in .androidmcp-framework/config.yaml, or add Android SDK platform-tools to PATH.`
      );
    }
    throw err;
  }
}

export async function runAdbForTarget(
  targetId: string,
  args: string[],
  options: Pick<ExecOptions, 'timeoutMs' | 'cwd'> = {}
) {
  return runAdb(['-s', targetId, ...args], options);
}

export async function runAdbShell(targetId: string, shellArgs: string[], options: Pick<ExecOptions, 'timeoutMs' | 'signal'> = {}) {
  return runAdbForTarget(targetId, ['shell', ...shellArgs], options);
}

function parseDevicesOutput(stdout: string): TargetInfo[] {
  const lines = stdout
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('List of devices attached') && !l.startsWith('*'));

  const targets: TargetInfo[] = [];
  for (const line of lines) {
    const parts = line.split(/\s+/);
    const id = parts[0];
    const state = parts[1];
    if (!id || !state) continue;
    const info: Record<string, string> = {};
    for (const part of parts.slice(2)) {
      const idx = part.indexOf(':');
      if (idx > 0) info[part.slice(0, idx)] = part.slice(idx + 1);
    }
    targets.push({
      id,
      type: id.startsWith('emulator-') ? 'emulator' : 'physical',
      state,
      product: info.product,
      model: info.model,
      transportId: info.transport_id,
    });
  }
  return targets;
}

/** `adb devices -l`, normalized, with AVD names resolved for booted emulators
 * via the emulator console (`adb emu avd name`). Never throws just because an
 * emulator's console isn't reachable - avdName is simply left unset. */
export async function listTargets(): Promise<TargetInfo[]> {
  const result = await runAdb(['devices', '-l']);
  const targets = parseDevicesOutput(result.stdout);
  await Promise.all(
    targets
      .filter((t) => t.type === 'emulator' && t.state === 'device')
      .map(async (t) => {
        try {
          const avd = await runAdbForTarget(t.id, ['emu', 'avd', 'name'], { timeoutMs: 5_000 });
          const name = avd.stdout.split('\n')[0]?.trim();
          if (name && !/^ERROR|^KO$/i.test(name)) t.avdName = name;
        } catch {
          // Emulator console not reachable - not fatal, avdName stays unset.
        }
      })
  );
  return targets;
}

export interface ResolveTargetOptions {
  requestedId?: string;
}

/**
 * The core of "support both automatically": explicit targetId wins; then the
 * active session default; then auto-select if exactly one target is ready;
 * otherwise fail loudly and list the candidates rather than guessing.
 */
export async function resolveTarget(options: ResolveTargetOptions = {}): Promise<TargetInfo> {
  const targets = await listTargets();
  const requested = options.requestedId ?? getEffectiveSessionDefaults().defaults.targetId ?? undefined;

  if (requested) {
    const match = targets.find((t) => t.id === requested);
    if (!match) {
      throw new AndroidBuildMcpError(
        'TARGET_NOT_FOUND',
        `No connected target with id "${requested}". Run list_devices to see what's connected.`,
        { requested, connected: targets.map((t) => t.id) }
      );
    }
    if (match.state !== 'device') {
      throw new AndroidBuildMcpError(
        'TARGET_OFFLINE',
        `Target "${requested}" is connected but in state "${match.state}", not "device".`,
        { requested, state: match.state }
      );
    }
    return match;
  }

  const ready = targets.filter((t) => t.state === 'device');
  if (ready.length === 0) {
    throw new AndroidBuildMcpError(
      'NO_TARGET_CONNECTED',
      'No emulator or physical device is connected and ready. Boot an emulator or plug in a device with USB debugging enabled, then retry.'
    );
  }
  if (ready.length > 1) {
    throw new AndroidBuildMcpError(
      'MULTIPLE_TARGETS_CONNECTED',
      `${ready.length} targets are connected. Pass targetId explicitly, or pin one with session_set_defaults.`,
      { candidates: ready.map((t) => ({ id: t.id, type: t.type, avdName: t.avdName, model: t.model })) }
    );
  }
  const [only] = ready;
  if (!only) {
    throw new AndroidBuildMcpError('NO_TARGET_CONNECTED', 'No emulator or physical device is connected and ready.');
  }
  return only;
}
