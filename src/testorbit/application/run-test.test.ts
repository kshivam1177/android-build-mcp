/**
 * TestOrbit Runner tests — pre-flow detection gates the Maestro run, a
 * Maestro failure produces a complete bundle, and a missing YAML fails
 * loudly. Maestro itself is stubbed; one test proves the real
 * missing-binary path via the runner test instead. Fixture data only.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RunTestUseCase } from './run-test.js';
import { toScreenId, toTestId } from '../domain/types.js';
import { MaestroRunner } from '../infrastructure/maestro-runner.js';
import { VariantStore } from '../infrastructure/variant-store.js';
import { freshNodes, writeFixtureScreenTree } from '../test-fixtures/variants.js';

/** Temp project with the login screen learned and a saved test + YAML. */
function makeProject(): { projectRoot: string; dumpFile: string; yamlPath: string } {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'testorbit-run-'));
  writeFixtureScreenTree(projectRoot, 'android', toScreenId('login'));
  const platformDir = path.join(projectRoot, '.testorbit', 'android');
  fs.mkdirSync(path.join(platformDir, 'testcases'), { recursive: true });
  fs.mkdirSync(path.join(platformDir, 'tests'), { recursive: true });
  fs.writeFileSync(
    path.join(platformDir, 'testcases', 'login-flow.json'),
    JSON.stringify({
      schemaVersion: 2,
      id: 'login-flow',
      goal: 'Log in',
      setup: { clearAppData: true, launchApp: true, disableAnimations: true },
      teardown: { clearAppData: true },
      provenance: { model: 'unknown', promptHash: 'unknown' },
      steps: [
        {
          index: 1,
          screen: 'login',
          variant: 'login.password',
          action: 'tap',
          elementId: 'login.submit',
          timeoutMs: 3000,
          assert: { kind: 'variant-present', variant: 'login.password' },
        },
      ],
    }),
    'utf8',
  );
  const yamlPath = path.join(platformDir, 'tests', 'login-flow.yaml');
  fs.writeFileSync(yamlPath, 'appId: com.shop.app\n---\n- launchApp:\n    clearState: true\n', 'utf8');
  return { projectRoot, dumpFile: path.join(projectRoot, 'dump.json'), yamlPath };
}

/** Write a hierarchy dump file for the given element ids. */
function writeDump(dumpFile: string, ids: readonly string[]): void {
  fs.writeFileSync(
    dumpFile,
    JSON.stringify({ nodes: freshNodes(toScreenId('login'), ids), display: { width: 1080, height: 2400 } }),
    'utf8',
  );
}

/** Shared fixture project for every test in this file. */
let projectRoot: string;
let dumpFile: string;
let yamlPath: string;

beforeEach(() => {
  ({ projectRoot, dumpFile, yamlPath } = makeProject());
});

afterEach(() => {
  fs.rmSync(projectRoot, { recursive: true, force: true });
});

describe('RunTestUseCase — pre-flow gate', () => {

  it('runs Maestro after a matching pre-flow detection and reports 0 replay LLM calls', async () => {
    writeDump(dumpFile, ['login.username', 'login.password', 'login.submit', 'login.help', 'login.back']);
    let calls = 0;
    const maestro = new MaestroRunner(async () => {
      calls += 1;
      return { stdout: '', stderr: '', exitCode: 0 };
    });
    const useCase = new RunTestUseCase(new VariantStore(projectRoot, 'android'), maestro);
    const result = await useCase.run({
      projectRoot,
      platform: 'android',
      testId: toTestId('login-flow'),
      hierarchyFile: dumpFile,
      llmCalls: { plan: 1, record: 3 },
    });
    expect(calls).toBe(1);
    expect(result.success).toBe(true);
    expect(result.report.llmCalls).toEqual({ plan: 1, record: 3, replay: 0 });
    expect(result.failureBundlePath).toBeNull();
    expect(fs.existsSync(result.reportPath)).toBe(true);
  });

  it('fails before Maestro on a variant mismatch and writes a bundle naming both variants', async () => {
    writeDump(dumpFile, ['login.otp-field', 'login.verify-otp', 'login.help', 'login.back']);
    let calls = 0;
    const maestro = new MaestroRunner(async () => {
      calls += 1;
      return { stdout: '', stderr: '', exitCode: 0 };
    });
    const useCase = new RunTestUseCase(new VariantStore(projectRoot, 'android'), maestro);
    const result = await useCase.run({
      projectRoot,
      platform: 'android',
      testId: toTestId('login-flow'),
      hierarchyFile: dumpFile,
    });
    expect(calls).toBe(0);
    expect(result.success).toBe(false);
    expect(result.failureBundlePath).not.toBeNull();
    const bundle = JSON.parse(fs.readFileSync(result.failureBundlePath as string, 'utf8')) as {
      expected: { variant: string };
      actual: { variant: string | null };
      rerunCommand: string;
    };
    expect(bundle.expected.variant).toBe('login.password');
    expect(bundle.actual.variant).toBe('login.otp');
    expect(bundle.rerunCommand).toBe('orbit run --test login-flow --platform android');
  });

});

describe('RunTestUseCase — failures', () => {
  it('writes a failure bundle when Maestro fails after a matching pre-flow', async () => {
    writeDump(dumpFile, ['login.username', 'login.password', 'login.submit', 'login.help', 'login.back']);
    const maestro = new MaestroRunner(async () => ({ stdout: '', stderr: 'flow failed\n', exitCode: 1 }));
    const useCase = new RunTestUseCase(new VariantStore(projectRoot, 'android'), maestro);
    const result = await useCase.run({
      projectRoot,
      platform: 'android',
      testId: toTestId('login-flow'),
      hierarchyFile: dumpFile,
    });
    expect(result.success).toBe(false);
    expect(result.failureBundlePath).not.toBeNull();
    expect(result.report.error).toContain('exit code 1');
    const bundle = JSON.parse(fs.readFileSync(result.failureBundlePath as string, 'utf8')) as {
      hierarchyPath: string;
    };
    expect(fs.existsSync(bundle.hierarchyPath)).toBe(true);
  });

  it('fails loudly when the Maestro YAML is missing', async () => {
    writeDump(dumpFile, ['login.username', 'login.password', 'login.submit', 'login.help', 'login.back']);
    fs.rmSync(yamlPath);
    const useCase = new RunTestUseCase(new VariantStore(projectRoot, 'android'));
    await expect(
      useCase.run({ projectRoot, platform: 'android', testId: toTestId('login-flow'), hierarchyFile: dumpFile }),
    ).rejects.toThrow(/No Maestro YAML for test "login-flow"/);
  });
});
