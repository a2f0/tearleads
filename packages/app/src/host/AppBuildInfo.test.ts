import { expect, test } from "bun:test";
import { createAppBuildInfo } from "./AppBuildInfo";

test.each([undefined, "", "{", "null", "[]", "42", '{"app":42}'])(
  "invalid package metadata %s cannot discard the remaining build identity",
  (packageVersionsJson) => {
    expect(
      createAppBuildInfo({
        commit: "abc1234",
        packageVersionsJson,
        target: "web",
        version: "1.2.3",
      }),
    ).toEqual({
      commit: "abc1234",
      packageVersions: {},
      target: "web",
      version: "1.2.3",
    });
  },
);

test("package metadata preserves scoped package names and release versions", () => {
  const info = createAppBuildInfo({
    commit: undefined,
    packageVersionsJson:
      '{"tearleads":"0.1.0","@tearleads/client-sdk":"0.2.0-rc.1"}',
    target: "web",
    version: undefined,
  });
  expect(info).toEqual({
    commit: "unknown",
    packageVersions: {
      tearleads: "0.1.0",
      "@tearleads/client-sdk": "0.2.0-rc.1",
    },
    target: "web",
    version: "unknown",
  });
});
