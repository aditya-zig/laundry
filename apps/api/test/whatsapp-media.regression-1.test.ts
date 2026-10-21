import { afterEach, expect, test, vi } from "vitest";
import { createServer, type Server, type RequestListener } from "node:http";
import { once } from "node:events";
import { retrieveWhatsappMedia, sendWhatsappText } from "../../../modules/conversations/src/whatsapp";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

function credentials(base?: string) {
  vi.stubEnv("WHATSAPP_TOKEN", "synthetic-provider-token");
  vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", "synthetic-phone");
  vi.stubEnv("DEMO_MODE", "false");
  if (base) vi.stubEnv("WHATSAPP_API_BASE_URL", base);
  else vi.stubEnv("WHATSAPP_API_BASE_URL", "https://graph.facebook.com");
}

async function fixture(handler: RequestListener): Promise<{ server: Server; base: string; close: () => Promise<void> }> {
  const server = createServer(handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return { server, base, close: async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); } };
}

// Regression: handoff QA, 2026-10-21. The transport must not forward a bearer
// token to arbitrary metadata URLs or follow a redirect into another origin.
test.each([
  "https://attacker.invalid/audio",
  "https://graph.facebook.com.attacker.invalid/audio",
  "https://169.254.169.254/audio",
  "https://user:password@lookaside.fbsbx.com/audio",
  "https://lookaside.fbsbx.com:444/audio",
])("refuses an untrusted media URL before requesting it: %s", async url => {
  credentials();
  const requested: string[] = [];
  vi.stubGlobal("fetch", async (input: string) => {
    requested.push(input);
    return input.includes("/media123?")
      ? Response.json({ url, mime_type: "audio/wav", file_size: 4 })
      : new Response("RIFF", { headers: { "Content-Type": "audio/wav" } });
  });
  await expect(retrieveWhatsappMedia("media123")).rejects.toThrow(/trusted|credentials|port/i);
  expect(requested).toHaveLength(1);
});

test("a misleading localhost substring cannot enable the local media exception", async () => {
  credentials("https://localhost.attacker.invalid");
  const requested: string[] = [];
  vi.stubGlobal("fetch", async (input: string) => {
    requested.push(input);
    return input.includes("/media123?")
      ? Response.json({ url: "http://127.0.0.1/private", mime_type: "audio/wav", file_size: 4 })
      : new Response("RIFF", { headers: { "Content-Type": "audio/wav" } });
  });
  await expect(retrieveWhatsappMedia("media123")).rejects.toThrow(/trusted|loopback|base/i);
  expect(requested).toHaveLength(0);
});

test("media redirects cannot reach another local service", async () => {
  let unwantedRequests = 0;
  const target = await fixture((_req, res) => { unwantedRequests++; res.writeHead(200, { "Content-Type": "audio/wav" }); res.end("RIFF"); });
  let base = "";
  const provider = await fixture((req, res) => {
    if (req.url?.startsWith("/v26.0/")) { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ url: `${base}/redirect`, mime_type: "audio/wav", file_size: 4 })); }
    else { res.writeHead(302, { Location: `${target.base}/private` }); res.end(); }
  });
  base = provider.base;
  credentials(base);
  try {
    await expect(retrieveWhatsappMedia("media123")).rejects.toThrow();
    expect(unwantedRequests).toBe(0);
  } finally { await provider.close(); await target.close(); }
});

test.each(["graph.facebook.com", "lookaside.fbsbx.com"])("accepts bounded audio from the trusted provider host %s", async host => {
  credentials();
  vi.stubGlobal("fetch", async (input: string) => input.includes("/media123?")
    ? Response.json({ url: `https://${host}/audio`, mime_type: "audio/wav", file_size: 4 })
    : new Response("RIFF", { headers: { "Content-Type": "audio/wav" } }));
  const media = await retrieveWhatsappMedia("media123");
  expect(media.bytes.toString()).toBe("RIFF");
  expect(media.mime).toBe("audio/wav");
});

