# Phases 71–80 — Device fleet registry and safe allocation

## Goal

Introduce a deterministic control plane for existing Android, Flutter, iOS and Web runtimes. The framework can register known targets, report whether they are reachable, and prevent two cooperating automation runs from claiming the same target at once.

## Delivered in this milestone

- Project-local target registry at `.testorbit/device-fleet.json`.
- Versioned and schema-validated registry records for Android, Flutter, iOS and Web.
- Register/update, list and remove operations with deterministic ordering.
- Read-only health probes that connect to the configured driver, read capabilities and always attempt disconnect.
- Exclusive target leases with unique tokens, owner metadata and bounded TTL (30–3600 seconds).
- Expired lease cleanup, explicit release and protection against removing a currently leased target.
- Atomic, permission-restricted (0600) JSON writes and in-process serialized mutations.
- MCP entry point: `manage_cross_platform_fleet`.
- Unit tests for registry updates, contention, lease expiry, invalid state, release and removal safety.

## Configure targets

Call `manage_cross_platform_fleet(action="register")` with a target object. Example Android target:

    {
      "id": "pixel-8-api-35",
      "platform": "android",
      "targetId": "emulator-5554",
      "appId": "com.example.app",
      "labels": ["android", "api-35", "smoke"],
      "enabled": true
    }

Example Web target:

    {
      "id": "web-staging",
      "platform": "web",
      "baseUrl": "https://staging.example.test",
      "labels": ["web", "staging"],
      "enabled": true
    }

Then use:

1. `action="list"` to inspect registered targets and active leases.
2. `action="health"` (optionally with `targetId`) to test driver connectivity and capabilities.
3. `action="lease"` with `targetId`, `owner` and optional `ttlSeconds` before scheduling work.
4. Pass the registered target configuration to the existing cross-platform runner.
5. `action="release"` with the returned lease token in a finally/cleanup path.

## Safety and operating model

- Registration is declarative; it never installs SDKs, boots emulators, creates cloud devices, signs apps or provisions macOS/browser workers.
- Health checks are connection/capability probes, not app-level E2E tests.
- Leases are advisory coordination for agents sharing the same project state and MCP process. They are not a distributed lock service for multiple hosts or independent filesystem replicas.
- Lease TTL is bounded to one hour to limit abandoned reservations. Expired leases are reclaimed on read/acquire.
- The registry may contain target metadata; do not put passwords, access tokens, private keys or other secrets in it.
- The fleet registry is project-local and ignored by Git. Back it up only if preserving local target configuration is desired.

## Remaining work in the broader device-farm roadmap

This milestone establishes the registry/allocation foundation, not a hosted device farm. Follow-on work should add host agents and remote worker heartbeats, cross-host lease coordination, emulator pool provisioning, macOS/Xcode worker discovery, browser worker lifecycle, build/install orchestration, signed artifact attestations, replay orchestration and coverage analytics. Phases 81–90 add local artifact integrity manifests and guarded retention, but do not yet provide signed remote provenance or replay. These require real host infrastructure and must be validated on configured devices before claiming end-to-end fleet execution.
