import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildPackage } from "./buildPackage";

// Installs the packed package into a fresh project, outside this workspace,
// and uses it there: proof that what npm receives works on its own (module
// resolution under Bun and Node, declarations under bundler and nodenext
// resolution, and a browser bundle) before anyone publishes it.
const workDir = mkdtempSync(join(tmpdir(), "client-sdk-smoke-"));

// The consumer typechecks with the TypeScript the workspace pins.
const { devDependencies }: { devDependencies: { typescript: string } } =
  JSON.parse(
    readFileSync(
      join(import.meta.dir, "..", "..", "..", "package.json"),
      "utf8",
    ),
  );

function run(command: string[], cwd: string) {
  const [executable, ...args] = command;
  if (!executable) {
    throw new Error("empty command");
  }
  const result = spawnSync(executable, args, { cwd, stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`${command.join(" ")} exited with ${result.status}`);
  }
}

const smokeTest = `import { expect, test } from "bun:test";
import { createDocumentSignerDeviceId, Tearleads } from "@tearleads/client-sdk";
import { purgeOpfsSqliteDatabase } from "@tearleads/client-sdk/sqlite";
import { trustedUserIdentityFromResponse } from "@tearleads/client-sdk/testing";

test("the published package creates a client", () => {
  const tearleads = new Tearleads();
  expect(tearleads.apiVersion.current).toBeNull();
  expect(createDocumentSignerDeviceId("abc")).toBe("signing-key:abc");
});

test("the published SQLite entry purges nothing without OPFS", async () => {
  await expect(purgeOpfsSqliteDatabase("smoke.db")).resolves.toBeUndefined();
});

test("the published testing entry decodes an identity response", () => {
  const identity = trustedUserIdentityFromResponse({
    encapsulationKeyFingerprint: "encapsulation",
    encapsulationPublicKey: "AQI=",
    signingKeyFingerprint: "signing",
    signingPublicKey: "AwQ=",
    userId: "user-1",
  });
  expect([...identity.signingPublicKey]).toEqual([3, 4]);
});
`;

// Node resolves ES modules strictly: every relative import needs its
// extension, and every bare one a declared dependency.
const nodeImports = `await import("@tearleads/client-sdk");
await import("@tearleads/client-sdk/sqlite");
await import("@tearleads/client-sdk/testing");
`;

const typecheckSource = `import { Tearleads } from "@tearleads/client-sdk";
import {
  createSQLiteRuntimeFromWorker,
  type SQLiteRuntime,
} from "@tearleads/client-sdk/sqlite";
import { createTestTrustedUserIdentity } from "@tearleads/client-sdk/testing";

export const tearleads = new Tearleads();
export const runtime: (worker: Worker) => SQLiteRuntime =
  createSQLiteRuntimeFromWorker;
export const identity = createTestTrustedUserIdentity({
  signingKeyFingerprint: "signing",
  signingPublicKey: new Uint8Array(),
  userId: "user-1",
});
`;

// TypeScript's defaults check every declaration a consumer's program reaches.
function consumerTsconfig(module: string, moduleResolution: string) {
  return JSON.stringify({
    compilerOptions: {
      lib: ["ESNext", "DOM"],
      module,
      moduleResolution,
      noEmit: true,
      noUncheckedSideEffectImports: true,
      skipLibCheck: false,
      strict: true,
      target: "es2022",
      types: [],
    },
    include: ["typecheck.ts"],
  });
}

const bundleEntry = `import { Tearleads } from "@tearleads/client-sdk";
import { purgeOpfsSqliteDatabase } from "@tearleads/client-sdk/sqlite";
console.log(Tearleads, purgeOpfsSqliteDatabase);
`;

function writeConsumer(projectDir: string, tarball: string) {
  mkdirSync(projectDir);
  const files: Record<string, string> = {
    "package.json": JSON.stringify({
      dependencies: { "@tearleads/client-sdk": `file:${tarball}` },
      devDependencies: { typescript: devDependencies.typescript },
      name: "client-sdk-smoke-consumer",
      private: true,
      type: "module",
    }),
    "smoke.test.js": smokeTest,
    "node-imports.mjs": nodeImports,
    "typecheck.ts": typecheckSource,
    "tsconfig.bundler.json": consumerTsconfig("esnext", "bundler"),
    "tsconfig.nodenext.json": consumerTsconfig("nodenext", "nodenext"),
    "bundle-entry.js": bundleEntry,
  };
  for (const [name, contents] of Object.entries(files)) {
    writeFileSync(join(projectDir, name), contents);
  }
}

// drizzle-orm's and loro-crdt's own declarations do not typecheck without
// skipLibCheck, which would also skip the SDK's. Check everything, then fail
// on errors in the consumer or the SDK and ignore the rest.
function typecheck(projectDir: string, tsconfig: string) {
  const result = spawnSync("bun", ["x", "tsc", "-p", tsconfig], {
    cwd: projectDir,
    encoding: "utf8",
  });
  if (result.error) {
    throw result.error;
  }
  const diagnostics = result.stdout
    .split("\n")
    .filter((line) => /\berror TS\d+:/.test(line));
  const errors = diagnostics.filter(
    (line) =>
      !line.startsWith("node_modules/") ||
      line.startsWith("node_modules/@tearleads/"),
  );
  // A failure without diagnostics means tsc itself did not run.
  if (errors.length > 0 || (result.status !== 0 && diagnostics.length === 0)) {
    throw new Error(
      `${tsconfig} failed:\n${errors.join("\n") || result.stderr}`,
    );
  }
}

try {
  const distDir = join(workDir, "dist");
  await buildPackage(distDir);
  run(["npm", "pack", "--pack-destination", workDir], distDir);
  const tarball = readdirSync(workDir).find((file) => file.endsWith(".tgz"));
  if (!tarball) {
    throw new Error("npm pack produced no tarball");
  }

  const projectDir = join(workDir, "consumer");
  writeConsumer(projectDir, join(workDir, tarball));
  run(["bun", "install"], projectDir);
  run(["bun", "test"], projectDir);
  run(["node", "node-imports.mjs"], projectDir);
  typecheck(projectDir, "tsconfig.bundler.json");
  typecheck(projectDir, "tsconfig.nodenext.json");
  run(
    [
      "bun",
      "build",
      "bundle-entry.js",
      "--target",
      "browser",
      "--outdir",
      "bundle",
    ],
    projectDir,
  );
  console.log(
    "Smoke test passed: the packed package installs, runs under Bun and Node, typechecks, and bundles.",
  );
} finally {
  rmSync(workDir, { force: true, recursive: true });
}
