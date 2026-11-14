import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { detectCodingAgents, generateAgentSkill, getSkillPath, renderSkill } from '../skills.js';

const roots: string[] = [];
function tempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'amf-skill-'));
  roots.push(root);
  return root;
}
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('coding-agent skill generation', () => {
  it('detects known agent folders without assuming a single agent', () => {
    const root = tempRoot();
    fs.mkdirSync(path.join(root, '.claude'));
    fs.mkdirSync(path.join(root, '.agents'));
    expect(detectCodingAgents(root)).toContain('claude');
    expect(detectCodingAgents(root)).toContain('codex');
  });

  it('writes a valid skill file into the selected agent skill folder', () => {
    const root = tempRoot();
    const result = generateAgentSkill(root, 'claude');
    expect(result.created).toBe(true);
    expect(result.filePath).toBe(getSkillPath(root, 'claude'));
    expect(fs.readFileSync(result.filePath, 'utf8')).toContain('name: testorbit');
    expect(fs.readFileSync(result.filePath, 'utf8')).toContain('Do not claim an emulator/device test passed');
  });

  it('never overwrites an existing skill file', () => {
    const root = tempRoot();
    const filePath = getSkillPath(root, 'codex');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, 'custom user instructions');
    const result = generateAgentSkill(root, 'codex');
    expect(result.created).toBe(false);
    expect(fs.readFileSync(filePath, 'utf8')).toBe('custom user instructions');
  });

  it('renders agent-neutral testing guidance', () => {
    const content = renderSkill('antigravity');
    expect(content).toContain('Antigravity');
    expect(content).toContain('.testorbit/test-reports/');
    expect(content).toContain('bounded');
  });
});
