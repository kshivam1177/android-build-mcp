/**
 * Layout check for TestOrbit (src/testorbit/).
 *
 * Verifies the enterprise folder/layer rules from the plan (Part D) that
 * ESLint cannot express on its own: the required directories exist, core/
 * imports only core/ + domain/ (plus node:crypto for hashing), no file
 * exceeds 300 lines, and no console.* output exists in shipped code.
 *
 * Run as `npm run testorbit:check-layout`. Exits non-zero with every
 * violation listed; exits 0 with a pass summary.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REQUIRED_DIRS = ['core', 'domain', 'application', 'infrastructure', 'cli', 'config'] as const;
const MAX_FILE_LINES = 300;
/** The only node: import core/ files may use (SHA-256 for id truncation). */
const CORE_ALLOWED_NODE_IMPORTS = new Set(['node:crypto']);

/** Resolve the repo root from this file's location (src/ or build/ layout). */
function repoRoot(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, '..', '..', '..');
}

/** Recursively collect every .ts file under a directory. */
function collectTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectTsFiles(full));
    else if (entry.isFile() && entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

/** Count content lines: skip blank lines and full-line comments. */
function contentLineCount(source: string): number {
  let count = 0;
  for (const line of source.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;
    count += 1;
  }
  return count;
}

/** Extract the module specifiers from import statements in a source file. */
function importSpecifiers(source: string): string[] {
  const found: string[] = [];
  const pattern = /(?:import\s+(?:[^'"]+\s+from\s+)?|import\s*\(\s*)['"]([^'"]+)['"]/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    if (match[1] !== undefined) found.push(match[1]);
  }
  return found;
}

/** Check the required layer directories exist under src/testorbit/. */
function checkStructure(root: string): string[] {
  const violations: string[] = [];
  for (const dir of REQUIRED_DIRS) {
    const full = path.join(root, 'src', 'testorbit', dir);
    if (!fs.existsSync(full) || !fs.statSync(full).isDirectory()) {
      violations.push(`missing required directory: src/testorbit/${dir}`);
    }
  }
  return violations;
}

/**
 * Check core/ import discipline: relative imports must stay inside core/
 * or domain/; node: imports are limited to node:crypto; no MCP or fs
 * imports are allowed in pure logic.
 *
 * Co-located test files (*.test.ts) are exempt from this check: they
 * import the test runner (`vitest`), not shipped dependencies, and the
 * layering rule targets shipped core logic. The file-size and no-console
 * checks still apply to them.
 */
function checkCoreImports(files: string[], testorbitDir: string): string[] {
  const violations: string[] = [];
  const coreDir = path.join(testorbitDir, 'core');
  for (const file of files) {
    if (!file.startsWith(coreDir + path.sep)) continue;
    if (file.endsWith('.test.ts')) continue;
    const rel = path.relative(testorbitDir, file);
    const source = fs.readFileSync(file, 'utf8');
    for (const spec of importSpecifiers(source)) {
      if (spec.startsWith('node:')) {
        if (!CORE_ALLOWED_NODE_IMPORTS.has(spec)) {
          violations.push(`${rel}: core/ must not import ${spec} (only node:crypto is allowed)`);
        }
        continue;
      }
      if (spec.startsWith('.')) {
        const target = path.normalize(path.join(path.dirname(file), spec));
        const targetRel = path.relative(testorbitDir, target);
        if (!targetRel.startsWith('core') && !targetRel.startsWith('domain')) {
          violations.push(`${rel}: core/ must only import core/ or domain/ (found ${spec})`);
        }
        continue;
      }
      violations.push(`${rel}: core/ must not import external module ${spec}`);
    }
  }
  return violations;
}

/** Check no file exceeds the 300 content-line cap. */
function checkFileSizes(files: string[], testorbitDir: string): string[] {
  const violations: string[] = [];
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    const lines = contentLineCount(source);
    if (lines > MAX_FILE_LINES) {
      violations.push(`${path.relative(testorbitDir, file)}: ${lines} content lines exceeds ${MAX_FILE_LINES}`);
    }
  }
  return violations;
}

/** Check no console.* output exists in shipped TestOrbit code. */
function checkNoConsole(files: string[], testorbitDir: string): string[] {
  const violations: string[] = [];
  const pattern = /\bconsole\.(log|warn|error|debug|info)\s*\(/;
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    if (pattern.test(source)) {
      violations.push(`${path.relative(testorbitDir, file)}: console.* output is banned (use the structured logger)`);
    }
  }
  return violations;
}

/** Run every layout check and exit with the result. */
function main(): void {
  const root = repoRoot();
  const testorbitDir = path.join(root, 'src', 'testorbit');
  const violations: string[] = [...checkStructure(root)];
  if (fs.existsSync(testorbitDir)) {
    const files = collectTsFiles(testorbitDir);
    violations.push(...checkCoreImports(files, testorbitDir));
    violations.push(...checkFileSizes(files, testorbitDir));
    violations.push(...checkNoConsole(files, testorbitDir));
    process.stdout.write(`testorbit layout check: ${files.length} file(s) scanned\n`);
  }
  if (violations.length > 0) {
    for (const violation of violations) process.stdout.write(`FAIL: ${violation}\n`);
    process.stdout.write(`testorbit layout check: ${violations.length} violation(s)\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write('testorbit layout check: passed\n');
}

main();
