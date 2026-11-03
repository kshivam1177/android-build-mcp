#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve('test-results');
const reports = [];

async function walk(directory) {
  let entries;
  try { entries = await fs.readdir(directory, { withFileTypes: true }); }
  catch { return; }
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) await walk(fullPath);
    else if (entry.isFile() && entry.name === 'junit.xml') reports.push(fullPath);
  }
}

await walk(root);
const summary = [];
let totals = { tests: 0, failures: 0, errors: 0, skipped: 0 };
for (const report of reports.sort()) {
  const xml = await fs.readFile(report, 'utf8');
  const rootTag = xml.match(/<(?:testsuites|testsuite)\b[^>]*>/)?.[0] ?? '';
  const values = {};
  for (const key of ['tests', 'failures', 'errors', 'skipped']) {
    values[key] = Number(rootTag.match(new RegExp('\\b' + key + '="(\\d+)"'))?.[1] ?? 0);
    totals[key] += values[key];
  }
  const nodeVersion = report.match(/node-(\d+)/)?.[1] ?? 'unknown';
  summary.push('| ' + nodeVersion + ' | ' + values.tests + ' | ' + values.failures + ' | ' + values.errors + ' | ' + values.skipped + ' |');
}

const lines = [
  '## Node compatibility test aggregation',
  '',
  '| Node | Tests | Failures | Errors | Skipped |',
  '|---|---:|---:|---:|---:|',
  ...summary,
  '| **Total** | **' + totals.tests + '** | **' + totals.failures + '** | **' + totals.errors + '** | **' + totals.skipped + '** |',
  ''
];
if (reports.length === 0) lines.splice(3, 0, 'No JUnit reports were available. Check the matrix job logs and artifact upload steps.', '');
const output = lines.join('\n');
if (process.env.GITHUB_STEP_SUMMARY) await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, output + '\n');
process.stdout.write(output);
