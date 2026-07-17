import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import wasm from "vite-plugin-wasm";

// Build identity for the System Monitor's Environment tab and support report.
// The web and electrobun targets get these from scripts/withBuildInfoEnv.sh,
// which exports `BUN_PUBLIC_*` for Bun's bundler to inline; Vite has no
// equivalent passthrough, so this config resolves the same two values and
// `define`s them. Both degrade to "unknown" rather than failing the build, since
// a release can be built from a source tarball with no .git directory.
const UNKNOWN_BUILD_VALUE = "unknown";

function readGitCommit(): string {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd: import.meta.dirname,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return UNKNOWN_BUILD_VALUE;
  }
}

function readAppVersion(): string {
  try {
    const { version } = createRequire(import.meta.url)("./package.json") as {
      version?: string;
    };
    return version ?? UNKNOWN_BUILD_VALUE;
  } catch {
    return UNKNOWN_BUILD_VALUE;
  }
}

// Published through process.env rather than `define`: Vite resolves
// `import.meta.env.*` itself from its own env object, and a `define` for those
// keys is ignored. Vite folds VITE_-prefixed process.env vars into that object,
// so setting them here is what actually reaches the bundle.
Object.assign(process.env, {
  VITE_APP_VERSION: readAppVersion(),
  VITE_GIT_SHA: readGitCommit(),
});

export default defineConfig({
  plugins: [react(), wasm()],
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "src"),
    },
  },
  server: {
    host: "127.0.0.1",
    port: 3000,
    strictPort: true,
  },
  worker: {
    format: "es",
  },
  build: {
    outDir: "dist",
    target: "esnext",
  },
});
