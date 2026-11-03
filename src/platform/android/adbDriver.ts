import { randomUUID } from 'node:crypto';
import { adbBackend } from '../../automation/adbBackend.js';
import type { AutomationBackend } from '../../automation/backend.js';
import { parseUiHierarchy } from '../../automation/uiHierarchy.js';
import { AutomationError, type DriverConfig, type DriverSession, type PlatformCapabilities, type PlatformDriver, type PlatformSnapshot, type ResolvedElement, type SemanticSelector, type WaitCondition, type ActionResult, type EvidenceBundle, type PlatformAction } from '../contracts.js';
import { resolveSemanticSelector } from '../selectors.js';

/** Native Android driver backed by the framework's existing ADB implementation. */
export class AndroidAdbDriver implements PlatformDriver {
  readonly platform = 'android' as const;
  private targetId?: string;
  private session?: DriverSession;
  private generation = 0;
  constructor(private readonly backend: AutomationBackend = adbBackend) {}

  async connect(config: DriverConfig, signal?: AbortSignal): Promise<DriverSession> {
    if (signal?.aborted) throw new AutomationError('CANCELLED', 'Connection cancelled.');
    if (!config.targetId) throw new AutomationError('INVALID_SPEC', 'Android requires an ADB targetId.');
    try {
      if (!(await this.backend.isAvailable(config.targetId))) throw new Error('ADB backend unavailable.');
      this.targetId = config.targetId;
      this.session = { id: randomUUID(), platform: 'android', targetId: config.targetId, connectedAt: new Date().toISOString() };
      return this.session;
    } catch (error) {
      throw new AutomationError('CONNECTION_FAILED', 'Unable to connect to Android target.', { targetId: config.targetId }, { cause: error });
    }
  }

  async capabilities(): Promise<PlatformCapabilities> {
    return { platform: 'android', snapshots: true, accessibilityTree: true, screenshots: true, gestures: true,
      appLifecycle: true, browserNavigation: false, nativeDialogs: true,
      supportedActions: ['tap', 'type', 'longPress', 'swipe', 'back', 'key', 'wait'] };
  }

  async snapshot(signal?: AbortSignal): Promise<PlatformSnapshot> {
    this.checkAbort(signal);
    const targetId = this.requireTarget();
    try {
      const nodes = parseUiHierarchy(await this.backend.dumpHierarchy(targetId));
      return {
        platform: 'android', targetId, snapshotId: randomUUID(), generation: ++this.generation,
        capturedAt: new Date().toISOString(),
        nodes: nodes.map((node) => ({
          ref: node.ref, role: node.className, text: node.text, label: node.contentDesc,
          resourceId: node.resourceId, enabled: node.enabled,
          visible: node.bounds.right > node.bounds.left && node.bounds.bottom > node.bounds.top,
          selected: node.checked,
          bounds: { x: node.bounds.left, y: node.bounds.top, width: node.bounds.right - node.bounds.left, height: node.bounds.bottom - node.bounds.top },
          attributes: { clickable: node.clickable, focusable: node.focusable, scrollable: node.scrollable }
        })),
        raw: nodes
      };
    } catch (error) {
      throw new AutomationError('ACTION_FAILED', 'Could not read Android accessibility hierarchy.', { targetId }, { cause: error });
    }
  }

  async resolve(selector: SemanticSelector, snapshot?: PlatformSnapshot): Promise<ResolvedElement> {
    const current = snapshot ?? await this.snapshot();
    if (current.targetId !== this.requireTarget() || current.platform !== 'android') {
      throw new AutomationError('STALE_SNAPSHOT', 'Snapshot does not belong to the active Android target.');
    }
    return resolveSemanticSelector(current, selector);
  }

