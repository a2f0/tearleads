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
    not_found_handling: "none",
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
    expect(versions).toContain(`key = "${tier}/website/terraform.tfstate"`);
    expect(main).not.toContain("terraform_remote_state");
    expect(main).not.toContain("server");
    const server = await read(`terraform/stacks/${tier}/server/main.tf`);
    expect(server).not.toContain("website");
    expect(server).toContain("local.api_hostname");
    expect(server).toContain("local.app_hostname");
  }
});

test("Ansible configures application and demo hosting", async () => {
  const tasks = await read("ansible/playbooks/tasks/staticSites.yml");
  expect(tasks).toContain("path: /var/www/app-web");
  expect(tasks).toContain("path: /var/www/app-demo");
  expect(tasks).toContain("src: etc/nginx/sites-available/app.conf.j2");
});
