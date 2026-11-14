export type ConsolidatedStatus = 'passed' | 'failed' | 'skipped';
export interface ConsolidatedTest {
  name: string;
  status: ConsolidatedStatus;
  durationMs?: number;
  message?: string;
  sourceReport: string;
  evidence: string[];
}
export interface ConsolidatedSummary {
  schemaVersion: 1;
  generatedAt: string;
  status: 'passed' | 'failed' | 'incomplete' | 'no-data';
  sourceReportCount: number;
  testCount: number;
  passed: number;
  failed: number;
  skipped: number;
  tests: ConsolidatedTest[];
  warnings: string[];
  gitHeadSha?: string | null;
  sourceReportsWithHeadSha?: number;
  sourceReportsWithoutHeadSha?: number;
}
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function text(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}
function duration(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}
function status(value: unknown): ConsolidatedStatus | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.toLowerCase();
  if (['passed','pass','success','succeeded'].includes(normalized)) return 'passed';
  if (['failed','fail','failure','error'].includes(normalized)) return 'failed';
  if (['skipped','blocked','planned','generated','executed','not-provided','unknown'].includes(normalized)) return 'skipped';
  return undefined;
}
function normalizeEvidence(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string').slice(0, 30);
}
export function normalizeReport(sourceReport: string, value: unknown): ConsolidatedTest[] {
  const report = record(value);
  const parentName = text(report.title, text(report.testCaseId, text(report.workflowId, text(report.flowId, text(report.request, sourceReport)))));
  const childArray = Array.isArray(report.stepResults) ? report.stepResults
    : Array.isArray(report.steps) && report.steps.some(step => status(record(step).status) !== undefined) ? report.steps
    : Array.isArray(report.results) && report.results.some(step => status(record(step).status) !== undefined) ? report.results
    : undefined;
  if (childArray?.length) {
    const normalized = childArray.map((item, index) => {
      const step = record(item);
      const rawStatus = status(step.status);
      const stepName = text(step.name, text(step.description, text(step.id, `step-${index + 1}`)));
      const message = text(step.error, text(step.message, text(step.details, '')));
      return {
        name: `${parentName} — ${stepName}`,
        status: rawStatus ?? 'skipped',
        ...(duration(step.durationMs) !== undefined ? { durationMs: duration(step.durationMs) } : {}),
        ...(message ? { message } : {}),
        sourceReport,
        evidence: normalizeEvidence(step.evidence),
      };
    });
    const parentFailed = report.success === false || status(report.status) === 'failed';
    if (parentFailed && !normalized.some(test => test.status === 'failed')) {
      normalized.push({
        name: `${parentName} — overall result`,
        status: 'failed',
        ...(duration(report.durationMs) !== undefined ? { durationMs: duration(report.durationMs) } : {}),
        message: text(report.summary, 'The source report explicitly marks the run as failed.'),
        sourceReport,
        evidence: normalizeEvidence(report.evidence),
      });
    }
    return normalized;
  }
  let overall = status(report.status);
  if (report.success === true) overall = overall === 'failed' ? 'failed' : 'passed';
  if (report.success === false) overall = 'failed';
  const message = text(report.summary, text(report.note, ''));
  return [{
    name: parentName,
    status: overall ?? 'skipped',
    ...(duration(report.durationMs) !== undefined ? { durationMs: duration(report.durationMs) } : {}),
    ...(message ? { message } : {}),
    sourceReport,
    evidence: normalizeEvidence(report.evidence),
  }];
}
export function buildSummary(tests: ConsolidatedTest[], sourceReportCount: number, warnings: string[], generatedAt = new Date().toISOString(), provenance: { gitHeadSha?: string | null; sourceReportsWithHeadSha?: number; sourceReportsWithoutHeadSha?: number } = {}): ConsolidatedSummary {
  const passed = tests.filter(test => test.status === 'passed').length;
  const failed = tests.filter(test => test.status === 'failed').length;
  const skipped = tests.filter(test => test.status === 'skipped').length;
  return {
    schemaVersion: 1,
    generatedAt,
    status: sourceReportCount === 0 || tests.length === 0 ? 'no-data' : failed > 0 ? 'failed' : skipped > 0 ? 'incomplete' : 'passed',
    sourceReportCount,
    testCount: tests.length,
    passed,
    failed,
    skipped,
    tests,
    warnings,
    gitHeadSha: provenance.gitHeadSha ?? null,
    sourceReportsWithHeadSha: provenance.sourceReportsWithHeadSha ?? 0,
    sourceReportsWithoutHeadSha: provenance.sourceReportsWithoutHeadSha ?? sourceReportCount,
  };
}
export function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
export function buildJUnitXml(summary: ConsolidatedSummary): string {
  const cases = summary.tests.map(test => {
    const attributes = `name="${escapeXml(test.name)}" classname="testorbit" time="${((test.durationMs ?? 0) / 1000).toFixed(3)}"`;
    const evidence = [`source report: ${test.sourceReport}`, ...test.evidence].join('\n');
    if (test.status === 'failed') return `  <testcase ${attributes}><failure type="TestFailure" message="${escapeXml(test.message ?? 'Test failed')}">${escapeXml(test.message ?? 'Test failed')}</failure><system-out>${escapeXml(evidence)}</system-out></testcase>`;
    if (test.status === 'skipped') return `  <testcase ${attributes}><skipped message="${escapeXml(test.message ?? 'No explicit passing outcome was recorded.')}" /><system-out>${escapeXml(evidence)}</system-out></testcase>`;
    return `  <testcase ${attributes}><system-out>${escapeXml(evidence)}</system-out></testcase>`;
  }).join('\n');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuite name="TestOrbit consolidated tests" tests="${summary.testCount}" failures="${summary.failed}" skipped="${summary.skipped}" errors="0" timestamp="${escapeXml(summary.generatedAt)}">`,
    cases,
    '</testsuite>',
    '',
  ].join('\n');
}
export function buildSummaryMarkdown(summary: ConsolidatedSummary): string {
  const lines = [
    '# TestOrbit Test Summary',
    '',
    `- **Status:** ${summary.status.toUpperCase()}`,
    `- **Source reports:** ${summary.sourceReportCount}`,
    `- **Tests:** ${summary.testCount}`,
    `- **Passed:** ${summary.passed}`,
    `- **Failed:** ${summary.failed}`,
    `- **Skipped / not explicitly passed:** ${summary.skipped}`,
    `- **Generated:** ${summary.generatedAt}`,
    `- **Tested Git HEAD:** ${summary.gitHeadSha ?? 'UNAVAILABLE'}`,
    `- **Source reports with commit provenance:** ${summary.sourceReportsWithHeadSha ?? 0}`,
    `- **Source reports missing commit provenance:** ${summary.sourceReportsWithoutHeadSha ?? summary.sourceReportCount}`,
    '',
    '## Results',
    ...(summary.tests.length ? summary.tests.map(test => `- **${test.status.toUpperCase()}** — ${test.name} (${test.sourceReport})${test.message ? `: ${test.message}` : ''}`) : ['- No recognized source reports were found. This is not a passing test run.']),
    '',
    '## Warnings',
    ...(summary.warnings.length ? summary.warnings.map(warning => `- ${warning}`) : ['- None']),
    '',
    '> Only explicit passing outcomes count as passed. Missing, planned, generated, executed-only, or blocked outcomes are reported as skipped.',
    '',
  ];
  return lines.join('\n');
}
