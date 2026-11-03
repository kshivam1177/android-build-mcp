import { randomUUID } from 'node:crypto';
import { AutomationError, type DriverConfig, type PlatformAction, type PlatformDriver, type PlatformKind } from './contracts.js';
import { DriverSessionManager } from './session.js';
import type { AutomationTestDefinition, AutomationTestStep } from './specification.js';

export interface PlatformRunResult {
  platform: PlatformKind; sessionId?: string; success: boolean; startedAt: string; durationMs: number;
  steps: Array<{ id: string; type: string; status: 'passed' | 'failed' | 'skipped'; durationMs: number; error?: string }>;
  error?: string;
}
export interface AutomationRunResult { runId: string; testId: string; success: boolean; startedAt: string; durationMs: number; platforms: PlatformRunResult[]; }
export interface AutomationEngineOptions {
  drivers: Partial<Record<PlatformKind, PlatformDriver>>;
  sessions?: DriverSessionManager;
  onStep?: (event: { runId: string; platform: PlatformKind; stepId: string; status: 'started' | 'passed' | 'failed' }) => void;
}

/** Deterministic multi-platform runner. Platform failures are isolated; AI is not called from this execution path. */
export class AutomationEngine {
  private readonly sessions: DriverSessionManager;
  constructor(private readonly options: AutomationEngineOptions) { this.sessions = options.sessions ?? new DriverSessionManager(); }
  async run(definition: AutomationTestDefinition, options: { signal?: AbortSignal; variables?: Record<string, string | number | boolean> } = {}): Promise<AutomationRunResult> {
    const runId = randomUUID(); const startedAt = new Date().toISOString(); const started = Date.now();
    const results: PlatformRunResult[] = []; const variables = { ...definition.variables, ...options.variables };
    for (const platform of definition.platforms) { if (options.signal?.aborted) break; results.push(await this.runPlatform(runId, definition, platform, variables, options.signal)); }
    return { runId, testId: definition.id, startedAt, durationMs: Date.now() - started, success: results.length === definition.platforms.length && results.every((r) => r.success), platforms: results };
  }
  private async runPlatform(runId: string, definition: AutomationTestDefinition, platform: PlatformKind, variables: Record<string, string | number | boolean | undefined>, signal?: AbortSignal): Promise<PlatformRunResult> {
    const startedAt = new Date().toISOString(); const started = Date.now(); const steps: PlatformRunResult['steps'] = [];
    const driver = this.options.drivers[platform];
    if (!driver) return { platform, success: false, startedAt, durationMs: Date.now() - started, steps, error: `No driver registered for platform ${platform}.` };
    let sessionId: string | undefined; let platformError: string | undefined;
    try {
      const target = definition.targets?.[platform];
      const config: DriverConfig = { platform, ...(target?.targetId ? { targetId: target.targetId } : {}), ...(target?.appId ? { appId: target.appId } : {}), ...(target?.baseUrl ? { baseUrl: target.baseUrl } : {}), ...(target?.metadata ? { metadata: target.metadata } : {}) };
      const managed = await this.sessions.open(driver, config, signal); sessionId = managed.session.id;
      const capabilities = await driver.capabilities();
      for (const step of definition.steps) {
        if (signal?.aborted) throw new AutomationError('CANCELLED', 'Test run was cancelled.');
        const stepStarted = Date.now(); this.options.onStep?.({ runId, platform, stepId: step.id, status: 'started' });
        try {
          if (step.type === 'waitFor') {
            await driver.waitFor(step.condition, step.timeoutMs, signal);
          } else {
            const action = toPlatformAction(step, variables);
            if (!capabilities.supportedActions.includes(action.type)) throw new AutomationError('UNSUPPORTED_CAPABILITY', `Platform ${platform} does not support ${action.type}.`, { platform, action: action.type });
            await driver.perform(action, signal);
          }
          steps.push({ id: step.id, type: step.type, status: 'passed', durationMs: Date.now() - stepStarted });
          this.options.onStep?.({ runId, platform, stepId: step.id, status: 'passed' });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          steps.push({ id: step.id, type: step.type, status: 'failed', durationMs: Date.now() - stepStarted, error: redact(message, variables) });
          this.options.onStep?.({ runId, platform, stepId: step.id, status: 'failed' }); platformError = message; break;
        }
      }
    } catch (error) { platformError = error instanceof Error ? error.message : String(error); }
    finally { if (sessionId) { try { await this.sessions.close(sessionId); } catch (error) { platformError ??= `Session cleanup failed: ${error instanceof Error ? error.message : String(error)}`; } } }
    return { platform, ...(sessionId ? { sessionId } : {}), success: !platformError && steps.length === definition.steps.length && steps.every((s) => s.status === 'passed'), startedAt, durationMs: Date.now() - started, steps, ...(platformError ? { error: redact(platformError, variables) } : {}) };
  }
}

function toPlatformAction(step: AutomationTestStep, variables: Record<string, string | number | boolean | undefined>): PlatformAction {
  switch (step.type) {
    case 'tap': return { type: 'tap', selector: step.selector };
    case 'type': return { type: 'type', selector: step.selector, text: interpolate(step.value, variables), ...(step.clearFirst !== undefined ? { clearFirst: step.clearFirst } : {}) };
    case 'longPress': return { type: 'longPress', selector: step.selector, ...(step.durationMs !== undefined ? { durationMs: step.durationMs } : {}) };
    case 'swipe': return { type: 'swipe', direction: step.direction, ...(step.distance !== undefined ? { distance: step.distance } : {}) };
    case 'back': return { type: 'back' };
    case 'navigate': return { type: 'navigate', url: step.url };
    case 'wait': return { type: 'wait', ...(step.timeoutMs !== undefined ? { timeoutMs: step.timeoutMs } : {}) };
    case 'waitFor': throw new AutomationError('INVALID_SPEC', 'waitFor is handled by the condition engine.');
  }
}
function interpolate(value: string, variables: Record<string, string | number | boolean | undefined>): string {
  return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_match, name: string) => { const resolved = variables[name]; if (resolved === undefined) throw new AutomationError('INVALID_SPEC', `Test variable ${name} is not defined.`); return String(resolved); });
}
function redact(message: string, variables: Record<string, string | number | boolean | undefined>): string {
  let result = message; for (const value of Object.values(variables)) if (typeof value === 'string' && value.length >= 4) result = result.split(value).join('[REDACTED]'); return result;
}