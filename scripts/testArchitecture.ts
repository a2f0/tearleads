export {};

const command = ["bun", "test", "scripts/architecture"];

console.log(`[architecture:test] ${command.join(" ")}`);
const child = Bun.spawn({
  cmd: command,
  stderr: "inherit",
  stdout: "inherit",
});

process.exitCode = await child.exited;