test("production cannot authorize a loopback provider override", async () => {
  credentials("http://127.0.0.1:9999");
  vi.stubEnv("NODE_ENV", "production");
  let requested = false;
  vi.stubGlobal("fetch", async () => { requested = true; return Response.json({}); });
  await expect(retrieveWhatsappMedia("media123")).rejects.toThrow(/base|trusted/i);
  expect(requested).toBe(false);
});

test("blank optional provider settings use the documented Graph defaults", async () => {
  credentials();
  vi.stubEnv("WHATSAPP_API_BASE_URL", "");
  vi.stubEnv("WHATSAPP_API_VERSION", "");
  const requested: string[] = [];
  vi.stubGlobal("fetch", async (input: string) => {
    requested.push(input);
    return input.includes("/media123?")
      ? Response.json({ url: "https://lookaside.fbsbx.com/audio", mime_type: "audio/wav", file_size: 4 })
      : new Response("RIFF", { headers: { "Content-Type": "audio/wav" } });
  });
  expect((await retrieveWhatsappMedia("media123")).bytes.toString()).toBe("RIFF");
  expect(requested[0]).toBe("https://graph.facebook.com/v26.0/media123?phone_number_id=synthetic-phone");
});

test("oversized chunked media is cancelled before the provider finishes its body", async () => {
  let base = "";
  let cancelledBeforeEnd = false;
  const provider = await fixture(async (req, res) => {
    if (req.url?.startsWith("/v26.0/")) { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ url: `${base}/audio`, mime_type: "audio/wav" })); return; }
    res.writeHead(200, { "Content-Type": "audio/wav" });
    res.on("close", () => { cancelledBeforeEnd = !res.writableEnded; });
    const chunk = Buffer.alloc(1024 * 1024);
    for (let i = 0; i < 11 && !res.destroyed; i++) {
      if (!res.write(chunk)) await new Promise<void>(resolve => {
        const drained = () => { res.off("close", closed); resolve(); };
        const closed = () => { res.off("drain", drained); resolve(); };
        res.once("drain", drained); res.once("close", closed);
      });
    }
    if (!res.destroyed) await new Promise<void>(resolve => { const timer = setTimeout(resolve, 300); res.once("close", () => { clearTimeout(timer); resolve(); }); });
    if (!res.destroyed) res.end();
  });
  base = provider.base;
  credentials(base);
  try {
    await expect(retrieveWhatsappMedia("media123")).rejects.toThrow(/10 MB/);
    // Let the real local socket report the reader cancellation to the server.
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(cancelledBeforeEnd).toBe(true);
  } finally { await provider.close(); }
});

test("media body stalls are aborted even after response headers arrive", async () => {
  let base = "";
  let responseClosed = false;
  const provider = await fixture((req, res) => {
    if (req.url?.startsWith("/v26.0/")) { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ url: `${base}/stall`, mime_type: "audio/wav" })); return; }
    res.writeHead(200, { "Content-Type": "audio/wav" });
    res.write("RIFF");
    res.once("close", () => { responseClosed = true; });
  });
  base = provider.base;
  credentials(base);
  try {
    const result = await Promise.race([
      retrieveWhatsappMedia("media123").then(() => "unexpected-success", () => "aborted"),
      new Promise<string>(resolve => { const timer = setTimeout(() => resolve("still-pending"), 21_000); timer.unref(); }),
    ]);
    expect(result).toBe("aborted");
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(responseClosed).toBe(true);
  } finally { await provider.close(); }
}, 25_000);

test("a provider acknowledgement without a message id cannot be reported sent", async () => {
  const provider = await fixture((_req, res) => { res.setHeader("Content-Type", "application/json"); res.end("{}"); });
  credentials(provider.base);
  try { await expect(sendWhatsappText("919000000001", "local fixture only")).rejects.toThrow(/message id|acknowledg/i); }
  finally { await provider.close(); }
});
