/**
 * Builds the Lean proof package in formal/lean, which kernel-checks every
 * theorem in it, and regenerates formal/lean/vectors/transparency.json from
 * its vector exporter. `--check` verifies the committed fixture matches
 * instead of writing it. The replay suite
 * (packages/crypto/src/keying/transparencyLeanVectors.test.ts) drives the
 * fixture through the production generator and verifiers.
 */
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import {
  checkProofEscapes,
  LEAN_PROJECT,
  resolveLeanTools,
  runLake,
} from "./leanTools";

const FIXTURE_PATH = `${LEAN_PROJECT}/vectors/transparency.json`;

function fail(message: string): never {
  console.error(`Error: ${message}`);
  process.exit(1);
}

function repoRoot(): string {
  const result = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    fail("the vector generator must run inside a Git repository.");
  }
  return result.stdout.trim();
}

const arguments_ = process.argv.slice(2);
if (
  arguments_.length > 1 ||
  (arguments_.length === 1 && arguments_[0] !== "--check")
) {
  fail("Usage: bun scripts/protocol/generateTransparencyVectors.ts [--check]");
}

const root = repoRoot();
const tools = resolveLeanTools(root);
checkProofEscapes(root);

const build = runLake(root, tools, ["build", "--wfail"]);
if (!build.ok) {
  fail(`lake build failed:\n${build.output}`);
}
const exported = runLake(root, tools, ["exe", "transparency-vectors"]);
if (!exported.ok) {
  fail(`the vector exporter failed:\n${exported.output}`);
}

const fixtureFile = Bun.file(join(root, FIXTURE_PATH));
if (arguments_[0] === "--check") {
  const actual = (await fixtureFile.exists()) ? await fixtureFile.text() : null;
  if (actual !== exported.stdout) {
    fail(
      `${FIXTURE_PATH} is stale; run \`bun run generate:protocol-proof-vectors\` and commit the result.`,
    );
  }
  console.log(`Lean proofs build and ${FIXTURE_PATH} is current.`);
} else {
  await Bun.write(fixtureFile, exported.stdout);
  console.log(`Wrote ${FIXTURE_PATH}.`);
}
