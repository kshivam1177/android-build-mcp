import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WORKFLOWS } from '../workflows.js';
import { loadConfig } from '../config/loader.js';
import { registerHandle, markWorkflowEnabled, getHandle } from './toolRegistry.js';
import { findProjectConfigPath } from '../utils/paths.js';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

function readPackageVersion(): string {
  try {
    const pkgPath = path.resolve(moduleDir, '..', '..', 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/**
 * Registers every tool from every workflow unconditionally (so
 * manage_workflows can re-enable any of them later via the handle's own
 * .enable()), then disables whatever isn't supposed to be on at boot.
 *
 * "On at boot" = config.yaml's enabledWorkflows if a real config file
 * exists, otherwise each workflow's own defaultEnabled flag. An explicit
 * empty enabledWorkflows array in a real config.yaml means "nothing" -
 * it must not silently fall back to the defaults.
 */
export function createServer(): McpServer {
  const config = loadConfig();
  const server = new McpServer({ name: 'testorbit', version: readPackageVersion() });

  // An existing config file is authoritative even when enabledWorkflows: [] is intentional.
  const hasExplicitConfig = Boolean(findProjectConfigPath(process.cwd()));
  const enabledWorkflowNames = new Set(
    hasExplicitConfig ? config.enabledWorkflows : WORKFLOWS.filter((w) => w.defaultEnabled).map((w) => w.name)
  );
  const individuallyEnabledTools = new Set(Object.values(config.customWorkflows).flat());

  for (const workflowDef of WORKFLOWS) {
    for (const toolModule of workflowDef.tools) {
      const handle = toolModule.register(server);
      registerHandle(toolModule.toolName, workflowDef.name, handle);
    }
  }

  for (const workflowDef of WORKFLOWS) {
    const enabled = enabledWorkflowNames.has(workflowDef.name);
    if (enabled) markWorkflowEnabled(workflowDef.name);
    for (const toolModule of workflowDef.tools) {
      const shouldBeOn = enabled || individuallyEnabledTools.has(toolModule.toolName);
      if (!shouldBeOn) {
        getHandle(toolModule.toolName)?.disable();
      }
    }
  }

  return server;
}
