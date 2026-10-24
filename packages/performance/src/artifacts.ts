import { execFileSync } from "node:child_process";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { openCloudflareTail } from "./cloudflare";
import { type Options, targets } from "./options";
import type { Sample } from "./provision";
import { summarize } from "./report";

export async function createReportWriter(
  options: Options,
  runId: string,
  samples: Sample[],
) {
  const root = resolve(import.meta.dir, "../../..");
  const directory = resolve(root, ".test_files/performance");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = resolve(directory, `${options.environment}-${runId}.json`);
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  const metadata = {
    schemaVersion: 1,
    scenario: "account-provisioning",
    runId,
    startedAt: new Date().toISOString(),
    environment: options.environment,
    requestedSamples: options.samples,
    captureCloudflare: options.cloudflare,
    ...targets[options.environment],
    revision: git("rev-parse", "HEAD"),
    dirty: git("status", "--porcelain").length > 0,
    runtime: {
      bun: Bun.version,
      platform: process.platform,
      arch: process.arch,
    },
    storage:
      "SQLite Multiple Ciphers WASM in memory; no OPFS or worker message queue",
    includes:
      "Trash provisioned atomically; login; session revocation outside provisioning timing",
    excludes:
      "browser boot, rendering, Contacts/self-contact bootstrap, background sync",
  };
  async function save(
    status: "running" | "complete" | "failed",
    tail?: Awaited<ReturnType<typeof openCloudflareTail>>,
  ) {
    const report = {
      ...metadata,
      updatedAt: new Date().toISOString(),
      status,
      summary: summarize(samples),
      samples,
      cloudflare: tail
        ? {
            events: tail.events,
            warnings: tail.warnings,
            unmatchedRequestIds: samples
              .flatMap((sample) => sample.requests)
              .filter(
                (request) =>
                  !tail.events.some((event) => event.requestId === request.id),
              )
              .map((request) => request.id),
          }
        : null,
    };
    await writeFile(`${path}.tmp`, `${JSON.stringify(report, null, 2)}\n`, {
      mode: 0o600,
    });
    await rename(`${path}.tmp`, path);
  }
  return { path, save };
}
