import { expect, test } from "bun:test";
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { PRODUCTION_URL_TAGS, STAGING_ROBOTS_META } from "./injectTierMeta";

async function write(path: string, contents: string, executable = false) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents);
  if (executable) await chmod(path, 0o755);
}

async function deployFixture(tier: "staging" | "production", failure = "") {
  const { PATH } = process.env;
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
  TF_VAR_domain=example.test
  SENTRY_STAGING_DSN=https://${"a".repeat(32)}@o1.ingest.us.sentry.io/11
  SENTRY_PRODUCTION_DSN=https://${"b".repeat(32)}@o1.ingest.us.sentry.io/22
  SENTRY_STAGING_PROJECT=web-staging
  SENTRY_PRODUCTION_PROJECT=web-production
  SENTRY_ORG=fixture
  export SENTRY_AUTH_TOKEN=private-upload-token
}
validate_domain_env() { :; }
validate_stripe_env() { :; }
export_wrangler_env() { export CLOUDFLARE_API_TOKEN=fixture-token; }
tier_api_hostname() { case "$1" in staging) echo api-staging.example.test ;; prod) echo api.example.test ;; esac; }
tier_app_hostname() { case "$1" in staging) echo app-staging.example.test ;; prod) echo app.example.test ;; esac; }
tier_demo_hostname() { case "$1" in staging) echo demo-staging.example.test ;; prod) echo demo.example.test ;; esac; }
purge_cloudflare_cache_for_hosts() { printf 'purge|%s\\n' "$*" >> "$WEB_DEPLOY_LOG"; }
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
    join(root, "bin/bun"),
    `#!/bin/bash
set -eu
case "$1 $2" in
  'run build')
    test -z "\${SENTRY_AUTH_TOKEN:-}"
    test "$BUN_PUBLIC_API_BASE_URL" = "https://$WEB_DEPLOY_API_HOSTNAME"
    umask 077
    printf 'build|%s|%s\\n' "$BUN_PUBLIC_APP_VARIANT" "$APP_WEB_TIER" >> "$WEB_DEPLOY_LOG"
    rm -rf dist
    mkdir -p dist/pdfjs/current
    printf '%s' "$BUN_PUBLIC_APP_VARIANT" > dist/index.html
    # Mirrors scripts/injectTierMeta.ts, or breaks it for a failure case.
    case "$APP_WEB_TIER:$WEB_DEPLOY_FAILURE" in
      staging:missing-noindex | prod:missing-canonical) ;;
      staging:staging-canonical | prod:production-noindex)
        printf '%s' '${PRODUCTION_URL_TAGS}${STAGING_ROBOTS_META}' >> dist/index.html ;;
      staging:*) printf '%s' '${STAGING_ROBOTS_META}' >> dist/index.html ;;
      prod:*) printf '%s' '${PRODUCTION_URL_TAGS}' >> dist/index.html ;;
    esac
    printf 'app code' > "dist/chunk-$BUN_PUBLIC_APP_VARIANT.js"
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
    printf 'vendor' > dist/pdfjs/current/pdf.worker.js
    ;;
  'run sentry:cli')
    test "$SENTRY_AUTH_TOKEN" = private-upload-token
    printf 'upload|%s\\n' "$*" >> "$WEB_DEPLOY_LOG"
    for path in "$@"; do
      if [[ -f "$path" ]]; then
        printf '%s\\n' "$path" >> "$WEB_DEPLOY_UPLOADS"
      fi
    done
    if [[ "$WEB_DEPLOY_FAILURE" == upload ]]; then exit 7; fi
    ;;
  'run deploy:app' | 'run deploy:demo')
    test "$CLOUDFLARE_API_TOKEN" = fixture-token
    variant="\${2#deploy:}"
    printf 'publish|%s|%s\n' "$variant" "$4" >> "$WEB_DEPLOY_LOG"
    # Wrangler publishes whatever the staged directory holds at that moment.
    cp -R "dist-$variant" "$WEB_DEPLOY_ROOT/published-$variant"
    ;;
  *) exit 1 ;;
esac
`,
    true,
  );
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
          WEB_DEPLOY_FAILURE: failure,
          WEB_DEPLOY_API_HOSTNAME:
            tier === "staging"
              ? "api-staging.example.test"
              : "api.example.test",
        },
        stdout: "pipe",
        stderr: "pipe",
      }),
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

