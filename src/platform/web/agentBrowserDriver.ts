import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execCommand } from '../../utils/exec.js';
import { AutomationError, type ActionResult, type DriverConfig, type DriverSession, type EvidenceBundle, type PlatformCapabilities, type PlatformDriver, type PlatformSnapshot, type ResolvedElement, type SemanticSelector, type WaitCondition, type PlatformAction, type SnapshotNode } from '../contracts.js';
import { resolveSemanticSelector } from '../selectors.js';

type AgentBrowserSnapshot = { success?: boolean; data?: { snapshot?: string; refs?: Record<string, Record<string, unknown>> } };

/** Agent Browser CLI adapter. Every browser command is isolated by a named session. */
export class AgentBrowserDriver implements PlatformDriver {
  readonly platform = 'web' as const;
  private session?: DriverSession;
  private sessionName = '';
  private command = process.env.AGENT_BROWSER_PATH || 'agent-browser';
  private timeoutMs = 30000;
  private generation = 0;

  async connect(config: DriverConfig, signal?: AbortSignal): Promise<DriverSession> {
    if (signal?.aborted) throw new AutomationError('CANCELLED', 'Browser connection cancelled.');
    this.sessionName = `amf-${randomUUID()}`;
    this.timeoutMs = config.commandTimeoutMs ?? 30000;
    try {
      await this.run(['open']);
      if (config.baseUrl) await this.run(['open', config.baseUrl]);
      this.session = { id: randomUUID(), platform: 'web', targetId: this.sessionName, connectedAt: new Date().toISOString() };
      return this.session;
    } catch (error) {
      throw new AutomationError('CONNECTION_FAILED', 'Agent Browser could not create a browser session. Check installation and browser runtime.', {}, { cause: error });
    }
  }

  async capabilities(): Promise<PlatformCapabilities> {
    return { platform: 'web', snapshots: true, accessibilityTree: true, screenshots: true, gestures: true,
      appLifecycle: false, browserNavigation: true, nativeDialogs: false,
      supportedActions: ['tap', 'type', 'swipe', 'back', 'key', 'navigate', 'wait'] };
  }

