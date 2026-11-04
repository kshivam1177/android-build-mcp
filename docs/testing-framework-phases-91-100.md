# Remote Worker Infrastructure — Phases 91–100

## Implemented

- Versioned registration protocol for Android, Flutter, iOS and Web workers.
- Capability/label inventory and bounded per-worker capacity.
- One-time cryptographically random credentials; only SHA-256 token digests are stored and credential comparisons are constant-time.
- Heartbeat expiry; stale workers cannot claim jobs.
- Capability-aware pull scheduling and explicit queued → assigned → running → terminal transitions.
- Cancellation requests are delivered to running workers on their next heartbeat.
- Evidence completion metadata includes a SHA-256 manifest digest, artifact count and total bytes.
- An injectable store interface and serialized in-process coordinator mutations.

## Deployment boundary

The included `InMemoryRemoteWorkerStore` is a reference/test adapter for **one coordinator process**. It is not a durable queue, distributed lock, or multi-replica backend. A production deployment needs a transactional shared `RemoteWorkerStore` implementation and an authenticated TLS control plane. Worker credentials must be delivered out-of-band and rotated/revoked by the deployment.

This phase implements and tests the protocol/state-machine core. It does **not** claim that a remote worker daemon, HTTP control plane, device provisioning, remote artifact byte transfer, or physical-device E2E is shipped. Those require a transport service and platform hosts, and remain follow-on work.
