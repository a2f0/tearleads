import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

// Direct Playwright invocations must not reuse an artifact from an older pin.
export function assertSeedArtifactCurrent(artifactPath: string): void {
  const require = createRequire(import.meta.url);
  const digest = (file: string) =>
    createHash("sha256").update(readFileSync(file)).digest("hex");
  const provenance = JSON.parse(
    readFileSync(`${artifactPath}.provenance.json`, "utf8"),
  ) as {
    schemaVersion: number;
    seedSha256: string;
    expectationsSha256: string;
    artifactSha256: string;
  };
  if (
    provenance.schemaVersion !== 2 ||
    provenance.artifactSha256 !== digest(artifactPath) ||
    provenance.seedSha256 !==
      digest(require.resolve("@a2f0/continuity/genesis/tearleads/seed.json")) ||
    provenance.expectationsSha256 !==
      digest(
        require.resolve("@a2f0/continuity/genesis/tearleads/expectations.json"),
      )
  ) {
    throw new Error(
      "Screenshot seed is stale or modified. Run bun run screenshots:seed.",
    );
  }
}
