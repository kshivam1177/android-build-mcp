import type { AutomationRunResult } from '../engine.js';

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/** Convert platform and step outcomes to JUnit XML without counting skipped work as passed. */
export function toJunitXml(result: AutomationRunResult): string {
  const cases = result.platforms.flatMap((platform) => {
    const platformCase = {
      name: platform.platform + ' platform',
      classname: result.testId,
      time: (platform.durationMs / 1000).toFixed(3),
      status: platform.success ? 'passed' : 'failed',
      message: platform.error ?? ''
    };
    const stepCases = platform.steps.map((step) => ({
      name: platform.platform + ' / ' + step.id,
      classname: result.testId,
      time: (step.durationMs / 1000).toFixed(3),
      status: step.status,
      message: step.error ?? ''
    }));
    return [platformCase, ...stepCases];
  });
  const failures = cases.filter((item) => item.status === 'failed').length;
  const skipped = cases.filter((item) => item.status === 'skipped').length;
  const seconds = (result.durationMs / 1000).toFixed(3);
  const body = cases.map((item) => {
    const failure = item.status === 'failed' ? '<failure message="' + escapeXml(item.message || 'Failed') + '">' + escapeXml(item.message) + '</failure>' : '';
    const skip = item.status === 'skipped' ? '<skipped message="' + escapeXml(item.message || 'Skipped') + '"/>' : '';
    return '<testcase classname="' + escapeXml(item.classname) + '" name="' + escapeXml(item.name) + '" time="' + item.time + '">' + failure + skip + '</testcase>';
  }).join('');
  return '<?xml version="1.0" encoding="UTF-8"?>\n<testsuite name="' + escapeXml(result.testId) + '" tests="' + cases.length + '" failures="' + failures + '" skipped="' + skipped + '" time="' + seconds + '">' + body + '</testsuite>\n';
}
