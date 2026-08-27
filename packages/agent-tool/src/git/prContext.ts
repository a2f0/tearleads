import { execFileSync, spawnSync } from "node:child_process";

export interface PrIdentity {
  readonly branch: string;
  readonly repo: string;
  readonly prNumber: string;
  readonly title: string;
}

export interface PrContext extends PrIdentity {
  readonly baseRef: string;
}

export interface PrView extends PrIdentity {
  readonly baseRefName: string;
  readonly baseRefOid: string;
}

interface SpawnResult {
  readonly status: number | null;
  readonly signal: string | null;
  readonly error?: Error;
}

// Large diffs blow past execFileSync's default 1 MiB maxBuffer and throw
// ENOBUFS before we can hand the diff to a reviewer, so capture generously.
export const MAX_BUFFER_BYTES = 512 * 1024 * 1024;

export function run(command: string, args: string[]): string {
  return execFileSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: MAX_BUFFER_BYTES,
  }).trim();
}

function tryRun(command: string, args: string[]): string | null {
  try {
    return run(command, args);
  } catch {
    return null;
  }
}

function safeParse(source: string): unknown {
  try {
    return JSON.parse(source);
  } catch {
    return undefined;
  }
}

function fieldOf(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null
    ? Reflect.get(value, key)
    : undefined;
}

function stringField(source: string, key: string): string {
  const value = fieldOf(safeParse(source), key);
  return typeof value === "string" ? value : "";
}

function firstPrNumber(source: string | null): string {
  if (source === null) {
    return "";
  }
  const parsed = safeParse(source);
  if (!Array.isArray(parsed) || parsed.length === 0) {
    return "";
  }
  const numberField = fieldOf(parsed[0], "number");
  return typeof numberField === "number" ? String(numberField) : "";
}

function numberFieldString(source: string, key: string): string {
  const value = fieldOf(safeParse(source), key);
  return typeof value === "number" ? String(value) : "";
}

