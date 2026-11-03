import { AutomationError, type PlatformSnapshot, type ResolvedElement, type SemanticSelector, type SnapshotNode } from './contracts.js';

/** Resolve only against a fresh, explicit snapshot; ambiguity is always an error. */
export function resolveSemanticSelector(
  snapshot: PlatformSnapshot,
  selector: SemanticSelector
): ResolvedElement {
  if (!selector.value.trim()) {
    throw new AutomationError('INVALID_SPEC', 'Selector value cannot be empty.', { selector });
  }
  if (selector.platform && selector.platform !== snapshot.platform) {
    throw new AutomationError('INVALID_SPEC', 'Platform-specific selector used against a different platform.', {
      selectorPlatform: selector.platform, snapshotPlatform: snapshot.platform
    });
  }

  const expected = selector.value.trim();
  const matches = snapshot.nodes.filter((node) => matchesNode(node, selector, expected));
  if (matches.length === 0) {
    throw new AutomationError('ELEMENT_NOT_FOUND', 'No element matched the semantic selector.', {
      strategy: selector.strategy, value: selector.value, snapshotId: snapshot.snapshotId,
      generation: snapshot.generation
    });
  }
  if (selector.index !== undefined) {
    const selected = matches[selector.index];
    if (!selected) throw new AutomationError('ELEMENT_NOT_FOUND', 'Selector index is outside the match set.', {
      index: selector.index, matchCount: matches.length
    });
    return resolved(snapshot, selected);
  }
  if (matches.length > 1) {
    throw new AutomationError('AMBIGUOUS_SELECTOR', 'Selector matched multiple elements; add a stable qualifier or index.', {
      strategy: selector.strategy, value: selector.value, matchCount: matches.length,
      refs: matches.map((node) => node.ref)
    });
  }
  return resolved(snapshot, matches[0]!);
}

export function assertFreshReference(snapshot: PlatformSnapshot, element: ResolvedElement): void {
  if (snapshot.targetId !== element.targetId ||
      snapshot.snapshotId !== element.snapshotId ||
      snapshot.generation !== element.generation) {
    throw new AutomationError('STALE_SNAPSHOT', 'Element reference belongs to an older UI snapshot. Resolve the semantic selector again.', {
      expected: { targetId: snapshot.targetId, snapshotId: snapshot.snapshotId, generation: snapshot.generation },
      actual: { targetId: element.targetId, snapshotId: element.snapshotId, generation: element.generation }
    });
  }
}

function resolved(snapshot: PlatformSnapshot, node: SnapshotNode): ResolvedElement {
  if (node.enabled === false) {
    throw new AutomationError('ELEMENT_DISABLED', 'Matched element is disabled.', { ref: node.ref });
  }
  return {
    platform: snapshot.platform, targetId: snapshot.targetId,
    snapshotId: snapshot.snapshotId, generation: snapshot.generation,
    ref: node.ref, node
  };
}

function matchesNode(node: SnapshotNode, selector: SemanticSelector, expected: string): boolean {
  const candidates: Array<string | undefined> = (() => {
    switch (selector.strategy) {
      case 'resourceId': return [node.resourceId, node.attributes?.['resource-id']?.toString()];
      case 'accessibilityId': return [node.testId, node.resourceId, node.label];
      case 'text': return [node.text, node.value];
      case 'label': return [node.label];
      case 'placeholder': return [node.attributes?.placeholder?.toString()];
      case 'role': return [node.role];
      case 'testId': return [node.testId];
      case 'css':
      case 'xpath': return [node.attributes?.selector?.toString()];
    }
  })().filter((value): value is string => typeof value === 'string');
  return candidates.some((value) => selector.exact === false
    ? value.toLocaleLowerCase().includes(expected.toLocaleLowerCase())
    : value === expected);
}
