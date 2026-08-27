import { spawnSync } from "node:child_process";

import { prState, resolvePr, run, spawnExitCode } from "../git/prContext";
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
        headRefOid
        id
        isInMergeQueue
        state
      }
    }
  }
`;

const MERGE_PULL_REQUEST_MUTATION = `
  mutation(
    $pullRequestId: ID!
    $commitHeadline: String!
    $commitBody: String!
    $expectedHeadOid: GitObjectID!
    $mergeMethod: PullRequestMergeMethod!
  ) {
    mergePullRequest(input: {
      pullRequestId: $pullRequestId
      commitHeadline: $commitHeadline
      commitBody: $commitBody
      expectedHeadOid: $expectedHeadOid
      mergeMethod: $mergeMethod
    }) {
      pullRequest { state }
    }
  }
`;

interface PullRequestMergeTarget {
  readonly headOid: string;
  readonly id: string;
}

function recordField(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null
    ? Reflect.get(value, key)
    : undefined;
}

/** Parse and reject PRs already configured to merge asynchronously. */
export function parsePullRequestMergeTarget(
  source: string,
): PullRequestMergeTarget {
  const parsed: unknown = JSON.parse(source);
  const data = recordField(parsed, "data");
  const repository = recordField(data, "repository");
  const pullRequest = recordField(repository, "pullRequest");
  const id = recordField(pullRequest, "id");
  const headOid = recordField(pullRequest, "headRefOid");
  const state = recordField(pullRequest, "state");
  if (
    state !== "OPEN" ||
    typeof id !== "string" ||
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
  return { headOid, id };
}

function resolvePullRequestMergeTarget(pr: {
  prNumber: string;
  repo: string;
}): PullRequestMergeTarget {
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
  return parsePullRequestMergeTarget(source);
}

/**
 * Build a direct GraphQL merge mutation for a subject-only squash. Unlike
 * `gh pr merge`, this cannot silently enable auto-merge or enqueue the PR.
 */
export function buildSquashMergeArgs(
  target: PullRequestMergeTarget,
  finalSubject: string,
  expectedHeadSha?: string,
): string[] {
  return [
    "api",
    "graphql",
    "-f",
    `query=${MERGE_PULL_REQUEST_MUTATION}`,
    "-f",
    `pullRequestId=${target.id}`,
    "-f",
    `commitHeadline=${finalSubject}`,
    // Empty body keeps the squash commit to the subject line only.
    "-f",
    "commitBody=",
    "-f",
    `expectedHeadOid=${expectedHeadSha || target.headOid}`,
    "-f",
    "mergeMethod=SQUASH",
  ];
}

/**
 * Squash-merge the open PR for the current branch with a subject-only commit
 * message — no auto-generated body or extended message. The subject defaults to
 * the PR title when one is not supplied, and is validated against the repo's
 * commitlint rules before the merge runs. When `expectedHeadSha` is supplied the
 * merge is bound to that commit through GraphQL's `expectedHeadOid` input.
 */
export function squashMerge(
  rootDir: string,
  subjectArg: string | undefined,
  expectedHeadSha?: string,
): number {
  const pr = resolvePr();
  const subject = resolveSubject(subjectArg, pr.title);

  // Validate the human-authored subject without the PR-number suffix: GitHub's
  // native squash appends `(#<n>)` server-side, past the commit-msg hook, so the
  // repo's existing history carries suffixes over the 50-char header limit. Keep
  // the suffix "free" here too by validating the base, then append it ourselves —
  // a custom GraphQL commit headline otherwise drops GitHub's automatic reference.
  const baseSubject = stripPrNumberSuffix(subject);
  validateCommitSubject(rootDir, baseSubject);
  const finalSubject = appendPrNumberSuffix(baseSubject, pr.prNumber);
  const mergeTarget = resolvePullRequestMergeTarget(pr);

  const result = spawnSync(
    "gh",
    buildSquashMergeArgs(mergeTarget, finalSubject, expectedHeadSha),
    { stdio: "inherit" },
  );
  const exitCode = spawnExitCode("GitHub mergePullRequest mutation", result);
  if (exitCode !== 0) {
    return exitCode;
  }

  // Confirm that GitHub committed the direct mutation before cleanup can run.
  const state = prState(pr.prNumber, pr.repo);
  if (state !== "MERGED") {
    process.stderr.write(
      `PR #${pr.prNumber} is not merged (state: ${state || "unknown"}). ` +
        "The synchronous subject-only squash did not land.\n",
    );
    return 1;
  }

  return 0;
}
