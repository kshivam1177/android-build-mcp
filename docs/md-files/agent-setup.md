# Coding-agent setup guide

This guide explains how to install TestOrbit and connect it to coding agents. It covers the current MCP server and its implemented tools; it does **not** imply that the full natural-language test generation/execution roadmap is already complete.

## 1. Prerequisites

Install the normal development tools for the project you want to test:

- Node.js 18 or newer and npm.
- Git (recommended; change analysis uses Git when available).
- For native Android: Android SDK/platform-tools (`adb`), JDK 17+, Gradle wrapper, and an emulator or connected device for device tests.
- For Flutter: Flutter SDK and Dart. Run `flutter doctor` and resolve the requirements for the targets you intend to test.
- For screenshot OCR: optionally install Tesseract OCR and make `tesseract` available on `PATH`, or set `TESSERACT_PATH`. OCR is not bundled with the npm package.\n- For Google's Android CLI integration: install the official CLI by following the [Android CLI setup guide](https://developer.android.com/tools/agents/android-cli). Confirm `android --help` works and the executable is on `PATH`, or configure `paths.androidCliPath`.

TestOrbit does not install Android Studio, Android SDK, Flutter, JDK, emulator images, or Google Android CLI on your behalf.

## 2. Install TestOrbit

### Recommended: npm package

```bash
npm install -g testorbit@latest
testorbit --help
testorbit doctor
```

You can also let the MCP client start it with `npx` (no global install required):

```bash
npx -y testorbit@latest mcp
```

The `mcp` command is a stdio server process. Do not run it in a terminal and expect normal command output: stdout is used for the MCP protocol. For manual diagnostics use `testorbit doctor`, `testorbit workflows`, and `testorbit tools` instead.

### Run from a local checkout

```bash
git clone <your-testorbit-repository-url>
cd testorbit
npm ci
npm run build
npm test
npm run typecheck
```

Then configure the MCP client to launch the local built entry point:

- macOS/Linux: `node /absolute/path/to/testorbit/build/cli/index.js mcp`
- Windows: `node C:\absolute\path\to\TestOrbit\build\cli\index.js mcp`

Use absolute paths in client configuration where possible. Keep the Node executable and all toolchain paths available to the environment that starts the MCP server.

## 3. Configure each app repository

Open the **application repository root** in your agent/IDE. Run:

```bash
testorbit setup
```

This creates `.testorbit/config.yaml` and does not overwrite an existing file. For projects with legacy `.android-build-mcp/` or `.androidbuildmcp/` data, inspect it and run `testorbit setup --migrate` to copy files without overwriting existing content. For native Android, configure `sessionDefaults.projectPath`, `module`, and `variant` for your Gradle project. For Flutter, point tools at the Flutter repository root when applicable; note that the current framework has only initial project analysis/instructions/reporting tools for the natural-language testing workflow, and the complete Flutter test execution adapter is not implemented yet.

Enable the relevant workflows in `.testorbit/config.yaml`. Workflow names and tools can be checked with:

```bash
testorbit workflows
testorbit tools
```

Then run:

```bash
testorbit doctor
```

The Android CLI integration is optional. To use it, enable the `android-cli` workflow in the project's `enabledWorkflows` list after installing Google's CLI. The `testing-intelligence` workflow is the early foundation for project analysis, reusable instructions and timestamped reports; it is not yet a fully autonomous end-to-end testing system.

## 4. Claude Code

From the application repository root:

```bash
claude mcp add testorbit -- npx -y testorbit@latest mcp
claude mcp list
```

This is project-local when run in a project context according to Claude Code's MCP configuration behavior. Alternatively, add a server entry to the repository's `.mcp.json`:

```json
{
  "mcpServers": {
    "testorbit": {
      "command": "npx",
      "args": ["-y", "testorbit@latest", "mcp"]
    }
  }
}
```

Restart/reload Claude Code if needed, then ask it to list the TestOrbit tools or run the `doctor` tool.

