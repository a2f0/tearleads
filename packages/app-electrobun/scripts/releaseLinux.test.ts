import { expect, test } from "bun:test";
import { runLinuxRelease } from "./releaseLinux.testUtils";

for (const tier of ["staging", "production"]) {
  test(`${tier} builds x64 in Docker and publishes a matched installer and updater`, async () => {
    const result = await runLinuxRelease(["upload", tier]);
    expect(result.exitCode, result.stderr).toBe(0);
    expect(
      result.calls.find((call) => call.startsWith("docker build")),
    ).toContain("--platform linux/amd64");
    expect(result.context).toContain(
      "packages/app-electrobun/scripts/releaseLinux.sh",
    );
    for (const excluded of [
      ".secrets",
      "node_modules",
      ".git/",
      "untracked.env",
    ])
      expect(result.context).not.toContain(excluded);
    const uploads = result.calls.filter((call) => call.startsWith("upload"));
    expect(uploads).toHaveLength(5);
    expect(uploads[0]).toContain("-Setup.tar.gz ");
    expect(uploads[2]).toContain(".tar.zst ");
    expect(uploads[3]).toContain("-update.json");
    expect(uploads[4]).toContain("-download.json");
    const discovery = JSON.parse(result.published[result.discovery] ?? "{}");
    expect(result.published[discovery.installer]).toBe("installer\n");
    expect(result.published[discovery.checksum]).toContain(
      `  ${discovery.installer}\n`,
    );
    expect(result.published["previous-Setup.tar.gz"]).toBe(
      "previous installer\n",
    );
    expect(result.calls.at(-1)).toBe("docker rm test-container");
  });
}

for (const failure of [
  "build",
  "missing",
  "smoke",
  "payload",
  "checksum",
  "metadata",
]) {
  test(`${failure} failure preserves download discovery`, async () => {
    const result = await runLinuxRelease(["upload", "production"], failure);
    expect(result.exitCode).not.toBe(0);
    expect(result.published[result.discovery]).toBe("previous discovery\n");
    expect(result.stdout).not.toContain("Download:");
    if (["build", "missing", "smoke"].includes(failure))
      expect(result.calls.some((call) => call.startsWith("upload"))).toBe(
        false,
      );
  });
}

test("build mode leaves AWS untouched", async () => {
  const result = await runLinuxRelease(["build", "production"]);
  expect(result.exitCode, result.stderr).toBe(0);
  expect(result.calls).not.toContain("credentials");
  expect(result.calls.some((call) => call.startsWith("upload"))).toBe(false);
});

test("build mode excludes tracked files deleted in the working tree", async () => {
  const result = await runLinuxRelease(["build", "production"], "deleted");
  expect(result.exitCode, result.stderr).toBe(0);
  expect(result.context).not.toContain(".gitignore");
});

for (const change of ["dirty", "staged"]) {
  test(`${change} tracked source cannot be uploaded under HEAD's release identity`, async () => {
    const result = await runLinuxRelease(["upload", "production"], change);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Commit source changes");
    expect(result.calls).toEqual([]);
  });
}

for (const args of [[], ["upload", "prod"], ["build", "production", "extra"]]) {
  test(`invalid arguments ${args.join(" ")} do not invoke Docker or AWS`, async () => {
    const result = await runLinuxRelease(args);
    expect(result.exitCode).toBe(1);
    expect(result.calls).toEqual([]);
  });
}
