import { Buffer } from "node:buffer";
import type { Octokit } from "@octokit/rest";

const WINDOW_RADIUS = 20;

/**
 * Returns the lines of `path` at the given ref surrounding `line` (prefixed with
 * their line numbers) so the model can judge whether a finding still applies.
 * Returns null when the path is not a readable file.
 */
export async function fetchFileWindow(
  octokit: Octokit,
  owner: string,
  repo: string,
  path: string,
  ref: string,
  line: number | null,
): Promise<string | null> {
  const { data } = await octokit.repos.getContent({ owner, repo, path, ref });
  if (Array.isArray(data) || data.type !== "file") {
    return null;
  }
  const text = Buffer.from(data.content, "base64").toString("utf8");
  const lines = text.split("\n");
  const center = line ?? 1;
  const start = Math.max(1, center - WINDOW_RADIUS);
  const end = Math.min(lines.length, center + WINDOW_RADIUS);
  const numbered: string[] = [];
  for (let n = start; n <= end; n += 1) {
    numbered.push(`${n}\t${lines[n - 1] ?? ""}`);
  }
  return numbered.join("\n");
}
