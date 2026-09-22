import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Skill document roots. Invoking a skill with arguments makes Claude Code
 * substitute them into `$0`-`$9` and `$ARGUMENTS` in the text the agent reads,
 * while the file on disk keeps the original. A shell or awk snippet using one
 * of those tokens therefore reaches the agent corrupted: in #2345 every such
 * token sat in a merge-safety lookup, and two of them arrived rewritten.
 * These skills take their arguments from the appended argument block instead,
 * so the tokens have no legitimate use here.
 */
export const skillRoots = [".claude/skills", ".codex/skills"] as const;

export interface SkillPlaceholderViolation {
  readonly column: number;
  readonly filePath: string;
  readonly line: number;
  readonly text: string;
}

/** `${1}` and `${ARGUMENTS}` are matched too: the braces are not what differs. */
const placeholderPattern = /\$\{?(?:[0-9]|ARGUMENTS)\}?/g;

// A root a checkout does not have (a fixture, a trimmed clone) is not a
// violation; a repository test asserts both roots are populated.
function readEntries(root: string) {
  try {
    return readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
}

export function listSkillDocuments(root: string): string[] {
  const files: string[] = [];
  for (const entry of readEntries(root).sort((left, right) =>
    left.name < right.name ? -1 : 1,
  )) {
    const entryPath = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...listSkillDocuments(entryPath));
    } else if (entry.name.endsWith(".md")) {
      files.push(entryPath);
    }
  }
  return files;
}

export function collectSkillPlaceholderViolations(
  filePath: string,
  sourceText: string,
): SkillPlaceholderViolation[] {
  const violations: SkillPlaceholderViolation[] = [];
  const lines = sourceText.split("\n");
  for (const [index, line] of lines.entries()) {
    for (const match of line.matchAll(placeholderPattern)) {
      violations.push({
        column: (match.index ?? 0) + 1,
        filePath,
        line: index + 1,
        text: match[0],
      });
    }
  }
  return violations;
}

export function scanSkillPlaceholders(
  cwd: string,
  roots: readonly string[] = skillRoots,
): SkillPlaceholderViolation[] {
  return roots.flatMap((root) =>
    listSkillDocuments(join(cwd, root)).flatMap((filePath) =>
      collectSkillPlaceholderViolations(
        relative(cwd, filePath).replace(/\\/g, "/"),
        readFileSync(filePath, "utf8"),
      ),
    ),
  );
}
