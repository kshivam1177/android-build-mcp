import { describe, expect, it, vi } from 'vitest';
import { listIosSimulators, setIosSimulatorState } from '../simulator.js';

const udid = 'AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE';
const listJson = JSON.stringify({ devices: {
  'com.apple.CoreSimulator.SimRuntime.iOS-18-0': [
    { udid, name: 'iPhone 16', state: 'Shutdown', isAvailable: true, deviceTypeIdentifier: 'com.apple.CoreSimulator.SimDeviceType.iPhone-16' }
  ]
} });

describe('iOS simulator lifecycle manager', () => {
  it('lists normalized simulator inventory', async () => {
    const runCommand = vi.fn(async (_command: string, _args: string[]) => ({ stdout: listJson, stderr: '', exitCode: 0 }));
    const devices = await listIosSimulators({ osPlatform: 'darwin', runCommand });
    expect(devices).toMatchObject([{ udid, name: 'iPhone 16', state: 'Shutdown', isAvailable: true }]);
    expect(runCommand).toHaveBeenCalledWith('xcrun', ['simctl', 'list', 'devices', '--json']);
  });

  it('boots a simulator and waits for boot completion', async () => {
    const runCommand = vi.fn(async (_command: string, _args: string[]) => ({ stdout: '', stderr: '', exitCode: 0 }))
      .mockResolvedValueOnce({ stdout: listJson, stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 });
    const result = await setIosSimulatorState(udid, 'boot', { osPlatform: 'darwin', runCommand });
    expect(result).toMatchObject({ action: 'boot', changed: true, simulator: { state: 'Booted' } });
    expect(runCommand.mock.calls.map((call) => call[1])).toEqual([
      ['simctl', 'list', 'devices', '--json'], ['simctl', 'boot', udid], ['simctl', 'bootstatus', udid, '-b']
    ]);
  });

  it('does not issue duplicate boot commands for an already booted simulator', async () => {
    const booted = JSON.stringify({ devices: { runtime: [{ udid, name: 'iPhone 16', state: 'Booted', isAvailable: true }] } });
    const runCommand = vi.fn(async (_command: string, _args: string[]) => ({ stdout: booted, stderr: '', exitCode: 0 }));
    const result = await setIosSimulatorState(udid, 'boot', { osPlatform: 'darwin', runCommand });
    expect(result.changed).toBe(false);
    expect(runCommand).toHaveBeenCalledOnce();
  });

  it('rejects invalid UDIDs and non-macOS hosts before running commands', async () => {
    const runCommand = vi.fn();
    await expect(setIosSimulatorState('not-a-udid', 'boot', { osPlatform: 'darwin', runCommand })).rejects.toMatchObject({ code: 'INVALID_SPEC' });
    await expect(listIosSimulators({ osPlatform: 'linux', runCommand })).rejects.toMatchObject({ code: 'UNSUPPORTED_CAPABILITY' });
    expect(runCommand).not.toHaveBeenCalled();
  });
});
