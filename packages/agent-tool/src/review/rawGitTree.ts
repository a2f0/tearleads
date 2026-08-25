import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

import { MAX_BUFFER_BYTES } from "../git/prContext";
import { destinationFor, validateDestinationPaths } from "./destinationPaths";

interface TreeEntry {
  mode: string;
  objectId: string;
  relativePath: string;
}

interface TreeEntryWithContents extends TreeEntry {
  contents: Buffer;
}

function gitBuffer(rootDir: string, args: string[], input?: Buffer): Buffer {
  return execFileSync("git", args, {
    cwd: rootDir,
    env: { ...process.env, GIT_NO_REPLACE_OBJECTS: "1" },
    input,
    maxBuffer: MAX_BUFFER_BYTES,
    stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
  });
}

function decodeUtf8(value: Buffer, noun: string): string {
  const decoded = value.toString("utf8");
  if (!Buffer.from(decoded).equals(value)) {
    throw new Error(`Review snapshots require UTF-8 ${noun}.`);
  }
  return decoded;
}

function decodeGitPath(value: Buffer): string {
  const decoded = decodeUtf8(value, "Git paths");
  const segments = decoded.split("/");
  if (
    decoded.length === 0 ||
    decoded.includes("\\") ||
    path.isAbsolute(decoded) ||
    segments.some(
      (segment) => segment === "" || segment === "." || segment === "..",
    )
  ) {
    throw new Error(
      `Unsafe path in reviewed Git tree: ${JSON.stringify(decoded)}`,
    );
  }
  return decoded;
}

function decodedSymlinkTarget(entry: TreeEntry, contents: Buffer): string {
  const target = decodeUtf8(contents, "symlink targets");
  if (
    target.length === 0 ||
    target.includes("\\") ||
    path.isAbsolute(target) ||
    path.win32.isAbsolute(target) ||
    /^[A-Za-z]:/.test(target)
  ) {
    throw new Error(
      `Unsafe symlink target for ${JSON.stringify(entry.relativePath)}: ${JSON.stringify(target)}`,
    );
  }
  return target;
}

function treeDirectories(entries: TreeEntry[]): Set<string> {
  const directories = new Set<string>();
  for (const entry of entries) {
    const segments = entry.relativePath.split("/");
    for (let end = 1; end < segments.length; end += 1) {
      directories.add(segments.slice(0, end).join("/"));
    }
  }
  return directories;
}

function unsafeSymlinkTarget(entry: TreeEntry, target: string): never {
  throw new Error(
    `Unsafe symlink target for ${JSON.stringify(entry.relativePath)}: ${JSON.stringify(target)}`,
  );
}

function followTreeSegment(
  entry: TreeEntry,
  target: string,
  segment: string,
  resolvedSegments: string[],
  pendingSegments: string[],
  followedSymlinks: Set<string>,
  entriesByPath: ReadonlyMap<string, TreeEntryWithContents>,
  directories: ReadonlySet<string>,
): void {
  const candidate = [...resolvedSegments, segment].join("/");
  const candidateEntry = entriesByPath.get(candidate);
  if (candidateEntry?.mode === "120000") {
    if (followedSymlinks.has(candidate)) {
      unsafeSymlinkTarget(entry, target);
    }
    followedSymlinks.add(candidate);
    pendingSegments.unshift(
      ...decodedSymlinkTarget(candidateEntry, candidateEntry.contents).split(
        "/",
      ),
    );
    return;
  }

  resolvedSegments.push(segment);
  if (candidateEntry !== undefined) {
    if (pendingSegments.length > 0) {
      unsafeSymlinkTarget(entry, target);
    }
    return;
  }
  if (!directories.has(candidate)) {
    unsafeSymlinkTarget(entry, target);
  }
}

function checkedSymlinkTarget(
  entry: TreeEntryWithContents,
  entriesByPath: ReadonlyMap<string, TreeEntryWithContents>,
  directories: ReadonlySet<string>,
): string {
  const target = decodedSymlinkTarget(entry, entry.contents);
  const parentSegments = entry.relativePath.split("/").slice(0, -1);
  const resolvedSegments = [...parentSegments];
  const pendingSegments = target.split("/");
  const followedSymlinks = new Set<string>();

  while (pendingSegments.length > 0) {
    const segment = pendingSegments.shift();
    if (segment === undefined || segment === "" || segment === ".") {
      continue;
    }
    if (segment === "..") {
      if (resolvedSegments.length === 0) {
        unsafeSymlinkTarget(entry, target);
      }
      resolvedSegments.pop();
      continue;
    }

    followTreeSegment(
      entry,
      target,
      segment,
      resolvedSegments,
      pendingSegments,
      followedSymlinks,
      entriesByPath,
      directories,
    );
  }

  const resolvedEntry = entriesByPath.get(resolvedSegments.join("/"));
  if (resolvedEntry?.mode !== "100644" && resolvedEntry?.mode !== "100755") {
    unsafeSymlinkTarget(entry, target);
  }
  return target;
}

