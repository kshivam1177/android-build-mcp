import type { AutomationRunResult } from '../engine.js';

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/** Convert platform and step outcomes to JUnit XML without counting skipped work as passed. */
export function toJunitXml(result: AutomationRunResult): string {
  const cases = result.platforms.flatMap((platform) => {
    const stepCases = platform.steps.map((step) => ({
      name: platform.platform + ' / ' + step.id,
      classname: result.testId,
      time: (step.durationMs / 1000).toFixed(3),
      status: step.status,
      message: step.error ?? ''
    }));
    if (stepCases.length) return stepCases;
    return [{
      name: platform.platform + ' platform setup',
      classname: result.testId,
      time: (platform.durationMs / 1000).toFixed(3),
      status: platform.success ? 'passed' : 'failed',
      message: platform.error ?? ''
    }];
  });
  const failures = cases.filter((item) => item.status === 'failed').length;
  const skipped = cases.filter((item) => item.status === 'skipped').length;
  const seconds = (result.durationMs / 1000).toFixed(3);
  const body = cases.map((item) => {
    const failure = item.status === 'failed' ? '<failure message="' + escapeXml(item.message || 'Failed') + '">' + escapeXml(item.message) + '</failure>' : '';
    const skip = item.status === 'skipped' ? '<skipped message="' + escapeXml(item.message || 'Skipped') + '"/>' : '';
    const source = result.platforms.flatMap((platform) => platform.steps.map((step) => ({ platform: platform.platform, id: step.id, attempts: step.attempts ?? 1 }))).find((step) => item.name === step.platform + ' / ' + step.id);
    const properties = source ? '<properties><property name="attempts" value="' + source.attempts + '"/></properties>' : '';
    return '<testcase classname="' + escapeXml(item.classname) + '" name="' + escapeXml(item.name) + '" time="' + item.time + '">' + properties + failure + skip + '</testcase>';
  }).join('');
  const suiteProperties = '<properties>' +
    '<property name="cancelled" value="' + String(result.cancelled) + '"/>' +
    '<property name="timedOut" value="' + String(result.timedOut) + '"/>' +
    '<property name="retriedSteps" value="' + result.summary.retriedSteps + '"/>' +
    '<property name="totalAttempts" value="' + result.summary.totalAttempts + '"/>' +
    '</properties>';
  return '<?xml version="1.0" encoding="UTF-8"?>\n<testsuite name="' + escapeXml(result.testId) + '" tests="' + cases.length + '" failures="' + failures + '" skipped="' + skipped + '" time="' + seconds + '">' + suiteProperties + body + '</testsuite>\n';
}
