# Setup

## Quick start

From your Android or Flutter project's root:

```bash
testorbit setup
```

This creates `.testorbit/config.yaml` if it doesn't exist. Existing canonical configurations are never overwritten.

If the project already contains `.android-build-mcp/` or `.androidbuildmcp/`, setup reports that legacy directory. Review the files and run `testorbit setup --migrate` to copy them into `.testorbit/`; the migration does not overwrite existing files or delete the old directory.

## The config file

`.testorbit/config.yaml` is project-scoped. A monorepo can keep one configuration for each project. See [`config.example.yaml`](../../config.example.yaml) for the complete schema.

- **`enabledWorkflows`** controls which workflows are exposed.
- **`customWorkflows`** enables selected tools outside their parent workflow.
- **`automationBackend`** is `adb`; UI automation uses the Android SDK and requires no Python helper.
- **`disableSessionDefaults`** can require each tool call to pass its own target/module/variant (useful in CI).
- **`sessionDefaults`** sets project-level defaults; session tools can temporarily override them.
- **`paths`** overrides `adbPath`, `gradlePath`, `androidHome`, `javaHome`, and `androidCliPath`.

## Session-default profiles

If you work across multiple Android projects from the same MCP client, `session_use_defaults_profile` switches between named profiles.

## Verifying the environment

```bash
testorbit doctor
```

The doctor command checks Node.js-visible Android tooling such as `adb`, Java, Gradle, Android SDK variables, the emulator binary, build-tools and the optional Google Android CLI integration.
