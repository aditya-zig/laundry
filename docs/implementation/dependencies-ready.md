Initial pnpm install completed for foundation + customer + api + worker manifests. Coordinator owns lockfile. Partner/ops manifests may require another install later. Shared verifier owns packages and root tsconfig. API client additions will be backward compatible. No pnpm install by workers. Backend: Antigravity voice tool lives tools/voice-transcriber; integration interface follow docs/implementation/local-speech.md once available.

Coordinator added root pg/@types/pg for shared domain source resolution and React type declarations. Installing now.
