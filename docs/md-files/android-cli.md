# Google Android CLI integration

**Research checked: 12 October 2026.** Google announced Android CLI 1.0 stable at Google I/O on 19 May 2026. The official command reference now documents project creation/description, SDK and device workflows, Journeys, Android skills, and Android Studio integration. Sources: [Android CLI overview](https://developer.android.com/tools/agents/android-cli), [command reference](https://developer.android.com/tools/agents/android-cli/commands), [Google announcement](https://android-developers.googleblog.com/2026/05/android-cli-stable-1-0-agent-development.html).

TestOrbit remains useful as an MCP-first orchestration layer: its existing adb/Gradle tools provide structured, directly callable device/build operations; Google Android CLI adds official agent skills, Journeys, environment management, and Android Studio semantic capabilities. They overlap, so this project should integrate with Android CLI rather than reimplement all its new functionality.

## Install and initialize

Install Android CLI using Google's current [installation instructions](https://developer.android.com/tools/agents/android-cli). On supported systems, the official documentation lists package-manager options including Homebrew, apt, and winget. Then run:

```bash
android update
android init
android info
android studio check
```

The `android` executable must be on `PATH`, or set `paths.androidCliPath` in `.testorbit/config.yaml`. Android CLI is an optional external dependency; TestOrbit does not download or bundle it.

Example config:

```yaml
paths:
  androidCliPath: android
```

Enable the optional workflow in `enabledWorkflows`:

```yaml
enabledWorkflows:
  - device
  - ui-automation
  - session-management
  - doctor
  - workflow-discovery
  - android-cli
```

If an explicit `enabledWorkflows` list is present, include `android-cli` to enable it. Alternatively use `manage_workflows` if available in the current server session.

## Exposed tools

| MCP tool | Purpose |
|---|---|
| `android_cli_info` | Show Android CLI environment and device information (`android info`). |
| `android_cli_studio_check` | Check the connection to running Android Studio instances. |
| `android_cli_studio_analyze_file` | Ask Android Studio to analyze a project file. |
| `android_cli_studio_find_symbol` | Find a symbol declaration or usages using IDE semantic resolution. |
| `android_cli_studio_version_lookup` | Look up dependency/tool versions through Android Studio. |
| `android_cli_skills_list` | List Android CLI skills. |

The integration uses an argv-based process spawn rather than a shell, and intentionally does not expose an arbitrary command runner. Android CLI commands that mutate SDKs, remove skills, create/delete devices, or run Journeys are not yet exposed as MCP tools in this release.

## Android Studio requirements

Google's current documentation says the Studio bridge requires a compatible Android Studio preview/current version (the official reference currently names Android Studio Quail 2 or higher) with the project open. Run `android studio check` first. If the bridge is unavailable, use the existing TestOrbit adb/Gradle workflows for supported operations.

## Important overlap and limitations

- Prefer `android_cli_studio_version_lookup` when the agent needs a current dependency version; do not rely on stale versions in prompts or docs.
- Use TestOrbit's existing build/install/launch/test tools when you need stable structured MCP operations against a selected device.
- Google Android CLI supports Journeys and can run natural-language user journeys, but this update does not yet wrap Journey creation/execution. That is a logical next feature after testing the CLI's exact syntax and output schema across macOS/Linux/Windows.
- Android CLI has platform limitations documented by Google; for example, the official docs currently note Windows restrictions for emulator commands and PowerShell-based installation. Check the official docs before relying on platform-specific commands.
