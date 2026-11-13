import fs from 'node:fs';
import path from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { withErrorHandling, textResult } from '../../utils/response.js';
import { execCommand } from '../../utils/exec.js';
import { getAdbPath } from '../../utils/adb.js';
import { loadConfig } from '../../config/loader.js';
import { DEFAULT_CONFIG } from '../../config/schema.js';
import type { ToolModule } from '../types.js';

export const toolName = 'doctor';
export const workflow = 'doctor';

export interface CheckResult {
  name: string;
  ok: boolean;
  required: boolean;
  detail: string;
}

async function checkBinary(name: string, command: string, args: string[], required: boolean): Promise<CheckResult> {
  try {
    const result = await execCommand(command, args, { timeoutMs: 10_000 });
    const firstLine = (result.stdout || result.stderr).split('\n')[0]?.trim() ?? '';
    return { name, ok: result.exitCode === 0, required, detail: firstLine || `exit ${result.exitCode}` };
  } catch (err) {
    return { name, ok: false, required, detail: err instanceof Error ? err.message : String(err) };
  }
}

/** Check whether WebDriverAgent answers on its default local port (iOS). */
async function checkWebDriverAgent(): Promise<CheckResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2000);
  try {
    const response = await fetch('http://127.0.0.1:8100/status', { signal: controller.signal });
    return { name: 'WebDriverAgent (iOS)', ok: response.ok, required: false, detail: `HTTP ${response.status}` };
  } catch (err) {
    return { name: 'WebDriverAgent (iOS)', ok: false, required: false, detail: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

export async function runDoctorChecks(): Promise<{ summary: string; checks: CheckResult[] }> {
  const checks: CheckResult[] = [];
  let config = DEFAULT_CONFIG;
  try {
    config = loadConfig();
    checks.push({ name: 'config', ok: true, required: false, detail: 'config.yaml parses and validates' });
  } catch (err) {
    checks.push({ name: 'config', ok: false, required: false, detail: err instanceof Error ? err.message : String(err) });
  }
  checks.push(await checkBinary('adb', getAdbPath(), ['version'], true));
  checks.push(await checkBinary('java', 'java', ['-version'], true));
  checks.push(await checkBinary('gradle', config.paths.gradlePath ?? 'gradle', ['--version'], false));

  const androidHome = config.paths.androidHome || process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  checks.push({
    name: 'ANDROID_HOME',
    ok: Boolean(androidHome && fs.existsSync(androidHome)),
    required: true,
    detail: androidHome ?? '(not set - set paths.androidHome in config.yaml or ANDROID_HOME/ANDROID_SDK_ROOT)',
  });

  if (androidHome) {
    const emulatorBin = path.join(androidHome, 'emulator', process.platform === 'win32' ? 'emulator.exe' : 'emulator');
    checks.push({ name: 'emulator binary', ok: fs.existsSync(emulatorBin), required: false, detail: emulatorBin });
    const buildToolsDir = path.join(androidHome, 'build-tools');
    checks.push({
      name: 'build-tools (aapt2)',
      ok: fs.existsSync(buildToolsDir) && fs.readdirSync(buildToolsDir).length > 0,
      required: false,
      detail: buildToolsDir,
    });
  }

  checks.push(await checkBinary('Android CLI', config.paths.androidCliPath ?? 'android', ['-V'], false));
  checks.push(await checkBinary('Tesseract OCR', process.env.TESSERACT_PATH || 'tesseract', ['--version'], false));

  // TestOrbit checks (Phase 0 task 9): Maestro, Playwright, WebDriverAgent.
  checks.push(await checkBinary('Maestro', 'maestro', ['--version'], false));
  checks.push(await checkBinary('Playwright', 'npx', ['--no-install', 'playwright', '--version'], false));
  checks.push(await checkWebDriverAgent());

  const requiredFailed = checks.filter((c) => c.required && !c.ok);
  const summary = requiredFailed.length === 0
    ? 'All required checks passed.'
    : `${requiredFailed.length} required check(s) failed: ${requiredFailed.map((c) => c.name).join(', ')}`;
  return { summary, checks };
}

export function register(server: McpServer) {
  return server.registerTool(
    toolName,
    {
      title: 'Doctor',
      description: 'Check Android development prerequisites: adb, Java, Gradle, Android SDK, emulator, build-tools and the optional Google Android CLI integration, plus TestOrbit checks (config valid, Maestro, Playwright, WebDriverAgent). This framework does not require Python.',
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    withErrorHandling(async () => {
      const { summary, checks } = await runDoctorChecks();
      return textResult(`${summary}\n\n${JSON.stringify(checks, null, 2)}`, { summary, checks });
    })
  );
}

const mod: ToolModule = { toolName, workflow, register };
export default mod;
