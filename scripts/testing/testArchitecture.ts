export {};

const command = ["bun", "test", "architecture"];

console.log(`[architecture:test] ${command.join(" ")}`);
const child = Bun.spawn({
  cmd: command,
  cwd: `${import.meta.dir}/..`,
  stderr: "inherit",
  stdout: "inherit",
});

process.exitCode = await child.exited;
