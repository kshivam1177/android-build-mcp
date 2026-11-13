import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { resolveProjectRoot } from '../utils/paths.js';

export type TestStatus = 'planned' | 'generated' | 'executed' | 'passed' | 'failed' | 'skipped' | 'blocked';
export interface TestStepResult {
  name: string;
  status: TestStatus;
  durationMs?: number;
  details?: string;
  evidence?: string[];
}
export interface TestRunReport {
  request: string;
  summary?: string;
  platform?: string;
  device?: string;
  buildVersion?: string;
  gitRevision?: string;
  changedFiles?: string[];
  selectedTests?: Array<{ name: string; reason: string }>;
  steps?: TestStepResult[];
  errors?: string[];
  limitations?: string[];
  instructions?: unknown;
  [key: string]: unknown;
}

const SECRET_KEY = /(password|passwd|secret|token|api[_-]?key|authorization|cookie|credential|private[_-]?key)/i;
const SECRET_VALUE = /(Bearer\s+)[A-Za-z0-9._~+\/-]+=*|((?:gh[pousr]_[A-Za-z0-9_]{20,})|(?:sk-[A-Za-z0-9_-]{20,}))/g;

export function redactSecrets(value: unknown, key = ''): unknown {
  if (SECRET_KEY.test(key)) return '[REDACTED]';
  if (typeof value === 'string') return value.replace(SECRET_VALUE, (_match, bearer: string | undefined) => bearer ? `${bearer}[REDACTED]` : '[REDACTED]');
  if (Array.isArray(value)) return value.map(item => redactSecrets(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([childKey, childValue]) => [childKey, redactSecrets(childValue, childKey)]));
  }
  return value;
}

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'unknown';
}

function markdown(report: TestRunReport, runId: string, createdAt: string): string {
  const steps = report.steps ?? [];
  const count = (status: TestStatus) => steps.filter(step => step.status === status).length;
  const lines = [
    '# AndroidBuildMCP Test Run',
    '',
    `- Run ID: ${runId}`,
    `- Created: ${createdAt}`,
    `- Platform: ${report.platform ?? 'not specified'}`,
    `- Device: ${report.device ?? 'not specified'}`,
    `- Git revision: ${report.gitRevision ?? 'not recorded'}`,
    '',
    '## Request',
    report.request,
    '',
    ...(report.summary ? ['## Summary', report.summary, ''] : []),
    '## Outcome counts',
    `- Passed: ${count('passed')}`,
    `- Failed: ${count('failed')}`,
    `- Skipped: ${count('skipped')}`,
    `- Blocked: ${count('blocked')}`,
    `- Planned/generated/executed (not final outcomes): ${count('planned') + count('generated') + count('executed')}`,
    '',
    '## Selected tests',
    ...(report.selectedTests?.length ? report.selectedTests.map(test => `- **${test.name}** — ${test.reason}`) : ['- None recorded']),
    '',
    '## Step outcomes',
    ...(steps.length ? steps.map(step => `- **${step.status.toUpperCase()}** — ${step.name}${step.durationMs === undefined ? '' : ` (${step.durationMs} ms)`}${step.details ? `: ${step.details}` : ''}`) : ['- No execution steps recorded.']),
    '',
    '## Changed files',
    ...(report.changedFiles?.length ? report.changedFiles.map(file => `- ${file}`) : ['- Not recorded']),
    '',
    '## Errors',
    ...(report.errors?.length ? report.errors.map(error => `- ${error}`) : ['- None recorded']),
    '',
    '## Limitations and evidence gaps',
    ...(report.limitations?.length ? report.limitations.map(item => `- ${item}`) : ['- No additional limitations recorded.']),
    '',
    '> A test is counted as passed only when the caller supplies an explicit passed outcome. This report generator does not execute tests or infer success.',
    '',
  ];
  return lines.join('\n');
}

export async function writeTestRunReport(projectRoot: string, input: TestRunReport, now = new Date()): Promise<{ runId: string; directory: string; markdownPath: string; jsonPath: string }> {
  const root = resolveProjectRoot(path.resolve(projectRoot));
  const date = now.toISOString().slice(0, 10);
  const time = now.toISOString().slice(11, 23).replace(/:/g, '-');
  const runId = `${time}-${randomUUID().slice(0, 8)}`;
  const directory = path.join(root, '.testorbit', 'test-reports', safeSegment(date), safeSegment(runId));
  const report = redactSecrets({ ...input, runId, createdAt: now.toISOString() }) as TestRunReport & { runId: string; createdAt: string };
  await mkdir(directory, { recursive: true });
  const markdownPath = path.join(directory, 'report.md');
  const jsonPath = path.join(directory, 'report.json');
  await Promise.all([
    writeFile(markdownPath, markdown(report, runId, now.toISOString()), { encoding: 'utf8', flag: 'wx' }),
    writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' }),
  ]);
  return { runId, directory, markdownPath, jsonPath };
}
