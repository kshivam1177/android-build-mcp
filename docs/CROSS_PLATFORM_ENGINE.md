# Cross-platform automation engine

The framework is moving toward one test definition and one orchestration contract, with platform-specific execution drivers.

## Current foundation

- \`src/platform/contracts.ts\`: driver, session, snapshot, semantic selector, action, wait, evidence and error contracts.
- \`src/platform/specification.ts\`: strict Zod validation for versioned \`schemaVersion: "1.0"\` test definitions.
- \`src/platform/selectors.ts\`: deterministic selector matching, ambiguity rejection, disabled-element rejection and snapshot-generation validation.
- \`src/platform/session.ts\`: session ownership, target connection reservation and reverse-order cleanup.
- \`src/platform/index.ts\`: public exports.

Runtime references are ephemeral. Persist semantic selectors in test files and resolve them against a fresh snapshot immediately before each action. An action must fail explicitly when its selector is ambiguous, missing, disabled or stale.

## Driver rollout

| Platform | Initial driver strategy | Status |
|---|---|---|
| Android | TypeScript + ADB, reusing the existing Android automation backend | Contract foundation |
| Flutter | OS accessibility/semantics first; optional Patrol bridge | Planned |
| iOS | Appium XCUITest adapter | Planned |
| Web | Agent Browser adapter | Planned |

The shared contract does not imply that every platform supports every action. Drivers must publish capabilities and reject unsupported actions with \`UNSUPPORTED_CAPABILITY\`; they must never silently no-op.

## AI execution policy

- \`disabled\`: deterministic execution only.
- \`assisted\`: default; AI may propose missing values, selector alternatives or recovery, but the orchestrator validates every proposal.
- \`discovery\`: AI may help explore and draft candidate test definitions.

Destructive operations require explicit policy approval. Never retry a non-idempotent action merely because its response was lost.

## Compatibility

The existing Android workflow and MCP tools remain in place during migration. New platform drivers are introduced behind the contract before existing Android paths are redirected.
