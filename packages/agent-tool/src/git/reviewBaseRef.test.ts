import { describe, expect, test } from "bun:test";

import { repoFromPrUrl, viewCurrentBranchPr } from "./currentBranchPr";
import {
  type PrView,
  type ReviewContextDependencies,
  resolveFreshBaseRef,
  resolvePinnedReviewBase,
  resolveReviewContext,
  selectRepositoryGitUrl,
  selectReviewBaseRef,
} from "./prContext";

const SHA1_OID = "a".repeat(40);
const SHA256_OID = "b".repeat(64);

describe("resolvePinnedReviewBase", () => {
  test("leaves ordinary review resolution unchanged when unset", () => {
    expect(resolvePinnedReviewBase(undefined)).toBeUndefined();
    expect(resolvePinnedReviewBase("  ")).toBeUndefined();
  });

  test("accepts full available SHA-1 and SHA-256 object ids", () => {
    expect(resolvePinnedReviewBase(SHA1_OID, () => true)).toBe(SHA1_OID);
    expect(resolvePinnedReviewBase(SHA256_OID, () => true)).toBe(SHA256_OID);
  });

  test("rejects malformed or unavailable object ids", () => {
    expect(() => resolvePinnedReviewBase("abc123", () => true)).toThrow(
      "must be a full Git OID",
    );
    expect(() => resolvePinnedReviewBase(SHA1_OID, () => false)).toThrow(
      "is unavailable locally",
    );
  });
});

describe("selectRepositoryGitUrl", () => {
  test("honors the configured HTTPS or SSH protocol", () => {
    expect(
      selectRepositoryGitUrl(
        "https",
        "https://github.com/owner/repo",
        "git@github.com:owner/repo.git",
      ),
    ).toBe("https://github.com/owner/repo");
    expect(
      selectRepositoryGitUrl(
        "ssh",
        "https://github.com/owner/repo",
        "git@github.com:owner/repo.git",
      ),
    ).toBe("git@github.com:owner/repo.git");
  });

  test("rejects unsupported or unavailable protocols", () => {
    expect(() =>
      selectRepositoryGitUrl("file", "https://example.com", ""),
    ).toThrow("Unsupported or unavailable git protocol");
    expect(() =>
      selectRepositoryGitUrl("ssh", "https://example.com", ""),
    ).toThrow("Unsupported or unavailable git protocol");
  });
});

