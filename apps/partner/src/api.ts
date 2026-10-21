// Partner API wiring over @laundry/api-client.
// Screens import this thin layer; never fetch directly.

import { createClient, type LaundryClient } from "@laundry/api-client";
import type { DeliveryJob, Session } from "@laundry/contracts";

function envBaseUrl(): string | undefined {
  // Static access so Metro inlines EXPO_PUBLIC_API_URL at build time.
  return process.env.EXPO_PUBLIC_API_URL;
}

export function getApiBaseUrl(): string {
  return (envBaseUrl() ?? "http://localhost:4100/v1").replace(/\/$/, "");
}

export const API_BASE = getApiBaseUrl();

// DEMO-only token persistence: keeps the demo rider session across web refreshes.
// Production must use secure platform storage and never persist real credentials here.
const TOKEN_KEY = "laundry.demo.partner.token";

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
let currentUser: Session["user"] | undefined;
let cachedJobs: DeliveryJob[] = [];

export function getClient(): LaundryClient {
  if (!client) {
    client = createClient({
      baseUrl: getApiBaseUrl(),
      getToken: () => token,
    });
  }
  return client;
}

export function setSession(sessionToken: string | undefined, user?: Session["user"]): void {
  token = sessionToken;
  currentUser = user;
  client = undefined;
  try {
    if (typeof localStorage !== "undefined") {
      if (sessionToken) localStorage.setItem(TOKEN_KEY, sessionToken);
      else localStorage.removeItem(TOKEN_KEY);
    }
  } catch {
    // Storage unavailable: session stays in memory for this launch.
  }
  if (!sessionToken) {
    clearCachedJobs();
  }
}

export function getToken(): string | undefined {
  return token;
}

export function getCurrentUser(): Session["user"] | undefined {
  return currentUser;
}

/** Demo rider sign-in via client.demoAuth('rider') */
export async function demoSignIn(role: "rider" = "rider"): Promise<Session> {
  const session = await getClient().demoAuth(role);
  setSession(session.token, session.user);
  return session;
}

/** Sign-out purges cached jobs and clears session token */
export function signOut(): void {
  setSession(undefined, undefined);
  clearCachedJobs();
}

/** Protected local job cache */
export function getCachedJobs(): DeliveryJob[] {
  return [...cachedJobs];
}

export function setCachedJobs(jobs: DeliveryJob[]): void {
  cachedJobs = [...jobs];
}

export function getCachedJob(id: string): DeliveryJob | undefined {
  return cachedJobs.find((j) => j.id === id);
}

export function updateCachedJob(job: DeliveryJob): void {
  const idx = cachedJobs.findIndex((j) => j.id === job.id);
  if (idx >= 0) {
    cachedJobs[idx] = job;
  } else {
    cachedJobs.push(job);
  }
}

export function clearCachedJobs(): void {
  cachedJobs = [];
}
