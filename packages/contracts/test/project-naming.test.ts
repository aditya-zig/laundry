import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const files = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" })
  .split("\0")
  .filter(Boolean);
const currentRunbooks = new Set([
  "docs/implementation/branding-correction.md",
  "docs/implementation/cloud-deployment.md",
  "docs/implementation/vercel-deploy.md",
  "docs/implementation/local-speech.md",
  "docs/implementation/service-assets.md",
]);
// Founder source material and the pre-rename planning record are historical
// documents. They are never rewritten, because changing them would falsify
// what was asked and what was decided. P00 protects docs/discovery byte for
// byte and keeps docs/plans/laundry-app as the pre-rename record.
const historicalPaths = ["docs/discovery/", "docs/plans/laundry-app/"];

function read(path: string): string {
  return readFileSync(new URL(path, `file://${root}`), "utf8");
}

describe("Laundry project naming", () => {
  it("uses only the current name in source, configuration and current documentation", () => {
    // Historical release reports and raw evidence retain original labels.
    const active = files.filter((path) =>
      !path.startsWith("docs/implementation/") || currentRunbooks.has(path),
    ).filter((path) => !historicalPaths.some((prefix) => path.startsWith(prefix)));
    const obsolete = /wan[d]ary/i;
    const textExtensions = /\.(?:[cm]?jsx?|tsx?|json|ya?ml|md|mdc|html|svg|py|sh|sql|toml|txt)$/;
    const rootConfigs = new Set([".env.example", ".vercelignore", "apps/api/Dockerfile"]);
    const violations = active.flatMap((path) => {
      const matches = obsolete.test(path) ||
        ((textExtensions.test(path) || rootConfigs.has(path)) && obsolete.test(read(path)));
      return matches ? [path] : [];
    });
    expect(violations).toEqual([]);
  });

  it("names every workspace package in the Laundry namespace", () => {
    for (const path of files.filter((path) => /^(apps|packages)\/[^/]+\/package\.json$/.test(path))) {
      expect(JSON.parse(read(path)).name).toMatch(/^@laundry\//);
    }
    const project = JSON.parse(read("package.json"));
    expect(project.name).toBe("laundry");
    expect(project.laundry.pinnedVersions).toBeDefined();
  });

  it("builds and deploys the renamed production branch and packages", () => {
    expect(read(".github/workflows/ci.yml")).toContain("refs/heads/build/laundry");
    expect(read("tools/build-web.mjs")).toContain("@laundry/${app}");
  });
});