describe("review base integration", () => {
  test("derives the upstream repository from a fork PR URL", () => {
    expect(repoFromPrUrl("https://github.com/upstream/repo/pull/42")).toBe(
      "upstream/repo",
    );
    expect(() => repoFromPrUrl("https://github.com/upstream/repo")).toThrow(
      "Could not resolve the base repository",
    );
  });

  test("accepts only an open current-branch PR", () => {
    const open = viewCurrentBranchPr("feature", () => ({
      status: 0,
      signal: null,
      stderr: "",
      stdout: JSON.stringify({
        number: 42,
        state: "OPEN",
        title: "Fork PR",
        url: "https://github.com/upstream/repo/pull/42",
        baseRefName: "main",
        baseRefOid: SHA1_OID,
      }),
    }));
    const closed = viewCurrentBranchPr("feature", () => ({
      status: 0,
      signal: null,
      stderr: "",
      stdout: JSON.stringify({ state: "CLOSED" }),
    }));

    expect(open?.repo).toBe("upstream/repo");
    expect(open?.prNumber).toBe("42");
    expect(closed).toBeUndefined();
  });

  test("distinguishes a confirmed no-PR result from lookup failures", () => {
    const noPr = viewCurrentBranchPr("feature", () => ({
      status: 1,
      signal: null,
      stderr: 'no pull requests found for branch "feature"\n',
      stdout: "",
    }));

    expect(noPr).toBeUndefined();
    expect(() =>
      viewCurrentBranchPr("feature", () => ({
        status: 1,
        signal: null,
        stderr: "authentication failed",
        stdout: "",
      })),
    ).toThrow("authentication failed");
  });

  test("gives a pinned base precedence without fetching", () => {
    let fetched = false;
    const resolved = selectReviewBaseRef(
      SHA1_OID,
      "upstream/repo",
      "main",
      SHA256_OID,
      {
        fetch: () => {
          fetched = true;
          return SHA256_OID;
        },
        refExists: () => true,
        repositoryGitUrl: () => "https://github.com/upstream/repo",
      },
    );

    expect(resolved).toBe(SHA1_OID);
    expect(fetched).toBe(false);
  });

  test("fetches a PR base by exact OID from the upstream repository", () => {
    const calls: string[][] = [];
    const resolved = resolveFreshBaseRef("upstream/repo", "main", SHA1_OID, {
      fetch: (url, target) => {
        calls.push([url, target]);
        return SHA1_OID;
      },
      refExists: (ref) => ref === SHA1_OID && calls.length > 0,
      repositoryGitUrl: (repo) => `https://github.com/${repo}`,
    });

    expect(resolved).toBe(SHA1_OID);
    expect(calls).toEqual([["https://github.com/upstream/repo", SHA1_OID]]);
  });

  test("fetches the default branch when no PR base OID exists", () => {
    const calls: string[][] = [];
    const resolved = resolveFreshBaseRef("owner/repo", "main", "", {
      fetch: (url, target) => {
        calls.push([url, target]);
        return SHA256_OID;
      },
      refExists: (ref) => ref === SHA256_OID,
      repositoryGitUrl: (repo) => `https://github.com/${repo}`,
    });

    expect(resolved).toBe(SHA256_OID);
    expect(calls).toEqual([["https://github.com/owner/repo", "main"]]);
  });

  test("rejects a fetched OID that differs from the PR base", () => {
    expect(() =>
      resolveFreshBaseRef("upstream/repo", "main", SHA1_OID, {
        fetch: () => SHA256_OID,
        refExists: () => false,
        repositoryGitUrl: () => "https://github.com/upstream/repo",
      }),
    ).toThrow("does not match expected OID");
  });

  function dependencies(
    currentPr: PrView | undefined,
    fallbackPrNumber: string,
    resolveBase: ReviewContextDependencies["selectReviewBaseRef"],
  ): ReviewContextDependencies {
    return {
      findOpenPrNumber: () => fallbackPrNumber,
      pinnedBaseOid: undefined,
      resolvePinnedReviewBase: () => undefined,
      resolveRepoContext: () => ({
        branch: "feature",
        repo: "fork/repo",
        defaultBranch: "main",
      }),
      selectReviewBaseRef: resolveBase,
      viewCurrentBranchPr: () => currentPr,
      viewPr: () => ({
        branch: "feature",
        repo: "fork/repo",
        prNumber: fallbackPrNumber,
        title: "Local PR",
        baseRefName: "main",
        baseRefOid: SHA1_OID,
      }),
    };
  }

  test("resolves an upstream fork PR and its immutable base", () => {
    const upstreamPr: PrView = {
      branch: "feature",
      repo: "upstream/repo",
      prNumber: "42",
      title: "Fork PR",
      baseRefName: "trunk",
      baseRefOid: SHA1_OID,
    };
    const context = resolveReviewContext(
      dependencies(upstreamPr, "", (pinned, repo, name, oid) => {
        expect([pinned, repo, name, oid]).toEqual([
          undefined,
          "upstream/repo",
          "trunk",
          SHA1_OID,
        ]);
        return SHA1_OID;
      }),
    );

    expect(context).toEqual({
      branch: "feature",
      repo: "upstream/repo",
      prNumber: "42",
      title: "Fork PR",
      baseRef: SHA1_OID,
    });
  });

  test("resolves a no-PR branch against its checkout default branch", () => {
    const context = resolveReviewContext(
      dependencies(undefined, "", (_pinned, repo, name, oid) => {
        expect([repo, name, oid]).toEqual(["fork/repo", "main", ""]);
        return SHA256_OID;
      }),
    );

    expect(context).toEqual({
      branch: "feature",
      repo: "fork/repo",
      prNumber: "",
      title: "",
      baseRef: SHA256_OID,
    });
  });

  test("propagates a base-fetch mismatch from full context resolution", () => {
    const upstreamPr: PrView = {
      branch: "feature",
      repo: "upstream/repo",
      prNumber: "42",
      title: "Fork PR",
      baseRefName: "main",
      baseRefOid: SHA1_OID,
    };
    expect(() =>
      resolveReviewContext(
        dependencies(upstreamPr, "", () => {
          throw new Error("Fetched base does not match expected OID");
        }),
      ),
    ).toThrow("does not match expected OID");
  });
});
