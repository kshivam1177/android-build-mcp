# MCP client configuration

TestOrbit currently runs as a local **stdio MCP server**. It uses the package/CLI name `testorbit` and starts with the `mcp` command. For a client-specific walkthrough, see [MCP integration guide](./mcp-guide.md).

## Generic configuration

Clients using the common `mcpServers` schema can use:

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

For VS Code's `.vscode/mcp.json` schema, use a top-level `servers` object:

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

## Verify installation

Run these in a terminal, not inside the MCP configuration:

```bash
node --version
npx -y testorbit@latest --help
npx -y testorbit@latest doctor
npx -y testorbit@latest workflows
npx -y testorbit@latest tools
```

Then restart/reload the MCP client and ask it to list the TestOrbit tools or call the available doctor tool.

## Project configuration is separate

The MCP client configuration only starts the server. It does not configure which project or workflows should be used. From the Android app repository root, run:

```bash
npx -y testorbit@latest setup
```

Review the generated `.testorbit/config.yaml`, especially `enabledWorkflows` and `sessionDefaults`. If the repository has legacy `.android-build-mcp/` or `.androidbuildmcp/` data, use `testorbit setup --migrate` after reviewing it. Restart the MCP client after changing configuration.

## Current transport limitation

This release supports stdio only. Do not use an HTTP URL or assume a built-in HTTP listener exists. Direct Android Studio Gemini integration requires a supported HTTP transport or a separately reviewed bridge; see [Supported clients](./supportedclients.md#transport-and-protocol-scope).
