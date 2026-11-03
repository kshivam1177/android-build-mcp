import type { PlatformAction, PlatformKind, SemanticSelector } from './contracts.js';
import { automationTestSchema, type AutomationTestDefinition } from './specification.js';

export type AssistanceMode = 'disabled' | 'assisted' | 'discovery';
export interface AssistanceRequest {
  mode: AssistanceMode;
  platform: PlatformKind;
  reason: 'missing_value' | 'ambiguous_selector' | 'unknown_screen' | 'failure_diagnosis' | 'test_discovery';
  context: Readonly<Record<string, unknown>>;
}
export type AssistanceProposal =
  | { kind: 'selector'; selector: SemanticSelector; explanation: string }
  | { kind: 'value'; value: string; explanation: string }
  | { kind: 'diagnosis'; category: string; explanation: string }
  | { kind: 'test_definition'; definition: unknown; explanation: string };

export interface AssistanceProvider {
  propose(request: AssistanceRequest, signal?: AbortSignal): Promise<AssistanceProposal | undefined>;
}

/**
 * Optional AI boundary. The core runner remains deterministic unless an
 * application explicitly injects a provider. Proposals are advisory and are
 * validated before a caller may present them for approval.
 */
export class AssistanceGateway {
  constructor(private readonly provider?: AssistanceProvider) {}

  async propose(request: AssistanceRequest, signal?: AbortSignal): Promise<AssistanceProposal | undefined> {
    if (request.mode === 'disabled' || !this.provider) return undefined;
    if (signal?.aborted) return undefined;
    const proposal = await this.provider.propose(request, signal);
    if (!proposal) return undefined;
    if (proposal.kind === 'selector') {
      if (!proposal.selector.value.trim() || proposal.selector.platform && proposal.selector.platform !== request.platform) return undefined;
    }
    if (proposal.kind === 'value' && proposal.value.length > 10000) return undefined;
    if (proposal.kind === 'test_definition') {
      const parsed = automationTestSchema.safeParse(proposal.definition);
      if (!parsed.success) return undefined;
      if (!parsed.data.platforms.includes(request.platform)) return undefined;
      return { ...proposal, definition: parsed.data as AutomationTestDefinition };
    }
    return proposal;
  }
}

/** Validate an AI-suggested action against the caller's explicit action allowlist. */
export function validateProposedAction(action: PlatformAction, allowedActions: readonly PlatformAction['type'][]): boolean {
  return allowedActions.includes(action.type);
}
