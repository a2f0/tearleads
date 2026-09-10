import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const baselinePath = "scripts/sourceShapeBaseline.json";

function git(args: readonly string[], input?: string): Buffer {
  return execFileSync("git", args, { input, maxBuffer: 128 * 1024 * 1024 });
}

function paths(output: Buffer): string[] {
  return output.toString("utf8").split("\0").filter(Boolean).sort();
}

function commit(ref: string): string {
  return git(["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`])
    .toString()
    .trim();
}

function snapshotRange(args: readonly string[]): {
  base: string;
  head: string;
} {
  if (args.length === 1 && args[0] === "--staged") {
    // write-tree rejects an unmerged index and pins its content for this scan.
    const head = git(["write-tree"]).toString().trim();
    const previous = spawnSync(
      "git",
      ["rev-parse", "--verify", "--quiet", "HEAD"],
      { encoding: "utf8" },
    );
    if (previous.status !== 0 && previous.status !== 1) {
      throw new Error(`Could not resolve HEAD: ${previous.stderr}`, {
        cause: previous.error,
      });
    }
    const base =
      previous.status === 0
        ? previous.stdout.trim()
        : git(["mktree"], "").toString().trim();
    return { base, head };
  }
  const range =
    args.length === 2 && args[0] === "--range"
      ? args[1]
      : args.length === 1 && args[0]?.startsWith("--range=")
        ? args[0].slice(8)
        : undefined;
  const match = range?.match(/^(.+?)(\.{2,3})([^.].*)$/);
  if (!match?.[1] || !match[2] || !match[3]) {
    throw new Error(
      "Usage: lintSourceShape.ts [--staged | --range <base>..<head>]",
    );
  }
  const left = commit(match[1]);
  const head = commit(match[3]);
  const base =
    match[2] === "..."
      ? git(["merge-base", left, head]).toString().trim()
      : left;
  return { base, head };
}

function treeBlobs(tree: string): Map<string, string> {
  const blobs = new Map<string, string>();
  for (const entry of paths(git(["ls-tree", "-rz", "--full-tree", tree]))) {
    const tab = entry.indexOf("\t");
    const [, kind, oid] = entry.slice(0, tab).split(" ");
    if (kind === "blob" && oid) blobs.set(entry.slice(tab + 1), oid);
  }
  return blobs;
}

function readBlobs(oids: readonly string[]): Map<string, Buffer> {
  const contents = new Map<string, Buffer>();
  if (oids.length === 0) return contents;
  const output = git(["cat-file", "--batch"], `${oids.join("\n")}\n`);
  let offset = 0;
  for (const oid of oids) {
    const end = output.indexOf(10, offset);
    const header = output.toString("utf8", offset, end).split(" ");
    const size = Number(header[2]);
    if (
      end < 0 ||
      header[0] !== oid ||
      header[1] !== "blob" ||
      !Number.isSafeInteger(size) ||
      size < 0 ||
      end + size + 1 >= output.length
    ) {
      throw new Error(`Could not read Git blob ${oid}`);
    }
    contents.set(oid, output.subarray(end + 1, end + 1 + size));
    offset = end + size + 2;
  }
  return contents;
}

export function sourceShapeSnapshot(args: readonly string[]) {
  if (args.length === 0) {
    return {
      files: paths(git(["ls-files", "-z"])),
      full: true,
      read: (path: string) =>
        existsSync(path) ? readFileSync(path) : undefined,
    };
  }
  const { base, head } = snapshotRange(args);
  // Disable rename detection so an old allowance is checked on deletion too.
  const changed = paths(
    git(["diff", "--name-only", "--no-renames", "-z", base, head, "--"]),
  );
  const blobs = treeBlobs(head);
  const full = changed.includes(baselinePath);
  const files = full
    ? [...new Set([...blobs.keys(), ...changed])].sort()
    : changed;
  const oids = [
    ...new Set(
      [...files, baselinePath].flatMap((path) => {
        const oid = blobs.get(path);
        return oid ? [oid] : [];
      }),
    ),
  ];
  const contents = readBlobs(oids);
  return {
    files,
    full,
    read: (path: string) => contents.get(blobs.get(path) ?? ""),
  };
}
