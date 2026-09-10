export {};

const child = Bun.spawn({
  cmd: [process.execPath, "test", "scripts/checks/staticAnalysis"],
  stderr: "inherit",
  stdout: "inherit",
});
process.exitCode = await child.exited;
