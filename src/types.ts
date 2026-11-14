/**
 * Shared types used across tools, automation backends, and the CLI/MCP entrypoints.
 * Config-derived types live in src/config/schema.ts and are re-exported from there.
 */

export type TargetType = 'emulator' | 'physical';

/** One row of `adb devices -l`, normalized. */
export interface TargetInfo {
  /** adb serial, e.g. "emulator-5554" or "R58N70ABCDE". */
  id: string;
  type: TargetType;
  /** device | offline | unauthorized | recovery | sideload | ... */
  state: string;
  /** Only populated for emulators, and only when resolvable. */
  avdName?: string;
  product?: string;
  model?: string;
  transportId?: string;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  command: string;
  durationMs: number;
}

export interface UiBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** One element from a UI hierarchy dump, with a short-lived ref for targeting. */
export interface UiNode {
  ref: string; // e1, e2, ...
  index: number;
  className?: string;
  text?: string;
  contentDesc?: string;
  resourceId?: string;
  packageName?: string;
  bounds: UiBounds;
  centerX: number;
  centerY: number;
  clickable: boolean;
  enabled: boolean;
  focusable: boolean;
  scrollable: boolean;
  checkable: boolean;
  checked: boolean;
  depth: number;
  /** Ref of the immediate parent node; absent for hierarchy roots. */
  parentRef?: string;
  /** Ancestor refs from the hierarchy root down to the immediate parent. */
  ancestorChain?: string[];
}

export interface UiSnapshot {
  targetId: string;
  capturedAt: string;
  backend: 'adb' | 'uiautomator2';
  nodes: UiNode[]; // flattened, pre-order traversal
}

export type AutomationBackendName = 'adb' | 'uiautomator2' | 'auto';

/** Structured error codes so tool handlers and callers can branch without
 * string-matching messages. Every thrown error in a tool handler should be
 * one of these, not a raw Error - fail loudly with a code, never swallow. */
export type ErrorCode =
  | 'ADB_NOT_FOUND'
  | 'GRADLE_NOT_FOUND'
  | 'JAVA_NOT_FOUND'
  | 'ANDROID_HOME_NOT_SET'
  | 'NO_TARGET_CONNECTED'
  | 'MULTIPLE_TARGETS_CONNECTED'
  | 'TARGET_NOT_FOUND'
  | 'TARGET_OFFLINE'
  | 'AVD_NOT_FOUND'
  | 'PROJECT_NOT_FOUND'
  | 'MODULE_NOT_FOUND'
  | 'GRADLE_BUILD_FAILED'
  | 'INSTALL_FAILED'
  | 'LAUNCH_FAILED'
  | 'ELEMENT_REF_NOT_FOUND'
  | 'STALE_SNAPSHOT'
  | 'AUTOMATION_BACKEND_UNAVAILABLE'
  | 'U2CLI_NOT_FOUND'
  | 'COVERAGE_REPORT_NOT_FOUND'
  | 'INVALID_CONFIG'
  | 'WORKFLOW_NOT_FOUND'
  | 'FILE_NOT_FOUND'
  | 'TIMEOUT'
  | 'COMMAND_FAILED';

export class TestOrbitFrameworkError extends Error {
  readonly code: ErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'TestOrbitFrameworkError';
    this.code = code;
    // Optional field assigned only when defined: an explicit `undefined`
    // is not assignable under `exactOptionalPropertyTypes` (TestOrbit tsconfig).
    if (details !== undefined) this.details = details;
  }
}

export interface ToolAnnotations {
  title: string;
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
}
