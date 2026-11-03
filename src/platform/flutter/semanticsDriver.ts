import { randomUUID } from 'node:crypto';
import { AutomationError, type ActionResult, type DriverConfig, type DriverSession, type EvidenceBundle, type PlatformCapabilities, type PlatformDriver, type PlatformSnapshot, type ResolvedElement, type SemanticSelector, type WaitCondition, type PlatformAction } from '../contracts.js';
import { AndroidAdbDriver } from '../android/adbDriver.js';
import { AppiumXCUITestDriver } from '../ios/appiumXCUITestDriver.js';
import { resolveSemanticSelector } from '../selectors.js';

/**
 * Flutter black-box adapter: uses the operating system accessibility/semantics
 * tree rather than assuming a Flutter-specific test channel exists.
 */
export class FlutterSemanticsDriver implements PlatformDriver {
  readonly platform = 'flutter' as const;
  private delegate?: PlatformDriver;
  private nativeSession?: DriverSession;
  private session?: DriverSession;

  constructor(private readonly android = new AndroidAdbDriver(), private readonly ios = new AppiumXCUITestDriver()) {}

  async connect(config: DriverConfig, signal?: AbortSignal): Promise<DriverSession> {
    const osPlatform = config.metadata?.osPlatform;
    if (osPlatform !== 'android' && osPlatform !== 'ios') {
      throw new AutomationError('INVALID_SPEC', 'Flutter target must declare metadata.osPlatform as android or ios.');
    }
    this.delegate = osPlatform === 'android' ? this.android : this.ios;
    const nativeConfig: DriverConfig = { ...config, platform: osPlatform };
    this.nativeSession = await this.delegate.connect(nativeConfig, signal);
    this.session = { id: randomUUID(), platform: 'flutter', targetId: this.nativeSession.targetId, connectedAt: new Date().toISOString() };
    return this.session;
  }

  async capabilities(): Promise<PlatformCapabilities> {
    const capabilities = await this.requireDelegate().capabilities();
    return { ...capabilities, platform: 'flutter' };
  }

  async snapshot(signal?: AbortSignal): Promise<PlatformSnapshot> {
    const snapshot = await this.requireDelegate().snapshot(signal);
    return { ...snapshot, platform: 'flutter' };
  }

  async resolve(selector: SemanticSelector, snapshot?: PlatformSnapshot): Promise<ResolvedElement> {
    const current = snapshot ?? await this.snapshot();
    return resolveSemanticSelector(current, { ...selector, platform: 'flutter' });
  }

  async perform(action: PlatformAction, signal?: AbortSignal): Promise<ActionResult> {
    const nativeAction: PlatformAction = 'selector' in action
      ? { ...action, selector: { ...action.selector, platform: undefined } }
      : action;
    const result = await this.requireDelegate().perform(nativeAction, signal);
    return { ...result, target: result.target ? { ...result.target, platform: 'flutter' } : null };
  }

  async waitFor(condition: WaitCondition, timeoutMs: number, signal?: AbortSignal): Promise<PlatformSnapshot> {
    const nativeCondition: WaitCondition = 'selector' in condition
      ? { ...condition, selector: { ...condition.selector, platform: undefined } }
      : condition;
    const snapshot = await this.requireDelegate().waitFor(nativeCondition, timeoutMs, signal);
    return { ...snapshot, platform: 'flutter' };
  }

  async captureEvidence(signal?: AbortSignal): Promise<EvidenceBundle> {
    const evidence = await this.requireDelegate().captureEvidence(signal);
    return { ...evidence, ...(evidence.snapshot ? { snapshot: { ...evidence.snapshot, platform: 'flutter' } } : {}) };
  }

  async disconnect(): Promise<void> {
    try { await this.delegate?.disconnect(); }
    finally { this.delegate = undefined; this.nativeSession = undefined; this.session = undefined; }
  }

  private requireDelegate(): PlatformDriver {
    if (!this.delegate || !this.session) throw new AutomationError('SESSION_CLOSED', 'Flutter semantics session is not connected.');
    return this.delegate;
  }
}
