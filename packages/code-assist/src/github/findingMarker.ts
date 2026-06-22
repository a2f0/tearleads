import { createHash } from "node:crypto";

const MARKER_PATTERN = /<!-- code-assist:([0-9a-f]+) -->/g;

/**
 * A stable, line-independent id for a finding, embedded as a hidden HTML comment
 * in each posted review comment. It lets a re-review on new commits skip issues
 * already posted (lines shift across commits; the issue itself does not).
 */
export function findingMarkerId(path: string, title: string): string {
  return createHash("sha256")
    .update(`${path}::${title}`)
    .digest("hex")
    .slice(0, 12);
}

export function renderMarker(id: string): string {
  return `<!-- code-assist:${id} -->`;
}

export function extractMarkerIds(bodies: readonly string[]): Set<string> {
  const ids = new Set<string>();
  for (const body of bodies) {
    for (const match of body.matchAll(MARKER_PATTERN)) {
      const id = match[1];
      if (id !== undefined) {
        ids.add(id);
      }
    }
  }
  return ids;
}
