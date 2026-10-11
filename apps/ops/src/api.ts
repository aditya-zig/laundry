// Ops API wiring over @wandary/api-client. Pages import this, never fetch.
import { createClient, type WandaryClient } from "@wandary/api-client";

function resolveBaseUrl(): string {
  const fromEnv = import.meta.env?.VITE_API_URL as string | undefined;
  return (fromEnv ?? "http://localhost:4100/v1").replace(/\/$/, "");
}

export function getApiBaseUrl(): string {
  return resolveBaseUrl();
}

// DEMO-only token persistence: keeps the demo operator session across refreshes.
// Production staff access needs SSO/MFA and must never persist tokens here.
const TOKEN_KEY = "wandary.demo.ops.token";

function readStoredToken(): string | undefined {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

let token: string | undefined = readStoredToken();
let client: WandaryClient | undefined;

export function getClient(): WandaryClient {
  if (!client) {
    client = createClient({ baseUrl: resolveBaseUrl(), getToken: () => token });
  }
  return client;
}

export function setSession(next: string | undefined): void {
  token = next;
  client = undefined;
  try {
    if (next) localStorage.setItem(TOKEN_KEY, next);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Storage unavailable: session stays in memory for this tab.
  }
}

export function getToken(): string | undefined {
  return token;
}

/** Demo operator sign-in until production staff SSO/MFA is approved. */
export async function demoSignIn(): Promise<void> {
  const session = await getClient().demoAuth("operator");
  setSession(session.token);
}