function gitRefExists(ref: string): boolean {
  if (ref.length === 0) {
    return false;
  }
  const result = spawnSync(
    "git",
    ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`],
    { stdio: "ignore" },
  );
  return result.status === 0;
}

type RefExists = (ref: string) => boolean;

interface FreshBaseRefDependencies {
  readonly fetch: (repositoryUrl: string, target: string) => string;
  readonly refExists: RefExists;
  readonly repositoryGitUrl: (repo: string) => string;
}

/** Resolve an optional exact review base supplied by the coordinating skill. */
export function resolvePinnedReviewBase(
  pinnedBaseOid: string | undefined,
  refExists: RefExists = gitRefExists,
): string | undefined {
  const oid = pinnedBaseOid?.trim() ?? "";
  if (oid.length === 0) {
    return undefined;
  }
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/iu.test(oid)) {
    throw new Error("AGENT_TOOL_REVIEW_BASE_OID must be a full Git OID.");
  }
  if (!refExists(oid)) {
    throw new Error(
      `Pinned review base '${oid}' is unavailable locally. Fetch it and retry.`,
    );
  }
  return oid;
}

/** Select a repository fetch URL using the protocol configured for `gh`. */
export function selectRepositoryGitUrl(
  protocol: string,
  httpsUrl: string,
  sshUrl: string,
): string {
  if (protocol === "https" && httpsUrl.length > 0) {
    return httpsUrl;
  }
  if (protocol === "ssh" && sshUrl.length > 0) {
    return sshUrl;
  }
  throw new Error(`Unsupported or unavailable git protocol '${protocol}'.`);
}

function resolveRepositoryGitUrl(repo: string): string {
  const repoRaw = run("gh", ["repo", "view", repo, "--json", "url,sshUrl"]);
  const httpsUrl = stringField(repoRaw, "url");
  const sshUrl = stringField(repoRaw, "sshUrl");
  let host = "";
  try {
    host = new URL(httpsUrl).host;
  } catch {
    throw new Error(`Could not resolve the GitHub host for '${repo}'.`);
  }
  const protocol = run("gh", ["config", "get", "git_protocol", "--host", host]);
  return selectRepositoryGitUrl(protocol, httpsUrl, sshUrl);
}

function fetchBase(repositoryUrl: string, target: string): string {
  const result = spawnSync("git", ["fetch", "--quiet", repositoryUrl, target], {
    stdio: "ignore",
  });
  if (spawnExitCode("git fetch", result) !== 0) {
    throw new Error(
      `Could not fetch base '${target}' from '${repositoryUrl}'.`,
    );
  }
  return run("git", ["rev-parse", "FETCH_HEAD"]);
}

const freshBaseRefDependencies: FreshBaseRefDependencies = {
  fetch: fetchBase,
  refExists: gitRefExists,
  repositoryGitUrl: resolveRepositoryGitUrl,
};

/**
 * Base ref for a review, resolved to the exact base snapshot from the repository
 * that owns the PR. A branch cut from an older base would otherwise diff in
 * upstream commits it never authored — so a review (or repair round) could flag
 * or touch code the branch does not own.
 */
export function resolveFreshBaseRef(
  repo: string,
  baseRefName: string,
  baseRefOid: string,
  dependencies: FreshBaseRefDependencies = freshBaseRefDependencies,
): string {
  if (dependencies.refExists(baseRefOid)) {
    return baseRefOid;
  }
  const fetchTarget = baseRefOid || baseRefName;
  const fetchedOid = dependencies.fetch(
    dependencies.repositoryGitUrl(repo),
    fetchTarget,
  );
  if (baseRefOid.length > 0 && fetchedOid !== baseRefOid) {
    throw new Error(
      `Fetched base '${fetchedOid}' does not match expected OID '${baseRefOid}'.`,
    );
  }
  if (!dependencies.refExists(fetchedOid)) {
    throw new Error(
      `Fetched base '${fetchedOid}' from '${repo}' is unavailable locally.`,
    );
  }
  return fetchedOid;
}

/** Prefer an already-fetched pinned base over any new repository lookup. */
export function selectReviewBaseRef(
  pinnedBaseRef: string | undefined,
  repo: string,
  baseRefName: string,
  baseRefOid: string,
  dependencies: FreshBaseRefDependencies = freshBaseRefDependencies,
): string {
  return (
    pinnedBaseRef ??
    resolveFreshBaseRef(repo, baseRefName, baseRefOid, dependencies)
  );
}

/**
 * Map a spawnSync result to a process exit code. A failure to launch (missing
 * binary) or a signal termination leaves `status` null; treat those as a
 * nonzero exit so callers can detect the failure and fall back.
 */
export function spawnExitCode(command: string, result: SpawnResult): number {
  if (result.error) {
    process.stderr.write(`Failed to run ${command}: ${result.error.message}\n`);
    return 1;
  }
  if (result.signal !== null) {
    process.stderr.write(`${command} terminated by signal ${result.signal}\n`);
    return 1;
  }
  return result.status ?? 1;
}

function defaultBranchName(source: string): string {
  const ref = fieldOf(safeParse(source), "defaultBranchRef");
  const name = fieldOf(ref, "name");
  return typeof name === "string" ? name : "";
}

/**
 * Resolve the current git branch, GitHub repo, and the repo's default branch.
 * Throws when on the default branch (or a conventional `main`/`master`) or when
 * the repo can't be determined (gh not authenticated).
 */
export function resolveRepoContext(): {
  branch: string;
  repo: string;
  defaultBranch: string;
} {
  const branch = run("git", ["rev-parse", "--abbrev-ref", "HEAD"]);

  const infoRaw = tryRun("gh", [
    "repo",
    "view",
    "--json",
    "nameWithOwner,defaultBranchRef",
  ]);
  const repo = infoRaw === null ? "" : stringField(infoRaw, "nameWithOwner");
  if (repo.length === 0) {
    throw new Error(
      "Could not determine repository. Ensure gh is authenticated.",
    );
  }
  const defaultBranch = infoRaw === null ? "" : defaultBranchName(infoRaw);

  if (branch === defaultBranch || branch === "main" || branch === "master") {
    throw new Error(
      `Cannot run this on the default branch ('${branch}'). Checkout a feature branch first.`,
    );
  }

  return { branch, repo, defaultBranch };
}

/**
 * Number of the open PR for `branch`, or "" when the query **succeeded** and
 * found none. A failed `gh` call (auth, rate limit, network) throws rather than
 * reporting "" — callers use the empty string to mean "no PR yet" and would
 * otherwise pick the wrong review base or skip a duplicate-PR guard on a
 * transient failure.
 */
export function findOpenPrNumber(branch: string, repo: string): string {
  const raw = tryRun("gh", [
    "pr",
    "list",
    "--head",
    branch,
    "--state",
    "open",
    "--json",
    "number",
    "-R",
    repo,
  ]);
  if (raw === null) {
    throw new Error(
      `Could not list open PRs for branch '${branch}'. Ensure gh is authenticated and reachable.`,
    );
  }
  return firstPrNumber(raw);
}

/** Read a known-open PR's title and base identity from GitHub. */
function viewPr(branch: string, repo: string, prNumber: string): PrView {
  const viewRaw = run("gh", [
    "pr",
    "view",
    prNumber,
    "--json",
    "title,baseRefName,baseRefOid",
    "-R",
    repo,
  ]);

  return {
    branch,
    repo,
    prNumber,
    title: stringField(viewRaw, "title"),
    baseRefName: stringField(viewRaw, "baseRefName"),
    baseRefOid: stringField(viewRaw, "baseRefOid"),
  };
}

export function repoFromPrUrl(prUrl: string): string {
  try {
    const segments = new URL(prUrl).pathname.split("/").filter(Boolean);
    if (segments.length >= 4 && segments[2] === "pull") {
      return `${segments[0]}/${segments[1]}`;
    }
  } catch {
    // Fall through to the actionable error below.
  }
  throw new Error(`Could not resolve the base repository from '${prUrl}'.`);
}

/** Resolve the current branch's PR, including an upstream PR from a fork. */
function viewCurrentBranchPr(branch: string): PrView | undefined {
  const viewRaw = tryRun("gh", [
    "pr",
    "view",
    "--json",
    "number,title,url,baseRefName,baseRefOid",
  ]);
  if (viewRaw === null) {
    return undefined;
  }
  const prNumber = numberFieldString(viewRaw, "number");
  const prUrl = stringField(viewRaw, "url");
  if (prNumber.length === 0 || prUrl.length === 0) {
    throw new Error("Could not determine the current branch's PR identity.");
  }
  return {
    branch,
    repo: repoFromPrUrl(prUrl),
    prNumber,
    title: stringField(viewRaw, "title"),
    baseRefName: stringField(viewRaw, "baseRefName"),
    baseRefOid: stringField(viewRaw, "baseRefOid"),
  };
}

export interface ReviewContextDependencies {
  readonly findOpenPrNumber: typeof findOpenPrNumber;
  readonly pinnedBaseOid: string | undefined;
  readonly resolvePinnedReviewBase: typeof resolvePinnedReviewBase;
  readonly resolveRepoContext: typeof resolveRepoContext;
  readonly selectReviewBaseRef: typeof selectReviewBaseRef;
  readonly viewCurrentBranchPr: typeof viewCurrentBranchPr;
  readonly viewPr: typeof viewPr;
}

/**
 * Resolve the open PR for the current branch from git + GitHub. Throws with an
 * actionable message when there is nothing reviewable (on main, no PR, gh not
 * authenticated).
 */
function fetchPrView(): PrView {
  const { branch, repo } = resolveRepoContext();

  const currentBranchPr = viewCurrentBranchPr(branch);
  if (currentBranchPr !== undefined) {
    return currentBranchPr;
  }

  const prNumber = findOpenPrNumber(branch, repo);
  if (prNumber.length === 0) {
    throw new Error(`No PR found for branch '${branch}'. Create a PR first.`);
  }

  return viewPr(branch, repo, prNumber);
}

/** Current GitHub state of a PR (e.g. "OPEN", "MERGED", "CLOSED"). */
export function prState(prNumber: string, repo: string): string {
  return stringField(
    run("gh", ["pr", "view", prNumber, "--json", "state", "-R", repo]),
    "state",
  );
}

/** Identity of the open PR for the current branch (no base-ref resolution). */
export function resolvePr(): PrIdentity {
  const view = fetchPrView();
  return {
    branch: view.branch,
    repo: view.repo,
    prNumber: view.prNumber,
    title: view.title,
  };
}

/**
 * PR identity plus a base ref that `git diff` can resolve locally, for a review
 * that may run *before* the branch has a PR.
 *
 * When an open PR exists this matches what a post-open review would see: the
 * base ref is the PR's own base, resolved to its current remote tip. When none
 * exists yet, `prNumber`/`title` are empty and the base ref is the repository's
 * current default branch — so the identical `base...HEAD` diff can be reviewed on
 * the local branch now and reviewed again once its PR is open. Either way the base
 * is fetched fresh, so a stale local ref never leaks upstream commits into the
 * diff. Throws on the default branch, via `resolveRepoContext`.
 */
export function resolveReviewContext(
  dependencies?: ReviewContextDependencies,
): PrContext {
  const { AGENT_TOOL_REVIEW_BASE_OID: pinnedBaseOid } = process.env;
  const deps = dependencies ?? {
    findOpenPrNumber,
    pinnedBaseOid,
    resolvePinnedReviewBase,
    resolveRepoContext,
    selectReviewBaseRef,
    viewCurrentBranchPr,
    viewPr,
  };
  const {
    branch,
    repo: checkoutRepo,
    defaultBranch,
  } = deps.resolveRepoContext();
  const pinnedBaseRef = deps.resolvePinnedReviewBase(deps.pinnedBaseOid);

  const currentBranchPr = deps.viewCurrentBranchPr(branch);
  const prNumber =
    currentBranchPr?.prNumber ?? deps.findOpenPrNumber(branch, checkoutRepo);
  if (prNumber.length === 0) {
    if (defaultBranch.length === 0) {
      throw new Error(
        "Could not determine the repository default branch to review against.",
      );
    }
    // No PR yet: review the local branch against the *current* remote default,
    // fetched fresh so a stale local ref cannot pull unrelated upstream commits
    // into the diff.
    return {
      branch,
      repo: checkoutRepo,
      prNumber: "",
      title: "",
      baseRef: deps.selectReviewBaseRef(
        pinnedBaseRef,
        checkoutRepo,
        defaultBranch,
        "",
      ),
    };
  }

  const view = currentBranchPr ?? deps.viewPr(branch, checkoutRepo, prNumber);
  if (view.baseRefName.length === 0) {
    throw new Error("Could not determine base branch from GitHub.");
  }
  return {
    branch,
    repo: view.repo,
    prNumber,
    title: view.title,
    baseRef: deps.selectReviewBaseRef(
      pinnedBaseRef,
      view.repo,
      view.baseRefName,
      view.baseRefOid,
    ),
  };
}
