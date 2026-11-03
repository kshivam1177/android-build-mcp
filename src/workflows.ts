import { deviceTools } from './tools/device/index.js';
import { emulatorManagementTools } from './tools/emulator-management/index.js';
import { uiAutomationTools } from './tools/ui-automation/index.js';
import { debuggingTools } from './tools/debugging/index.js';
import { projectDiscoveryTools } from './tools/project-discovery/index.js';
import { gradleModuleTools } from './tools/gradle-module/index.js';
import { sessionManagementTools } from './tools/session-management/index.js';
import { doctorTools } from './tools/doctor/index.js';
import { workflowDiscoveryTools } from './tools/workflow-discovery/index.js';
import { androidCliTools } from './tools/android-cli/index.js';
import { testingIntelligenceTools } from './tools/testing-intelligence/index.js';
import { crossPlatformAutomationTools } from './tools/cross-platform-automation/index.js';
import type { ToolModule } from './tools/types.js';

export interface WorkflowDefinition {
  name: string;
  description: string;
  /** Enabled out of the box when no config.yaml exists at all. */
  defaultEnabled: boolean;
  tools: ToolModule[];
}

export const WORKFLOWS: WorkflowDefinition[] = [
  {
    name: 'device',
    description:
      "Build, install, launch, stop, test, and transfer files to/from Android targets - emulators and physical devices together, since adb doesn't distinguish the way Xcode's simctl/devicectl split does.",
    defaultEnabled: true,
    tools: deviceTools,
  },
  {
    name: 'emulator-management',
    description: 'Create, boot, wipe, and configure AVDs: location, dark/light appearance, status-bar demo mode, screen recording.',
    defaultEnabled: false,
    tools: emulatorManagementTools,
  },
  {
    name: 'ui-automation',
    description: 'Semantic UI snapshots, screenshot OCR coordinates, selector-based form filling, declarative JSON workflows executed through the official Android CLI, and tap/swipe/drag/type/key/gesture/wait/batch.',
    defaultEnabled: true,
    tools: uiAutomationTools,
  },
  {
    name: 'debugging',
    description: 'Logcat streaming, crash and ANR extraction, log clearing, full adb bugreport. Log/crash-focused by design - no JDWP breakpoint debugging in this version.',
    defaultEnabled: true,
    tools: debuggingTools,
  },
  {
    name: 'project-discovery',
    description: 'Find Gradle project roots, list modules and build variants, inspect build configuration.',
    defaultEnabled: false,
    tools: projectDiscoveryTools,
  },
  {
    name: 'gradle-module',
    description:
      'Build/test/run/list/stop a standalone Gradle module (pure-JVM/Kotlin library or CLI) - the roughest analogy in this project to Xcode\\'s swift-package workflow; Android has no exact equivalent to a runnable SPM target.',
    defaultEnabled: false,
    tools: gradleModuleTools,
  },
  {
    name: 'session-management',
    description: 'View, set, clear, and switch between named session-default profiles (projectPath/module/variant/targetId/...).',
    defaultEnabled: true,
    tools: sessionManagementTools,
  },
  {
    name: 'doctor',
    description: 'Environment diagnostics: adb, Java, Gradle, Android SDK, emulator and optional Google Android CLI.',
    defaultEnabled: true,
    tools: doctorTools,
  },
  {
    name: 'android-cli',
    description: 'Optional integration with Google Android CLI 1.0+: environment info, Android Studio semantic analysis/navigation, dependency version lookup, and Android skills discovery. Android CLI is installed separately.',
    defaultEnabled: false,
    tools: androidCliTools,
  },
  {
    name: 'testing-intelligence',
    description: 'Project test discovery, change-aware test planning, saved UI workflows, native/Flutter test matrices, unified resumable E2E runs, strict evidence gates, and consolidated reports.',
    defaultEnabled: true,
    tools: testingIntelligenceTools,
  },
  {
    name: 'cross-platform-automation',
    description: 'Cross-platform test validation and execution, target inspection, deterministic UI assertions and state classification, failure diagnosis, optional AI assistance contracts, and JSON/Markdown/JUnit reporting across Android, Flutter, iOS and Web.',
    defaultEnabled: false,
    tools: crossPlatformAutomationTools,
  },
  {
    name: 'workflow-discovery',
    description: 'List and toggle which workflows are enabled for this running server session.',
    defaultEnabled: true,
    tools: workflowDiscoveryTools,
  },
];

export function getWorkflow(name: string): WorkflowDefinition | undefined {
  return WORKFLOWS.find((w) => w.name === name);
}

export function getAllToolModules(): ToolModule[] {
  return WORKFLOWS.flatMap((w) => w.tools);
}
