import { spawnSync } from "node:child_process";

import {
  prState,
  resolveFreshBaseRef,
  resolvePr,
  resolveRepositoryGitUrl,
  run,
  spawnExitCode,
} from "../git/prContext";
import { appendPrNumberSuffix, stripPrNumberSuffix } from "./prNumberSuffix";
import { singleLineSubject } from "./subjectLine";
import { validateCommitSubject } from "./validateCommitSubject";

/**
 * Resolve the squash subject from the CLI argument, falling back to the PR
 * title. Rejects an empty subject and any embedded line break so the squash
 * commit stays a single subject line.
 */
export function resolveSubject(
  subjectArg: string | undefined,
  prTitle: string,
): string {
  return singleLineSubject(subjectArg, prTitle, "squash subject");
}

const PULL_REQUEST_MERGE_TARGET_QUERY = `
  query($owner: String!, $name: String!, $number: Int!) {
    repository(owner: $owner, name: $name) {
      pullRequest(number: $number) {
        autoMergeRequest { enabledAt }
        baseRefName
        headRefOid
        isInMergeQueue
        state
      }
    }
  }
`;

interface PullRequestMergeTarget {
  readonly baseRefName: string;
  readonly headOid: string;
}

interface AtomicRuleCoverage {
  readonly squashPullRequest: boolean;
  readonly strictChecks: boolean;
}

function recordField(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null
    ? Reflect.get(value, key)
    : undefined;
}

/** Find the non-bypassable server rules the atomic base update relies on. */
export function atomicRuleCoverage(sources: string[]): AtomicRuleCoverage {
  let squashPullRequest = false;
  let strictChecks = false;
  for (const source of sources) {
    const ruleset: unknown = JSON.parse(source);
    if (
      recordField(ruleset, "enforcement") !== "active" ||
      recordField(ruleset, "current_user_can_bypass") !== "never"
    ) {
      continue;
    }
    const rules = recordField(ruleset, "rules");
    if (!Array.isArray(rules)) {
      continue;
    }
    for (const rule of rules) {
      const parameters = recordField(rule, "parameters");
      if (recordField(rule, "type") === "required_status_checks") {
        const checks = recordField(parameters, "required_status_checks");
        strictChecks ||=
          recordField(parameters, "strict_required_status_checks_policy") ===
            true &&
          Array.isArray(checks) &&
          checks.length > 0;
      }
      if (recordField(rule, "type") === "pull_request") {
        const methods = recordField(parameters, "allowed_merge_methods");
        squashPullRequest ||=
          Array.isArray(methods) && methods.includes("squash");
      }
    }
  }
  return { squashPullRequest, strictChecks };
}

function assertAtomicBaseRules(repo: string, baseRef: string): void {
  const rulesetIds = run("gh", [
    "api",
    `repos/${repo}/rules/branches/${encodeURIComponent(baseRef)}`,
    "--jq",
    "[.[].ruleset_id] | unique | .[]",
  ])
    .split(/\s+/u)
    .filter(Boolean);
  const coverage = atomicRuleCoverage(
    rulesetIds.map((id) => run("gh", ["api", `repos/${repo}/rulesets/${id}`])),
  );
  if (!coverage.strictChecks || !coverage.squashPullRequest) {
    throw new Error(
      `Base '${baseRef}' needs non-bypassable strict checks and a squash pull-request rule.`,
    );
  }
}

/** Parse and reject PRs already configured to merge asynchronously. */
export function parsePullRequestMergeTarget(
  source: string,
  expectedBaseRef?: string,
): PullRequestMergeTarget {
  const parsed: unknown = JSON.parse(source);
  const data = recordField(parsed, "data");
  const repository = recordField(data, "repository");
  const pullRequest = recordField(repository, "pullRequest");
  const baseRefName = recordField(pullRequest, "baseRefName");
  const headOid = recordField(pullRequest, "headRefOid");
  const state = recordField(pullRequest, "state");
  if (
    state !== "OPEN" ||
    typeof baseRefName !== "string" ||
    typeof headOid !== "string"
  ) {
    throw new Error("Could not resolve an open pull request merge target.");
  }
  if (
    recordField(pullRequest, "isInMergeQueue") === true ||
    recordField(pullRequest, "autoMergeRequest") !== null
  ) {
    throw new Error(
      "Pull request already has a queued or automatic merge; cancel it before running squashMerge.",
    );
  }
  if (expectedBaseRef !== undefined && baseRefName !== expectedBaseRef) {
    throw new Error(
      `Pull request base changed from '${expectedBaseRef}' to '${baseRefName}'; revalidate and re-review before merging.`,
    );
  }
  return { baseRefName, headOid };
}

function resolvePullRequestMergeTarget(
  pr: {
    prNumber: string;
    repo: string;
  },
  expectedBaseRef?: string,
): PullRequestMergeTarget {
  const repoParts = pr.repo.split("/");
  if (repoParts.length !== 2 || repoParts.some((part) => part.length === 0)) {
    throw new Error(`Invalid repository slug '${pr.repo}'.`);
  }
  const [owner, name] = repoParts;
  const source = run("gh", [
    "api",
    "graphql",
    "-f",
    `query=${PULL_REQUEST_MERGE_TARGET_QUERY}`,
    "-F",
    `owner=${owner}`,
    "-F",
    `name=${name}`,
    "-F",
    `number=${pr.prNumber}`,
  ]);
  return parsePullRequestMergeTarget(source, expectedBaseRef);
}

/**
 * Build an atomic fast-forward of the reviewed squash commit onto the explicit
 * base ref. The lease binds the update to the base snapshot that was reviewed.
 */
