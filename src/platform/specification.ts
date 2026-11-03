import { z } from 'zod';

const selectorSchema = z.object({
  strategy: z.enum(['accessibilityId', 'resourceId', 'text', 'role', 'label', 'placeholder', 'testId', 'css', 'xpath']),
  value: z.string().trim().min(1),
  platform: z.enum(['android', 'flutter', 'ios', 'web']).optional(),
  exact: z.boolean().optional(),
  index: z.number().int().nonnegative().optional()
}).strict();

const actionSchema = z.discriminatedUnion('type', [
  z.object({ id: z.string().min(1), type: z.literal('tap'), selector: selectorSchema }),
  z.object({ id: z.string().min(1), type: z.literal('type'), selector: selectorSchema, value: z.string(), clearFirst: z.boolean().optional(), sensitive: z.boolean().optional() }),
  z.object({ id: z.string().min(1), type: z.literal('longPress'), selector: selectorSchema, durationMs: z.number().int().positive().max(30000).optional() }),
  z.object({ id: z.string().min(1), type: z.literal('swipe'), direction: z.enum(['up', 'down', 'left', 'right']), distance: z.number().positive().max(1).optional() }),
  z.object({ id: z.string().min(1), type: z.literal('back') }),
  z.object({ id: z.string().min(1), type: z.literal('navigate'), url: z.string().url() }),
  z.object({ id: z.string().min(1), type: z.literal('wait'), timeoutMs: z.number().int().positive().max(120000).optional() })
]);

export const automationTestSchema = z.object({
  schemaVersion: z.literal('1.0'),
  id: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/),
  name: z.string().min(1).max(200),
  platforms: z.array(z.enum(['android', 'flutter', 'ios', 'web'])).min(1).max(4),
  targets: z.record(z.enum(['android', 'flutter', 'ios', 'web']), z.object({
    appId: z.string().optional(),
    baseUrl: z.string().url().optional(),
    targetId: z.string().optional()
  }).strict()).optional(),
  variables: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
  ai: z.object({ mode: z.enum(['disabled', 'assisted', 'discovery']).default('assisted') }).default({ mode: 'assisted' }),
  policy: z.object({
    allowDestructiveActions: z.boolean().default(false),
    maxRecoveryAttempts: z.number().int().min(0).max(3).default(1)
  }).default({ allowDestructiveActions: false, maxRecoveryAttempts: 1 }),
  steps: z.array(actionSchema).min(1).max(500)
}).strict().superRefine((spec, context) => {
  const ids = new Set<string>();
  spec.steps.forEach((step, index) => {
    if (ids.has(step.id)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['steps', index, 'id'], message: 'Step IDs must be unique.' });
    ids.add(step.id);
  });
});

export type AutomationTestDefinition = z.infer<typeof automationTestSchema>;
export type AutomationTestStep = AutomationTestDefinition['steps'][number];

export function parseAutomationTest(input: unknown): AutomationTestDefinition {
  return automationTestSchema.parse(input);
}
