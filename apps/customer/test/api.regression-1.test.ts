import { afterEach, expect, it, vi } from "vitest";
import { ensureDemoSession, getToken, setSession } from "../src/api";

afterEach(() => { setSession(undefined); vi.unstubAllGlobals(); });

// Regression: QA-003 — stored demo tokens can outlive the local database session.
// Found by /qa on 2026-10-21. Report: docs/implementation/ui-handoff-2026-10-21.md
it("replaces a rejected stored demo session before checkout uses it", async () => {
  setSession("expired-demo-fixture");
  const requests: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => {
    requests.push(String(url));
    if (String(url).endsWith("/me")) return new Response(JSON.stringify({ code: "UNAUTHENTICATED", message: "Invalid session", retryable: false, traceId: "fixture" }), { status: 401 });
    return new Response(JSON.stringify({ token: "fresh-demo-fixture", user: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", role: "customer", name: "Demo fixture", phone: "+910000000000" } }), { status: 201 });
  });
  await ensureDemoSession();
  expect(requests.map(url => new URL(url).pathname)).toEqual(["/v1/me", "/v1/auth/demo"]);
  expect(getToken()).toBe("fresh-demo-fixture");
});
