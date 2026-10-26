import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../src/App";
import { setSession } from "../src/api";

function read(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

afterEach(() => {
  setSession(undefined);
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Laundry display branding", () => {
  it.each([undefined, "demo-operator-token"])("renders the correct operations heading for session %s", (token) => {
    vi.stubEnv("VITE_DEMO_MODE", "true");
    vi.stubGlobal("window", { location: { hash: "#/catalog" } });
    setSession(token);
    const html = renderToStaticMarkup(createElement(App));
    expect(html).toContain("<h1>Laundry Ops</h1>");
    if (!token) expect(html).toContain("DEMO sign-in only");
  });

  it.each([
    ["customer", "Laundry Customer"],
    ["partner", "Laundry Rider"],
  ])("uses the production display name for %s without changing its deep-link scheme", (slug, displayName) => {
    const config = JSON.parse(read(`../../${slug}/app.json`));
    expect(config.expo.name).toBe(displayName);
    expect(config.expo.slug).toBe(`laundry-${slug}`);
    expect(config.expo.scheme).toBe(`laundry-${slug}`);
  });

  it("uses Laundry in the operations browser title", () => {
    expect(read("../index.html")).toContain("<title>Laundry Operations</title>");
  });
});
