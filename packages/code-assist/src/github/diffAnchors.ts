import type { PullRequestFile } from "./fetchPullRequest";

/**
 * The GitHub reviews API rejects (422) inline comments on lines that are not
 * part of the diff. We parse each file's patch to learn which new-file line
 * numbers are valid anchors, then drop any model finding that misses them.
 */
export interface FileAnchors {
  readonly added: ReadonlySet<number>;
  readonly context: ReadonlySet<number>;
}

const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

export function parsePatchAnchors(patch: string): FileAnchors {
  const added = new Set<number>();
  const context = new Set<number>();
  let newLine = 0;
  let inHunk = false;

  for (const rawLine of patch.split("\n")) {
    const header = HUNK_HEADER.exec(rawLine);
    if (header) {
      const start = header[1];
      newLine = start ? Number.parseInt(start, 10) : 0;
      inHunk = true;
      continue;
    }
    if (!inHunk) {
      continue;
    }
    const marker = rawLine.charAt(0);
    if (marker === "+") {
      added.add(newLine);
      newLine += 1;
    } else if (marker === " ") {
      context.add(newLine);
      newLine += 1;
    }
    // "-" deletions, "\" no-newline markers, and the trailing empty string left
    // by splitting a patch that ends in a newline do not map to a new-file line.
  }
  return { added, context };
}

export function buildAnchorMap(
  files: readonly PullRequestFile[],
): Map<string, FileAnchors> {
  const map = new Map<string, FileAnchors>();
  for (const file of files) {
    if (file.patch) {
      map.set(file.filename, parsePatchAnchors(file.patch));
    }
  }
  return map;
}
