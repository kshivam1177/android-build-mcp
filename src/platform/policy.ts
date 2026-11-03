import type { PlatformAction } from './contracts.js';

export type ActionRisk = 'read' | 'write' | 'destructive';
export interface ActionIntent {
  action: PlatformAction;
  risk: ActionRisk;
  reason: string;
}
export interface ExecutionPolicy {
  allowDestructiveActions: boolean;
  requireApprovalForWrites?: boolean;
}
export interface PolicyDecision {
  allowed: boolean;
  requiresApproval: boolean;
  reason: string;
}

/** Policy is driven by declared intent, never by guessing from button text. */
export function evaluateActionPolicy(intent: ActionIntent, policy: ExecutionPolicy, approved = false): PolicyDecision {
  if (intent.risk === 'destructive' && !policy.allowDestructiveActions) {
    return { allowed: false, requiresApproval: false, reason: 'Destructive action is blocked by policy.' };
  }
  const requiresApproval = intent.risk === 'destructive' || (intent.risk === 'write' && policy.requireApprovalForWrites === true);
  if (requiresApproval && !approved) {
    return { allowed: false, requiresApproval: true, reason: 'Explicit approval is required before this action can run.' };
  }
  return { allowed: true, requiresApproval: false, reason: 'Action is permitted by the active policy.' };
}