  async snapshot(signal?: AbortSignal): Promise<PlatformSnapshot> {
    this.ensureConnected(signal);
    const result = await this.run(['snapshot', '--json']);
    let parsed: AgentBrowserSnapshot;
    try { parsed = JSON.parse(result.stdout) as AgentBrowserSnapshot; }
    catch (error) { throw new AutomationError('ACTION_FAILED', 'Agent Browser returned invalid snapshot JSON.', {}, { cause: error }); }
    if (parsed.success === false || !parsed.data?.refs) throw new AutomationError('ACTION_FAILED', 'Agent Browser snapshot did not include element references.');
    const nodes: SnapshotNode[] = Object.entries(parsed.data.refs).map(([key, value]) => ({
      ref: key.startsWith('@') ? key : `@${key}`,
      role: stringValue(value.role), text: stringValue(value.name) ?? stringValue(value.text),
      label: stringValue(value.name) ?? stringValue(value.label),
      testId: stringValue(value.testId) ?? stringValue(value.testid),
      enabled: value.disabled === true ? false : true,
      visible: value.visible === false ? false : true,
      attributes: Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string | number | boolean] =>
        ['string', 'number', 'boolean'].includes(typeof entry[1])))
    }));
    return { platform: 'web', targetId: this.sessionName, snapshotId: randomUUID(), generation: ++this.generation, capturedAt: new Date().toISOString(), nodes, raw: parsed.data.snapshot };
  }

  async resolve(selector: SemanticSelector, snapshot?: PlatformSnapshot): Promise<ResolvedElement> {
    return resolveSemanticSelector(snapshot ?? await this.snapshot(), selector);
  }

  async perform(action: PlatformAction, signal?: AbortSignal): Promise<ActionResult> {
    this.ensureConnected(signal);
    const startedAt = new Date().toISOString(); const started = Date.now();
    let target: ResolvedElement | null = null;
    switch (action.type) {
      case 'navigate': await this.run(['open', action.url]); break;
      case 'back': await this.run(['back']); break;
      case 'key': await this.run(['press', action.key]); break;
      case 'wait': await this.delay(action.timeoutMs ?? 250, signal); break;
      case 'swipe': await this.run(['scroll', action.direction]); break;
      case 'tap':
      case 'type':
      case 'longPress': {
        const fresh = await this.snapshot(signal);
        target = await this.resolve(action.selector, fresh);
        if (action.type === 'tap') await this.run(['click', target.ref]);
        else if (action.type === 'type') await this.run(['fill', target.ref, action.text]);
        else throw new AutomationError('UNSUPPORTED_CAPABILITY', 'Agent Browser CLI adapter does not expose a portable long-press command.');
        break;
      }
    }
    return { action: action.type, startedAt, durationMs: Date.now() - started, target, dispatched: true };
  }

  async waitFor(condition: WaitCondition, timeoutMs: number, signal?: AbortSignal): Promise<PlatformSnapshot> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      this.ensureConnected(signal);
      if (condition.kind === 'url') {
        const result = await this.run(['get', 'url']);
        if ((condition.equals && result.stdout.trim() === condition.equals) ||
            (condition.contains && result.stdout.includes(condition.contains))) return this.snapshot(signal);
      } else {
        const current = await this.snapshot(signal);
        try {
          const found = await this.resolve(condition.selector, current);
          if (condition.kind === 'visible' || (condition.kind === 'text' &&
              (condition.equals ? found.node.text === condition.equals : condition.contains ? (found.node.text ?? '').includes(condition.contains) : true))) return current;
        } catch (error) {
          if (condition.kind === 'absent' && error instanceof AutomationError && error.code === 'ELEMENT_NOT_FOUND') return current;
          if (!(error instanceof AutomationError) || !['ELEMENT_NOT_FOUND', 'AMBIGUOUS_SELECTOR'].includes(error.code)) throw error;
        }
      }
      await this.delay(250, signal);
    }
    throw new AutomationError('ACTION_TIMEOUT', 'Timed out waiting for browser condition.', { timeoutMs });
  }

  async captureEvidence(signal?: AbortSignal): Promise<EvidenceBundle> {
    this.ensureConnected(signal);
    const directory = await mkdtemp(path.join(os.tmpdir(), 'amf-browser-'));
    const file = path.join(directory, 'screenshot.png');
    try {
      await this.run(['screenshot', file]);
      const [data, snapshot] = await Promise.all([readFile(file), this.snapshot(signal)]);
      return { capturedAt: new Date().toISOString(), screenshot: { data, mimeType: 'image/png' }, snapshot };
    } finally { await rm(directory, { recursive: true, force: true }); }
  }

  async disconnect(): Promise<void> {
    if (!this.session) return;
    try { await this.run(['close']); } finally { this.session = undefined; this.sessionName = ''; }
  }

  private async run(args: string[]) {
    const result = await execCommand(this.command, ['--session-name', this.sessionName, ...args], { timeoutMs: this.timeoutMs });
    if (result.exitCode !== 0) throw new AutomationError('ACTION_FAILED', 'Agent Browser command failed.', { command: args[0], stderr: result.stderr.slice(0, 2000) });
    return result;
  }
  private ensureConnected(signal?: AbortSignal): void {
    if (!this.session) throw new AutomationError('SESSION_CLOSED', 'Agent Browser session is not connected.');
    if (signal?.aborted) throw new AutomationError('CANCELLED', 'Browser action cancelled.');
  }
  private async delay(ms: number, signal?: AbortSignal): Promise<void> {
    this.ensureConnected(signal);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
      const abort = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(new AutomationError('CANCELLED', 'Browser wait cancelled.')); };
      signal?.addEventListener('abort', abort, { once: true });
    });
  }
}
function stringValue(value: unknown): string | undefined { return typeof value === 'string' ? value : undefined; }
