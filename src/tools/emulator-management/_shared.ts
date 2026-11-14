import fs from 'node:fs';
import path from 'node:path';
import { resolveAndroidHome } from '../../utils/apk.js';
import { listTargets } from '../../utils/adb.js';
import { TestOrbitFrameworkError } from '../../types.js';
import type { TargetInfo } from '../../types.js';

function binName(base: string): string {
  return process.platform === 'win32' ? `${base}.bat` : base;
}

export function findAvdmanager(): string {
  const home = resolveAndroidHome();
  const latest = path.join(home, 'cmdline-tools', 'latest', 'bin', binName('avdmanager'));
  if (fs.existsSync(latest)) return latest;

  const cmdlineToolsDir = path.join(home, 'cmdline-tools');
  if (fs.existsSync(cmdlineToolsDir)) {
    const versions = fs
      .readdirSync(cmdlineToolsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name !== 'latest')
      .map((d) => d.name)
      .sort()
      .reverse();
    for (const v of versions) {
      const candidate = path.join(cmdlineToolsDir, v, 'bin', binName('avdmanager'));
      if (fs.existsSync(candidate)) return candidate;
    }
  }

  const legacy = path.join(home, 'tools', 'bin', binName('avdmanager'));
  if (fs.existsSync(legacy)) return legacy;

  throw new TestOrbitFrameworkError(
    'FILE_NOT_FOUND',
    `avdmanager not found under ${home}/cmdline-tools or ${home}/tools/bin. Install "cmdline-tools;latest" via sdkmanager.`
  );
}

export function findEmulatorBinary(): string {
  const home = resolveAndroidHome();
  const bin = path.join(home, 'emulator', process.platform === 'win32' ? 'emulator.exe' : 'emulator');
  if (!fs.existsSync(bin)) {
    throw new TestOrbitFrameworkError(
      'FILE_NOT_FOUND',
      `emulator binary not found at ${bin}. Install the "emulator" package via sdkmanager.`
    );
  }
  return bin;
}

export interface AvdInfo {
  name: string;
  device?: string;
  path?: string;
  target?: string;
  tagAbi?: string;
}

export function parseAvdManagerListOutput(stdout: string): AvdInfo[] {
  const blocks = stdout.split(/^-+$/m);
  const avds: AvdInfo[] = [];
  for (const block of blocks) {
    const nameMatch = block.match(/Name:\s*(.+)/);
    if (!nameMatch) continue;
    avds.push({
      name: nameMatch[1]!.trim(),
      device: block.match(/Device:\s*(.+)/)?.[1]?.trim(),
      path: block.match(/Path:\s*(.+)/)?.[1]?.trim(),
      target: block.match(/Target:\s*(.+)/)?.[1]?.trim(),
      tagAbi: block.match(/Tag\/ABI:\s*(\S+)/)?.[1]?.trim(),
    });
  }
  return avds;
}

/** Poll `adb devices` until a new emulator target (not present in
 * `before`) reaches state "device", or throw TIMEOUT. */
export async function waitForNewEmulator(before: TargetInfo[], timeoutMs = 120_000): Promise<TargetInfo> {
  const beforeIds = new Set(before.map((t) => t.id));
  const start = Date.now();
  for (;;) {
    const current = await listTargets();
    const match = current.find((t) => t.type === 'emulator' && t.state === 'device' && !beforeIds.has(t.id));
    if (match) return match;
    if (Date.now() - start > timeoutMs) {
      throw new TestOrbitFrameworkError('TIMEOUT', `No new emulator reached "device" state within ${timeoutMs}ms.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
}
