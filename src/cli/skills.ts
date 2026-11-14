import fs from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';

export const SUPPORTED_AGENTS = ['claude', 'codex', 'gemini', 'antigravity', 'cursor', 'copilot', 'other', 'auto'] as const;
export type CodingAgent = typeof SUPPORTED_AGENTS[number];

const AGENTS: Record<Exclude<CodingAgent, 'auto'>, { label: string; markers: string[]; skillDir: string }> = {
  claude: { label: 'Claude Code', markers: ['.claude'], skillDir: '.claude/skills/testorbit' },
  codex: { label: 'OpenAI Codex', markers: ['.agents', '.codex'], skillDir: '.agents/skills/testorbit' },
  gemini: { label: 'Gemini CLI', markers: ['.gemini'], skillDir: '.gemini/skills/testorbit' },
  antigravity: { label: 'Antigravity', markers: ['.agent'], skillDir: '.agent/skills/testorbit' },
  cursor: { label: 'Cursor', markers: ['.cursor'], skillDir: '.cursor/skills/testorbit' },
  copilot: { label: 'GitHub Copilot', markers: ['.github'], skillDir: '.github/skills/testorbit' },
  other: { label: 'Other / generic agent', markers: ['.agents'], skillDir: '.agents/skills/testorbit' },
};

export function detectCodingAgents(root: string): Array<Exclude<CodingAgent, 'auto'>> {
  const found: Array<Exclude<CodingAgent, 'auto'>> = [];
  for (const agent of Object.keys(AGENTS) as Array<Exclude<CodingAgent, 'auto'>>) {
    if (AGENTS[agent].markers.some((marker) => fs.existsSync(path.join(root, marker)))) found.push(agent);
  }
  return found;
}

export function getSkillPath(root: string, agent: Exclude<CodingAgent, 'auto'>): string {
  return path.join(root, AGENTS[agent].skillDir, 'SKILL.md');
}

export function renderSkill(agent: Exclude<CodingAgent, 'auto'>): string {
  const label = AGENTS[agent].label;
  return `---
name: testorbit
description: Use TestOrbit to inspect, build, debug, and test Android or Flutter projects. Apply when working on app changes, UI flows, test planning, device validation, or test evidence.
---

# TestOrbit

This skill is configured for ${label}. Use the framework's existing CLI and MCP tools instead of inventing a parallel Android automation stack.

## Before changing code
1. Identify whether this repository is native Android, Flutter, or a multi-package workspace.
2. Read project instructions and existing tests before proposing changes.
3. Run \`testorbit doctor\` when toolchain or device readiness is uncertain.
4. Check \`.testorbit/\` for project setup, custom test instructions, saved test cases, and previous reports.

## After changing code
1. Use change-aware test planning and project-native test suites where available.
2. Prefer targeted tests for affected packages first, then required integration/UI checks.
3. Do not claim an emulator/device test passed unless it actually executed against a target.
4. Treat planned, skipped, blocked, unavailable, and not-run tests as distinct outcomes.
5. Preserve redacted logs and evidence; never copy secrets into reports.
6. Review the final report and explain any missing or blocked validation.

## Evidence and reports
- Keep framework-generated data under \`.testorbit/\`.
- Reports belong under \`.testorbit/test-reports/YYYY-MM-DD/HHmmss/\`.
- Screenshots and hierarchy snapshots belong under \`.testorbit/artifacts/\`.
- Verify report freshness and Git HEAD provenance before treating reports as current evidence.
- Never overwrite user-authored instructions, test cases, or reports without explicit approval.

## Safety
- Preview test plans before executing potentially destructive or device-mutating flows.
- Ask before uninstalling apps, clearing app data, resetting devices, or touching production services.
- Keep retries bounded and only retry failures known to be transient.
- If evidence is incomplete, say so clearly instead of reporting a pass.
`;
}

export async function chooseCodingAgent(root: string, requested?: string): Promise<Exclude<CodingAgent, 'auto'>> {
  if (requested && requested !== 'auto') {
    if (!(SUPPORTED_AGENTS as readonly string[]).includes(requested)) throw new Error(`Unknown agent "${requested}". Choose: ${SUPPORTED_AGENTS.join(', ')}.`);
    return requested as Exclude<CodingAgent, 'auto'>;
  }

  const detected = detectCodingAgents(root);
  if (requested === 'auto' && detected.length === 1) return detected[0] as Exclude<CodingAgent, 'auto'>;
  if (process.stdin.isTTY && process.stdout.isTTY) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      console.log('Which coding agent do you use?');
      const options = SUPPORTED_AGENTS.filter((x) => x !== 'auto') as Array<Exclude<CodingAgent, 'auto'>>;
      options.forEach((agent, index) => console.log(`  ${index + 1}. ${AGENTS[agent].label} (${agent})`));
      console.log(`  ${options.length + 1}. Auto-detect existing agent folders`);
      if (detected.length) console.log(`Detected folder(s): ${detected.map((x) => AGENTS[x].label).join(', ')}`);
      const answer = (await rl.question('Select an option [1-' + (options.length + 1) + ']: ')).trim();
      const index = Number(answer);
      if (!answer || !Number.isInteger(index) || index < 1 || index > options.length + 1) {
        if (detected.length) return detected[0] as Exclude<CodingAgent, 'auto'>;
        throw new Error('Invalid selection. Re-run with --agent <name>.');
      }
      if (index === options.length + 1) {
        if (detected.length === 1) return detected[0] as Exclude<CodingAgent, 'auto'>;
        if (detected.length > 1) {
          console.log('Multiple agent folders detected; using generic .agents/skills output. Pass --agent to choose one explicitly.');
        }
        return 'other';
      }
      return options[index - 1]!;
    } finally {
      rl.close();
    }
  }

  if (detected.length === 1) return detected[0] as Exclude<CodingAgent, 'auto'>;
  return 'other';
}

export function generateAgentSkill(root: string, agent: Exclude<CodingAgent, 'auto'>): { filePath: string; created: boolean } {
  const filePath = getSkillPath(root, agent);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (fs.existsSync(filePath)) return { filePath, created: false };
  fs.writeFileSync(filePath, renderSkill(agent), { encoding: 'utf8', flag: 'wx' });
  return { filePath, created: true };
}
