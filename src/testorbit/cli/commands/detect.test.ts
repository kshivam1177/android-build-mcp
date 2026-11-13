import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runDetectCommand } from './detect.js';
import { freshCheckoutCard, freshCheckoutPicker, writeFixtureScreenTree } from '../../test-fixtures/variants.js';
import { toScreenId } from '../../domain/types.js';
import type { CoreHierarchyNode } from '../../domain/types.js';

/** Temp project with the checkout screen learned, plus a dump file. */
function makeProject(): { projectRoot: string; dumpFile: string } {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'testorbit-cli-'));
  writeFixtureScreenTree(projectRoot, 'android', toScreenId('checkout'));
  return { projectRoot, dumpFile: path.join(projectRoot, 'dump.json') };
}

describe('runDetectCommand — matched variants', () => {
  let projectRoot: string;
  let dumpFile: string;
  let output: string;

  beforeEach(() => {
    ({ projectRoot, dumpFile } = makeProject());
    output = '';
  });

  afterEach(() => {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  function writeDump(nodes: readonly CoreHierarchyNode[]): void {
    fs.writeFileSync(dumpFile, JSON.stringify({ nodes, display: { width: 1080, height: 2400 } }), 'utf8');
  }

  async function run(nodes: readonly CoreHierarchyNode[]): Promise<number> {
    writeDump(nodes);
    return runDetectCommand({
      projectRoot,
      platform: 'android',
      screenId: toScreenId('checkout'),
      hierarchyFile: dumpFile,
      write: (text) => {
        output += text;
      },
    });
  }

  it('prints the matched variant and exits 0', async () => {
    expect(await run(freshCheckoutCard())).toBe(0);
    expect(output).toContain('checkout.online-card');
  });

  it('prints the picker variant as a legitimate state', async () => {
    expect(await run(freshCheckoutPicker())).toBe(0);
    expect(output).toContain('checkout.method-picker');
  });
});

describe('runDetectCommand — unknown variant', () => {
  let projectRoot: string;
  let dumpFile: string;
  let output: string;

  beforeEach(() => {
    ({ projectRoot, dumpFile } = makeProject());
    output = '';
  });

  afterEach(() => {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it('prints unknown plus the exact learn command and exits 1', async () => {
    fs.writeFileSync(dumpFile, JSON.stringify({ nodes: [], display: { width: 1080, height: 2400 } }), 'utf8');
    const code = await runDetectCommand({
      projectRoot,
      platform: 'android',
      screenId: toScreenId('checkout'),
      hierarchyFile: dumpFile,
      write: (text) => {
        output += text;
      },
    });
    expect(code).toBe(1);
    expect(output).toContain('"kind": "unknown"');
    expect(output).toContain('orbit learn --screen checkout --variantId <variant-name> --platform android');
  });
});
