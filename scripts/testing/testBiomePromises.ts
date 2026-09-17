export {};

for (const { cmd, cwd } of [
  { cmd: [process.execPath, "run", "--cwd", "packages/client-sdk", "build"] },
  {
    cmd: [process.execPath, "test", "production.test.ts"],
    cwd: `${import.meta.dir}/../checks/biome`,
  },
]) {
  console.log(`[biome:promises] bun ${cmd.slice(1).join(" ")}`);
  const child = Bun.spawn({
    cmd,
    cwd: cwd ?? process.cwd(),
    stderr: "inherit",
    stdout: "inherit",
  });
  const exitCode = await child.exited;
  if (exitCode !== 0) {
    process.exitCode = exitCode;
    break;
  }
}
