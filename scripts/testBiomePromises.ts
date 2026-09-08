export {};

for (const cmd of [
  [process.execPath, "run", "--cwd", "packages/client-sdk", "build"],
  [process.execPath, "test", "scripts/checks/biome"],
]) {
  console.log(`[biome:promises] bun ${cmd.slice(1).join(" ")}`);
  const child = Bun.spawn({ cmd, stderr: "inherit", stdout: "inherit" });
  const exitCode = await child.exited;
  if (exitCode !== 0) {
    process.exitCode = exitCode;
    break;
  }
}
