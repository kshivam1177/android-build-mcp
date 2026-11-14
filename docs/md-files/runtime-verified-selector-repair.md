# Runtime-verified selector repair

Selector repair is a controlled maintenance operation, not an automatic retry. The framework can propose alternatives from a fresh Android accessibility hierarchy, but changing a saved test definition requires explicit approval.

## Workflow

1. Capture the current UI hierarchy with the framework's UI snapshot/hierarchy workflow. Pass the node labels, content descriptions, resource IDs, clickability and enabled state to `approve_selector_repair`.
2. Supply the saved test case ID, 1-based step number, exact current `originalTarget`, proposed target, and hierarchy capture timestamp.
3. Call without `approve=true` first. The tool checks that the evidence timestamp is valid and at most five minutes old, that the proposed target resolves uniquely, that the node is explicitly enabled, and—when the action is `tap`—that the node is clickable.
4. Review the result and selector in the context of the app's expected behavior. Only then call with `approve=true`.
5. The tool re-reads the test case and refuses a stale proposal if the saved target no longer equals `originalTarget`. It backs up the full case, changes only the selected step's `target`, and appends an audit record under `.testorbit/selector-repairs/audit.jsonl`.
6. Rerun the test and inspect its report. A repair is not a test pass and does not count as coverage until the updated case has actually executed with valid evidence.

## Safety boundaries

- No UI actions are executed by this tool.
- The hierarchy is supplied by the caller; the tool does not itself capture a device hierarchy. Its timestamp and content must correspond to the same fresh capture.
- No change is written unless the selector validates and `approve=true` is supplied.
- Ambiguous targets, stale evidence, future timestamps, missing enabled state, and non-clickable tap targets fail closed.
- The saved test target must still match the original target, preventing a stale proposal from silently overwriting a concurrent edit.
- A pre-change backup is created before updating the case; the audit record contains the hierarchy SHA-256 digest, original/proposed targets, timestamp and backup path.
- The tool does not automatically retry failed actions, invent selectors, or declare runtime correctness. Always rerun the test and review resulting evidence.
