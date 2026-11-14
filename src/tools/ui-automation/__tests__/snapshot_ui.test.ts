import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { register } from '../snapshot_ui.js';

const mocks = vi.hoisted(() => ({ resolveTargetAndBackend: vi.fn() }));
vi.mock('../_shared.js', () => ({ resolveTargetAndBackend: mocks.resolveTargetAndBackend, dumpHierarchyWithRetry: async (backend: { dumpHierarchy: (targetId: string) => Promise<string> }, targetId: string) => backend.dumpHierarchy(targetId) }));

const XML = '<hierarchy><node index="0" text="Login" resource-id="com.example:id/login" class="android.widget.Button" package="com.example.app" content-desc="" clickable="true" enabled="true" focusable="true" scrollable="false" checkable="false" checked="false" bounds="[0,0][100,50]"></node></hierarchy>';

describe('snapshot_ui persistence', () => {
  const roots: string[] = [];
  afterEach(() => {
    mocks.resolveTargetAndBackend.mockReset();
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  });

  it('persists raw hierarchy and returns a compact summary by default', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'amf-snapshot-'));
    roots.push(root);
    mocks.resolveTargetAndBackend.mockResolvedValue({
      target: { id: 'emulator-5554' },
      backend: { name: 'adb', dumpHierarchy: vi.fn().mockResolvedValue(XML) },
    });
    let handler: ((args: { projectPath: string; targetId: string }) => Promise<unknown>) | undefined;
    const server = {
      registerTool: (_name: string, _metadata: unknown, callback: typeof handler) => { handler = callback; },
    } as unknown as McpServer;
    register(server);

    const response = await handler!({ projectPath: root, targetId: 'emulator-5554' }) as {
      content: Array<{ type: string; text?: string }>;
      structuredContent: Record<string, unknown>;
    };
    const artifactPath = String(response.structuredContent.artifactPath);
    const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8')) as {
      rawHierarchyXml: string;
      totalElementCount: number;
      elements: Array<{ text?: string }>;
    };

    expect(artifactPath).toContain(path.join('.testorbit', 'artifacts', 'snapshots'));
    expect(artifact.rawHierarchyXml).toBe(XML);
    expect(artifact.totalElementCount).toBe(1);
    expect(artifact.elements[0]?.text).toBe('Login');
    expect(response.structuredContent.elementsIncluded).toBe(false);
    expect(response.structuredContent.elementCount).toBe(1);
    expect(response.content[0]?.text).toContain(artifactPath);
    expect(response.content[0]?.text).not.toContain('resource-id');
  });
});
