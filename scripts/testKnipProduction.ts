export {};

const child = Bun.spawn({
  cmd: ["bun", "test", "scripts/checks/knip"],
  stderr: "inherit",
  stdout: "inherit",
});

process.exitCode = await child.exited;
