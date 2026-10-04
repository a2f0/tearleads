import { spawnSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";

const packageRoot = join(import.meta.dir, "..");
const registry = "https://registry.npmjs.org";

// Every version npm has for the package, and its latest tag.
export interface RegistryState {
  latest: string;
  versions: string[];
}

export interface PublishDecision {
  publish: boolean;
  reason: string;
}

// npm publishes only full versions; Bun's comparator also accepts "1.0".
const versionPattern =
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

// CI publishes only a version newer than npm's latest. A merge that keeps the
// version, a re-run, and a run that finishes after a newer release succeed
// without publishing, so the latest tag never moves backwards.
export function decidePublish(
  version: string,
  state: RegistryState,
): PublishDecision {
  if (!versionPattern.test(version)) {
    throw new Error(`invalid package version: ${JSON.stringify(version)}`);
  }
  if (state.versions.includes(version)) {
    return { publish: false, reason: `${version} is already on npm` };
  }
  if (Bun.semver.order(version, state.latest) <= 0) {
    return {
      publish: false,
      reason: `${version} is not newer than npm's latest (${state.latest})`,
    };
  }
  return {
    publish: true,
    reason: `${version} is newer than npm's latest (${state.latest})`,
  };
}

// Parses `npm view <name> versions dist-tags --json`, which prints versions as
// a string rather than an array when only one exists.
export function parseRegistryState(json: string): RegistryState {
  const view = JSON.parse(json);
  const versions: unknown = view?.versions;
  const latest: unknown = view?.["dist-tags"]?.latest;
  const list = typeof versions === "string" ? [versions] : versions;
  if (
    typeof latest !== "string" ||
    !Array.isArray(list) ||
    !list.every((version) => typeof version === "string")
  ) {
    throw new Error(`unexpected npm view output: ${json}`);
  }
  return { latest, versions: list };
}

function readRegistryState(name: string): RegistryState {
  // A scope registry overrides --registry, so pin the scope as well.
  const result = spawnSync(
    "npm",
    [
      "view",
      name,
      "versions",
      "dist-tags",
      "--json",
      "--registry",
      registry,
      `--${name.split("/")[0]}:registry=${registry}`,
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
  );
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`npm view ${name} exited with ${result.status}`);
  }
  return parseRegistryState(result.stdout);
}

// Prints the decision and, in GitHub Actions, sets the step's publish output.
if (import.meta.main) {
  const { name, version } = JSON.parse(
    readFileSync(join(packageRoot, "package.json"), "utf8"),
  );
  const decision = decidePublish(version, readRegistryState(name));
  console.log(
    decision.publish
      ? `Publishing ${name}: ${decision.reason}.`
      : `::notice::Not publishing ${name}: ${decision.reason}.`,
  );
  const { GITHUB_OUTPUT: output } = process.env;
  if (output) {
    appendFileSync(output, `publish=${decision.publish}\n`);
  }
}
