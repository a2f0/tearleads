import { expect, test } from "bun:test";
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

async function write(path: string, contents: string, executable = false) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents);
  if (executable) await chmod(path, 0o755);
}

async function deployFixture(tier: "staging" | "production", failure = "") {
  const { PATH } = process.env;
  const rsync = Bun.which("rsync");
  if (!rsync) throw new Error("rsync is required for deployment tests");
  const root = await mkdtemp(join(tmpdir(), "tearleads-web-deploy-"));
  const scripts = join(root, "packages/app-web/scripts");
  const log = join(root, "commands.log");
  const uploads = join(root, "uploads.log");
  const suffix = tier === "staging" ? "Staging" : "Production";
  await mkdir(scripts, { recursive: true });
  for (const name of [
    "deployAppWeb.sh",
    "sentryEnv.sh",
    `deploy${suffix}AppWeb.sh`,
  ]) {
    await copyFile(join(import.meta.dir, name), join(scripts, name));
    await chmod(join(scripts, name), 0o755);
  }
  await write(
    join(root, "terraform/scripts/common.sh"),
    `load_secrets_env() {
  SSH_TARGET=deploy@fixture
  TF_VAR_domain=example.test
  SENTRY_STAGING_DSN=https://${"a".repeat(32)}@o1.ingest.us.sentry.io/11
  SENTRY_PRODUCTION_DSN=https://${"b".repeat(32)}@o1.ingest.us.sentry.io/22
  SENTRY_STAGING_PROJECT=web-staging
  SENTRY_PRODUCTION_PROJECT=web-production
  SENTRY_ORG=fixture
  export SENTRY_AUTH_TOKEN=private-upload-token
}
validate_aws_env() { :; }
validate_stripe_env() { :; }
purge_cloudflare_cache_for_hosts() { :; }
`,
  );
  await write(
    join(root, "bin/git"),
    `#!/bin/sh
case "$*" in
  'rev-parse --show-toplevel') printf '%s\\n' "$WEB_DEPLOY_ROOT" ;;
  'rev-parse HEAD') printf '%040d\\n' 1 ;;
  *) exit 1 ;;
esac
`,
    true,
  );
  await write(
    join(root, "bin/ssh"),
    '#!/bin/sh\nprintf "ssh|%s\\n" "$*" >> "$WEB_DEPLOY_LOG"\n',
    true,
  );
  await write(
    join(root, "bin/bun"),
    `#!/bin/bash
set -eu
case "$1 $2" in
  'run build')
    test -z "\${SENTRY_AUTH_TOKEN:-}"
    printf 'build|%s\\n' "$BUN_PUBLIC_APP_VARIANT" >> "$WEB_DEPLOY_LOG"
    rm -rf dist
    mkdir -p dist/pdfjs/current
    printf '%s' "$BUN_PUBLIC_APP_VARIANT" > dist/index.html
    printf 'app code' > "dist/chunk-$BUN_PUBLIC_APP_VARIANT.js"
    case "$BUN_PUBLIC_APP_VARIANT" in app) destination=app-web ;; demo) destination=app-demo ;; esac
    touch -r "$WEB_DEPLOY_ROOT/remote/$destination/chunk-$BUN_PUBLIC_APP_VARIANT.js" "dist/chunk-$BUN_PUBLIC_APP_VARIANT.js"
    if [[ "$WEB_DEPLOY_FAILURE" == missing-script ]]; then
      rm "dist/chunk-$BUN_PUBLIC_APP_VARIANT.js"
    elif [[ "$WEB_DEPLOY_FAILURE" == multiple-scripts ]]; then
      printf 'unexpected entry' > dist/chunk-other.js
    fi
    if [[ "$WEB_DEPLOY_FAILURE" != missing-map ]]; then
      printf '{}' > "dist/chunk-$BUN_PUBLIC_APP_VARIANT.js.map"
    fi
    printf 'sqlite' > dist/worker.js
    printf 'cache' > dist/sw.js
    printf 'unchanged vendor' > dist/pdfjs/current/pdf.worker.js
    ;;
  'run sentry:cli')
    test "$SENTRY_AUTH_TOKEN" = private-upload-token
    printf 'upload|%s\\n' "$*" >> "$WEB_DEPLOY_LOG"
    for path in "$@"; do
      if [[ -d "$path" ]]; then
        find "$path" -type f \\( -name '*.js' -o -name '*.map' \\) >> "$WEB_DEPLOY_UPLOADS"
      elif [[ -f "$path" ]]; then
        printf '%s\\n' "$path" >> "$WEB_DEPLOY_UPLOADS"
      fi
    done
    if [[ "$WEB_DEPLOY_FAILURE" == upload ]]; then exit 7; fi
    ;;
  *) exit 1 ;;
esac
`,
    true,
  );
  await write(
    join(root, "bin/rsync"),
    `#!/bin/bash
set -eu
printf 'copy|%s\\n' "$*" >> "$WEB_DEPLOY_LOG"
args=()
for arg in "$@"; do
  case "$arg" in
    --rsync-path=*) ;;
    deploy@fixture:*) args+=("$WEB_DEPLOY_ROOT/remote/\${arg##*/var/www/}") ;;
    *) args+=("$arg") ;;
  esac
done
exec "$WEB_DEPLOY_RSYNC" "\${args[@]}"
`,
    true,
  );
  for (const variant of ["app-web", "app-demo"]) {
    const destination = join(root, "remote", variant);
    await write(
      join(destination, "pdfjs/current/pdf.worker.js"),
      "unchanged vendor",
    );
    await utimes(join(destination, "pdfjs/current/pdf.worker.js"), 1, 1);
    await write(
      join(destination, "pdfjs/old/pdf.worker.js"),
      "obsolete vendor",
    );
    await write(
      join(destination, "pdfjs/current/leaked.js.map"),
      "private source",
    );
    await write(join(destination, "old.js.map"), "private source");
    await write(join(destination, "old.js"), "obsolete app");
    const entry = join(
      destination,
      `chunk-${variant === "app-web" ? "app" : "demo"}.js`,
    );
    // A same-size, same-time file must still be replaced if its bytes differ.
    await write(entry, "bad code");
    await utimes(entry, 1, 1);
  }
  return {
    root,
    log,
    uploads,
    run: () =>
      Bun.spawnSync([join(scripts, `deploy${suffix}AppWeb.sh`)], {
        cwd: root,
        env: {
          PATH: `${join(root, "bin")}:${PATH ?? ""}`,
          WEB_DEPLOY_ROOT: root,
          WEB_DEPLOY_LOG: log,
          WEB_DEPLOY_UPLOADS: uploads,
          WEB_DEPLOY_RSYNC: rsync,
          WEB_DEPLOY_FAILURE: failure,
        },
        stdout: "pipe",
        stderr: "pipe",
      }),
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

test.each(["staging", "production"] as const)(
  "%s uploads only the app map pair and publishes current assets without recopying identical bytes",
  async (tier) => {
    const fixture = await deployFixture(tier);
    try {
      const vendor = join(
        fixture.root,
        "remote/app-web/pdfjs/current/pdf.worker.js",
      );
      const before = await stat(vendor);
      const result = fixture.run();
      expect(result.exitCode, result.stderr.toString()).toBe(0);
      expect(
        (await readFile(fixture.uploads, "utf8")).trim().split("\n").sort(),
      ).toEqual(["dist/chunk-app.js", "dist/chunk-app.js.map"]);
      expect((await stat(vendor)).ino).toBe(before.ino);
      for (const [directory, variant] of [
        ["app-web", "app"],
        ["app-demo", "demo"],
      ] as const) {
        const destination = join(fixture.root, "remote", directory);
        expect(await readFile(join(destination, "index.html"), "utf8")).toBe(
          variant,
        );
        expect(
          await readFile(join(destination, `chunk-${variant}.js`), "utf8"),
        ).toBe("app code");
        for (const removed of [
          "old.js",
          "old.js.map",
          `chunk-${variant}.js.map`,
          "pdfjs/old",
          "pdfjs/current/leaked.js.map",
        ])
          await expect(stat(join(destination, removed))).rejects.toThrow();
      }
      const calls = await readFile(fixture.log, "utf8");
      expect(calls).toContain(`--project web-${tier}`);
      expect(calls).toContain(`--dist ${tier}-app`);
      expect(calls.indexOf("upload|")).toBeLessThan(calls.indexOf("copy|"));
    } finally {
      await fixture.cleanup();
    }
  },
);

test.each(["missing-map", "missing-script", "multiple-scripts", "upload"])(
  "%s failure stops publication before any app files are copied",
  async (failure) => {
    const fixture = await deployFixture("staging", failure);
    try {
      const result = fixture.run();
      expect(result.exitCode).not.toBe(0);
      const calls = await readFile(fixture.log, "utf8");
      expect(calls).not.toContain("copy|");
      expect(calls).not.toContain("build|demo");
    } finally {
      await fixture.cleanup();
    }
  },
);
