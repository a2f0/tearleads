import { readFileSync } from "node:fs";
import { basename } from "node:path";

// sentry-cli 3.7.0 rewrites maps by default: for each source without embedded
// content it opens the source as a file, whether absolute, a file: URL, below
// the sourceRoot, relative to its own working directory, or in an indexed map's
// sections, and uploads what it reads. The upload passes --no-rewrite, so it
// sends only the staged files' own bytes. These checks also refuse, before any
// upload, a staged pair that would need any other file: its map must be a plain
// version 3 map whose every source is a repository-relative path with embedded
// content, and its script may name no source map but its own.

const urlScheme = /^[A-Za-z][A-Za-z0-9+.-]*:/u;
const mapReference = /^\s*(?:\/\/|\/\*)\s*[#@]\s*sourceMappingURL\s*=(.*)$/u;

function isRepositoryRelative(source: unknown): boolean {
  return (
    typeof source === "string" &&
    !urlScheme.test(source) &&
    !source.includes("\\") &&
    !source.includes("\0") &&
    source
      .split("/")
      .every((part) => part !== "" && part !== "." && part !== "..")
  );
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}

function assertEmbeddedSources(mapPath: string): void {
  const name = basename(mapPath);
  const map = readJson(mapPath);
  if (
    typeof map !== "object" ||
    map === null ||
    !("version" in map) ||
    map.version !== 3 ||
    "sections" in map ||
    "sourceRoot" in map ||
    !("sources" in map) ||
    !("sourcesContent" in map)
  )
    throw new Error(
      `Staged source map ${name} must be a version 3 map with embedded sources and no sections or sourceRoot; release must not be published`,
    );
  const { sources, sourcesContent } = map;
  if (
    !Array.isArray(sources) ||
    !Array.isArray(sourcesContent) ||
    sourcesContent.length !== sources.length ||
    !sources.every(
      (source, index) =>
        isRepositoryRelative(source) &&
        typeof sourcesContent[index] === "string",
    )
  )
    throw new Error(
      `Staged source map ${name} has a source that is not a repository-relative path with embedded content; release must not be published`,
    );
}

// sentry-cli follows the last line starting with a sourceMappingURL comment;
// any line that could be read as one must name the script's own staged map.
function assertOwnMapReference(scriptPath: string): void {
  const own = `${basename(scriptPath)}.map`;
  for (const line of readFileSync(scriptPath, "utf8").split(/[\n\r]/u)) {
    const reference = mapReference
      .exec(line)?.[1]
      ?.replace(/\*\/\s*$/u, "")
      .trim();
    if (reference !== undefined && reference !== own)
      throw new Error(
        `Staged script ${basename(scriptPath)} names a source map other than ${own}; release must not be published`,
      );
  }
}

// Checks one staged script and its sibling map, both already known to be
// regular, unlinked files.
export function assertSelfContainedPair(scriptPath: string): void {
  assertOwnMapReference(scriptPath);
  assertEmbeddedSources(`${scriptPath}.map`);
}
