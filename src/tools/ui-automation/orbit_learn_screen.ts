import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { parseUiHierarchy, cacheSnapshot } from '../../automation/uiHierarchy.js';
import { createScreenMap } from '../../automation/screenMap.js';
import { LearnScreenUseCase } from '../../testorbit/application/learn-screen.js';
import { describeLearnScreenDiff, diffLearnedScreens } from '../../testorbit/core/screen-diff.js';
import { deriveElementIds } from '../../testorbit/core/element-id.js';
import { stableSelectorOf } from '../../testorbit/core/matcher.js';
import { isInteractiveNode } from '../../testorbit/core/screen-identity.js';
import { TestOrbitError } from '../../testorbit/domain/errors.js';
import { parseScreenElements } from '../../testorbit/domain/schemas.js';
import { isPlatform, toScreenId, toVariantId, validateAppRoute } from '../../testorbit/domain/types.js';
import type { ElementId, LearnedScreenElement } from '../../testorbit/domain/types.js';
import { writeFileWithBackup } from '../../testorbit/infrastructure/filesystem.js';
import { VariantStore } from '../../testorbit/infrastructure/variant-store.js';
import { withErrorHandling, textResult } from '../../utils/response.js';
import { getScreenSize, resolveTargetAndBackend } from './_shared.js';
import type { UiNode } from '../../types.js';
import type { ToolModule } from '../types.js';

export const toolName = 'orbit_learn_screen';
export const workflow = 'ui-automation';

function inputType(node: UiNode): 'text' | 'number' | 'password' | 'unknown' {
  const labels = `${node.contentDesc ?? ''} ${node.text ?? ''}`.toLowerCase();
  if (labels.includes('password')) return 'password';
  if (/phone|mobile|number|numeric/.test(labels) || (node.className ?? '').toLowerCase().includes('number')) return 'number';
  if ((node.className ?? '').toLowerCase().includes('edittext') || node.focusable) return 'text';
  return 'unknown';
}

/** Elements of a previously learned screen, or [] when never learned. */
function readOldElements(screenDir: string): LearnedScreenElement[] {
  const elementsPath = path.join(screenDir, 'elements.json');
  if (!fs.existsSync(elementsPath)) return [];
  return parseScreenElements(JSON.parse(fs.readFileSync(elementsPath, 'utf8')) as unknown, elementsPath);
}

/** Project-relative path for tool output, or null when there is no file. */
function relativeOrNull(projectRoot: string, filePath: string | null): string | null {
  if (filePath === null) return null;
  return path.relative(projectRoot, filePath).split(path.sep).join('/');
}

