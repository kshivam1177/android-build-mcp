# Deployment and release setup

TestOrbit is a local developer tool that runs as a child process of an MCP client. It does not need a public server or hosted endpoint for stdio usage.

## Local development

Requirements: Node.js 20+ recommended, npm, Java, Android SDK platform tools (`adb`), and an Android SDK. Install Android CLI separately only if you want the optional `android-cli` workflow.

```bash
npm ci
npm run typecheck
npm test
npm run build
node build/cli/index.js doctor
```

Connect a client to the built entry point:

```json
{
  "mcpServers": {
    "testorbit": {
      "command": "node",
      "args": ["/absolute/path/to/TestOrbit/build/cli/index.js", "mcp"]
    }
  }
}
```

Use an absolute path in client configuration. Configure `ANDROID_HOME` or `ANDROID_SDK_ROOT`, Java, and any custom executable paths before starting the MCP client. Restart the client after changing configuration.

## Publish to npm

1. Ensure `package.json` version is incremented and `package-lock.json` matches.
2. Run `npm ci`, `npm run typecheck`, `npm test`, and `npm run build` in CI.
3. Run `npm pack --dry-run` and confirm `build/`, `templates/`, examples/, README, and license are included as intended. The Python UI-automation bridge has been removed and is not part of the published package.
4. Publish using the project's release credentials and normal npm provenance/release policy.
5. Smoke-test the published package in a clean environment with `npx -y testorbit@<version> doctor` and a real MCP client.

## CI considerations

- Unit tests do not replace end-to-end tests against a real Android SDK and emulator/physical device.
- Use a dedicated emulator/device runner for build/install/UI tests; avoid running destructive tests on personal devices.
- Pin Node and Java versions in CI. Cache npm dependencies and Gradle caches, but do not cache mutable device state as if it were reproducible.
- Avoid logging secrets or signing credentials. Do not commit keystores, passwords, local SDK paths, or machine-specific config.
- Google Android CLI is an optional dependency. Test the workflow both when `android` is installed and when it is absent; `doctor` should report it as optional.

## Current verification status

This source update adds the Android CLI workflow and documentation. It has **not** been validated here against a real Android CLI installation, Android Studio, Android SDK, emulator, or physical device. Run the commands above in a suitable environment before publishing. The MCP TypeScript SDK v2 migration is also still outstanding; README documents that accurately rather than claiming v1 is the latest stable line.
