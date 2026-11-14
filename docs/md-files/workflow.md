# Workflows

A workflow is a named group of related tools. TestOrbit enables six workflows by default, including testing intelligence, and lets you enable optional workflows as needed.

## Default state

The following workflows are enabled without a manual enable call: `device`, `ui-automation`, `session-management`, `doctor`, `workflow-discovery`, and `testing-intelligence`. Testing intelligence provides project analysis, screen audits, test-case persistence, change-impact analysis, and structured test reports.

Optional workflows are `emulator-management`, `debugging`, `project-discovery`, `gradle-module`, and `android-cli`.

## Full list

| Workflow | Default | Description |
|---|---|---|
| `device` | On | Build, install, launch, stop, test, and transfer files to/from Android devices. Includes Native Android Gradle tests and Flutter `flutter test` adapters. |
| `emulator-management` | Off | Create, boot, wipe, and configure Android Virtual Devices. |
| `ui-automation` | On | Semantic snapshots, screenshots, selector-based form filling, JSON workflows, keyboard dismissal, and device interactions. |
| `debugging` | Off | Logcat streaming, crash and ANR extraction, log clearing, and ADB bug reports. |
| `project-discovery` | Off | Find Gradle roots, list modules and build variants, inspect build configuration. |
| `gradle-module` | Off | Build and test standalone Gradle modules. |
| `session-management` | On | View, set, clear, and switch between session-default profiles. |
| `doctor` | On | Diagnose ADB, Java, Gradle, Android SDK, emulator, and optional Android CLI setup. |
| `workflow-discovery` | On | List and toggle workflows for the current server session. |
| `android-cli` | Off | Optional Google Android CLI integration. |
| `testing-intelligence` | On | Analyze projects, discover Native Android and Flutter tests, audit screens, save test cases, and write reports. |

## Persistent configuration

Edit `.testorbit/config.yaml` and restart the MCP client to change enabled workflows:

```yaml
enabledWorkflows:
  - device
  - ui-automation
  - session-management
  - doctor
  - workflow-discovery
  - testing-intelligence
  # Optional:
  # - android-cli
  # - emulator-management
```

A config file's explicit `enabledWorkflows` list is authoritative. If an older config omits `testing-intelligence`, add it to that list to enable the workflow for that existing installation. Fresh/default configs include it automatically. An explicit `enabledWorkflows: []` means no workflows are enabled.

## Session-only configuration

Call `manage_workflows` with `{"action":"enable","workflowName":"emulator-management"}` to enable a workflow for the current server session. Session-only changes do not update `config.yaml` and do not survive a restart.

## Custom workflows

`customWorkflows` can enable individual tools independently of their parent workflow. See [tools.md](./tools.md) for the tool reference.
