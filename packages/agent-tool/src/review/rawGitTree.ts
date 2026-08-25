import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

import { MAX_BUFFER_BYTES } from "../git/prContext";

interface TreeEntry {
  mode: string;
  objectId: string;
  relativePath: string;
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

function writeEntry(rootDir: string, entry: TreeEntry, contents: Buffer): void {
  const destination = path.join(rootDir, ...entry.relativePath.split("/"));
  mkdirSync(path.dirname(destination), { recursive: true });
  if (entry.mode === "120000") {
    symlinkSync(decodeUtf8(contents, "symlink targets"), destination);
    return;
  }
  if (entry.mode !== "100644" && entry.mode !== "100755") {
    throw new Error(
      `Unsupported mode ${entry.mode} for ${entry.relativePath}.`,
    );
  }
  writeFileSync(destination, contents);
  chmodSync(destination, entry.mode === "100755" ? 0o755 : 0o644);
}

/** Materialize raw blobs from an exact Git tree without attribute conversion. */
export function materializeRawGitTree(
  sourceRoot: string,
  tree: string,
  destinationRoot: string,
): void {
  const entries = readTree(sourceRoot, tree);
  const blobs = readBlobs(sourceRoot, entries);
  entries.forEach((entry, index) => {
    const blob = blobs[index];
    if (blob === undefined) {
      throw new Error(`Missing blob response for ${entry.relativePath}.`);
    }
    writeEntry(destinationRoot, entry, blob);
  });
}