export function register(server: McpServer) {
  return server.registerTool(toolName, {
    title: 'Learn Screen',
    description: 'Capture the current Android screen once and save a reusable screen definition, screenshot, semantic element selectors, normalized coordinates, and a basic form specification under .testorbit/<platform>/screens/<screenId>/. Learning goes through the TestOrbit LearnScreenUseCase, which also writes the default variant. Re-learning an existing screen refuses without force: true; with force it keeps .bak backups of the previous files and reports the added/removed/renamed/changed element diff.',
    inputSchema: {
      screenId: z.string().min(1).max(80).regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/),
      targetId: z.string().optional(),
      projectPath: z.string().optional(),
      tags: z.array(z.string().max(30)).max(10).optional(),
      appRoute: z.string().max(200).optional(),
      force: z.boolean().optional(),
      platform: z.string().optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, withErrorHandling(async (args: {
    screenId: string; targetId?: string; projectPath?: string; tags?: string[]; appRoute?: string;
    force?: boolean; platform?: string;
  }) => {
    // Format-only validation (B3/Phase 1 task 8): fails naming `appRoute`.
    validateAppRoute(args.appRoute);
    const screenId = toScreenId(args.screenId);
    const platform = args.platform ?? 'android';
    if (!isPlatform(platform)) {
      throw new TestOrbitError(
        'INVALID_PLATFORM',
        `Unsupported platform "${platform}": expected one of android, ios, flutter, web.`,
        'Pass a supported platform.',
        { platform },
      );
    }
    const projectRoot = path.resolve(args.projectPath ?? process.cwd());
    const store = new VariantStore(projectRoot, platform);
    const useCase = new LearnScreenUseCase(store);
    const screenDir = store.screenDir(screenId);
    const { target, backend } = await resolveTargetAndBackend(args.targetId);
    const [shot, xml, display] = await Promise.all([
      backend.screenshot(target.id),
      backend.dumpHierarchy(target.id),
      getScreenSize(target.id),
    ]);
    const nodes = parseUiHierarchy(xml);
    cacheSnapshot({ targetId: target.id, capturedAt: new Date().toISOString(), backend: backend.name, nodes });
    // Stable element ids (B3) from the one shared derivation; only
    // interactive elements are learned, over the full hierarchy as context.
    const interactive = nodes.filter(isInteractiveNode);
    const ids = deriveElementIds(interactive, screenId, nodes);
    const idFor = (node: UiNode): ElementId => {
      const id = ids.get(node.ref);
      if (id === undefined) {
        throw new Error(`No stable element id derived for node ${node.ref}; this is an internal invariant failure.`);
      }
      return id;
    };
    // Safe re-learn (Phase 3 task 1): diff the fresh dump against the
    // previously learned screen before writing anything, and refuse to
    // overwrite without an explicit force flag — never silently rewrite.
    const freshElements: LearnedScreenElement[] = interactive.map((node) => ({
      id: idFor(node),
      selector: stableSelectorOf(node),
      clickable: node.clickable,
      enabled: node.enabled,
    }));
    const diff = diffLearnedScreens(readOldElements(screenDir), freshElements);
    const alreadyLearned = fs.existsSync(path.join(screenDir, 'screen.json'));
    if (alreadyLearned && args.force !== true) {
      throw new TestOrbitError(
        'RELEARN_REQUIRES_FORCE',
        `Screen "${args.screenId}" is already learned. Re-learning would overwrite it (${describeLearnScreenDiff(diff)}). Re-run orbit_learn_screen with force: true to overwrite — the previous screen.json, elements.json, form-spec.json, screenshot, and variant files are kept as .bak backups.`,
        'Re-run orbit_learn_screen with force: true, or learn under a new screenId.',
        {
          screenId: args.screenId,
          added: String(diff.added.length),
          removed: String(diff.removed.length),
          renamed: String(diff.renamed.length),
          changed: String(diff.changed.length),
        },
      );
    }
    // The use case owns elements.json (canonical lean format, one selector
    // per id) and the default variant file, with .bak backups on re-learn.
    // The default variant's required set defaults to every interactive id
    // present: the tool has no designated subset to pass, so the
    // use-case default applies (B2's designated subset is recorded when
    // a variant is learned with designated required ids).
    const learned = useCase.learnVariant({
      projectRoot,
      platform,
      screenId,
      variantId: toVariantId('default'),
      nodes,
      display,
    });
    const inputs = interactive.filter((node) => (node.className ?? '').toLowerCase().includes('edittext') || node.focusable);
    const fields = inputs.map((node) => ({
      elementId: idFor(node),
      label: node.contentDesc ?? node.text ?? idFor(node),
      inputType: inputType(node),
      stableSelector: stableSelectorOf(node),
    }));
    const screenTitleNode = nodes.find((node) => (node.text || node.contentDesc) && node.bounds.top < display.height * 0.15 && node.bounds.left < display.width * 0.6);
    const title = screenTitleNode?.contentDesc ?? screenTitleNode?.text ?? args.screenId;
    const extension = shot.mimeType === 'image/jpeg' ? 'jpg' : 'png';
    const screenshotPath = path.join(screenDir, `screenshot.${extension}`);
    const screenMap = createScreenMap({
      screenId: args.screenId, deviceId: target.id, backend: backend.name,
      screenshotPath: path.relative(projectRoot, screenshotPath).split(path.sep).join('/'),
      width: display.width, height: display.height, nodes,
    });
    const screen = {
      schemaVersion: 2, screenId: args.screenId,
      appPackage: nodes.find((node) => node.packageName)?.packageName ?? null,
      title, tags: args.tags ?? [], appRoute: args.appRoute ?? null,
      // Fingerprint v2: a version stamp only, never a run-time check (B4).
      fingerprint: screenMap.fingerprint, display, capturedAt: new Date().toISOString(),
      deviceId: target.id, backend: backend.name,
      elementCount: interactive.length, formFieldCount: fields.length,
    };
    const screenshotBackup = writeFileWithBackup(screenshotPath, shot.data);
    const screenBackup = writeFileWithBackup(path.join(screenDir, 'screen.json'), JSON.stringify(screen, null, 2) + '\n');
    // Phase 3 task 2: submitButton stays null here. The submit element is
    // recorded by the converter (Phase 4) as the elementId of the last tap
    // before the first navigation step — orbit_learn_screen must not invent a
    // fill rule of its own.
    let formSpecBackup: string | null = null;
    if (fields.length) {
      formSpecBackup = writeFileWithBackup(
        path.join(screenDir, 'form-spec.json'),
        JSON.stringify({ fields, submitButton: null }, null, 2) + '\n',
      );
    }
    const result: Record<string, unknown> = {
      success: true, screenId: args.screenId, title, fingerprint: screenMap.fingerprint,
      elementCount: interactive.length, formFields: fields.length,
      savedTo: path.relative(projectRoot, screenDir),
      relearned: alreadyLearned,
      defaultVariant: 'default',
      diff: {
        added: [...diff.added],
        removed: [...diff.removed],
        renamed: diff.renamed.map((pair) => ({ from: pair.from, to: pair.to })),
        changed: diff.changed.map((entry) => ({ id: entry.id, field: entry.field, learned: entry.learned, fresh: entry.fresh })),
      },
      backups: {
        screen: relativeOrNull(projectRoot, screenBackup),
        elements: relativeOrNull(projectRoot, learned.elementBackupPath),
        formSpec: relativeOrNull(projectRoot, formSpecBackup),
        screenshot: relativeOrNull(projectRoot, screenshotBackup),
        variant: relativeOrNull(projectRoot, learned.backupPath),
      },
    };
    if (learned.warning !== undefined) result['warning'] = learned.warning;
    if (learned.backfilledVariants.length > 0) result['backfilledVariants'] = [...learned.backfilledVariants];
    return textResult(JSON.stringify(result, null, 2), result);
  }));
}

const mod: ToolModule = { toolName, workflow, register };
export default mod;