Official guide: [Claude Code MCP](https://docs.anthropic.com/en/docs/claude-code/mcp).

## 5. OpenAI Codex (CLI and IDE extension)

Codex CLI and its IDE extension share the Codex MCP configuration. From a terminal:

```bash
codex mcp add testorbit -- npx -y testorbit@latest mcp
codex mcp list
```

If your installed Codex version expects manual configuration, add this to `~/.codex/config.toml`:

```toml
[mcp_servers.testorbit]
command = "npx"
args = ["-y", "testorbit@latest", "mcp"]
```

Restart the Codex session and confirm the server is available. For a local checkout, replace `npx` with `node` and use the absolute path to `build/cli/index.js` as the first argument, followed by `mcp`.

Official reference: [Codex MCP configuration](https://developers.openai.com/codex/mcp/).

## 6. Google Gemini CLI

Gemini CLI supports MCP server definitions in its settings. For a project-scoped setup, create or update `.gemini/settings.json` in the application repository:

```json
{
  "mcpServers": {
    "testorbit": {
      "command": "npx",
      "args": ["-y", "testorbit@latest", "mcp"]
    }
  }
}
```

For user-wide configuration, use `~/.gemini/settings.json` instead. Start/restart Gemini CLI and inspect its MCP status/tools. Be careful not to overwrite other settings already in the file; merge the `mcpServers` entry into the existing JSON.

Official reference: [Gemini CLI MCP servers](https://github.com/google-gemini/gemini-cli/blob/main/docs/tools/mcp-server.md).

## 7. Google Antigravity

Antigravity IDE/CLI uses `mcp_config.json` with a `mcpServers` object. For a workspace-level setup, create or update `.agents/mcp_config.json` in the app repository:

```json
{
  "mcpServers": {
    "testorbit": {
      "command": "npx",
      "args": ["-y", "testorbit@latest", "mcp"]
    }
  }
}
```

The global CLI/IDE config is documented at `~/.gemini/config/mcp_config.json`. Merge this entry rather than replacing existing servers. In Antigravity CLI, open the MCP manager with `/mcp` to inspect connection state and logs. In the IDE, open the MCP Servers panel and use Manage MCP Servers / View raw config.

Official reference: [Antigravity MCP documentation](https://antigravity.google/docs/mcp).

## 8. VS Code with GitHub Copilot

For new VS Code/Copilot setups, prefer a portable `.mcp.json` at the application repository root:

```json
{
  "mcpServers": {
    "testorbit": {
      "command": "npx",
      "args": ["-y", "testorbit@latest", "mcp"]
    }
  }
}
```

Alternatively, VS Code supports `.vscode/mcp.json`, which uses a different schema with a top-level `servers` object:

```json
{
  "servers": {
    "testorbit": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "testorbit@latest", "mcp"]
    }
  }
}
```

In VS Code, open the repository, open Copilot Chat, switch to Agent mode, and use **Configure Tools** / the MCP Servers view to enable the TestOrbit tools. If you change the configuration, restart/reload the server from the MCP server management UI.

Official reference: [VS Code MCP servers](https://code.visualstudio.com/docs/agent-customization/mcp-servers).

## 9. Android Studio with Gemini

**Important transport limitation:** Android Studio's documented MCP integration currently does not support connecting to MCP servers over `stdio`; it supports HTTP-based MCP connections. TestOrbit currently starts over `stdio` only. Therefore, the configurations above cannot be pasted directly into Android Studio's MCP Servers settings and expected to work.

To use TestOrbit directly inside Android Studio, the project needs a supported Streamable HTTP transport (with local-only binding, authentication/access controls, and explicit security review), or a trusted stdio-to-HTTP bridge. This transport is not included in the current build, so do not follow an unofficial bridge recipe as if it were already supported.

Once HTTP transport is implemented, the intended Android Studio setup location is **Settings > Tools > AI > MCP Servers**, enable MCP servers, and configure the local HTTP endpoint according to the Android Studio version's schema. See Google's [Add an MCP server to Android Studio](https://developer.android.com/studio/gemini/add-mcp-server) guide for the current UI and transport restrictions.

You can still use TestOrbit from Claude Code, Codex, Gemini CLI, Antigravity and VS Code while working on the same Android Studio project; the MCP client does not have to be the IDE itself.

## 10. Shared agent instructions

For consistent behavior across agents, add the following guidance to the repository's agent instruction file (for example `AGENTS.md`, `CLAUDE.md`, or VS Code instructions). Keep it concise and commit it if the whole team should share the workflow:

```markdown
## TestOrbit testing workflow

- Before testing a feature change, inspect the current Git diff and the project's `.testorbit/knowledge/` and `.testorbit/instructions/` if present.
- Use TestOrbit project-analysis and testing-intelligence tools when available; do not claim the full autonomous testing lifecycle is implemented unless the configured tools actually support it.
- Prefer existing tests and project scripts before generating new tests.
- For Native Android, use the project's Gradle wrapper and the installed Google Android CLI capabilities when relevant. For Flutter, use the project's documented Flutter/Dart test commands.
- Prepare a test plan based on the requested scope and affected code. Ask before destructive actions, production-data use, or changing important existing assertions.
- Do not execute arbitrary generated shell commands without reviewing their purpose and safety.
- Report pass, fail, blocked, skipped, and inconclusive separately. Never mark a test passed without executing it and validating its assertions.
- Save each run's report and machine-readable results under `.testorbit/test-reports/YYYY-MM-DD/HHmmss/` when the reporting tool is available.
- Do not silently overwrite user-authored test instructions. Propose updates and preserve prior reports.
```

## 11. Suggested first prompts

Use these after connecting the MCP server. They are prompts for the agent, not commands guaranteed to be fully automated by the current implementation.

**Inspect a repository:**

> Analyze this repository for Native Android and Flutter projects. Identify build systems, modules, test folders, available test commands, and current Git changes. Save a baseline testing instruction document. Do not modify application code or run tests yet.

**Plan regression tests:**

> Inspect the current Git diff and saved TestOrbit testing instructions. Propose a test plan for the changed behavior and related regression risks. Reuse existing tests first. Clearly label any suggested tests that have not been generated or executed.

**Run a targeted test (when execution adapters are available):**

> Test the changed login flow and its direct regressions. Use a disposable test account and a debug build. Show me the planned commands and any device/emulator actions before running them. Save a timestamped report and evidence under `.testorbit/test-reports/`.

**Custom scenario:**

> Add a reusable scenario for offline order editing and synchronization. Define preconditions, steps, assertions, test data, cleanup, and expected evidence. Do not overwrite existing instructions; show me the proposed changes for review.

## 12. Troubleshooting

- **Server does not start:** run `node --version`, `npx -y testorbit@latest --help`, and `testorbit doctor` separately. Check client logs.
- **No tools visible:** confirm the config JSON is valid, restart/reload the MCP server, and check that `.testorbit/config.yaml` has the desired workflow names in `enabledWorkflows`.
- **Wrong project is targeted:** start the agent from the app repository root, run `testorbit setup`, and inspect `.testorbit/config.yaml` and session defaults.
- **`adb` or Gradle unavailable:** check Android SDK environment variables, `adb devices`, JDK, and `./gradlew tasks` (or `gradlew.bat tasks` on Windows).
- **Flutter tests unavailable:** check `flutter doctor`, `flutter --version`, and `flutter test` manually in the Flutter project before expecting an agent to orchestrate them.
- **Android Studio cannot connect:** remember that the current TestOrbit server is stdio-only; direct Android Studio connection requires HTTP transport or a reviewed bridge.
- **Tests were not executed:** the current testing-intelligence tools do not yet provide the complete test-plan generation and execution lifecycle. Treat reports as records of supplied results, not proof of automatic testing.

## 13. Security notes

MCP tools may run local commands, access source files, interact with devices, or write reports. Connect only to trusted server builds. Do not run tests against production accounts or data by default. Review generated commands, protect secrets, redact tokens and personal data from logs, and use a disposable emulator/device and test accounts for destructive scenarios.


## 14. `trust` and `alwaysAllow` configuration

Some MCP clients or MCP-hosting applications accept additional configuration fields such as `trust` and `alwaysAllow`. These are **client-specific extensions, not standard MCP protocol fields**. Use them only in a client whose configuration schema documents them; other clients may reject or ignore them.

- `trust: true` may mark a server as trusted in clients that support this extension. Only trust a local server you have reviewed.
- `alwaysAllow` is a client-side approval allowlist in clients that support it. Entries are tool names, not commands. Keep the list minimal and use the exact names exposed by the connected server.
- Tools such as `uninstall_app_device`, `clear_app_data`, `grant_permissions`, and `reset_permissions` can alter device/app state. Do not auto-approve them unless that behavior is intentional for your development device.

A reusable configuration example is available at [`examples/mcp-config.example.json`](../../examples/mcp-config.example.json). It uses placeholder paths; replace them with paths on your machine. The README also includes a local-checkout example. The server's npm package name is `testorbit`; the recommended MCP client alias is `testorbit`, and the display name is **TestOrbit**.

### Client-specific setup

- **Claude Code:** use `claude mcp add testorbit -- npx -y testorbit@latest mcp`, or the `.mcp.json` entry in [Section 4](#4-claude-code). Use only config fields accepted by Claude Code.
- **Codex:** use `codex mcp add testorbit -- npx -y testorbit@latest mcp`, or the TOML entry in [Section 5](#5-openai-codex-cli-and-ide-extension). Do not paste JSON-only fields such as `alwaysAllow` into `config.toml`.
- **Antigravity:** use the `mcpServers` entry in [Section 7](#7-google-antigravity) and merge it into your existing `mcp_config.json`. Check the installed version's schema before adding `trust` or `alwaysAllow`.
- **VS Code / GitHub Copilot:** use the `.mcp.json` or `.vscode/mcp.json` schema in [Section 8](#8-vs-code-with-github-copilot). Configure approval behavior through VS Code's supported MCP UI/settings rather than assuming `alwaysAllow` is recognized.
