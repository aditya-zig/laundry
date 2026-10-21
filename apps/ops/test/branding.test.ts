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
});

describe("Laundry display branding", () => {
  it.each([undefined, "demo-operator-token"])("renders the correct operations heading for session %s", (token) => {
    vi.stubGlobal("window", { location: { hash: "#/catalog" } });
    setSession(token);
    const html = renderToStaticMarkup(createElement(App));
    expect(html).toContain("<h1>Laundry Ops</h1>");
    if (!token) expect(html).toContain("DEMO sign-in only");
  });

  it.each(["Customer", "Partner"])("uses Laundry in the %s app display name and deep-link scheme", (app) => {
    const slug = app.toLowerCase();
    const config = JSON.parse(read(`../../${slug}/app.json`));
    expect(config.expo.name).toBe(`Laundry ${app} (demo)`);
    expect(config.expo.slug).toBe(`laundry-${slug}`);
    expect(config.expo.scheme).toBe(`laundry-${slug}`);
  });

  it("uses Laundry in the operations browser title", () => {
    expect(read("../index.html")).toContain("<title>Laundry Ops (demo)</title>");
  });
});
