import { randomUUID } from 'node:crypto';
import { AutomationError, type DriverConfig, type DriverSession, type PlatformDriver, type PlatformKind } from './contracts.js';

const driverLeases = new WeakMap<PlatformDriver, symbol>();
const targetLeases = new Map<string, symbol>();

export interface ManagedSession {
  readonly session: DriverSession;
  readonly driver: PlatformDriver;
  readonly config: DriverConfig;
  readonly targetKey: string;
  readonly leaseToken: symbol;
}

/**
 * Owns driver lifecycle and guarantees reverse-order cleanup. A failed connect
 * is never published as an active session.
 */
export class DriverSessionManager {
  private readonly sessions = new Map<string, ManagedSession>();

  async open(driver: PlatformDriver, config: DriverConfig, signal?: AbortSignal): Promise<ManagedSession> {
    if (driver.platform !== config.platform) {
      throw new AutomationError('INVALID_SPEC', 'Driver platform does not match target configuration.', {
        driver: driver.platform, configured: config.platform
      });
    }
    const reservation = randomUUID();
    if (driverLeases.has(driver)) {
      throw new AutomationError('CONNECTION_FAILED', 'This driver instance is already reserved by another session. Use a separate driver instance for each concurrent run.', { platform: config.platform });
    }
    const configuredTarget = config.targetId ?? (config.platform === 'ios'
      ? String(config.metadata?.udid ?? config.metadata?.deviceName ?? 'default-simulator')
      : undefined);
    const targetKey = config.platform + ':' + (configuredTarget ?? reservation);
    if (targetLeases.has(targetKey)) {
      throw new AutomationError('CONNECTION_FAILED', 'A connection is already being established for this target.');
    }
    const leaseToken = Symbol(targetKey);
    driverLeases.set(driver, leaseToken);
    targetLeases.set(targetKey, leaseToken);
    let connected = false;
    try {
      if (signal?.aborted) throw new AutomationError('CANCELLED', 'Connection was cancelled.');
      const session = await driver.connect(config, signal);
      connected = true;
      if (signal?.aborted) {
        await driver.disconnect();
        throw new AutomationError('CANCELLED', 'Connection was cancelled after the driver connected.');
      }
      const managed = { session, driver, config, targetKey, leaseToken };
      this.sessions.set(session.id, managed);
      return managed;
    } catch (error) {
      if (!connected) {
        try { await driver.disconnect(); } catch { /* Preserve connection failure; cleanup is best-effort. */ }
      }
      if (driverLeases.get(driver) === leaseToken) driverLeases.delete(driver);
      if (targetLeases.get(targetKey) === leaseToken) targetLeases.delete(targetKey);
      throw error instanceof AutomationError ? error
        : new AutomationError('CONNECTION_FAILED', 'Could not establish platform session.', { platform: config.platform }, { cause: error });
    }
  }

  get(sessionId: string, expectedPlatform?: PlatformKind): ManagedSession {
    const managed = this.sessions.get(sessionId);
    if (!managed) throw new AutomationError('SESSION_CLOSED', 'Session is not active.', { sessionId });
    if (expectedPlatform && managed.session.platform !== expectedPlatform) {
      throw new AutomationError('INVALID_SPEC', 'Session platform mismatch.', { expectedPlatform, actualPlatform: managed.session.platform });
    }
    return managed;
  }

  async close(sessionId: string): Promise<void> {
    const managed = this.sessions.get(sessionId);
    if (!managed) return;
    this.sessions.delete(sessionId);
    try { await managed.driver.disconnect(); }
    finally {
      if (driverLeases.get(managed.driver) === managed.leaseToken) driverLeases.delete(managed.driver);
      if (targetLeases.get(managed.targetKey) === managed.leaseToken) targetLeases.delete(managed.targetKey);
    }
  }

  async closeAll(): Promise<void> {
    const active = [...this.sessions.keys()].reverse();
    const failures: unknown[] = [];
    for (const id of active) {
      try { await this.close(id); } catch (error) { failures.push(error); }
    }
    if (failures.length) {
      throw new AutomationError('ACTION_FAILED', 'One or more platform sessions failed to disconnect.', {
        failedSessions: failures.length
      }, { cause: failures[0] });
    }
  }

  list(): readonly ManagedSession[] { return [...this.sessions.values()]; }
}
