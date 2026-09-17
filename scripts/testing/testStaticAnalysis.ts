export {};

const child = Bun.spawn({
  cmd: [process.execPath, "test", "staticAnalysis"],
  cwd: `${import.meta.dir}/../checks`,
  stderr: "inherit",
  stdout: "inherit",
});
process.exitCode = await child.exited;
