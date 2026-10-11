# Toolchain and shared boundary

The workspace pins its dependency versions for reproducible local development. These pins are compatibility choices; they are not a claim that every dependency is the latest release.

Node: 24. Package manager: pnpm 10.33.2. Database: PostgreSQL 17 (Docker, local host port 5448).

| Component | Version |
|---|---|
| node | 24 |
| expo | 52.0.0 |
| expo-router | 4.0.0 |
| react | 18.3.1 |
| react-native | 0.76.5 |
| react-native-web | 0.19.13 |
| vite | 6.0.0 |
| @nestjs/common | 11.0.0 |
| pg | 8.13.0 |
| vitest | 3.2.4 |
| zod | 3.23.8 |

Shared runtime exports are packages/contracts/src/index.ts, packages/api-client/src/index.ts and packages/design-tokens/src/index.ts. Generated output belongs in each package dist directory, never alongside src.

API paths are relative to /v1. The typed SDK parses server responses and exposes explicit idempotency-key overrides. Use the same key for a retry of the same mutation; use a new key for a new operation. Client API additions preserve existing argument shapes.

Service artwork is locally authored SVG under assets/services. It is demonstration artwork rather than commercial facility photography. The backend owns serving these assets and mapping them into service resources.

Independent verification and known boundaries are tracked in docs/implementation. README is the final runbook once integration is complete.
