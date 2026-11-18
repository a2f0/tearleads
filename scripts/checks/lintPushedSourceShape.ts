/**
 * The push gate's source-shape step: checks exactly the commits a push adds.
 * agent-tool's push gate writes what is being pushed to the JSON file named by
 * AGENT_TOOL_PUSH_GATE while its declared steps run; each pushed ref carries
 * the remote's old tip (or the newest commit the remote already has) as
 * `base`. CI's `check:fast` scans the whole tree and is the authority.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

interface PushedRef {
  readonly remoteRef: string;
  readonly localOid: string;
  readonly deleted: boolean;
  readonly commits: readonly string[];
  readonly base: string | null;
}

interface PushData {
  readonly schemaVersion: number;
  readonly refs: readonly PushedRef[];
}

/** A range for each pushed ref that adds commits; null when nothing anchors it. */
export function pushedRanges(
  push: PushData,
  mergeBase: (tip: string) => string | null,
): { readonly ref: string; readonly range: string | null }[] {
  if (push.schemaVersion !== 1) {
    throw new Error(`Unsupported push data schema ${push.schemaVersion}`);
  }
  return push.refs
    .filter((ref) => !ref.deleted && ref.commits.length > 0)
    .map((ref) => {
      // The remote advertised no single commit below this branch, as when it
      // is new to an empty remote; fall back to where it left main.
      const base = ref.base ?? mergeBase(ref.localOid);
      return {
        ref: ref.remoteRef,
        range: base ? `${base}..${ref.localOid}` : null,
      };
    });
}

function mainMergeBase(tip: string): string | null {
  const result = spawnSync("git", ["merge-base", "main", tip], {
    encoding: "utf8",
  });
  return result.status === 0 ? result.stdout.trim() : null;
}

function main(): number {
  const { AGENT_TOOL_PUSH_GATE: file } = process.env;
  if (!file) {
    console.error(
      "AGENT_TOOL_PUSH_GATE is unset; this step runs inside agent-tool's push gate.",
    );
    return 1;
  }
  const push = JSON.parse(readFileSync(file, "utf8")) as PushData;
  const lint = fileURLToPath(new URL("lintSourceShape.ts", import.meta.url));
  for (const { ref, range } of pushedRanges(push, mainMergeBase)) {
    if (!range) {
      console.log(
        `${ref}: no base to compare against; CI checks its source shape.`,
      );
      continue;
    }
    console.log(`${ref}: checking source shape for ${range}`);
    const result = spawnSync(
      process.execPath,
      [lint, "--check-root", process.cwd(), "--range", range],
      {
        stdio: "inherit",
      },
    );
    if (result.status !== 0) return result.status ?? 1;
  }
  return 0;
}

if (import.meta.main) process.exitCode = main();
