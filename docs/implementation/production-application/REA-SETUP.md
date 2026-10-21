# REA setup receipt

Verified 21 October 2026 on the current development machine. This is not the cloud environment's installation receipt.

The approved setup was applied using `npx --yes rea-agents@latest setup --client codex --yes --json`. The resolved installed release is **6.7.0**. Codex registration is pinned to `npx -y rea-agents@6.7.0 mcp`; the previous configuration was backed up. The REA skill was installed for the agent with skill identity 42 and a catalog of 207 tools.

Verification:

- The client-scoped doctor reports `healthy: true`; Node 24.20.0, Codex registration and installed skill identity align.
- A separate direct MCP stdio connection successfully initialized the server, listed **207 tools** and called `binary_session` without an error. Server identity was `rea` version `6.7.0`.
- The currently running coding-agent tool catalog has not reloaded this new registration. Reconnect/restart the coding-agent session, discover REA tools and call `binary_session` there before claiming the agent's live connection is ready.
- The broader environment doctor is not fully healthy: optional native analysis engines, including JADX, Ghidra, Hopper, IDA and Kuna, are not configured. No attached Android device or supplied APK was available. These are explicit native-analysis prerequisites, not proof that static website research cannot proceed.

Raw local setup/doctor/MCP output remains outside git under `.verification/`. No private config or credentials are published in this receipt. R01 must repeat the pinned installation, doctor and direct MCP check inside its isolated cloud job; this machine's global MCP registration does not transfer to a cloud worker. Consult the installed `reverse-engineer-anything` skill and its connection guide before tool selection.

REA installation and transport verification do not establish that LaundryMate has been completely analyzed. The first research deliverable is tracked separately as R01.
