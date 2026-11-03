# Phases 81–90 — Evidence integrity and CI handoff

## Goal

Make cross-platform test output independently verifiable after a run. A report should not be trusted merely because it exists: its artifact inventory, byte sizes and SHA-256 hashes must be checked before CI, release automation or a reviewer consumes it.

## Delivered

- Every saved cross-platform suite run now emits `evidence-manifest.json`.
- The manifest records the run ID, source revision, selected-definition manifest digest, relative artifact paths, byte sizes and SHA-256 digests.
- It inventories JSON, Markdown, JUnit, screenshot and UI snapshot files produced in the run directory.
- The manifest itself is not recursively hashed.
- New MCP tool: `validate_cross_platform_evidence`.
- Validation detects missing, modified and unexpected files, duplicate paths, traversal attempts and symlinks.
- Report-directory validation is restricted to real directories beneath `.androidmcp-framework/test-reports/`; internal checkpoint state under `.runs` is excluded.
- Unit tests cover valid manifests, tampering, missing and unexpected files, traversal and symlink rejection.

## Validate a report

After `run_cross_platform_suite(execute=true)` returns its report directory, call:

    validate_cross_platform_evidence(
      reportDirectory=".androidmcp-framework/test-reports/2026-11-03/12-30-00-cross-platform-suite-..."
    )

The result includes:

- `valid`: true only when every listed file matches and no unexpected file exists.
- `checked`: number of manifest entries examined.
- `missing`: expected files that no longer exist.
- `modified`: changed files and unexpected additions.
- `unsafe`: malformed paths, duplicates or unsafe filesystem entries.

CI/release systems should require both the suite's execution gate and this integrity validation to pass. A valid manifest proves artifact integrity relative to the manifest; it does not prove that the tests themselves were correct or that the manifest was signed by a trusted remote authority.

## Security boundaries

- All manifest paths are relative to the report directory; absolute paths, traversal, symlinks and non-file entries are rejected.
- The validator only reads report artifacts and never executes content.
- Reports may include screenshots or UI snapshots containing customer data. Apply project-specific retention and access controls before uploading them to shared CI artifacts.
- SHA-256 provides tamper detection only when the manifest itself is protected. For supply-chain attestation, sign the manifest or bind it to a trusted CI provenance service in a later milestone.

## Remaining work

This phase creates a verifiable artifact contract, not a hosted CI device farm. Follow-on work should add configurable retention/pruning, signed attestations, remote worker agents, cross-host lease coordination, platform-specific CI runner provisioning, artifact upload/download adapters, failure replay and coverage analytics. Physical Android, macOS/iOS and browser workers remain necessary for genuine platform E2E.
