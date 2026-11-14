import { createRequire } from 'node:module';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execCommand } from '../utils/exec.js';
import type { UiNode } from '../types.js';

type SharpPipeline = {
  rotate(): SharpPipeline;
  grayscale(): SharpPipeline;
  normalize(): SharpPipeline;
  resize(options: { width: number; withoutEnlargement?: boolean }): SharpPipeline;
  png(): SharpPipeline;
  toBuffer(): Promise<Buffer>;
  metadata(): Promise<{ width?: number; height?: number }>;
};
type SharpFactory = (input: Buffer) => SharpPipeline;
const require = createRequire(import.meta.url);

function optionalSharp(): SharpFactory | undefined {
  try {
    const loaded = require('sharp') as SharpFactory | { default?: SharpFactory };
    return typeof loaded === 'function' ? loaded : loaded.default;
  } catch { return undefined; }
}

export interface OcrWord {
  text: string;
  confidence: number;
  bounds: { left: number; top: number; right: number; bottom: number };
  centerX: number;
  centerY: number;
  matchedElementRef?: string;
}

export interface ImageElementCaptureResult {
  imageWidth: number;
  imageHeight: number;
  processedForOcr: boolean;
  ocrAvailable: boolean;
  words: OcrWord[];
  elements: Array<{
    elementRef: string;
    text?: string;
    contentDesc?: string;
    resourceId?: string;
    className?: string;
    bounds: UiNode['bounds'];
    clickable: boolean;
    enabled: boolean;
    ocrText: string[];
  }>;
  warnings: string[];
}

export function parseTesseractTsv(tsv: string, scaleX = 1, scaleY = 1, minConfidence = 45): OcrWord[] {
  const words: OcrWord[] = [];
  for (const line of tsv.split(/\r?\n/).slice(1)) {
    const fields = line.split('\t');
    if (fields.length < 12 || fields[0] !== '5') continue;
    const text = fields.slice(11).join('\t').trim();
    const confidence = Number(fields[10]);
    const left = Number(fields[6]) * scaleX;
    const top = Number(fields[7]) * scaleY;
    const width = Number(fields[8]) * scaleX;
    const height = Number(fields[9]) * scaleY;
    if (!text || !Number.isFinite(confidence) || confidence < minConfidence ||
        ![left, top, width, height].every(Number.isFinite) || width <= 0 || height <= 0) continue;
    words.push({
      text, confidence,
      bounds: { left: Math.round(left), top: Math.round(top), right: Math.round(left + width), bottom: Math.round(top + height) },
      centerX: Math.round(left + width / 2), centerY: Math.round(top + height / 2),
    });
  }
  return words;
}

function contains(bounds: UiNode['bounds'], x: number, y: number): boolean {
  return x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom;
}

export function mapOcrWordsToNodes(words: OcrWord[], nodes: UiNode[]): OcrWord[] {
  for (const word of words) {
    const matches = nodes.filter((node) => contains(node.bounds, word.centerX, word.centerY)).sort((a, b) => {
      const areaA = Math.max(0, a.bounds.right - a.bounds.left) * Math.max(0, a.bounds.bottom - a.bounds.top);
      const areaB = Math.max(0, b.bounds.right - b.bounds.left) * Math.max(0, b.bounds.bottom - b.bounds.top);
      return areaA - areaB;
    });
    if (matches[0]) word.matchedElementRef = matches[0].ref;
  }
  return words;
}

/** Fuses Android semantic nodes with screenshot OCR. Sharp and Tesseract are optional. */
export async function captureImageElements(options: {
  image: Buffer;
  nodes: UiNode[];
  tesseractPath?: string;
  minConfidence?: number;
  timeoutMs?: number;
}): Promise<ImageElementCaptureResult> {
  const warnings: string[] = [];
  const sharp = optionalSharp();
  let ocrImage = options.image;
  let imageWidth = 0;
  let imageHeight = 0;
  let ocrWidth = 0;
  let ocrHeight = 0;
  let processedForOcr = false;

  if (sharp) {
    try {
      const pipeline = sharp(options.image).rotate();
      const metadata = await pipeline.metadata();
      imageWidth = metadata.width ?? 0;
      imageHeight = metadata.height ?? 0;
      const targetWidth = imageWidth > 0 ? Math.min(2400, imageWidth * 2) : 2400;
      ocrImage = await pipeline.grayscale().normalize().resize({ width: targetWidth, withoutEnlargement: false }).png().toBuffer();
      const processedMeta = await sharp(ocrImage).metadata();
      ocrWidth = processedMeta.width ?? imageWidth;
      ocrHeight = processedMeta.height ?? imageHeight;
      processedForOcr = true;
    } catch (error) {
      warnings.push(`Sharp preprocessing failed; original screenshot will be used: ${(error as Error).message}`);
      ocrImage = options.image;
    }
  } else warnings.push('Optional image library "sharp" is not installed; OCR uses the original screenshot.');

  if (!imageWidth || !imageHeight) {
    try {
      const meta = sharp ? await sharp(options.image).metadata() : undefined;
      imageWidth = meta?.width ?? 0;
      imageHeight = meta?.height ?? 0;
    } catch { /* dimensions remain unknown */ }
  }
  if (!ocrWidth) ocrWidth = imageWidth;
  if (!ocrHeight) ocrHeight = imageHeight;

  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'testorbit-image-capture-'));
  let words: OcrWord[] = [];
  let ocrAvailable = false;
  try {
    const imagePath = path.join(tempDir, 'screen.png');
    await writeFile(imagePath, ocrImage);
    const result = await execCommand(options.tesseractPath || 'tesseract', [imagePath, 'stdout', 'tsv'], { timeoutMs: options.timeoutMs ?? 15000 });
    if (result.exitCode !== 0) warnings.push(`Tesseract OCR failed (exit ${result.exitCode}): ${result.stderr.trim().slice(0, 400)}`);
    else {
      ocrAvailable = true;
      const scaleX = imageWidth > 0 && ocrWidth > 0 ? imageWidth / ocrWidth : 1;
      const scaleY = imageHeight > 0 && ocrHeight > 0 ? imageHeight / ocrHeight : 1;
      words = parseTesseractTsv(result.stdout, scaleX, scaleY, options.minConfidence ?? 45);
    }
  } catch (error) {
    warnings.push(`Tesseract OCR is unavailable or failed: ${(error as Error).message}`);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }

  mapOcrWordsToNodes(words, options.nodes);
  const elements = options.nodes.map((node) => ({
    elementRef: node.ref,
    ...(node.text ? { text: node.text } : {}),
    ...(node.contentDesc ? { contentDesc: node.contentDesc } : {}),
    ...(node.resourceId ? { resourceId: node.resourceId } : {}),
    ...(node.className ? { className: node.className } : {}),
    bounds: node.bounds,
    clickable: node.clickable,
    enabled: node.enabled,
    ocrText: words.filter((word) => word.matchedElementRef === node.ref).map((word) => word.text),
  }));
  return { imageWidth, imageHeight, processedForOcr, ocrAvailable, words, elements, warnings };
}
