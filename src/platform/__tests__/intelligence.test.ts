import { describe, expect, it, vi } from 'vitest';
import { AssistanceGateway } from '../intelligence.js';

describe('AssistanceGateway', () => {
  it('does not call a provider when assistance is disabled', async () => {
    const provider = { propose: vi.fn(async () => ({ kind: 'value' as const, value: 'sample', explanation: 'candidate' })) };
    const gateway = new AssistanceGateway(provider);
    await expect(gateway.propose({ mode: 'disabled', platform: 'web', reason: 'missing_value', context: {} })).resolves.toBeUndefined();
    expect(provider.propose).not.toHaveBeenCalled();
  });

  it('rejects a selector proposal scoped to another platform', async () => {
    const provider = { propose: vi.fn(async () => ({ kind: 'selector' as const, selector: { strategy: 'text' as const, value: 'Continue', platform: 'ios' as const }, explanation: 'candidate' })) };
    const gateway = new AssistanceGateway(provider);
    await expect(gateway.propose({ mode: 'assisted', platform: 'web', reason: 'ambiguous_selector', context: {} })).resolves.toBeUndefined();
  });

  it('does not enable AI when no provider is injected', async () => {
    const gateway = new AssistanceGateway();
    await expect(gateway.propose({ mode: 'assisted', platform: 'android', reason: 'failure_diagnosis', context: {} })).resolves.toBeUndefined();
  });
});
