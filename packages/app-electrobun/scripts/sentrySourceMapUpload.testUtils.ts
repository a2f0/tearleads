import { expect } from "bun:test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const packageRoot = resolve(import.meta.dirname, "..");

export interface FakeSentry {
  readonly url: string;
  readonly requests: string[];
  readonly authorizations: Set<string>;
  stop(): void;
}

// A loopback stand-in for Sentry's chunked artifact-bundle upload API. A
// failing instance answers every request with a 500.
export function startFakeSentry(
  bundlePath: string,
  failing: boolean,
): FakeSentry {
  const chunks = new Map<string, Uint8Array>();
  const requests: string[] = [];
  const authorizations = new Set<string>();
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const { pathname } = new URL(request.url);
      requests.push(`${request.method} ${pathname}`);
      authorizations.add(request.headers.get("authorization") ?? "");
      if (failing) return new Response("failure", { status: 500 });
      if (pathname.endsWith("/chunk-upload/") && request.method === "GET")
        return Response.json({
          url: new URL(pathname, request.url).href,
          chunkSize: 8388608,
          chunksPerRequest: 64,
          maxFileSize: 2147483648,
          maxRequestSize: 33554432,
          concurrency: 1,
          hashAlgorithm: "sha1",
          compression: [],
          accept: ["artifact_bundles", "artifact_bundles_v2", "sources"],
        });
      if (pathname.endsWith("/chunk-upload/")) {
        for (const [, value] of await request.formData()) {
          if (typeof value === "string") continue;
          const bytes = new Uint8Array(await value.arrayBuffer());
          chunks.set(createHash("sha1").update(bytes).digest("hex"), bytes);
        }
        return new Response("");
      }
      if (pathname.includes("assemble")) {
        const { chunks: ids }: { chunks: string[] } = await request.json();
        const parts = ids.map((id) => chunks.get(id));
        if (parts.some((part) => !part))
          return Response.json({ state: "not_found", missingChunks: ids });
        await Bun.write(
          bundlePath,
          Buffer.concat(parts.filter((part) => part !== undefined)),
        );
        return Response.json({ state: "ok", missingChunks: [], detail: null });
      }
      return Response.json({ detail: "not found" }, { status: 404 });
    },
  });
  return {
    url: `http://127.0.0.1:${server.port}`,
    requests,
    authorizations,
    stop: () => server.stop(true),
  };
}

// Counts TCP connections whatever they speak: direct requests, proxied
// requests and CONNECT tunnels all count.
export function startAttacker() {
  let connections = 0;
  const listener = Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      open(socket) {
        connections += 1;
        socket.end();
      },
      data() {},
    },
  });
  return {
    url: `http://127.0.0.1:${listener.port}`,
    connections: () => connections,
    stop: () => listener.stop(true),
  };
}

export function orgAuthToken(url: string): string {
  const claims = JSON.stringify({ iat: 1, url, org: "test-org" });
  return `sntrys_${Buffer.from(claims).toString("base64")}_${"Q".repeat(43)}`;
}

const proxyNames = [
  "http_proxy",
  "HTTP_PROXY",
  "https_proxy",
  "HTTPS_PROXY",
  "all_proxy",
  "ALL_PROXY",
];

// Every ambient source sentry-cli or Bun reads, pointed at the attacker: rc and
// ini files in HOME, the wrapper's cwd, the package and an ancestor of all of
// them; Bun and sentry-cli dotenv files; and a PATH whose bun and sentry-cli
// exit 0 without uploading.
async function plantHostileConfig(root: string, attacker: string) {
  const rc = `[defaults]\nurl=${attacker}\n[http]\nproxy_url=${attacker}\n`;
  const dotenv = [
    `SENTRY_URL=${attacker}`,
    "SENTRY_ALLOW_FAILURE=1",
    "SENTRY_LOAD_DOTENV=1",
    ...proxyNames.map((name) => `${name}=${attacker}`),
  ].join("\n");
  const files: Record<string, string> = {
    ".sentryclirc": rc,
    "sentry.properties": `defaults.url=${attacker}\nhttp.proxy_url=${attacker}\n`,
    "home/.sentryclirc": rc,
    "home/Library/Application Support/sentry/sentrycli.ini": rc,
    "xdg/sentry/sentrycli.ini": rc,
    "work/.sentryclirc": rc,
    "repo/.env": dotenv,
    "repo/packages/app/.env": dotenv,
    "repo/packages/app/.env.production.local": dotenv,
    "repo/packages/app/.sentryclirc": rc,
  };
  for (const name of [
    ".env",
    ".env.local",
    ".env.production",
    ".env.production.local",
  ])
    files[`work/${name}`] = dotenv;
  for (const [path, content] of Object.entries(files))
    await Bun.write(join(root, path), `${content}\n`);
  for (const name of ["bun", "sentry-cli"]) {
    await Bun.write(join(root, "bin", name), "#!/bin/sh\nexit 0\n");
    await chmod(join(root, "bin", name), 0o755);
  }
  const { PATH } = process.env;
  return {
    ...Object.fromEntries(proxyNames.map((name) => [name, attacker])),
    SENTRY_URL: attacker,
    SENTRY_ALLOW_FAILURE: "1",
    SENTRY_LOAD_DOTENV: "1",
    SENTRY_DOTENV_PATH: join(root, "work/.env"),
    SENTRY_PROPERTIES: join(root, "sentry.properties"),
    SENTRY_BINARY_PATH: join(root, "bin/sentry-cli"),
    XDG_CONFIG_HOME: join(root, "xdg"),
    NODE_ENV: "production",
    HOME: join(root, "home"),
    PATH: `${join(root, "bin")}:${PATH ?? ""}`,
  };
}

