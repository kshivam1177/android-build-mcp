import { execCommand } from '../utils/exec.js';
import type { PlatformKind } from './contracts.js';

export type PreflightStatus = 'ready' | 'warning' | 'blocked';
export interface PreflightCheck {
  id: string;
  platform: PlatformKind;
  status: PreflightStatus;
  summary: string;
  command?: string;
  details?: string;
  remediation?: string;
}
export interface PlatformPreflightResult {
  checkedAt: string;
  ready: boolean;
  platforms: PlatformKind[];
  checks: PreflightCheck[];
}
export interface PreflightOptions {
  osPlatform?: NodeJS.Platform;
  commandTimeoutMs?: number;
  runCommand?: (command: string, args: string[]) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
  flutterOsPlatform?: 'android' | 'ios';
}

/**
 * Read-only host/runtime diagnostics. It never installs packages, boots devices,
 * changes simulator state, or opens an application.
 */
export async function inspectPlatformReadiness(
  platforms: PlatformKind[],
  options: PreflightOptions = {}
): Promise<PlatformPreflightResult> {
  const host = options.osPlatform ?? process.platform;
  const run = options.runCommand ?? (async (command: string, args: string[]) => {
    const result = await execCommand(command, args, { timeoutMs: options.commandTimeoutMs ?? 5000 });
    return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode };
  });
  const checks: PreflightCheck[] = [];
  const checkCommand = async (platform: PlatformKind, id: string, command: string, args: string[], remediation: string) => {
    try {
      const result = await run(command, args);
      const ok = result.exitCode === 0;
      checks.push({
        id, platform, status: ok ? 'ready' : 'blocked',
        summary: ok ? command + ' is available.' : command + ' returned a non-zero exit code.',
        command: [command, ...args].join(' '),
        details: (result.stdout || result.stderr).trim().slice(0, 1200),
        ...(!ok ? { remediation } : {})
      });
      return ok;
    } catch (error) {
      checks.push({
        id, platform, status: 'blocked', summary: command + ' could not be executed.',
        command: [command, ...args].join(' '),
        details: error instanceof Error ? error.message : String(error),
        remediation
      });
      return false;
    }
  };

  for (const platform of [...new Set(platforms)]) {
    if (platform === 'android') {
      await checkCommand(platform, 'adb-version', process.env.ADB || 'adb', ['version'], 'Install Android SDK Platform Tools and ensure adb is on PATH.');
      await checkCommand(platform, 'adb-targets', process.env.ADB || 'adb', ['devices', '-l'], 'Start an emulator or connect and authorize an Android device; provide its serial as targetId.');
    } else if (platform === 'flutter') {
      const osPlatform = options.flutterOsPlatform;
      if (!osPlatform) {
        checks.push({ id: 'flutter-os-platform', platform, status: 'blocked', summary: 'Flutter target OS is not specified.', remediation: 'Set target metadata.osPlatform to android or ios.' });
      } else {
        checks.push({ id: 'flutter-os-platform', platform, status: 'ready', summary: 'Flutter will use the ' + osPlatform + ' accessibility adapter.' });
        if (osPlatform === 'android') {
          await checkCommand(platform, 'flutter-adb', process.env.ADB || 'adb', ['devices', '-l'], 'Start or connect an authorized Android target.');
        } else if (host !== 'darwin') {
          checks.push({ id: 'flutter-ios-host', platform, status: 'blocked', summary: 'Flutter iOS black-box automation requires a macOS host.', remediation: 'Run this target on macOS with Xcode and an iOS simulator or device.' });
        } else {
          await checkCommand(platform, 'flutter-ios-xcode', 'xcodebuild', ['-version'], 'Install Xcode and select the active developer directory.');
          await checkCommand(platform, 'flutter-ios-appium', 'appium', ['--version'], 'Install Appium 2 and the XCUITest driver.');
        }
      }
    } else if (platform === 'ios') {
      if (host !== 'darwin') {
        checks.push({ id: 'ios-host', platform, status: 'blocked', summary: 'Native iOS automation requires macOS.', remediation: 'Run on macOS with Xcode, Appium 2 and the XCUITest driver.' });
      } else {
        await checkCommand(platform, 'ios-xcode', 'xcodebuild', ['-version'], 'Install Xcode and select the active developer directory.');
        await checkCommand(platform, 'ios-appium', 'appium', ['--version'], 'Install Appium 2 and the XCUITest driver.');
        await checkCommand(platform, 'ios-xcuitest-driver', 'appium', ['driver', 'list', '--installed'], 'Install the Appium XCUITest driver with appium driver install xcuitest.');
      }
    } else if (platform === 'web') {
      await checkCommand(platform, 'agent-browser-version', process.env.AGENT_BROWSER_PATH || 'agent-browser', ['--version'], 'Install Agent Browser and ensure its CLI is available on PATH or set AGENT_BROWSER_PATH.');
    }
  }
  return {
    checkedAt: new Date().toISOString(),
    ready: checks.every((check) => check.status !== 'blocked'),
    platforms: [...new Set(platforms)],
    checks
  };
}
