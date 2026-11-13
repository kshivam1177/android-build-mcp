import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { register } from '../screenshot.js';

const mocks = vi.hoisted(() => ({ resolveTargetAndBackend: vi.fn() }));
vi.mock('../_shared.js', () => ({ resolveTargetAndBackend: mocks.resolveTargetAndBackend }));

describe('screenshot artifact persistence', () => {
  const roots: string[] = [];
  afterEach(() => {
    mocks.resolveTargetAndBackend.mockReset();
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  });

  it('discovers the project root from a nested daemon working directory when projectPath is omitted', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'amf-screenshot-root-'));
    roots.push(root);
    const nested = path.join(root, 'packages', 'mobile', 'tools');
    fs.mkdirSync(nested, { recursive: true });
    fs.mkdirSync(path.join(root, '.git'));
    const originalCwd = process.cwd();
    const imageData = Buffer.from('png bytes');
    mocks.resolveTargetAndBackend.mockResolvedValue({
      target: { id: 'emulator-5554' },
      backend: { screenshot: vi.fn().mockResolvedValue({ data: imageData, mimeType: 'image/png' }) },
    });

    let handler: ((args: { projectPath?: string; targetId?: string }) => Promise<unknown>) | undefined;
    const server = {
      registerTool: (_name: string, _metadata: unknown, callback: typeof handler) => { handler = callback; },
    } as unknown as McpServer;
    register(server);

    try {
      process.chdir(nested);
      const result = await handler!({ targetId: 'emulator-5554' }) as {
        content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
      };
      const text = result.content.find((item) => item.type === 'text')?.text ?? '';
      const savedPath = text.match(/saved to: (.+)/)?.[1];
      expect(savedPath).toBe(path.join(root, '.testorbit', 'artifacts', 'screenshots', path.basename(savedPath ?? '')));
      expect(fs.readFileSync(savedPath!)).toEqual(imageData);
    } finally {
      process.chdir(originalCwd);
    }
  });

  it('writes the PNG before returning text and image content with an absolute path', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'amf-screenshot-'));
    roots.push(root);
    const imageData = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/2ioAAAAASUVORK5CYII=',
      'base64'
    );
    mocks.resolveTargetAndBackend.mockResolvedValue({
      target: { id: 'emulator-5554' },
      backend: { screenshot: vi.fn().mockResolvedValue({ data: imageData, mimeType: 'image/png' }) },
    });

    let handler: ((args: { projectPath?: string; targetId?: string }) => Promise<unknown>) | undefined;
    const server = {
      registerTool: (_name: string, _metadata: unknown, callback: typeof handler) => { handler = callback; },
    } as unknown as McpServer;
    register(server);

    const result = await handler!({ projectPath: root, targetId: 'emulator-5554' }) as {
      content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
    };
    const text = result.content.find((item) => item.type === 'text')?.text ?? '';
    const savedPath = text.match(/saved to: (.+)/)?.[1];

    expect(savedPath).toBeTruthy();
    expect(path.isAbsolute(savedPath!)).toBe(true);
    expect(savedPath).toContain(path.join('.testorbit', 'artifacts', 'screenshots'));
    expect(savedPath).toMatch(/emulator-5554-.*\.png$/);
    expect(fs.readFileSync(savedPath!)).toEqual(imageData);
    expect(result.content[1]).toMatchObject({ type: 'image', mimeType: 'image/png', data: imageData.toString('base64') });
  });
});
