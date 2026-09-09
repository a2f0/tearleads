import { basename, dirname, resolve } from "node:path";
import {
  resolveSentryConfig,
  type SentryInput,
} from "../src/diagnostics/sentryConfig";

export function assertSentryBuildOutput(
  input: Omit<SentryInput, "origin" | "scriptUrl">,
  outputDir: string,
  outputPaths: readonly string[],
) {
  if (!input.dsn || input.variant !== "app") return;
  const scripts = outputPaths.filter((path) => path.endsWith(".js"));
  const script = scripts[0];
  if (
    scripts.length !== 1 ||
    !script ||
    dirname(resolve(script)) !== resolve(outputDir) ||
    !resolveSentryConfig({
      ...input,
      origin: "https://app.invalid",
      scriptUrl: `https://app.invalid/${basename(script)}`,
    })
  ) {
    throw new Error(
      "Invalid Sentry build: check the tier configuration and supported single JavaScript entry filename.",
    );
  }
}