test.each(["staging", "production"] as const)(
  "%s uploads only the app map pair and publishes each variant from its own staged assets",
  async (tier) => {
    const fixture = await deployFixture(tier);
    const wranglerTier = tier === "staging" ? "staging" : "prod";
    try {
      const result = fixture.run();
      expect(result.exitCode, result.stderr.toString()).toBe(0);
      expect(
        (await readFile(fixture.uploads, "utf8")).trim().split("\n").sort(),
      ).toEqual(["dist/chunk-app.js", "dist/chunk-app.js.map"]);
      for (const variant of ["app", "demo"] as const) {
        const published = join(fixture.root, `published-${variant}`);
        expect(await readFile(join(published, "index.html"), "utf8")).toBe(
          `${variant}${tier === "staging" ? STAGING_ROBOTS_META : PRODUCTION_URL_TAGS}`,
        );
        expect(
          await readFile(join(published, `chunk-${variant}.js`), "utf8"),
        ).toBe("app code");
        expect(await readFile(join(published, ".assetsignore"), "utf8")).toBe(
          "*.map\n",
        );
        const headers = await readFile(join(published, "_headers"), "utf8");
        expect(headers).toContain("/index.html\n  Cache-Control: no-cache");
        expect(headers).toContain("/sw.js\n  Cache-Control: no-cache");
        expect(headers).toContain(
          "/chunk-*\n  Cache-Control: public, max-age=31536000, immutable",
        );
        if (tier === "staging") {
          expect(headers).toEndWith("/*\n  X-Robots-Tag: noindex, nofollow\n");
        } else {
          expect(headers).not.toContain("X-Robots-Tag");
        }
        await expect(
          stat(
            join(published, `chunk-${variant === "app" ? "demo" : "app"}.js`),
          ),
        ).rejects.toThrow();
      }
      const calls = await readFile(fixture.log, "utf8");
      expect(calls).toContain(`build|app|${wranglerTier}`);
      expect(calls).toContain(`build|demo|${wranglerTier}`);
      expect(calls).toContain(`--project web-${tier}`);
      expect(calls).toContain(`--dist ${tier}-app`);
      expect(calls).toContain(`publish|app|${wranglerTier}`);
      expect(calls).toContain(`publish|demo|${wranglerTier}`);
      expect(calls.indexOf("upload|")).toBeLessThan(calls.indexOf("publish|"));
      expect(calls.indexOf("build|demo")).toBeLessThan(
        calls.indexOf("publish|"),
      );
      expect(calls.trim().split("\n").at(-1)).toBe(
        `purge|example.test ${
          tier === "staging"
            ? "app-staging.example.test demo-staging.example.test"
            : "app.example.test demo.example.test"
        }`,
      );
    } finally {
      await fixture.cleanup();
    }
  },
);

test.each([
  ["staging", "missing-map"],
  ["staging", "missing-script"],
  ["staging", "multiple-scripts"],
  ["staging", "upload"],
  ["staging", "missing-noindex"],
  ["staging", "staging-canonical"],
  ["production", "production-noindex"],
  ["production", "missing-canonical"],
] as const)(
  "%s %s failure stops publication before anything is published",
  async (tier, failure) => {
    const fixture = await deployFixture(tier, failure);
    try {
      const result = fixture.run();
      expect(result.exitCode).not.toBe(0);
      const calls = await readFile(fixture.log, "utf8");
      expect(calls).not.toContain("publish|");
      expect(calls).not.toContain("build|demo");
    } finally {
      await fixture.cleanup();
    }
  },
);
