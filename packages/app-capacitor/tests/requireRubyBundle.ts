const packageRoot = import.meta.dir.replace(/\/tests$/, "");
const installHint =
  "Run `bundle install` in packages/app-capacitor before running native release checks.";

let bundleCheck: Promise<void> | undefined;

function spawnRubyBundleCheck() {
  try {
    return Bun.spawn(["bundle", "check"], {
      cwd: packageRoot,
      stderr: "pipe",
      stdout: "ignore",
    });
  } catch {
    throw new Error(`Ruby Bundler is unavailable. ${installHint}`);
  }
}

async function checkRubyBundle() {
  const child = spawnRubyBundleCheck();
  const [exitCode, stderr] = await Promise.all([
    child.exited,
    new Response(child.stderr).text(),
  ]);
  if (exitCode !== 0) {
    const detail = stderr.trim();
    throw new Error(
      `The native release Ruby bundle is unavailable. ${installHint}${detail ? `\n${detail}` : ""}`,
    );
  }
}

export function requireRubyBundle() {
  bundleCheck ??= checkRubyBundle();
  return bundleCheck;
}
