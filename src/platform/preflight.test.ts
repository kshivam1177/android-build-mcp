import { describe, expect, it } from 'vitest';
import { inspectPlatformReadiness } from './preflight.js';

describe('inspectPlatformReadiness', () => {
  it('reports missing Android tooling as blocked without throwing', async () => {
    const result = await inspectPlatformReadiness(['android'], {
      runCommand: async () => { throw new Error('not found'); }
    });
    expect(result.ready).toBe(false);
    expect(result.checks).toHaveLength(2);
    expect(result.checks.every((check) => check.status === 'blocked')).toBe(true);
    expect(result.checks[0]?.remediation).toContain('Platform Tools');
  });

  it('checks Agent Browser on Web and reports ready when installed', async () => {
    const result = await inspectPlatformReadiness(['web'], {
      runCommand: async () => ({ stdout: 'agent-browser 1.0.0', stderr: '', exitCode: 0 })
    });
    expect(result.ready).toBe(true);
    expect(result.checks).toMatchObject([{ id: 'agent-browser-version', status: 'ready' }]);
  });

  it('requires an explicit OS adapter for Flutter', async () => {
    const result = await inspectPlatformReadiness(['flutter']);
    expect(result.ready).toBe(false);
    expect(result.checks[0]).toMatchObject({ id: 'flutter-os-platform', status: 'blocked' });
  });

  it('blocks native iOS checks on non-macOS hosts', async () => {
    const result = await inspectPlatformReadiness(['ios'], { osPlatform: 'linux' });
    expect(result.ready).toBe(false);
    expect(result.checks[0]).toMatchObject({ id: 'ios-host', status: 'blocked' });
  });
});
