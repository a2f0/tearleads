import { basename, dirname, resolve } from "node:path";
import { stripVTControlCharacters } from "node:util";
import { assertCompletedTurboRun, plannedTurboTasks } from "./turboRunEvidence";

async function run() {
  const [task, ...args] = process.argv.slice(2);
  if (task !== "test" && task !== "e2e")
    throw new Error("Expected a test or e2e task");
  if (args.some((arg) => /^--(?:dry(?:-run)?|summarize|ui)(?:=|$)/.test(arg)))
    throw new Error("Turbo evidence flags are managed by this runner");
  const cwd = process.cwd();
  const turbo = resolve(cwd, "node_modules/.bin/turbo");
  const plan = Bun.spawn([turbo, "run", task, ...args, "--dry-run=json"], {
    cwd,
    stdout: "pipe",
    stderr: "inherit",
  });
  const [planText, planExit] = await Promise.all([
    new Response(plan.stdout).text(),
    plan.exited,
  ]);
  if (planExit !== 0) return planExit;
  const planned = plannedTurboTasks(JSON.parse(planText));
  const startedAt = Date.now();
  let summaryPath: string | undefined;
  const child = Bun.spawn(
    [turbo, "run", task, ...args, "--summarize=true", "--ui=stream"],
    {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
      stdin: "inherit",
    },
  );
  const forward = async (
    stream: ReadableStream<Uint8Array>,
    sink: NodeJS.WriteStream,
  ) => {
    const decoder = new TextDecoder();
    let pending = "";
    const inspect = (line: string) => {
      const match = /^\s*Summary:\s+(.+\.json)\s*$/.exec(
        stripVTControlCharacters(line),
      );
      if (match?.[1]) summaryPath = match[1];
    };
    for await (const chunk of stream) {
      sink.write(chunk);
      pending += decoder.decode(chunk, { stream: true });
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? "";
      for (const line of lines) inspect(line);
    }
    inspect(pending + decoder.decode());
  };
  const [code] = await Promise.all([
    child.exited,
    forward(child.stdout, process.stdout),
    forward(child.stderr, process.stderr),
  ]);
  if (code !== 0) return code;
  if (!summaryPath) throw new Error("Turbo exited without completion evidence");
  const path = resolve(cwd, summaryPath);
  if (
    dirname(path) !== resolve(cwd, ".turbo/runs") ||
    !/^[a-zA-Z0-9_-]+\.json$/.test(basename(path))
  )
    throw new Error("Turbo returned an unexpected completion evidence path");
  assertCompletedTurboRun({
    summary: await Bun.file(path).json(),
    planned,
    startedAt,
  });
  return 0;
}

try {
  process.exitCode = await run();
} catch (error) {
  console.error(
    `[turbo-verification] ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
}
