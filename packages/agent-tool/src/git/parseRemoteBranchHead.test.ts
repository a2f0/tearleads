import { describe, expect, test } from "bun:test";

import { parseRemoteBranchHead } from "./prContext";

describe("parseRemoteBranchHead", () => {
  test("returns the OID of exactly the named branch", () => {
    expect(
      parseRemoteBranchHead(
        "aaa\trefs/heads/feature-2\nbbb\trefs/heads/feature\n",
        "feature",
      ),
    ).toBe("bbb");
  });

  test("returns null when the branch is absent", () => {
    expect(parseRemoteBranchHead("", "feature")).toBeNull();
    expect(
      parseRemoteBranchHead("aaa\trefs/heads/feature-2\n", "feature"),
    ).toBeNull();
  });
});