function git(cwd: string, ...args: string[]) {
  const env = { ...process.env };
  for (const name of Object.keys(env))
    if (name.startsWith("GIT_")) delete env[name];
  execFileSync(
    "git",
    [
      "-c",
      "commit.gpgsign=false",
      "-c",
      "core.hooksPath=/dev/null",
      "-c",
      "user.name=Sentry test",
      "-c",
      "user.email=sentry-test@example.invalid",
      ...args,
    ],
    { cwd, env, stdio: "ignore" },
  );
}

// A committed checkout shaped like this one: tier secrets, and a package with
// the manifest script and dependencies a Bun-launched sentry-cli would use.
async function createRepository(repoRoot: string, token: string) {
  const dsn = `https://${"a".repeat(32)}@o1.ingest.us.sentry.io/1`;
  await Bun.write(
    join(repoRoot, ".gitignore"),
    ".secrets/\nbuild/\nnode_modules\n.env*\n.sentryclirc\n",
  );
  await Bun.write(
    join(repoRoot, "packages/app/package.json"),
    JSON.stringify({ private: true, scripts: { "sentry:cli": "sentry-cli" } }),
  );
  await symlink(
    join(packageRoot, "node_modules"),
    join(repoRoot, "packages/app/node_modules"),
  );
  await Bun.write(
    join(repoRoot, ".secrets/root.env"),
    `SENTRY_ORG=test-org\nSENTRY_AUTH_TOKEN=${token}\n`,
  );
  await Bun.write(
    join(repoRoot, ".secrets/staging.env"),
    `SENTRY_ELECTROBUN_STAGING_PROJECT=tearleads-electrobun-staging\nSENTRY_ELECTROBUN_STAGING_DSN=${dsn}\n`,
  );
  git(repoRoot, "init", "--quiet");
  git(repoRoot, "add", ".");
  git(repoRoot, "commit", "--quiet", "-m", "Fixture");
}

// The build command: stage the renderer chunk and main-process bundle, with
// external maps, where the wrapper told the packaging hook to.
const stageScript = `import { join } from "node:path";
const directory = process.env.TEARLEADS_ELECTROBUN_SOURCEMAP_DIR;
if (!directory) throw new Error("No source-map staging directory");
await Bun.write(join(import.meta.dirname, "built"), "");
for (const [entry, naming, target] of [
  ["renderer.ts", "chunk-a1b2c3.js", "browser"],
  ["main.ts", "bun/index.js", "bun"],
]) {
  const build = await Bun.build({
    entrypoints: [join(import.meta.dirname, "sources", entry)],
    outdir: directory, naming, target, sourcemap: "external",
  });
  if (!build.success) process.exit(1);
}
`;

const harnessScript = (
  wrapper: string,
) => `import { runDesktopSentryRelease } from ${JSON.stringify(wrapper)};
const [intended, packageRoot, repoRoot, stage] = process.argv.slice(2);
const root = new URL(intended).origin + "/";
process.exit(await runDesktopSentryRelease({
  packageRoot, repoRoot, command: [process.execPath, stage], env: process.env,
  endpoint: { url: root, isAllowed: (url) => url.href === root },
}));
`;

export interface ReleaseRun {
  readonly code: number;
  readonly output: string;
  readonly built: boolean;
  readonly packageRoot: string;
}

// Runs withSentryReleaseEnv.ts's release flow in a Bun subprocess whose cwd,
// HOME, environment, PATH and every ancestor carry hostile Sentry settings,
// with the loopback intended server as its only allowed endpoint.
export async function runHostileRelease(options: {
  intended: string;
  attacker: string;
  token: string;
  tmpUnderHostileAncestor?: boolean;
}): Promise<ReleaseRun> {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "desktop-release-")),
  );
  const cleanTmp = await realpath(
    await mkdtemp(join(tmpdir(), "desktop-tmp-")),
  );
  try {
    const env = await plantHostileConfig(root, options.attacker);
    const repoRoot = join(root, "repo");
    await createRepository(repoRoot, options.token);
    await Bun.write(
      join(root, "sources/renderer.ts"),
      "export const render = () => document.title;\nconsole.log(render());\n",
    );
    await Bun.write(
      join(root, "sources/main.ts"),
      "export const main = () => process.pid;\nconsole.log(main());\n",
    );
    await Bun.write(join(root, "stage.ts"), stageScript);
    await Bun.write(
      join(root, "harness.ts"),
      harnessScript(join(import.meta.dirname, "withSentryReleaseEnv.ts")),
    );
    const tmp = options.tmpUnderHostileAncestor ? join(root, "tmp") : cleanTmp;
    await Bun.write(join(tmp, ".keep"), "");
    const packageDir = join(repoRoot, "packages/app");
    const child = Bun.spawn(
      [
        process.execPath,
        join(root, "harness.ts"),
        options.intended,
        packageDir,
        repoRoot,
        join(root, "stage.ts"),
      ],
      {
        cwd: join(root, "work"),
        env: { ...env, TMPDIR: tmp, ELECTROBUN_RELEASE_TIER: "staging" },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    const built = await Bun.file(join(root, "built")).exists();
    const staged = await Bun.file(
      join(packageDir, "build/sentry-sourcemaps/bun/index.js"),
    ).exists();
    expect(staged).toBe(false);
    return { code, output: stdout + stderr, built, packageRoot: packageDir };
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(cleanTmp, { recursive: true, force: true });
  }
}