  async perform(action: PlatformAction, signal?: AbortSignal): Promise<ActionResult> {
    this.checkAbort(signal);
    const startedAt = new Date().toISOString();
    const started = Date.now();
    const targetId = this.requireTarget();
    let target: ResolvedElement | null = null;
    try {
      switch (action.type) {
        case 'tap':
        case 'type':
        case 'longPress': {
          const fresh = await this.snapshot(signal);
          target = await this.resolve(action.selector, fresh);
          const bounds = target.node.bounds;
          if (!bounds) throw new AutomationError('ELEMENT_NOT_FOUND', 'Android element has no bounds.');
          const x = bounds.x + bounds.width / 2;
          const y = bounds.y + bounds.height / 2;
          if (action.type === 'tap') await this.backend.tap(targetId, x, y);
          else if (action.type === 'type') await this.backend.typeText(targetId, action.text);
          else await this.backend.longPress(targetId, x, y, action.durationMs);
          break;
        }
        case 'back': await this.backend.keyEvent(targetId, 'KEYCODE_BACK'); break;
        case 'key': await this.backend.keyEvent(targetId, action.key); break;
        case 'wait': await this.delay(action.timeoutMs ?? 250, signal); break;
        case 'swipe': {
          const snapshot = await this.snapshot(signal);
          const bounds = snapshot.nodes.map((node) => node.bounds).filter((value) => value !== undefined);
          const width = Math.max(1, ...bounds.map((value) => value.x + value.width));
          const height = Math.max(1, ...bounds.map((value) => value.y + value.height));
          const x = Math.round(width / 2);
          const y = Math.round(height / 2);
          const distance = Math.round((action.distance ?? 0.65) * (action.direction === 'left' || action.direction === 'right' ? width : height));
          const delta = { up: [0, -distance], down: [0, distance], left: [-distance, 0], right: [distance, 0] }[action.direction];
          await this.backend.swipe(targetId, x, y, Math.max(0, Math.min(width, x + delta[0]!)), Math.max(0, Math.min(height, y + delta[1]!)));
          break;
        }
        case 'navigate': throw new AutomationError('UNSUPPORTED_CAPABILITY', 'Native Android driver does not support URL navigation.');
      }
      return { action: action.type, startedAt, durationMs: Date.now() - started, target, dispatched: true };
    } catch (error) {
      if (error instanceof AutomationError) throw error;
      throw new AutomationError('ACTION_FAILED', 'Android action failed.', { targetId, action: action.type }, { cause: error });
    }
  }

  async waitFor(condition: WaitCondition, timeoutMs: number, signal?: AbortSignal): Promise<PlatformSnapshot> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      this.checkAbort(signal);
      const snapshot = await this.snapshot(signal);
      if (condition.kind === 'url') throw new AutomationError('UNSUPPORTED_CAPABILITY', 'URL wait is not available on Android.');
      try {
        const element = resolveSemanticSelector(snapshot, condition.selector);
        if (condition.kind !== 'absent' &&
          (condition.kind !== 'text' ||
            (condition.equals !== undefined ? element.node.text === condition.equals :
              condition.contains !== undefined ? (element.node.text ?? '').includes(condition.contains) : true))) return snapshot;
      } catch (error) {
        if (!(error instanceof AutomationError) || !['ELEMENT_NOT_FOUND', 'AMBIGUOUS_SELECTOR'].includes(error.code)) throw error;
        if (condition.kind === 'absent' && error.code === 'ELEMENT_NOT_FOUND') return snapshot;
      }
      await this.delay(250, signal);
    }
    throw new AutomationError('ACTION_TIMEOUT', 'Timed out waiting for Android UI condition.', { timeoutMs });
  }

  async captureEvidence(signal?: AbortSignal): Promise<EvidenceBundle> {
    this.checkAbort(signal);
    const targetId = this.requireTarget();
    const [screenshot, snapshot] = await Promise.all([this.backend.screenshot(targetId), this.snapshot(signal)]);
    return { capturedAt: new Date().toISOString(), screenshot, snapshot };
  }

  async disconnect(): Promise<void> { this.session = undefined; this.targetId = undefined; }
  private requireTarget(): string {
    if (!this.session || !this.targetId) throw new AutomationError('SESSION_CLOSED', 'Android driver is not connected.');
    return this.targetId;
  }
  private checkAbort(signal?: AbortSignal): void {
    if (signal?.aborted) throw new AutomationError('CANCELLED', 'Android operation cancelled.');
  }
  private async delay(ms: number, signal?: AbortSignal): Promise<void> {
    this.checkAbort(signal);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
      const abort = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(new AutomationError('CANCELLED', 'Android wait cancelled.')); };
      signal?.addEventListener('abort', abort, { once: true });
    });
  }
}
