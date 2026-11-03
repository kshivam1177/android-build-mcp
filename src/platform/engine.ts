import { createHash, randomUUID } from 'node:crypto';
import { AutomationError, type DriverConfig, type PlatformAction, type PlatformDriver, type PlatformKind } from './contracts.js';
import { evaluateSnapshotAssertion } from './assertions.js';
import { DriverSessionManager } from './session.js';
import { runBounded } from './orchestration.js';
import type { RunCheckpoint, RunCheckpointStore } from './checkpoint.js';
import type { AutomationTestDefinition, AutomationTestStep } from './specification.js';

export interface PlatformRunResult {
  platform: PlatformKind; sessionId?: string; success: boolean; startedAt: string; durationMs: number;
  steps: Array<{ id: string; type: string; status: 'passed' | 'failed' | 'skipped'; durationMs: number; attempts?: number; error?: string }>;
  error?: string;
  evidence?: { capturedAt: string; screenshot?: { mimeType: string; base64: string }; snapshot?: import('./contracts.js').PlatformSnapshot };
}
export interface AutomationRunResult { runId: string; testId: string; success: boolean; startedAt: string; durationMs: number; platforms: PlatformRunResult[]; }
export interface AutomationEngineOptions {
  drivers: Partial<Record<PlatformKind, PlatformDriver>>;
  sessions?: DriverSessionManager;
  onStep?: (event: { runId: string; platform: PlatformKind; stepId: string; status: 'started' | 'passed' | 'failed' }) => void;
  /** Maximum number of independent platform targets to execute simultaneously. Defaults to 2. */
  maxConcurrency?: number;
}

