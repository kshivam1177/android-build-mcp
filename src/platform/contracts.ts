/**
 * Stable cross-platform automation contracts.
 *
 * Runtime element references are deliberately session/snapshot scoped. Test
 * definitions must persist SemanticSelector values, never ResolvedElement refs.
 */
export type PlatformKind = 'android' | 'flutter' | 'ios' | 'web';
export type DriverLifecycle = 'created' | 'connecting' | 'connected' | 'disconnecting' | 'closed' | 'failed';
export type LocatorStrategy = 'accessibilityId' | 'resourceId' | 'text' | 'role' | 'label' | 'placeholder' | 'testId' | 'css' | 'xpath';

export interface SemanticSelector {
  strategy: LocatorStrategy;
  value: string;
  /** Optional platform-specific refinement; never required for portability. */
  platform?: PlatformKind;
  exact?: boolean;
  index?: number;
}

export interface DriverConfig {
  platform: PlatformKind;
  targetId?: string;
  appId?: string;
  baseUrl?: string;
  commandTimeoutMs?: number;
  connectTimeoutMs?: number;
  metadata?: Record<string, string | number | boolean>;
}

export interface PlatformCapabilities {
  platform: PlatformKind;
  snapshots: boolean;
  accessibilityTree: boolean;
  screenshots: boolean;
  gestures: boolean;
  appLifecycle: boolean;
  browserNavigation: boolean;
  nativeDialogs: boolean;
  supportedActions: readonly PlatformAction['type'][];
}

export interface SnapshotNode {
  /** Ephemeral reference, valid only for snapshotId + generation. */
  ref: string;
  role?: string;
  text?: string;
  label?: string;
  value?: string;
  resourceId?: string;
  testId?: string;
  enabled?: boolean;
  visible?: boolean;
  selected?: boolean;
  bounds?: { x: number; y: number; width: number; height: number };
  attributes?: Readonly<Record<string, string | boolean | number>>;
}

export interface PlatformSnapshot {
  platform: PlatformKind;
  targetId: string;
  snapshotId: string;
  generation: number;
  capturedAt: string;
  nodes: readonly SnapshotNode[];
  raw?: unknown;
}

export type PlatformAction =
  | { type: 'tap'; selector: SemanticSelector }
  | { type: 'type'; selector: SemanticSelector; text: string; clearFirst?: boolean }
  | { type: 'longPress'; selector: SemanticSelector; durationMs?: number }
  | { type: 'swipe'; direction: 'up' | 'down' | 'left' | 'right'; distance?: number; durationMs?: number }
  | { type: 'back' }
  | { type: 'key'; key: string }
  | { type: 'navigate'; url: string }
  | { type: 'wait'; timeoutMs?: number };

export type WaitCondition =
  | { kind: 'visible'; selector: SemanticSelector }
  | { kind: 'absent'; selector: SemanticSelector }
  | { kind: 'text'; selector: SemanticSelector; equals?: string; contains?: string }
  | { kind: 'url'; equals?: string; contains?: string };

export interface ResolvedElement {
  platform: PlatformKind;
  targetId: string;
  snapshotId: string;
  generation: number;
  ref: string;
  node: SnapshotNode;
}

export interface ActionResult {
  action: PlatformAction['type'];
  startedAt: string;
  durationMs: number;
  target: ResolvedElement | null;
  /** True only when the driver can confirm the command was dispatched. */
  dispatched: boolean;
}

export interface EvidenceBundle {
  capturedAt: string;
  screenshot?: { mimeType: string; data: Buffer };
  snapshot?: PlatformSnapshot;
  logs?: readonly string[];
  attachments?: readonly { name: string; mimeType: string; data: Buffer }[];
}

export interface DriverSession {
  id: string;
  platform: PlatformKind;
  targetId: string;
  connectedAt: string;
}

export interface PlatformDriver {
  readonly platform: PlatformKind;
  connect(config: DriverConfig, signal?: AbortSignal): Promise<DriverSession>;
  capabilities(): Promise<PlatformCapabilities>;
  snapshot(signal?: AbortSignal): Promise<PlatformSnapshot>;
  resolve(selector: SemanticSelector, snapshot?: PlatformSnapshot): Promise<ResolvedElement>;
  perform(action: PlatformAction, signal?: AbortSignal): Promise<ActionResult>;
  waitFor(condition: WaitCondition, timeoutMs: number, signal?: AbortSignal): Promise<PlatformSnapshot>;
  captureEvidence(signal?: AbortSignal): Promise<EvidenceBundle>;
  disconnect(): Promise<void>;
}

export type AutomationErrorCode =
  | 'DRIVER_UNAVAILABLE' | 'CONNECTION_FAILED' | 'SESSION_CLOSED'
  | 'UNSUPPORTED_CAPABILITY' | 'ELEMENT_NOT_FOUND' | 'AMBIGUOUS_SELECTOR'
  | 'STALE_SNAPSHOT' | 'ELEMENT_DISABLED' | 'ACTION_TIMEOUT'
  | 'ACTION_FAILED' | 'CANCELLED' | 'INVALID_SPEC';

export class AutomationError extends Error {
  constructor(
    public readonly code: AutomationErrorCode,
    message: string,
    public readonly details: Readonly<Record<string, unknown>> = {},
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'AutomationError';
  }
}
