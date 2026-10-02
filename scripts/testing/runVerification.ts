import { verificationPlan, verificationUsage } from "./verificationPlan";
import {
  saveVerificationReport,
  type VerificationReport,
  verificationGit,
  verificationReportPath,
  verificationSnapshot,
} from "./verificationReport";

function createReport(
  root: string,
  plan: ReturnType<typeof verificationPlan>,
): VerificationReport {
  return {
    schemaVersion: 1,
    mode: plan.mode,
    packageName: plan.packageName,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    status: "running",
    exitCode: null,
    before: verificationSnapshot(root),
    after: null,
    steps: plan.steps.map((step) => ({
      ...step,
      status: "pending",
      durationMs: 0,
      exitCode: null,
    })),
  };
}

interface RunState {
  child: ReturnType<typeof Bun.spawn> | undefined;
  interrupted: number;
}

async function runStep(
  root: string,
  step: VerificationReport["steps"][number],
  state: RunState,
): Promise<number> {
  console.log(`[verify:${step.name}] ${step.command.join(" ")}`);
  const start = performance.now();
  try {
    state.child = Bun.spawn({
      cmd: step.command,
      cwd: root,
      stdin: "ignore",
      stdout: "inherit",
      stderr: "inherit",
    });
    const code = await state.child.exited;
    step.exitCode = state.interrupted || code;
  } catch (error) {
    step.exitCode = 1;
    step.error = String(error);
  } finally {
    state.child = undefined;
    step.durationMs = Math.round(performance.now() - start);
  }
  step.status = step.exitCode === 0 ? "passed" : "failed";
  console.log(
    `[verify:${step.name}] ${step.status} in ${(step.durationMs / 1000).toFixed(2)}s`,
  );
  return step.exitCode;
}

async function verify(
  root: string,
  plan: ReturnType<typeof verificationPlan>,
): Promise<number> {
  const path = verificationReportPath(root);
  const report = createReport(root, plan);
  console.log(`[verify] Report: ${path}`);
  saveVerificationReport(path, report);
  const state: RunState = { child: undefined, interrupted: 0 };
  const onInterrupt = () => {
    state.interrupted = 130;
    state.child?.kill("SIGINT");
  };
  const onTerminate = () => {
    state.interrupted = 143;
    state.child?.kill("SIGTERM");
  };
  process.on("SIGINT", onInterrupt);
  process.on("SIGTERM", onTerminate);
  let exitCode = 0;
  try {
    for (const step of report.steps) {
      if (state.interrupted) {
        exitCode = state.interrupted;
        break;
      }
      step.status = "running";
      saveVerificationReport(path, report);
      exitCode = await runStep(root, step, state);
      saveVerificationReport(path, report);
      if (exitCode !== 0) break;
    }
    report.after = verificationSnapshot(root);
    if (
      report.before.head !== report.after.head ||
      report.before.fingerprint !== report.after.fingerprint
    ) {
      report.error =
        "Git revision or working-tree contents changed during verification; run it again.";
      if (exitCode === 0) exitCode = 1;
    }
  } catch (error) {
    report.error = String(error);
    if (exitCode === 0) exitCode = 1;
  } finally {
    process.off("SIGINT", onInterrupt);
    process.off("SIGTERM", onTerminate);
    for (const step of report.steps) {
      if (step.status === "pending") step.status = "skipped";
    }
    report.status = exitCode === 0 ? "passed" : "failed";
    report.exitCode = exitCode;
    report.finishedAt = new Date().toISOString();
    saveVerificationReport(path, report);
  }
  if (report.error) console.error(`[verify] ${report.error}`);
  console.log(`[verify] ${report.status}; report: ${path}`);
  return exitCode;
}

try {
  const args = process.argv.slice(2);
  if (args.includes("--help") && args.length <= 2) {
    console.log(verificationUsage);
  } else {
    const root = verificationGit(process.cwd(), "rev-parse", "--show-toplevel");
    process.exitCode = await verify(root, verificationPlan(root, args));
  }
} catch (error) {
  console.error(String(error));
  process.exitCode = 1;
}
