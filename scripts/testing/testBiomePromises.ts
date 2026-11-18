import { checkRoot } from "../lib/checkRoot";

const root = checkRoot();
for (const { cmd, cwd } of [
  { cmd: [process.execPath, "run", "--cwd", "packages/client-sdk", "build"] },
  {
    cmd: [process.execPath, "test", "production.test.ts"],
    cwd: `${root}/scripts/checks/biome`,
  },
]) {
  console.log(`[biome:promises] bun ${cmd.slice(1).join(" ")}`);
  const child = Bun.spawn({
    cmd,
    cwd: cwd ?? root,
    env: process.env,
    stderr: "inherit",
    stdout: "inherit",
  });
  const exitCode = await child.exited;
  if (exitCode !== 0) {
    process.exitCode = exitCode;
    break;
  }
}
