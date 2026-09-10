export {};

const child = Bun.spawn({
  cmd: ["bun", "test", "scripts/checks/staticAnalysis"],
  stderr: "inherit",
  stdout: "inherit",
});
process.exitCode = await child.exited;
