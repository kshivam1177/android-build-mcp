import { randomUUID } from 'node:crypto';
import { AutomationError, type DriverConfig, type DriverSession, type PlatformDriver, type PlatformKind } from './contracts.js';

export interface ManagedSession {
  readonly session: DriverSession;
  readonly driver: PlatformDriver;
  readonly config: DriverConfig;
}

/**
 * Owns driver lifecycle and guarantees reverse-order cleanup. A failed connect
 * is never published as an active session.
 */
export class DriverSessionManager {
  private readonly sessions = new Map<string, ManagedSession>();
  private readonly connecting = new Set<string>();

  async open(driver: PlatformDriver, config: DriverConfig, signal?: AbortSignal): Promise<ManagedSession> {
    if (driver.platform !== config.platform) {
      throw new AutomationError('INVALID_SPEC', 'Driver platform does not match target configuration.', {
        driver: driver.platform, configured: config.platform
      });
    }
    const reservation = randomUUID();
    if (this.connecting.has(config.targetId ?? reservation)) {
      throw new AutomationError('CONNECTION_FAILED', 'A connection is already being established for this target.');
    }
    const targetKey = config.targetId ?? reservation;
    this.connecting.add(targetKey);
    try {
      if (signal?.aborted) throw new AutomationError('CANCELLED', 'Connection was cancelled.');
      const session = await driver.connect(config, signal);
      const managed = { session, driver, config };
      this.sessions.set(session.id, managed);
      return managed;
    } catch (error) {
      throw error instanceof AutomationError ? error
        : new AutomationError('CONNECTION_FAILED', 'Could not establish platform session.', { platform: config.platform }, { cause: error });
    } finally {
      this.connecting.delete(targetKey);
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
    await managed.driver.disconnect();
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
