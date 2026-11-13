# Supported MCP clients and transports

TestOrbit is an MCP server implemented with the official TypeScript SDK. The current release exposes **tools over local stdio transport**. It is not currently an HTTP server, and it does not claim MCP Resources or Prompts support unless those capabilities are explicitly added and tested.

## Compatibility matrix

| Client | Status | Connection type | Setup |
|---|---|---|---|
| Claude Code | Supported | Local stdio | `claude mcp add` or project `.mcp.json` |
| OpenAI Codex CLI / IDE extension | Supported | Local stdio | `codex mcp add` or `~/.codex/config.toml` |
| Google Gemini CLI | Supported | Local stdio | `.gemini/settings.json` |
| Google Antigravity | Supported where local stdio MCP servers are enabled | Local stdio | MCP server configuration |
| VS Code + GitHub Copilot | Supported | Local stdio | Workspace `.mcp.json` or `.vscode/mcp.json` |
| Android Studio Gemini | Not directly supported by this server today | Requires HTTP-based MCP endpoint | Requires Streamable HTTP transport or a separately reviewed bridge |
| Other MCP clients | Conditional | Must support local stdio processes | Use the generic configuration below |

“Supported” means the client can launch the server and discover/call its currently registered tools. It does not mean every optional workflow is enabled by default, nor that every planned testing feature is implemented.

## Transport and protocol scope

- **Transport:** stdio only in the current release.
- **Server identity:** `testorbit`; display name: `TestOrbit`; npm package/CLI name: `testorbit`.
- **MCP capability currently exposed:** tools and tool schemas/results.
- **Not currently provided:** a built-in Streamable HTTP endpoint. Do not configure an HTTP URL for this release.
- **Tools are workflow-gated:** tool registration and tool availability are distinct. Optional workflows may need enabling in the project configuration and a server restart.

For the full client setup, troubleshooting and security guide, see [MCP integration guide](./mcp-guide.md).