function readTree(rootDir: string, tree: string): TreeEntry[] {
  const output = gitBuffer(rootDir, [
    "ls-tree",
    "-r",
    "-z",
    "--full-tree",
    tree,
  ]);
  const entries: TreeEntry[] = [];
  let offset = 0;
  while (offset < output.length) {
    const end = output.indexOf(0, offset);
    if (end < 0) {
      throw new Error("Malformed NUL-delimited output from git ls-tree.");
    }
    const record = output.subarray(offset, end);
    const tab = record.indexOf(0x09);
    const metadata = record.subarray(0, tab).toString("ascii");
    const match = /^(\d{6}) blob ([0-9a-f]+)$/.exec(metadata);
    const mode = match?.[1];
    const objectId = match?.[2];
    if (tab < 0 || mode === undefined || objectId === undefined) {
      throw new Error(`Unsupported entry in reviewed Git tree: ${metadata}`);
    }
    entries.push({
      mode,
      objectId,
      relativePath: decodeGitPath(record.subarray(tab + 1)),
    });
    offset = end + 1;
  }
  return entries;
}

function readBlobs(rootDir: string, entries: TreeEntry[]): Buffer[] {
  if (entries.length === 0) {
    return [];
  }
  const input = Buffer.from(
    `${entries.map((entry) => entry.objectId).join("\n")}\n`,
  );
  const output = gitBuffer(rootDir, ["cat-file", "--batch"], input);
  let offset = 0;
  return entries.map((entry) => {
    const headerEnd = output.indexOf(0x0a, offset);
    const header = output.subarray(offset, headerEnd).toString("ascii");
    const match = /^([0-9a-f]+) blob (\d+)$/.exec(header);
    if (headerEnd < 0 || match === null || match[1] !== entry.objectId) {
      throw new Error(
        `Malformed blob response for ${entry.relativePath}: ${header}`,
      );
    }
    const size = Number(match[2]);
    const contentStart = headerEnd + 1;
    const contentEnd = contentStart + size;
    if (contentEnd >= output.length || output[contentEnd] !== 0x0a) {
      throw new Error(`Truncated blob response for ${entry.relativePath}.`);
    }
    offset = contentEnd + 1;
    return output.subarray(contentStart, contentEnd);
  });
}

function writeEntry(
  rootDir: string,
  entry: TreeEntryWithContents,
  symlinkTargets: ReadonlyMap<string, string>,
): void {
  const destination = destinationFor(rootDir, entry.relativePath);
  mkdirSync(path.dirname(destination), { recursive: true });
  if (entry.mode === "120000") {
    const target = symlinkTargets.get(entry.relativePath);
    if (target === undefined) {
      throw new Error(
        `Missing checked symlink target for ${entry.relativePath}.`,
      );
    }
    symlinkSync(target, destination);
    return;
  }
  if (entry.mode !== "100644" && entry.mode !== "100755") {
    throw new Error(
      `Unsupported mode ${entry.mode} for ${entry.relativePath}.`,
    );
  }
  writeFileSync(destination, entry.contents);
  chmodSync(destination, entry.mode === "100755" ? 0o755 : 0o644);
}

/** Materialize raw blobs from an exact Git tree without attribute conversion. */
export function materializeRawGitTree(
  sourceRoot: string,
  tree: string,
  destinationRoot: string,
): void {
  const entries = readTree(sourceRoot, tree);
  validateDestinationPaths(
    destinationRoot,
    entries.map((entry) => entry.relativePath),
  );
  const blobs = readBlobs(sourceRoot, entries);
  const entriesWithContents = entries.map((entry, index) => {
    const blob = blobs[index];
    if (blob === undefined) {
      throw new Error(`Missing blob response for ${entry.relativePath}.`);
    }
    if (
      entry.mode !== "120000" &&
      entry.mode !== "100644" &&
      entry.mode !== "100755"
    ) {
      throw new Error(
        `Unsupported mode ${entry.mode} for ${entry.relativePath}.`,
      );
    }
    return { ...entry, contents: blob };
  });
  const entriesByPath = new Map(
    entriesWithContents.map((entry) => [entry.relativePath, entry]),
  );
  const directories = treeDirectories(entriesWithContents);
  const symlinkTargets = new Map<string, string>();
  for (const entry of entriesWithContents) {
    if (entry.mode === "120000") {
      symlinkTargets.set(
        entry.relativePath,
        checkedSymlinkTarget(entry, entriesByPath, directories),
      );
    }
  }
  for (const entry of entriesWithContents) {
    writeEntry(destinationRoot, entry, symlinkTargets);
  }
}
