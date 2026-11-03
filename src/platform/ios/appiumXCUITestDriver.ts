import { randomUUID } from 'node:crypto';
import { AutomationError, validateAppIdentifier, type ActionResult, type DriverConfig, type DriverSession, type EvidenceBundle, type PlatformCapabilities, type PlatformDriver, type PlatformSnapshot, type ResolvedElement, type SemanticSelector, type WaitCondition, type PlatformAction, type SnapshotNode } from '../contracts.js';
import { resolveSemanticSelector } from '../selectors.js';

type AppiumValue<T> = { value: T };
type AppiumElement = { 'element-6066-11e4-a52e-4f735466cecf'?: string; ELEMENT?: string };

/** Appium 2 / XCUITest WebDriver adapter. Requires a macOS host with Xcode and Appium's xcuitest driver. */
export class AppiumXCUITestDriver implements PlatformDriver {
  readonly platform = 'ios' as const;
  private baseUrl = 'http://127.0.0.1:4723';
  private session?: DriverSession;
  private appiumSessionId?: string;
  private generation = 0;
  private timeoutMs = 60000;
  private bundleId?: string;

  async connect(config: DriverConfig, signal?: AbortSignal): Promise<DriverSession> {
    if (signal?.aborted) throw new AutomationError('CANCELLED', 'iOS connection cancelled.');
    this.baseUrl = String(config.metadata?.appiumUrl ?? this.baseUrl).replace(/\/$/, '');
    this.timeoutMs = config.connectTimeoutMs ?? this.timeoutMs;
    const deviceName = String(config.metadata?.deviceName ?? 'iPhone Simulator');
    const platformVersion = config.metadata?.platformVersion;
    const udid = config.metadata?.udid;
    const app = config.metadata?.appPath;
    this.bundleId = config.appId ? validateAppIdentifier(config.appId) : undefined;
    const capabilities: Record<string, unknown> = {
      platformName: 'iOS',
      'appium:automationName': 'XCUITest',
      'appium:deviceName': deviceName,
      ...(platformVersion ? { 'appium:platformVersion': platformVersion } : {}),
      ...(udid ? { 'appium:udid': udid } : {}),
      ...(app ? { 'appium:app': app } : {}),
      ...(config.appId ? { 'appium:bundleId': config.appId } : {}),
      'appium:newCommandTimeout': Math.max(60, Math.floor(this.timeoutMs / 1000))
    };
    const response = await this.request<AppiumValue<{ sessionId?: string }>>('/session', {
      method: 'POST', body: JSON.stringify({ capabilities: { alwaysMatch: capabilities, firstMatch: [{}] } }), signal
    });
    const id = response.value?.sessionId;
    if (!id) throw new AutomationError('CONNECTION_FAILED', 'Appium did not return a session id.');
    this.appiumSessionId = id;
    this.session = { id: randomUUID(), platform: 'ios', targetId: String(udid ?? deviceName), connectedAt: new Date().toISOString() };
    return this.session;
  }

  async capabilities(): Promise<PlatformCapabilities> {
    return { platform: 'ios', snapshots: true, accessibilityTree: true, screenshots: true, gestures: true,
      appLifecycle: true, browserNavigation: false, nativeDialogs: true,
      supportedActions: ['tap', 'type', 'longPress', 'swipe', 'back', 'wait', 'hideKeyboard', 'launchApp', 'terminateApp'] };
  }