export function buildAtomicSquashPushArgs(
  repositoryUrl: string,
  target: PullRequestMergeTarget,
  expectedBaseOid: string,
): string[] {
  return [
    "push",
    `--force-with-lease=refs/heads/${target.baseRefName}:${expectedBaseOid}`,
    repositoryUrl,
    `${target.headOid}:refs/heads/${target.baseRefName}`,
  ];
}

/** Require a single reviewed squash commit directly on the validated base. */
export function assertAtomicSquashCandidate(
  target: PullRequestMergeTarget,
  expectedHeadSha: string,
  expectedBaseRef: string,
  expectedBaseOid: string,
  localHead: string,
  parentLine: string,
): void {
  if (target.headOid !== expectedHeadSha || localHead !== expectedHeadSha) {
    throw new Error("Local, reviewed, and pull request heads must match.");
  }
  if (target.baseRefName !== expectedBaseRef) {
    throw new Error(
      `Pull request base changed from '${expectedBaseRef}' to '${target.baseRefName}'; revalidate and re-review before merging.`,
    );
  }
  const parents = parentLine.trim().split(/\s+/u);
  if (parents.length !== 2 || parents[0] !== expectedHeadSha) {
    throw new Error("Reviewed head must be one non-merge squash commit.");
  }
  if (parents[1] !== expectedBaseOid) {
    throw new Error(
      "Reviewed squash commit is not based on the validated base.",
    );
  }
}

/** Keep the base commit message subject-only and tied to this PR. */
export function assertSquashCommitMessage(
  committedSubject: string,
  committedBody: string,
  expectedSubject: string,
): void {
  if (committedSubject !== expectedSubject) {
    throw new Error(
      `Reviewed squash subject '${committedSubject}' does not match '${expectedSubject}'.`,
    );
  }
  if (committedBody.trim().length > 0) {
    throw new Error("Reviewed squash commit must not have a message body.");
  }
}

/** Indirect merge recognition is supported only on the default branch. */
export function assertDefaultBaseRef(
  baseRef: string,
  defaultBranch: string,
): void {
  if (baseRef !== defaultBranch) {
    throw new Error(
      `Atomic squash merge requires the repository default branch '${defaultBranch}', not '${baseRef}'.`,
    );
  }
}

/**
 * Squash-merge the open PR for the current branch with a subject-only commit
 * message — no auto-generated body or extended message. The reviewed head must
 * already be that single squash commit directly on the validated base. The
 * merge atomically pushes it to the explicitly named base with a lease, so a
 * base advance, head change, or PR retarget cannot redirect stale work.
 */
export function squashMerge(
  rootDir: string,
  subjectArg: string | undefined,
  expectedHeadSha?: string,
  expectedBaseRef?: string,
  expectedBaseOid?: string,
): number {
  const pr = resolvePr();
  const subject = resolveSubject(subjectArg, pr.title);

  // Validate the human-authored subject without the PR-number suffix: GitHub's
  // native squash appends `(#<n>)` server-side, past the commit-msg hook, so the
  // repo's existing history carries suffixes over the 50-char header limit. Keep
  // the suffix "free" here too by validating the base, then require the prepared
  // squash commit to contain the authoritative PR reference.
  const baseSubject = stripPrNumberSuffix(subject);
  validateCommitSubject(rootDir, baseSubject);
  const finalSubject = appendPrNumberSuffix(baseSubject, pr.prNumber);
  const mergeTarget = resolvePullRequestMergeTarget(pr, expectedBaseRef);
  const reviewedHead = expectedHeadSha ?? mergeTarget.headOid;
  const baseRef = expectedBaseRef ?? mergeTarget.baseRefName;
  const liveBaseOid = resolveFreshBaseRef(pr.repo, baseRef);
  if (expectedBaseOid !== undefined && liveBaseOid !== expectedBaseOid) {
    throw new Error(
      `Base '${baseRef}' advanced from '${expectedBaseOid}' to '${liveBaseOid}'; update and re-review before merging.`,
    );
  }
  const defaultBranch = run("gh", [
    "repo",
    "view",
    pr.repo,
    "--json",
    "defaultBranchRef",
    "--jq",
    ".defaultBranchRef.name",
  ]);
  assertDefaultBaseRef(baseRef, defaultBranch);
  assertAtomicBaseRules(pr.repo, baseRef);
  assertAtomicSquashCandidate(
    mergeTarget,
    reviewedHead,
    baseRef,
    liveBaseOid,
    run("git", ["rev-parse", "HEAD"]),
    run("git", ["rev-list", "--parents", "-n", "1", reviewedHead]),
  );
  assertSquashCommitMessage(
    run("git", ["log", "-1", "--format=%s", reviewedHead]),
    run("git", ["log", "-1", "--format=%b", reviewedHead]),
    finalSubject,
  );

  const result = spawnSync(
    "git",
    buildAtomicSquashPushArgs(
      resolveRepositoryGitUrl(pr.repo),
      mergeTarget,
      liveBaseOid,
    ),
    { stdio: "inherit" },
  );
  const exitCode = spawnExitCode("atomic squash push", result);
  if (exitCode !== 0) {
    return exitCode;
  }

  // Confirm GitHub recognized the protected fast-forward as this PR's merge
  // before cleanup can run.
  const state = prState(pr.prNumber, pr.repo);
  if (state !== "MERGED") {
    process.stderr.write(
      `PR #${pr.prNumber} is not merged (state: ${state || "unknown"}). ` +
        "The atomic subject-only squash was not recognized as merged.\n",
    );
    return 1;
  }

  return 0;
}
