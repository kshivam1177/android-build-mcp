import { execCommand } from '../../utils/exec.js';
import { AutomationError } from '../contracts.js';

export interface IosSimulator {
  udid: string;
  name: string;
  state: string;
  isAvailable: boolean;
  runtime: string;
  deviceTypeIdentifier?: string;
}
export interface SimulatorManagerOptions {
  osPlatform?: NodeJS.Platform;
  timeoutMs?: number;
  runCommand?: (command: string, args: string[]) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
}
type SimctlDevice = { udid?: string; name?: string; state?: string; isAvailable?: boolean; deviceTypeIdentifier?: string };
type SimctlList = { devices?: Record<string, SimctlDevice[]> };

function assertMacOS(platform: NodeJS.Platform): void {
  if (platform !== 'darwin') throw new AutomationError('UNSUPPORTED_CAPABILITY', 'iOS simulator lifecycle commands require macOS and Xcode.');
}
function assertUdid(udid: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(udid)) {
    throw new AutomationError('INVALID_SPEC', 'A valid iOS simulator UDID is required.');
  }
}
async function command(args: string[], options: SimulatorManagerOptions) {
  const run = options.runCommand ?? (async (cmd: string, argv: string[]) => {
    const result = await execCommand(cmd, argv, { timeoutMs: options.timeoutMs ?? 120000 });
    return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode };
  });
  const result = await run('xcrun', ['simctl', ...args]);
  if (result.exitCode !== 0) throw new AutomationError('ACTION_FAILED', 'xcrun simctl command failed.', { args, stderr: result.stderr.slice(0, 1500), exitCode: result.exitCode });
  return result.stdout;
}

export async function listIosSimulators(options: SimulatorManagerOptions = {}): Promise<IosSimulator[]> {
  assertMacOS(options.osPlatform ?? process.platform);
  const output = await command(['list', 'devices', '--json'], options);
  let parsed: SimctlList;
  try { parsed = JSON.parse(output) as SimctlList; }
  catch (error) { throw new AutomationError('ACTION_FAILED', 'simctl returned invalid device-list JSON.', {}, { cause: error }); }
  const devices: IosSimulator[] = [];
  for (const [runtime, entries] of Object.entries(parsed.devices ?? {})) {
    for (const device of entries) {
      if (!device.udid || !device.name) continue;
      devices.push({
        udid: device.udid, name: device.name, state: device.state ?? 'Unknown',
        isAvailable: device.isAvailable !== false, runtime,
        ...(device.deviceTypeIdentifier ? { deviceTypeIdentifier: device.deviceTypeIdentifier } : {})
      });
    }
  }
  return devices;
}

export async function setIosSimulatorState(
  udid: string,
  action: 'boot' | 'shutdown',
  options: SimulatorManagerOptions = {}
): Promise<{ simulator: IosSimulator; action: 'boot' | 'shutdown'; changed: boolean }> {
  assertMacOS(options.osPlatform ?? process.platform);
  assertUdid(udid);
  const devices = await listIosSimulators(options);
  const simulator = devices.find((device) => device.udid.toLowerCase() === udid.toLowerCase());
  if (!simulator) throw new AutomationError('INVALID_SPEC', 'The requested simulator UDID was not found.', { udid });
  if (!simulator.isAvailable) throw new AutomationError('UNSUPPORTED_CAPABILITY', 'The requested simulator runtime is unavailable.', { udid, runtime: simulator.runtime });
  const desiredState = action === 'boot' ? 'Booted' : 'Shutdown';
  if (simulator.state === desiredState) return { simulator, action, changed: false };
  await command(action === 'boot' ? ['boot', udid] : ['shutdown', udid], options);
  if (action === 'boot') await command(['bootstatus', udid, '-b'], options);
  return { simulator: { ...simulator, state: desiredState }, action, changed: true };
}
