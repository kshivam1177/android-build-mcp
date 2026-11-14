# Installation

## Requirements

- **Node.js 18+** for the MCP server and CLI
- **Android SDK** with `platform-tools` (`adb`) and at least one `build-tools` version
- **JDK 17+** on `PATH` or `JAVA_HOME` set (needed by Gradle)
- A Gradle wrapper in your Android project (recommended) or Gradle on `PATH`
- Optional: Google's Android CLI installed separately for the `android-cli` workflow

TestOrbit itself does not require Python. Run `testorbit doctor` to check the local Android toolchain.

## Install

```bash
npm install -g testorbit@latest
```

Verify:

```bash
testorbit --help
testorbit doctor
```

### Run without installing globally

```bash
npx -y testorbit@latest mcp
```

## Updating

```bash
npm install -g testorbit@latest
```

When using the `npx -y testorbit@latest` form in your MCP client config, npx re-resolves the package version according to its normal cache behavior.

## Next

- [setup.md](./setup.md) - initialize per-project configuration
- [agent-setup.md](./agent-setup.md) - setup for coding agents and IDEs
- [workflow.md](./workflow.md) - workflow reference

## Optional: Google Android CLI integration

Install Google's Android CLI separately using the [official guide](https://developer.android.com/tools/agents/android-cli), then run `android update` and `android init`. Ensure `android` is on `PATH` or configure `paths.androidCliPath`. See [android-cli.md](./android-cli.md).
