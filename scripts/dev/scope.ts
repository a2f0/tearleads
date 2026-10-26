#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { benchmark } from "./scope/benchmark";
import { calibrate } from "./scope/calibrate";
import { register } from "./scope/register";
import { regrade } from "./scope/regrade";
import { getSavedConfig, root, settings } from "./scope/settings";
import { projectConfig } from "./scope/suites";

const args = process.argv.slice(2);
function run(
  command: string,
  argv: string[],
  env = process.env,
  cwd = root,
): void {
  const result = spawnSync(command, argv, { cwd, env, stdio: "inherit" });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}

switch (args[0]) {
  case undefined:
  case "--help":
    console.log(`Local Scope commands:
  install                 Install pinned native services (macOS arm64)
  start / stop            Start or stop background services
  portal                  Run the portal in the foreground
  register [ref] [base]    Upload a Git checkout (defaults HEAD, origin/main)
  calibrate               Check known correct/incorrect answers with Codex
  benchmark [count]       Run three agent-friendliness tasks, sequentially
  regrade <receipt>        Regrade saved one-turn outputs without rerunning agents
  smoke                   Run a scored repository inspection smoke test
  cli [arguments]         Forward arguments to the upstream Scope CLI
Other commands are forwarded to the upstream CLI with this project selected.`);
    break;
  case "install":
  case "start":
  case "stop":
    if (args.length !== 1) throw new Error("This command takes no arguments");
    run(
      "python3",
      args[0] === "install"
        ? ["-B", join(root, "scripts/dev/scope/install.py")]
        : ["-B", join(root, "scripts/dev/scope/native.py"), args[0]],
    );
    break;
  case "register":
    if (args.length > 3)
      throw new Error("Usage: bun run scope:register [git-ref] [base-ref]");
    await register(args[1] ?? "HEAD", args[2] ?? "origin/main");
    break;
  case "calibrate":
    if (args.length !== 1) throw new Error("Usage: bun run scope calibrate");
    await calibrate();
    break;
  case "regrade":
    if (args.length !== 2 || !args[1])
      throw new Error("Usage: bun run scope regrade <receipt.json>");
    await regrade(args[1]);
    break;
  case "benchmark":
  case "smoke":
    if (args.length > (args[0] === "smoke" ? 1 : 2))
      throw new Error("Usage: bun run scope benchmark [count]");
    await benchmark(
      args[0] === "smoke" ? "smoke" : "agent-friendliness",
      Number(args[1] ?? 1),
    );
    break;
  case "portal":
    if (args.length !== 1) throw new Error("Usage: bun run scope portal");
    run(
      "node",
      [
        "--require",
        join(root, "scripts/dev/scope/loopback.cjs"),
        "--import",
        join(settings.sourceDir, "node_modules/tsx/dist/loader.mjs"),
        "--import",
        join(root, "scripts/dev/scope/browser-guard.ts"),
        join(settings.sourceDir, "apps/portal/node_modules/vite/bin/vite.js"),
        "--host",
        "127.0.0.1",
        "--port",
        String(settings.portalPort),
        "--strictPort",
      ],
      {
        ...process.env,
        VITE_API_PROXY_TARGET: settings.apiUrl,
        VITE_AUTH_ENABLED_LOCAL: "false",
      },
      join(settings.sourceDir, "apps/portal"),
    );
    break;
  default: {
    const cli = join(settings.sourceDir, "apps/cli/dist/scope.mjs");
    if (!existsSync(cli)) throw new Error("Run bun run scope install first");
    const cliArgs = args[0] === "cli" ? args.slice(1) : args;
    if (!cliArgs.includes("--help") && !cliArgs.includes("--version"))
      projectConfig();
    run("node", [cli, ...cliArgs], {
      ...process.env,
      SCOPE_API_URL: settings.apiUrl,
      SCOPE_PROJECT: getSavedConfig()?.projectId ?? "",
      SCOPE_NO_UPDATE_CHECK: "1",
    });
  }
}
