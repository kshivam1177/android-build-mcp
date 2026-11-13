# MCP integration guide

## Launch the server

Use the npm package from a compatible MCP client:

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

The official registry name is `io.github.kshivam1177/testorbit`; the local `mcpServers` key is a client-side alias.

## Project configuration

From an Android or Flutter repository root, run:

```bash
testorbit setup
```

This creates `.testorbit/config.yaml`. Legacy `.android-build-mcp/` and `.androidbuildmcp/` data can be copied using `testorbit setup --migrate`; migration preserves the old files and fails rather than overwriting existing destination files.

## Requirements and troubleshooting

The framework uses Node.js, the Android SDK/ADB, Java and Gradle as needed. UI automation uses ADB and Android's built-in UI hierarchy dump. The server does not require Python or a bundled script directory.

Run `testorbit doctor` to inspect prerequisites. The server currently uses stdio transport; client support and Android Studio limitations are documented in [supported clients](./supportedclients.md).
