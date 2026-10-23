import { expect, test } from "bun:test";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "../../..");
const read = (path: string) => Bun.file(resolve(root, path)).text();

test("website domains and Workers agree across the two independent stacks", async () => {
  const config = Bun.JSON5.parse(await read("packages/website/wrangler.jsonc"));
  expect(config).toHaveProperty("workers_dev", false);
  expect(config).toHaveProperty("preview_urls", false);
  expect(config).toHaveProperty("assets", {
    directory: "./dist",
    html_handling: "auto-trailing-slash",
    not_found_handling: "404-page",
  });
  expect(config).not.toHaveProperty("main");
  expect(config).not.toHaveProperty("routes");
  for (const tier of ["prod", "staging"]) {
    const main = await read(`terraform/stacks/${tier}/website/main.tf`);
    const versions = await read(`terraform/stacks/${tier}/website/versions.tf`);
    expect(config).toHaveProperty(
      `env.${tier}.name`,
      `tearleads-website-${tier}`,
    );
    expect(main).toMatch(
      new RegExp(`worker_name\\s*= "tearleads-website-${tier}"`),
    );
    expect(main).toMatch(
      tier === "prod"
        ? /hostname\s*= var.domain/
        : /hostname\s*= "website-staging\.\$\{var.domain\}"/,
    );
    expect(versions).toMatch(
      new RegExp(`key\\s+= "${tier}/website/terraform\\.tfstate"`),
    );
    expect(main).not.toContain("terraform_remote_state");
    expect(main).not.toContain("edge");
  }
});

test("edge domains attach the API, app, and demo hostnames to their Workers", async () => {
  const api = Bun.JSON5.parse(await read("packages/api/wrangler.jsonc"));
  expect(api).toHaveProperty("main", "./src/worker/index.ts");
  expect(api).toHaveProperty("workers_dev", false);
  expect(api).toHaveProperty("placement", { region: "aws:us-east-1" });
  expect(api).toHaveProperty("triggers.crons", ["* * * * *", "0 * * * *"]);
  expect(api).not.toHaveProperty("routes");
  for (const tier of ["prod", "staging"]) {
    const main = await read(`terraform/stacks/${tier}/edge/main.tf`);
    const versions = await read(`terraform/stacks/${tier}/edge/versions.tf`);
    const variables = await read(`terraform/stacks/${tier}/edge/variables.tf`);
    expect(api).toHaveProperty(
      `env.${tier}.name`,
      `tearleads-platform-api-${tier}`,
    );
    expect(api).toHaveProperty(`env.${tier}.durable_objects.bindings`, [
      { name: "KEY_VALUE_STORE", class_name: "KeyValueStore" },
      { name: "REALTIME_HUB", class_name: "RealtimeHub" },
    ]);
    // The origins follow TF_VAR_domain at deploy time, not a name here.
    expect(api).not.toHaveProperty(`env.${tier}.vars.API_PUBLIC_ORIGIN`);
    expect(api).not.toHaveProperty(`env.${tier}.vars.API_CORS_ORIGINS`);
    expect(api).not.toHaveProperty(
      `env.${tier}.vars.API_BILLING_RETURN_ORIGINS`,
    );
    expect(variables).toContain(`default     = "${tier}"`);
    expect(versions).toMatch(
      new RegExp(`key\\s+= "${tier}/edge/terraform\\.tfstate"`),
    );
    expect(main).toContain(
      `worker_name           = "tearleads-platform-api-\${var.deployment_tier}"`,
    );
    expect(main).not.toContain("tearleads-website");
    for (const variant of ["app", "demo"]) {
      const assets = Bun.JSON5.parse(
        await read(`packages/app-web/wrangler.${variant}.jsonc`),
      );
      expect(assets).toHaveProperty("workers_dev", false);
      expect(assets).toHaveProperty("assets", {
        directory: `./dist-${variant}`,
        html_handling: "auto-trailing-slash",
        not_found_handling: "single-page-application",
      });
      expect(assets).not.toHaveProperty("main");
      expect(assets).toHaveProperty(
        `env.${tier}.name`,
        `tearleads-${variant}-${tier}`,
      );
      expect(main).toContain(
        `worker_name           = "tearleads-${variant}-\${var.deployment_tier}"`,
      );
    }
  }
});
