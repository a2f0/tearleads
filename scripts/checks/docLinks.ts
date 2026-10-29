import { existsSync, readFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { headingAnchors, markdownTargets } from "./markdownScan";

/**
 * Repository documentation link checks: every relative link and image in a
 * tracked Markdown file must reach a tracked file or directory, every fragment
 * must name a heading or explicit anchor in its target, and links to this
 * repository's `main` branch on GitHub are checked the same way offline.
 * External URLs are only collected here; `externalLinks.ts` probes them.
 */

export const repositorySlug = "a2f0/tearleads";
const repositoryUrlPattern = new RegExp(
  `^https://github\\.com/${repositorySlug}/(?:blob|tree|raw)/(?:main|HEAD)/([^?#]*)(#.*)?$`,
);

export interface DocLinkIssue {
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly target: string;
  readonly reason: string;
}

export interface ExternalLink {
  readonly file: string;
  readonly line: number;
  readonly url: string;
}

export interface DocLinkReport {
  readonly issues: DocLinkIssue[];
  readonly external: ExternalLink[];
}

export interface RepositoryFiles {
  readonly root: string;
  /** Repository-relative POSIX paths of tracked (and untracked, unignored) files. */
  readonly files: ReadonlySet<string>;
  /** Every ancestor directory of `files`, without a trailing slash. */
  readonly directories: ReadonlySet<string>;
}

export function repositoryFiles(
  root: string,
  files: readonly string[],
): RepositoryFiles {
  const directories = new Set<string>([""]);
  for (const file of files) {
    let parent = posix.dirname(file);
    while (parent !== "." && !directories.has(parent)) {
      directories.add(parent);
      parent = posix.dirname(parent);
    }
  }
  return { root, files: new Set(files), directories };
}

/** Tracked files plus untracked files that are not ignored. */
export function listRepositoryFiles(root: string): string[] {
  const result = Bun.spawnSync(
    ["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    { cwd: root, stdout: "pipe", stderr: "pipe" },
  );
  if (result.exitCode !== 0) {
    throw new Error(`git ls-files failed: ${result.stderr.toString()}`);
  }
  const listed = result.stdout.toString().split("\0").filter(Boolean);
  // A deleted but still-indexed file is listed by --cached; drop it.
  return listed.filter((file) => existsSync(join(root, file)));
}

/** Markdown documents to check: all tracked Markdown except managed skills. */
export function documentsToCheck(repo: RepositoryFiles): string[] {
  const managed = managedSkillFiles(repo.root);
  return [...repo.files]
    .filter((file) => /\.md$/i.test(file) && !managed.has(file))
    .sort();
}

// Managed skill copies are owned upstream (see AGENTS.md) and cannot be fixed
// here; `agents:check` keeps them identical to the pinned release.
function managedSkillFiles(root: string): Set<string> {
  try {
    const manifest: unknown = JSON.parse(
      readFileSync(join(root, ".agent-tool-skills.json"), "utf8"),
    );
    if (
      typeof manifest === "object" &&
      manifest !== null &&
      "files" in manifest &&
      typeof manifest.files === "object" &&
      manifest.files !== null
    ) {
      return new Set(Object.keys(manifest.files));
    }
  } catch {
    // No manifest: nothing is managed.
  }
  return new Set();
}

export function checkDocuments(
  repo: RepositoryFiles,
  documents: readonly string[],
): DocLinkReport {
  const issues: DocLinkIssue[] = [];
  const external: ExternalLink[] = [];
  const anchorCache = new Map<string, Set<string>>();
  const anchorsOf = (file: string) => {
    let anchors = anchorCache.get(file);
    if (anchors === undefined) {
      anchors = headingAnchors(readFileSync(join(repo.root, file), "utf8"));
      anchorCache.set(file, anchors);
    }
    return anchors;
  };
  for (const document of documents) {
    const source = readFileSync(join(repo.root, document), "utf8");
    for (const { line, column, target } of markdownTargets(source)) {
      const reason = checkTarget(repo, document, target, anchorsOf, (url) =>
        external.push({ file: document, line, url }),
      );
      if (reason !== null) {
        issues.push({ file: document, line, column, target, reason });
      }
    }
  }
  return { issues, external };
}

function checkTarget(
  repo: RepositoryFiles,
  document: string,
  target: string,
  anchorsOf: (file: string) => Set<string>,
  addExternal: (url: string) => void,
): string | null {
  const repositoryLink = repositoryUrlPattern.exec(target);
  if (repositoryLink !== null) {
    return checkRepositoryPath(
      repo,
      decodePath(repositoryLink[1] ?? ""),
      repositoryLink[2]?.slice(1),
      anchorsOf,
    );
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(target)) {
    if (/^https?:/i.test(target)) addExternal(target);
    return null;
  }
  if (target.startsWith("//")) return null;
  const hashIndex = target.indexOf("#");
  const pathPart = (
    hashIndex === -1 ? target : target.slice(0, hashIndex)
  ).replace(/\?.*$/, "");
  const fragment = hashIndex === -1 ? undefined : target.slice(hashIndex + 1);
  if (pathPart === "") {
    return fragment === undefined || fragment === ""
      ? null
      : checkFragment(repo, document, fragment, anchorsOf);
  }
  const decoded = decodePath(pathPart);
  const resolved = decoded.startsWith("/")
    ? posix.normalize(decoded.slice(1))
    : posix.normalize(posix.join(posix.dirname(document), decoded));
  if (resolved === ".." || resolved.startsWith("../")) {
    return "link leaves the repository";
  }
  return checkRepositoryPath(repo, resolved, fragment, anchorsOf);
}

function decodePath(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

function checkRepositoryPath(
  repo: RepositoryFiles,
  rawPath: string,
  fragment: string | undefined,
  anchorsOf: (file: string) => Set<string>,
): string | null {
  const path = rawPath.replace(/\/+$/, "").replace(/^\.$/, "");
  if (repo.directories.has(path)) {
    return fragment === undefined || fragment === ""
      ? null
      : checkDirectoryFragment(repo, path, fragment, anchorsOf);
  }
  if (!repo.files.has(path)) {
    return existsSync(join(repo.root, path))
      ? "target is ignored by Git, so it is missing from other checkouts"
      : "target does not exist";
  }
  if (fragment === undefined || fragment === "") return null;
  return checkFragment(repo, path, fragment, anchorsOf);
}

// GitHub renders a directory's README below its listing.
function checkDirectoryFragment(
  repo: RepositoryFiles,
  directory: string,
  fragment: string,
  anchorsOf: (file: string) => Set<string>,
): string | null {
  const readme = posix.join(directory, "README.md");
  return repo.files.has(readme)
    ? checkFragment(repo, readme, fragment, anchorsOf)
    : `fragment #${fragment} on a directory without a README.md`;
}

function checkFragment(
  repo: RepositoryFiles,
  file: string,
  fragment: string,
  anchorsOf: (file: string) => Set<string>,
): string | null {
  const lineRange = /^L(\d+)(?:C\d+)?(?:-L(\d+)(?:C\d+)?)?$/.exec(fragment);
  if (lineRange !== null) {
    const lineCount = readFileSync(join(repo.root, file), "utf8").split(
      "\n",
    ).length;
    const last = Number(lineRange[2] ?? lineRange[1]);
    return last <= lineCount
      ? null
      : `line ${last} is past the end of ${file} (${lineCount} lines)`;
  }
  if (!/\.md$/i.test(file)) return null;
  const anchor = decodePath(fragment).toLowerCase();
  const anchors = anchorsOf(file);
  return anchors.has(anchor) || anchors.has(decodePath(fragment))
    ? null
    : `no heading or anchor #${fragment} in ${file}`;
}

export function repositoryRoot(): string {
  return dirname(dirname(import.meta.dir));
}
