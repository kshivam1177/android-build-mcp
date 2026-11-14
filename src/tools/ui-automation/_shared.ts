import { resolveTarget, runAdbShell } from '../../utils/adb.js';
import { resolveBackend } from '../../automation/index.js';
import type { TargetInfo } from '../../types.js';
import type { AutomationBackend } from '../../automation/backend.js';
import { parseUiHierarchy } from '../../automation/uiHierarchy.js';
import { TestOrbitFrameworkError } from '../../types.js';

export async function resolveTargetAndBackend(
  requestedId?: string
): Promise<{ target: TargetInfo; backend: AutomationBackend }> {
  const target = await resolveTarget({
    ...(requestedId !== undefined ? { requestedId } : {}),
  });
  const backend = await resolveBackend(target.id);
  return { target, backend };
}

export async function getScreenSize(targetId: string): Promise<{ width: number; height: number }> {
  const result = await runAdbShell(targetId, ['wm', 'size']);
  const match = result.stdout.match(/(\d+)x(\d+)/);
  if (!match) {
    return { width: 1080, height: 2400 }; // reasonable modern-phone fallback if parsing fails
  }
  return { width: Number(match[1]), height: Number(match[2]) };
}

export type Direction = 'up' | 'down' | 'left' | 'right';

/** Turns a directional swipe into concrete coordinates using a screen-relative
 * distance (0-1), matching the vocabulary of Xcode-side gesture presets. */
export function directionToCoords(
  direction: Direction,
  screen: { width: number; height: number },
  distance = 0.6
): { startX: number; startY: number; endX: number; endY: number } {
  const cx = screen.width / 2;
  const cy = screen.height / 2;
  const dx = (screen.width * distance) / 2;
  const dy = (screen.height * distance) / 2;
  switch (direction) {
    case 'up':
      return { startX: cx, startY: cy + dy, endX: cx, endY: cy - dy };
    case 'down':
      return { startX: cx, startY: cy - dy, endX: cx, endY: cy + dy };
    case 'left':
      return { startX: cx + dx, startY: cy, endX: cx - dx, endY: cy };
    case 'right':
      return { startX: cx - dx, startY: cy, endX: cx + dx, endY: cy };
  }
}


export async function dumpHierarchyWithRetry(backend: AutomationBackend, targetId: string, attempts = 3, baseDelayMs = 300): Promise<string> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const xml = await backend.dumpHierarchy(targetId);
      if (xml.includes('<hierarchy')) return xml;
      throw new Error('Hierarchy dump did not contain a valid root node.');
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        const jitter = Math.floor(Math.random() * Math.max(1, Math.floor(baseDelayMs / 3)));
        await new Promise((resolve) => setTimeout(resolve, baseDelayMs * attempt + jitter));
      }
    }
  }
  throw new TestOrbitFrameworkError('COMMAND_FAILED', 'Could not capture Android accessibility hierarchy after ' + attempts + ' attempts. Wait for the UI transition to finish and retry.', { targetId, attempts, cause: lastError instanceof Error ? lastError.message : String(lastError) });
}

export function resolveTextNode(xml: string, requestedText: string, exact = false) {
  const needle = requestedText.trim().toLocaleLowerCase();
  if (!needle) throw new TestOrbitFrameworkError('INVALID_CONFIG', 'Text selector must not be empty.');
  const matches = parseUiHierarchy(xml).filter((node) => {
    const labels = [node.text, node.contentDesc].filter((value): value is string => Boolean(value));
    return labels.some((label) => exact ? label.trim().toLocaleLowerCase() === needle : label.trim().toLocaleLowerCase().includes(needle))
      && node.enabled && node.bounds.right > node.bounds.left && node.bounds.bottom > node.bounds.top;
  });
  if (matches.length === 0) throw new TestOrbitFrameworkError('ELEMENT_REF_NOT_FOUND', 'No enabled accessibility element matched text "' + requestedText + '".');
  if (matches.length > 1) throw new TestOrbitFrameworkError('INVALID_CONFIG', 'Text selector "' + requestedText + '" matched ' + matches.length + ' elements. Use exact=true or a more specific label.', { matches: matches.slice(0, 10).map((node) => ({ text: node.text, contentDesc: node.contentDesc, resourceId: node.resourceId, bounds: node.bounds })) });
  return matches[0]!;
}
