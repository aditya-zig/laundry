// Thin API wiring over @laundry/api-client. Screens import this, never fetch.
import { createClient, type LaundryClient } from "@laundry/api-client";

function envBaseUrl(): string | undefined {
  // Static access so Metro inlines EXPO_PUBLIC_API_URL at build time.
  return process.env.EXPO_PUBLIC_API_URL;
}

export function getApiBaseUrl(): string {
  return (envBaseUrl() ?? "http://localhost:4100/v1").replace(/\/$/, "");
}

// DEMO-only token persistence: keeps the demo session across web refreshes.
// Production must use secure platform storage and never persist real credentials here.
const TOKEN_KEY = "laundry.demo.customer.token";

function readStoredToken(): string | undefined {
  try {
    if (typeof localStorage === "undefined") return undefined;
    return localStorage.getItem(TOKEN_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

let token: string | undefined = readStoredToken();
let client: LaundryClient | undefined;

export function getClient(): LaundryClient {
  if (!client) {
    client = createClient({ baseUrl: getApiBaseUrl(), getToken: () => token });
  }
  return client;
}

export function setSession(next: string | undefined): void {
  token = next;
  client = undefined;
  try {
    if (typeof localStorage !== "undefined") {
      if (next) localStorage.setItem(TOKEN_KEY, next);
      else localStorage.removeItem(TOKEN_KEY);
    }
  } catch {
    // Storage unavailable (private mode, native without web storage):
    // session stays in memory for this launch.
  }
}

export function getToken(): string | undefined {
  return token;
}

/** Demo sign-in used until production OTP/phone verification is approved. */
export async function demoSignIn(role: "customer" = "customer"): Promise<void> {
  const session = await getClient().demoAuth(role);
  setSession(session.token);
}
