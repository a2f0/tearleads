import { describe, expect, test } from "bun:test";

import { resolvePinnedReviewBase, selectRepositoryGitUrl } from "./prContext";

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