  async snapshot(signal?: AbortSignal): Promise<PlatformSnapshot> {
    const source = await this.request<AppiumValue<string>>(`/session/${this.requireSession()}/source`, { signal });
    const nodes: SnapshotNode[] = [];
    const tagPattern = /<([A-Za-z][\w.]*)((?:\s+[\w:-]+="[^"]*")*)\s*\/?\s*>/g;
    const attrPattern = /([\w:-]+)="([^"]*)"/g;
    let match: RegExpExecArray | null;
    while ((match = tagPattern.exec(source.value)) !== null) {
      const attrs: Record<string, string> = {};
      let attr: RegExpExecArray | null;
      attrPattern.lastIndex = 0;
      while ((attr = attrPattern.exec(match[2] ?? '')) !== null) if (attr[1] && attr[2] !== undefined) attrs[attr[1]] = decodeXml(attr[2]);
      const name = attrs.name ?? attrs.label ?? attrs.value;
      const id = attrs['name'] ?? attrs['label'] ?? attrs['value'] ?? String(nodes.length);
      nodes.push({
        ref: `e${nodes.length + 1}`, role: match[1], text: name, label: attrs.label ?? attrs.name,
        resourceId: attrs.name, enabled: attrs.enabled !== 'false', visible: attrs.visible !== 'false',
        selected: attrs.selected === 'true', attributes: attrs
      });
      void id;
    }
    return { platform: 'ios', targetId: this.session?.targetId ?? 'ios', snapshotId: randomUUID(),
      generation: ++this.generation, capturedAt: new Date().toISOString(), nodes, raw: source.value };
  }

  async resolve(selector: SemanticSelector, snapshot?: PlatformSnapshot): Promise<ResolvedElement> {
    return resolveSemanticSelector(snapshot ?? await this.snapshot(), selector);
  }

  async perform(action: PlatformAction, signal?: AbortSignal): Promise<ActionResult> {
    const startedAt = new Date().toISOString(); const started = Date.now();
    const sid = this.requireSession(); let target: ResolvedElement | null = null;
    switch (action.type) {
      case 'tap':
      case 'type':
      case 'longPress': {
        const fresh = await this.snapshot(signal); target = await this.resolve(action.selector, fresh);
        const elementId = await this.findElement(action.selector, signal);
        if (action.type === 'tap') await this.request(`/session/${sid}/element/${elementId}/click`, { method: 'POST', body: '{}' , signal });
        else if (action.type === 'type') {
          if (action.clearFirst === true) await this.request(`/session/${sid}/element/${elementId}/clear`, { method: 'POST', body: '{}', signal });
          await this.request(`/session/${sid}/element/${elementId}/value`, { method: 'POST', body: JSON.stringify({ text: action.text, value: [...action.text] }), signal });
        } else {
          const rect = await this.request<AppiumValue<{ x: number; y: number; width: number; height: number }>>(`/session/${sid}/element/${elementId}/rect`, { signal });
          const x = rect.value.x + rect.value.width / 2; const y = rect.value.y + rect.value.height / 2;
          await this.request(`/session/${sid}/execute/sync`, { method: 'POST', body: JSON.stringify({ script: 'mobile: touchAndHold', args: [{ x, y, duration: (action.durationMs ?? 800) / 1000 }] }), signal });
        }
        break;
      }
      case 'swipe':
        await this.request(`/session/${sid}/execute/sync`, { method: 'POST', body: JSON.stringify({ script: 'mobile: swipe', args: [{ direction: action.direction, percent: 0.65 }] }), signal }); break;
      case 'back':
        await this.request(`/session/${sid}/back`, { method: 'POST', body: '{}', signal }); break;
      case 'key':
        throw new AutomationError('UNSUPPORTED_CAPABILITY', 'Generic key events are not portable on iOS; use semantic controls.');
      case 'wait': await delay(action.timeoutMs ?? 250, signal); break;
      case 'hideKeyboard': await this.request(`/session/${sid}/appium/device/hide_keyboard`, { method: 'POST', body: '{}', signal }); break;
      case 'launchApp': {
        const bundleId = action.appId ?? this.bundleId;
        if (!bundleId) throw new AutomationError('INVALID_SPEC', 'launchApp requires an iOS bundle id in the action or target configuration.');
        validateAppIdentifier(bundleId);
        await this.request(`/session/${sid}/appium/device/activate_app`, { method: 'POST', body: JSON.stringify({ bundleId }), signal });
        break;
      }
      case 'terminateApp': {
        const bundleId = action.appId ?? this.bundleId;
        if (!bundleId) throw new AutomationError('INVALID_SPEC', 'terminateApp requires an iOS bundle id in the action or target configuration.');
        validateAppIdentifier(bundleId);
        await this.request(`/session/${sid}/appium/device/terminate_app`, { method: 'POST', body: JSON.stringify({ bundleId }), signal });
        break;
      }
      case 'navigate': throw new AutomationError('UNSUPPORTED_CAPABILITY', 'URL navigation is not supported by the native XCUITest driver.');
    }
    return { action: action.type, startedAt, durationMs: Date.now() - started, target, dispatched: true };
  }

  async waitFor(condition: WaitCondition, timeoutMs: number, signal?: AbortSignal): Promise<PlatformSnapshot> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (condition.kind === 'url') throw new AutomationError('UNSUPPORTED_CAPABILITY', 'URL waits are not available on native iOS.');
      const current = await this.snapshot(signal);
      try {
        const found = resolveSemanticSelector(current, condition.selector, { allowDisabled: true });
        if (condition.kind === 'visible' && found.node.visible !== false) return current;
        if (condition.kind === 'absent' && found.node.visible === false) return current;
        if (condition.kind === 'text' && found.node.visible !== false &&
          (condition.equals !== undefined ? found.node.text === condition.equals : condition.contains !== undefined ? (found.node.text ?? '').includes(condition.contains) : true)) return current;
      } catch (error) {
        if (condition.kind === 'absent' && error instanceof AutomationError && error.code === 'ELEMENT_NOT_FOUND') return current;
        if (!(error instanceof AutomationError) || !['ELEMENT_NOT_FOUND', 'AMBIGUOUS_SELECTOR'].includes(error.code)) throw error;
      }
      await delay(250, signal);
    }
    throw new AutomationError('ACTION_TIMEOUT', 'Timed out waiting for iOS UI condition.', { timeoutMs });
  }

  async captureEvidence(signal?: AbortSignal): Promise<EvidenceBundle> {
    const result = await this.request<AppiumValue<string>>(`/session/${this.requireSession()}/screenshot`, { signal });
    return { capturedAt: new Date().toISOString(), screenshot: { data: Buffer.from(result.value, 'base64'), mimeType: 'image/png' }, snapshot: await this.snapshot(signal) };
  }

  async disconnect(): Promise<void> {
    if (!this.appiumSessionId) return;
    const id = this.appiumSessionId;
    try { await this.request(`/session/${id}`, { method: 'DELETE' }); }
    finally { this.appiumSessionId = undefined; this.session = undefined; this.bundleId = undefined; }
  }

  private async findElement(selector: SemanticSelector, signal?: AbortSignal): Promise<string> {
    const using = selector.strategy === 'accessibilityId' || selector.strategy === 'label' ? 'accessibility id'
      : selector.strategy === 'resourceId' ? 'id' : selector.strategy === 'role' ? 'class name' : selector.strategy === 'xpath' ? 'xpath' : 'name';
    const response = await this.request<AppiumValue<AppiumElement>>(`/session/${this.requireSession()}/element`, {
      method: 'POST', body: JSON.stringify({ using, value: selector.value }), signal
    });
    const id = response.value?.['element-6066-11e4-a52e-4f735466cecf'] ?? response.value?.ELEMENT;
    if (!id) throw new AutomationError('ELEMENT_NOT_FOUND', 'Appium could not resolve the iOS selector.', { selector });
    return id;
  }

  private requireSession(): string {
    if (!this.session || !this.appiumSessionId) throw new AutomationError('SESSION_CLOSED', 'XCUITest session is not active.');
    return this.appiumSessionId;
  }

  private async request<T = unknown>(endpoint: string, options: { method?: string; body?: string; signal?: AbortSignal } = {}): Promise<T> {
    if (options.signal?.aborted) throw new AutomationError('CANCELLED', 'Appium request cancelled.');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const abort = () => controller.abort();
    options.signal?.addEventListener('abort', abort, { once: true });
    try {
      const response = await fetch(`${this.baseUrl}${endpoint}`, {
        method: options.method ?? 'GET', headers: { 'content-type': 'application/json' },
        ...(options.body ? { body: options.body } : {}), signal: controller.signal
      });
      const payload = await response.json() as { value?: unknown; message?: string };
      if (!response.ok || (payload.value && typeof payload.value === 'object' && 'error' in payload.value)) {
        throw new AutomationError('ACTION_FAILED', 'Appium WebDriver request failed.', { endpoint, status: response.status, response: payload });
      }
      return payload as T;
    } catch (error) {
      if (error instanceof AutomationError) throw error;
      throw new AutomationError('ACTION_FAILED', 'Could not communicate with Appium server.', { endpoint }, { cause: error });
    } finally {
      clearTimeout(timer); options.signal?.removeEventListener('abort', abort);
    }
  }
}
function decodeXml(value: string): string { return value.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'); }
function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(new AutomationError('CANCELLED', 'iOS wait cancelled.'));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
    const abort = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(new AutomationError('CANCELLED', 'iOS wait cancelled.')); };
    signal?.addEventListener('abort', abort, { once: true });
  });
}
