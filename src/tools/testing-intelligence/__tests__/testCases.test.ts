import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { register as registerSaveTestCase } from '../save_test_case.js';
import { register as registerListTestCases } from '../list_test_cases.js';

describe('Testing Intelligence: save_test_case and list_test_cases', () => {
  let tmpDir: string;
  let saveHandler: (...args: unknown[]) => unknown;
  let listHandler: (...args: unknown[]) => unknown;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-test-cases-'));

    const mockServer = {
      registerTool: (_name: string, _def: any, handler: (...args: unknown[]) => unknown) => {
        return handler;
      },
    } as any;

    saveHandler = registerSaveTestCase(mockServer);
    listHandler = registerListTestCases(mockServer);
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('saves a test case into .testorbit/testcases/ and lists it', async () => {
    const saveRes = await saveHandler({
      projectPath: tmpDir,
      id: 'TC-001',
      title: 'Cart Order Flow',
      description: 'End to end cart checkout flow',
      category: 'checkout',
      steps: [
        {
          stepNumber: 1,
          description: 'Open Cart',
          action: 'tap',
          target: 'Cart Icon',
          expectedOutcome: 'Cart screen opens',
        },
      ],
      assertions: ['Cart is empty after checkout'],
    });

    expect(saveRes.isError).toBeFalsy();
    const testCasesDir = path.join(tmpDir, '.testorbit', 'testcases');
    const expectedFile = path.join(testCasesDir, 'tc-001.json');
    expect(fs.existsSync(expectedFile)).toBe(true);

    const savedContent = JSON.parse(fs.readFileSync(expectedFile, 'utf8'));
    expect(savedContent.id).toBe('TC-001');
    expect(savedContent.category).toBe('checkout');
    expect(savedContent.steps).toHaveLength(1);

    // List test cases
    const listRes = await listHandler({ projectPath: tmpDir });
    expect(listRes.isError).toBeFalsy();
    expect(listRes.structuredContent.count).toBe(1);
    expect(listRes.structuredContent.testCases[0].id).toBe('TC-001');
  });

  it('filters by category in list_test_cases', async () => {
    await saveHandler({
      projectPath: tmpDir,
      id: 'TC-SMOKE-1',
      title: 'Smoke Test',
      description: 'Smoke test login',
      category: 'smoke',
    });

    await saveHandler({
      projectPath: tmpDir,
      id: 'TC-CART-1',
      title: 'Cart Test',
      description: 'Add to cart',
      category: 'cart',
    });

    const smokeRes = await listHandler({ projectPath: tmpDir, category: 'smoke' });
    expect(smokeRes.structuredContent.count).toBe(1);
    expect(smokeRes.structuredContent.testCases[0].id).toBe('TC-SMOKE-1');

    const cartRes = await listHandler({ projectPath: tmpDir, category: 'cart' });
    expect(cartRes.structuredContent.count).toBe(1);
    expect(cartRes.structuredContent.testCases[0].id).toBe('TC-CART-1');
  });

  it('prevents overwrite when overwrite is false', async () => {
    await saveHandler({
      projectPath: tmpDir,
      id: 'TC-DUP',
      title: 'First Version',
      description: 'First',
    });

    const dupRes = await saveHandler({
      projectPath: tmpDir,
      id: 'TC-DUP',
      title: 'Second Version',
      description: 'Second',
    });

    expect(dupRes.isError).toBe(true);
    expect(dupRes.content[0].text).toContain('already exists');
  });

  it('extractCoordinates extracts pixel values from target strings', async () => {
    const { extractCoordinates } = await import('../run_test_case.js');
    expect(extractCoordinates('Cart Icon (x: 526, y: 79)')).toEqual({ x: 526, y: 79 });
    expect(extractCoordinates('Button (120, 340)')).toEqual({ x: 120, y: 340 });
    expect(extractCoordinates('[200, 450]')).toEqual({ x: 200, y: 450 });
    expect(extractCoordinates('No coordinates here')).toBeNull();
  });

  it('findNodeByTarget matches element by text or contentDesc', async () => {
    const { findNodeByTarget, findNodesByTarget, recoverySuggestions } = await import('../run_test_case.js');
    const nodes = [
      {
        ref: 'e1',
        index: 0,
        text: 'Proceed to Checkout',
        bounds: { left: 0, top: 0, right: 100, bottom: 50 },
        centerX: 50,
        centerY: 25,
        clickable: true,
        enabled: true,
        focusable: true,
        scrollable: false,
        checkable: false,
        checked: false,
        depth: 1,
      },
      {
        ref: 'e2',
        index: 1,
        contentDesc: 'Shopping Cart',
        bounds: { left: 0, top: 0, right: 100, bottom: 50 },
        centerX: 50,
        centerY: 25,
        clickable: true,
        enabled: true,
        focusable: true,
        scrollable: false,
        checkable: false,
        checked: false,
        depth: 1,
      },
    ];

    expect(findNodeByTarget(nodes, 'checkout')?.ref).toBe('e1');
    expect(findNodeByTarget(nodes, 'shopping cart')?.ref).toBe('e2');
    expect(findNodeByTarget(nodes, 'Non-existent')).toBeUndefined();
    expect(findNodesByTarget(nodes, 'checkout')).toHaveLength(1);
    expect(recoverySuggestions('Could not locate target on screen: Login')).toContain('Refresh the learned screen definition and update the saved target to a currently visible semantic label or resource ID.');
    expect(recoverySuggestions('Ambiguous target Login matched 2 elements.')).toContain('Replace the text target with a unique resource ID or content description; do not rely on the first matching element.');
  });
});

describe('test execution recovery helpers', () => {
  it('does not resolve ambiguous labels to the first matching element', async () => {
    const { findNodeByTarget, findNodesByTarget } = await import('../run_test_case.js');
    const node = (ref: string, text: string) => ({
      ref, index: 0, text, bounds: { left: 0, top: 0, right: 100, bottom: 50 },
      centerX: 50, centerY: 25, clickable: true, enabled: true, focusable: true,
      scrollable: false, checkable: false, checked: false, depth: 1,
    });
    const nodes = [node('one', 'Login'), node('two', 'Login')];
    expect(findNodesByTarget(nodes, 'Login')).toHaveLength(2);
    expect(findNodeByTarget(nodes, 'Login')).toBeUndefined();
  });
});
