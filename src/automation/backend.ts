/** adbBackend.ts is the single supported UI-automation implementation. */
export interface AutomationBackend {
  readonly name: 'adb';
  isAvailable(targetId: string, signal?: AbortSignal): Promise<boolean>;
  dumpHierarchy(targetId: string, signal?: AbortSignal): Promise<string>;
  tap(targetId: string, x: number, y: number, signal?: AbortSignal): Promise<void>;
  longPress(targetId: string, x: number, y: number, durationMs?: number, signal?: AbortSignal): Promise<void>;
  swipe(targetId: string, startX: number, startY: number, endX: number, endY: number, durationMs?: number, signal?: AbortSignal): Promise<void>;
  drag(targetId: string, startX: number, startY: number, endX: number, endY: number, durationMs?: number, signal?: AbortSignal): Promise<void>;
  typeText(targetId: string, text: string, signal?: AbortSignal): Promise<void>;
  keyEvent(targetId: string, keyCode: string, signal?: AbortSignal): Promise<void>;
  screenshot(targetId: string, signal?: AbortSignal): Promise<{ data: Buffer; mimeType: string }>;
}