/** Deterministic multi-platform runner. Platform failures are isolated; AI is not called from this execution path. */
export class AutomationEngine {
  private readonly sessions: DriverSessionManager;
  constructor(private readonly options: AutomationEngineOptions) { this.sessions = options.sessions ?? new DriverSessionManager(); }
  async run(definition: AutomationTestDefinition, options: {
    signal?: AbortSignal;
    variables?: Record<string, string | number | boolean>;
    maxConcurrency?: number;
    checkpointStore?: RunCheckpointStore;
    resume?: boolean;
    /** Explicitly permits restarting platforms that were active when the prior process stopped. */
    restartInterruptedPlatforms?: boolean;
  } = {}): Promise<AutomationRunResult> {
    const started = Date.now();
    const variables = { ...definition.variables, ...options.variables };
    const definitionHash = createHash('sha256').update(JSON.stringify({ definition, variables })).digest('hex');
    const store = options.checkpointStore;
    let checkpoint: RunCheckpoint | undefined = options.resume && store ? await store.load() : undefined;

    if (checkpoint && (checkpoint.testId !== definition.id || checkpoint.definitionHash !== definitionHash)) {
      throw new AutomationError('INVALID_SPEC', 'Checkpoint does not match this test definition or its runtime variables.', {
        expectedTestId: definition.id, checkpointTestId: checkpoint.testId
      });
    }
    if (checkpoint?.activePlatforms.length && !options.restartInterruptedPlatforms) {
      throw new AutomationError('INVALID_SPEC', 'The previous process stopped while platform runs were active. Resume was blocked to avoid replaying potentially non-idempotent actions. Set restartInterruptedPlatforms=true only after reviewing the previous run.', {
        interruptedPlatforms: checkpoint.activePlatforms
      });
    }

    const startedAt = checkpoint?.startedAt ?? new Date().toISOString();
    const runId = checkpoint?.runId ?? randomUUID();
    checkpoint ??= {
      version: 1, runId, testId: definition.id, definitionHash, startedAt, updatedAt: startedAt,
      status: 'running', activePlatforms: [], completedPlatforms: []
    };
    checkpoint.status = 'running';
    checkpoint.activePlatforms = [];
    const completed = new Map(checkpoint.completedPlatforms.map((result) => [result.platform, result]));
    const pending = definition.platforms.filter((platform) => !completed.has(platform));

    let persistChain = Promise.resolve();
    const persist = (): Promise<void> => {
      if (!store) return Promise.resolve();
      checkpoint!.updatedAt = new Date().toISOString();
      const snapshot = JSON.parse(JSON.stringify(checkpoint)) as RunCheckpoint;
      persistChain = persistChain.then(() => store.save(snapshot));
      return persistChain;
    };
    await persist();

    await runBounded(
      pending,
      options.maxConcurrency ?? this.options.maxConcurrency ?? 2,
      async (platform) => {
        checkpoint!.activePlatforms.push(platform);
        await persist();
        const result = await this.runPlatform(runId, definition, platform, variables, options.signal);
        checkpoint!.activePlatforms = checkpoint!.activePlatforms.filter((active) => active !== platform);
        checkpoint!.completedPlatforms.push(result);
        completed.set(platform, result);
        await persist();
        return result;
      },
      options.signal
    );

    await persistChain;
    checkpoint.status = options.signal?.aborted ? 'cancelled' : 'completed';
    await persist();
    const platforms = definition.platforms.flatMap((platform) => {
      const result = completed.get(platform);
      return result ? [result] : [];
    });
    return {
      runId, testId: definition.id, startedAt, durationMs: Date.now() - started,
      success: !options.signal?.aborted && platforms.length === definition.platforms.length && platforms.every((result) => result.success),
      platforms
    };
  }
  private async runPlatform(runId: string, definition: AutomationTestDefinition, platform: PlatformKind, variables: Record<string, string | number | boolean | undefined>, signal?: AbortSignal): Promise<PlatformRunResult> {
    const startedAt = new Date().toISOString(); const started = Date.now(); const steps: PlatformRunResult['steps'] = [];
    const driver = this.options.drivers[platform];
    if (!driver) return { platform, success: false, startedAt, durationMs: Date.now() - started, steps, error: 'No driver registered for platform ' + platform + '.' };
    let sessionId: string | undefined; let platformError: string | undefined;
    let evidence: PlatformRunResult['evidence'];
    try {
      const target = definition.targets?.[platform];
      const config: DriverConfig = { platform, ...(target?.targetId ? { targetId: target.targetId } : {}), ...(target?.appId ? { appId: target.appId } : {}), ...(target?.baseUrl ? { baseUrl: target.baseUrl } : {}), ...(target?.metadata ? { metadata: target.metadata } : {}) };
      const managed = await this.sessions.open(driver, config, signal); sessionId = managed.session.id;
      const capabilities = await driver.capabilities();
      for (const step of definition.steps) {
        if (signal?.aborted) throw new AutomationError('CANCELLED', 'Test run was cancelled.');
        const stepStarted = Date.now(); this.options.onStep?.({ runId, platform, stepId: step.id, status: 'started' });
        let attempts = 0;
        const maxReadRetries = step.type === 'waitFor' || step.type === 'assert' ? definition.policy.maxRecoveryAttempts : 0;
        const executeStep = async (): Promise<void> => {
          if (step.type === 'waitFor') {
            await driver.waitFor(step.condition, step.timeoutMs, signal);
          } else if (step.type === 'assert') {
            const snapshot = await driver.snapshot(signal);
            const assertion = evaluateSnapshotAssertion(snapshot, step.assertion);
            if (!assertion.passed) throw new AutomationError('ACTION_FAILED', 'Assertion failed: ' + assertion.message, { assertion });
          } else {
            const action = toPlatformAction(step, variables);
            if (action.type === 'terminateApp' && !definition.policy.allowDestructiveActions) {
              throw new AutomationError('UNSUPPORTED_CAPABILITY', 'terminateApp is destructive and requires policy.allowDestructiveActions=true.');
            }
            if (!capabilities.supportedActions.includes(action.type)) throw new AutomationError('UNSUPPORTED_CAPABILITY', 'Platform ' + platform + ' does not support ' + action.type + '.', { platform, action: action.type });
            await driver.perform(action, signal);
          }
        };
        try {
          while (true) {
            attempts += 1;
            try {
              await executeStep();
              break;
            } catch (error) {
              if (attempts > maxReadRetries || !isRetryableReadOnlyFailure(step, error) || signal?.aborted) throw error;
            }
          }
          steps.push({ id: step.id, type: step.type, status: 'passed', durationMs: Date.now() - stepStarted, attempts });
          this.options.onStep?.({ runId, platform, stepId: step.id, status: 'passed' });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          steps.push({ id: step.id, type: step.type, status: 'failed', durationMs: Date.now() - stepStarted, attempts, error: redact(message, variables) });
          this.options.onStep?.({ runId, platform, stepId: step.id, status: 'failed' }); platformError = message;
          try {
            const captured = await driver.captureEvidence();
            evidence = { capturedAt: captured.capturedAt, ...(captured.screenshot ? { screenshot: { mimeType: captured.screenshot.mimeType, base64: captured.screenshot.data.toString('base64') } } : {}), ...(captured.snapshot ? { snapshot: captured.snapshot } : {}) };
          } catch { /* Preserve the original step failure if evidence capture also fails. */ }
          break;
        }
      }
    } catch (error) { platformError = error instanceof Error ? error.message : String(error); }
    finally { if (sessionId) { try { await this.sessions.close(sessionId); } catch (error) { platformError ??= 'Session cleanup failed: ' + (error instanceof Error ? error.message : String(error)); } } }
    return { platform, ...(sessionId ? { sessionId } : {}), success: !platformError && steps.length === definition.steps.length && steps.every((s) => s.status === 'passed'), startedAt, durationMs: Date.now() - started, steps, ...(platformError ? { error: redact(platformError, variables) } : {}), ...(evidence ? { evidence } : {}) };
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
    case 'hideKeyboard': return { type: 'hideKeyboard' };
    case 'launchApp': return { type: 'launchApp', ...(step.appId ? { appId: step.appId } : {}) };
    case 'terminateApp': return { type: 'terminateApp', ...(step.appId ? { appId: step.appId } : {}) };
    case 'waitFor': throw new AutomationError('INVALID_SPEC', 'waitFor is handled by the condition engine.');
    case 'assert': throw new AutomationError('INVALID_SPEC', 'assert is handled by the snapshot assertion engine.');
  }
}
function interpolate(value: string, variables: Record<string, string | number | boolean | undefined>): string {
  return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_match, name: string) => { const resolved = variables[name]; if (resolved === undefined) throw new AutomationError('INVALID_SPEC', 'Test variable ' + name + ' is not defined.'); return String(resolved); });
}
function redact(message: string, variables: Record<string, string | number | boolean | undefined>): string {
  let result = message; for (const value of Object.values(variables)) if (typeof value === 'string' && value.length >= 4) result = result.split(value).join('[REDACTED]'); return result;
}


function isRetryableReadOnlyFailure(step: AutomationTestStep, error: unknown): boolean {
  if (step.type !== 'waitFor' && step.type !== 'assert') return false;
  if (!(error instanceof AutomationError)) return false;
  return ['STALE_SNAPSHOT', 'ACTION_TIMEOUT', 'DRIVER_UNAVAILABLE'].includes(error.code);
}
