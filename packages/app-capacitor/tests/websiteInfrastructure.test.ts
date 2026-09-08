import { expect, test } from "bun:test";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "../../..");
const read = (path: string) => Bun.file(resolve(root, path)).text();

test("website domains and Workers agree across the two independent stacks", async () => {
  const config = JSON.parse(await read("packages/website/wrangler.jsonc"));
  expect(config.workers_dev).toBe(false);
  expect(config.preview_urls).toBe(false);
  expect(config.assets).toEqual({
    directory: "./dist",
    html_handling: "auto-trailing-slash",
    not_found_handling: "404-page",
  });
  expect(config).not.toHaveProperty("main");
  expect(config).not.toHaveProperty("routes");
  for (const tier of ["prod", "staging"]) {
    const main = await read(`terraform/stacks/${tier}/website/main.tf`);
    const versions = await read(`terraform/stacks/${tier}/website/versions.tf`);
    expect(config.env[tier].name).toBe(`tearleads-website-${tier}`);
    expect(main).toMatch(
      new RegExp(`worker_name\\s*= "${config.env[tier].name}"`),
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

test("Ansible removes only the obsolete website files and retains app hosting", async () => {
  const tasks = await read("ansible/playbooks/tasks/staticSites.yml");
  const cleanup = tasks.slice(
    tasks.indexOf("- name: Remove obsolete server-hosted website files"),
  );
  expect(cleanup).toContain("state: absent");
  expect(cleanup.match(/^ {4}- .+$/gm)).toEqual([
    "    - /etc/nginx/sites-enabled/website.conf",
    "    - /etc/nginx/sites-available/website.conf",
    "    - /var/www/website",
  ]);
  expect(cleanup).toContain("notify: Reload nginx");
  expect(tasks).toContain("path: /var/www/app-web");
  expect(tasks).toContain("path: /var/www/app-demo");
  expect(tasks).toContain("src: etc/nginx/sites-available/app.conf.j2");
  expect(
    await Bun.file(
      resolve(
        root,
        "ansible/playbooks/templates/etc/nginx/sites-available/website.conf.j2",
      ),
    ).exists(),
  ).toBe(false);
});
