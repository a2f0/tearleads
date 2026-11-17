import { cruise, format } from "dependency-cruiser";
import type { ArchitectureCheckResult } from "./checkFactories";
import { findStaleTestTierBaselineEntries } from "./clientSdkTestTierBaseline";
import testTierBaseline from "./clientSdkTestTierBaseline.json";
import { clientSdkTestTierRules } from "./dependencyCruiserClientSdkRules";
import {
  createDependencyCruiserOptions,
  dependencyCruiserEntryPoints,
} from "./dependencyCruiserConfig";
import { findDependencyCruiserGraphHealthViolations } from "./dependencyCruiserGraphHealth";

export async function runDependencyCruiserCheck(): Promise<ArchitectureCheckResult> {
  const result = await cruise(
    dependencyCruiserEntryPoints,
    createDependencyCruiserOptions(),
  );
  if (typeof result.output === "string") {
    const rawOutput = result.output.trim();
    return {
      failed: true,
      output: [
        "error dependency-cruiser: expected an analyzable graph result",
        rawOutput,
      ]
        .filter((value) => value.length > 0)
        .join("\n"),
    };
  }

  const graphHealthViolations = findDependencyCruiserGraphHealthViolations(
    result.output,
    dependencyCruiserEntryPoints,
  );
  const staleTestTierEntries = findStaleTestTierBaselineEntries(
    result.output,
    clientSdkTestTierRules,
    testTierBaseline,
  );
  const formattedResult = await format(result.output, { outputType: "err" });
  const formattedOutput =
    typeof formattedResult.output === "string"
      ? formattedResult.output.trim()
      : "";
  const graphHealthOutput =
    graphHealthViolations.length === 0
      ? ""
      : [
          "error dependency-cruiser-graph-is-complete: dependency-cruiser must retain every workspace plus known npm and cross-workspace edges.",
          ...graphHealthViolations.map((violation) => `  ${violation}`),
        ].join("\n");
  const staleTestTierOutput =
    staleTestTierEntries.length === 0
      ? ""
      : [
          "error client-sdk-test-tier-baseline-is-current: the test-tier baseline only shrinks; drop entries that no longer violate.",
          ...staleTestTierEntries.map((entry) => `  ${entry}`),
        ].join("\n");
  const output = [formattedOutput, graphHealthOutput, staleTestTierOutput]
    .filter((value) => value.length > 0)
    .join("\n");

  return {
    failed:
      formattedResult.exitCode !== 0 ||
      graphHealthViolations.length > 0 ||
      staleTestTierEntries.length > 0,
    output,
  };
}
