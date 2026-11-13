// Executable stand-in for provider/deployment CLIs; never imports application code.

import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";

const { SOFT_RESET_FIXTURE: root, TEARLEADS_TEARDOWN_TIER: teardownTier } =
  process.env;
if (!root) throw new Error("fixture only");
const tool = basename(process.argv[2] ?? "");
const args = process.argv.slice(3);
appendFileSync(
  join(root, "calls.jsonl"),
  `${JSON.stringify([tool, ...args])}\n`,
);
appendFileSync(
  join(root, "teardown-tier.jsonl"),
  `${JSON.stringify({ tool, tier: teardownTier ?? null })}\n`,
);
const account = "a".repeat(32);
const tier = readFileSync(join(root, "tier"), "utf8");
const database = `tearleads-${tier}`;
const bucket = `tearleads-blobs-${tier}`;
const postgres = {
  "restapi_object.database": {
    path: "/organizations/tearleads/databases",
    data: JSON.stringify({ name: database, kind: "postgresql" }),
    id: database,
  },
  "restapi_object.main_protection": {
    path: `/organizations/tearleads/databases/${database}/branches/main`,
    object_id: "main",
  },
  "planetscale_postgres_branch_role.runtime": {
    organization: "tearleads",
    database,
    branch: "main",
    name: "tearleads-runtime",
    access_host_url: "fixture.psdb.cloud",
    database_name: database,
    username: "runtime",
  },
  "planetscale_postgres_branch_role.migrations": {
    organization: "tearleads",
    database,
    branch: "main",
    name: "tearleads-migrations",
    access_host_url: "fixture.psdb.cloud",
    database_name: database,
    username: "migrations",
    password: "SECRET_CANARY",
  },
  "cloudflare_hyperdrive_config.api": {
    account_id: account,
    name: `tearleads-api-${tier}`,
  },
};
const storage = {
  "cloudflare_r2_bucket.blobs": { account_id: account, name: bucket },
  "module.storage.cloudflare_r2_managed_domain.storage": {
    account_id: account,
    bucket_name: bucket,
  },
  "module.storage.cloudflare_r2_bucket_lifecycle.storage": {
    account_id: account,
    bucket_name: bucket,
  },
  "module.storage.cloudflare_r2_bucket_cors.downloads[0]": {
    account_id: account,
    bucket_name: bucket,
  },
  "module.storage.cloudflare_account_token.objects": {
    account_id: account,
    name: `${bucket}-objects`,
    policies: [
      {
        effect: "allow",
        permission_groups: [{ id: "2efd5506f9c8494dacb1fa10a3e7d5b6" }],
        resources: JSON.stringify({
          [`com.cloudflare.edge.r2.bucket.${account}_default_${bucket}`]: "*",
        }),
      },
    ],
  },
};
const fault = (name: string) => existsSync(join(root, name));
if (fault("fail") && readFileSync(join(root, "fail"), "utf8") === tool) {
  console.error("SECRET_CANARY");
  process.exit(9);
}
function output(value: unknown) {
  console.log(JSON.stringify(value));
}
if (
  tool === "bun" &&
  args.includes("build") &&
  args.some((arg) => arg.endsWith("/packages/website")) &&
  fault("fail-website")
) {
  console.error("Screenshot provenance is incomplete.");
  process.exit(7);
}
if (tool === "deployApiMaintenance.sh" && fault("dirty-during-maintenance"))
  writeFileSync(join(root, "repo/package.json"), '{"changed":true}');
if (tool === "deployApiMaintenance.sh" && fault("replace-lock")) {
  const lock = join(root, "home/.local/state/tearleads-soft-reset/prod.lock");
  renameSync(lock, join(root, "original-lock"));
  mkdirSync(lock);
  writeFileSync(join(lock, "owner.json"), "foreign owner");
}
if (tool === "deployApiMaintenance.sh" && fault("block-maintenance")) {
  const child = Bun.spawn(
    [
      process.execPath,
      "-e",
      'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000)',
    ],
    { stdout: "ignore", stderr: "ignore" },
  );
  writeFileSync(
    join(root, "child-pids.json"),
    JSON.stringify([process.pid, child.pid]),
  );
  process.on("SIGTERM", () => {});
  await new Promise(() => setInterval(() => {}, 1000));
}
if (tool === "deployApiMaintenance.sh")
  writeFileSync(join(root, "maintenance-complete"), "");
if (
  tool === "deployApiMaintenance.sh" &&
  fault("change-storage-plan-after-show")
)
  appendFileSync(readFileSync(join(root, "storage-plan-path"), "utf8"), "\n");
if (tool === "deployWebsite.sh")
  writeFileSync(join(root, "website-deployed"), "");
if (tool.startsWith("run-")) {
  const stack = tool.split("-")[1];
  const recreated = fault(`${stack}-created`);
  if (args[1] === "output") {
    if (args[3] === "hyperdrive_id") console.log("a".repeat(32));
    else if (stack === "postgres" && args[3] === "database")
      output({
        name: fault("wrong-database") ? "wrong" : database,
        branch: "main",
        branch_id:
          fault("changed-public-inventory") && fault("website-deployed")
            ? "changed-after-deploy"
            : fault("changed-maintenance-inventory") &&
                fault("maintenance-complete") &&
                !recreated
              ? "changed-before-drop"
              : recreated && !fault("old-branch")
                ? "new-branch"
                : "old-branch",
        organization: "tearleads",
      });
    else if (stack === "postgres")
      output({
        postgres_host: "fixture.psdb.cloud",
        postgres_db: database,
        postgres_migration_port: "5432",
        postgres_migration_user: "migrations",
        postgres_migration_password: fault("unbound-migration")
          ? "DIFFERENT_MIGRATION_SECRET_CANARY"
          : "SECRET_CANARY",
      });
    else if (stack === "storage" && args[3] === "bucket")
      output({
        name: bucket,
        account_id: fault("wrong-account") ? "b".repeat(32) : account,
      });
    else if (stack === "storage")
      output({
        blob_s3_bucket: bucket,
        blob_s3_endpoint: `https://${account}.r2.cloudflarestorage.com`,
        blob_s3_access_key_id: "fixture",
        blob_s3_secret_access_key:
          fault("changed-blob-credentials") && fault("postgres-destroyed")
            ? "CHANGED_BLOB_SECRET_CANARY"
            : "SECRET_CANARY",
      });
    else if (stack === "edge")
      output(
        Object.fromEntries(
          ["api", "app", "demo"].map((name) => [
            `${name}_url`,
            {
              value: `https://${name}${tier === "staging" ? "-staging" : ""}.example.test`,
            },
          ]),
        ),
      );
    else
      output(
        `https://${tier === "staging" ? "website-staging." : ""}example.test`,
      );
  }
  if (args[1] === "plan") {
    const action = args.includes("-destroy")
      ? "delete"
      : fault(`${stack}-destroyed`) && !recreated
        ? "create"
        : "no-op";
    const values = stack === "postgres" ? postgres : storage;
    const changes: Record<string, unknown>[] = Object.entries(values).map(
      ([address, value]) => ({
        address,
        mode: "managed",
        change: {
          actions: [action],
          before: action === "create" ? null : value,
          after: action === "delete" ? null : value,
        },
      }),
    );
    if (fault("wrong-create") && action === "create" && stack === "postgres") {
      changes[4] = {
        address: "cloudflare_hyperdrive_config.api",
        mode: "managed",
        change: {
          actions: ["create"],
          before: null,
          after: { account_id: "WRONG", name: `tearleads-api-${tier}` },
          after_unknown: { account_id: true },
        },
      };
    }
    if (fault("bad-plan") && action === "delete")
      changes.push({
        address: "cloudflare_r2_bucket.downloads",
        mode: "managed",
        change: {
          actions: ["delete"],
          before: { account_id: account, name: "downloads" },
          after: null,
        },
      });
    const file = args.find((a) => a.startsWith("-out="))?.slice(5);
    if (!file) throw new Error("plan not saved");
    if (
      fault("replace-override") &&
      action === "delete" &&
      stack === "storage"
    ) {
      const override = join(
        root,
        "repo/terraform/stacks",
        tier,
        stack,
        "soft_reset_override.tf",
      );
      renameSync(override, join(root, "original-override"));
      writeFileSync(override, "foreign replacement");
    }
    const phase = `${stack}-${action}${recreated ? "-recreated" : ""}`;
    const drift = fault("plan-drift.json")
      ? (JSON.parse(readFileSync(join(root, "plan-drift.json"), "utf8"))[
          phase
        ] ?? [])
      : fault("drift")
        ? [{ change: { actions: ["update"] } }]
        : [];
    if (fault("plan-drift.json"))
      appendFileSync(
        join(root, "drift-plans.jsonl"),
        `${JSON.stringify({ phase, drift, actions: changes.map(({ change }) => change) })}\n`,
      );
    writeFileSync(
      file,
      JSON.stringify({
        format_version: "1.2",
        resource_changes: changes,
        resource_drift: drift,
        variables: {
          cloudflare_account_id: { value: account },
          planetscale_database: { value: database },
          planetscale_organization: { value: "tearleads" },
        },
      }),
    );
  }
  if (args[1] === "apply") {
    const plan = JSON.parse(readFileSync(args[2] ?? "", "utf8"));
    const action = plan.resource_changes[0].change.actions[0];
    writeFileSync(
      join(root, `${stack}-${action === "delete" ? "destroyed" : "created"}`),
      "",
    );
  }
} else if (tool === "terraform") {
  const file = args.at(-1) ?? "";
  const plan = JSON.parse(readFileSync(file, "utf8"));
  if (fault("plan-mutation.json")) {
    const mutation = JSON.parse(
      readFileSync(join(root, "plan-mutation.json"), "utf8"),
    );
    if (basename(file) === mutation.file) {
      let target = plan;
      for (const key of mutation.path.slice(0, -1)) target = target[key];
      target[mutation.path.at(-1)] = mutation.value;
    }
  }
  console.log(JSON.stringify(plan));
  if (basename(file) === "storage-delete.tfplan")
    writeFileSync(join(root, "storage-plan-path"), file);
  if (
    fault("change-plan-during-show") ||
    (fault("change-storage-plan-during-show") &&
      basename(file) === "storage-no-op.tfplan")
  )
    appendFileSync(file, "\n");
} else if (tool === "curl") console.log("200");
else if (tool === "psql") {
  // PostgreSQL catalog name columns use C order even in locale databases.
  const tables = [
    "blob_stages",
    "blobs",
    "container_sync_tombstones",
    "containers",
    "users",
  ];
  const {
    PGSSLMODE,
    PGSSLROOTCERT,
    PGPORT,
    PGOPTIONS,
    DATABASE_URL,
    POSTGRES_URL,
  } = process.env;
  if (
    PGSSLMODE !== "verify-full" ||
    PGSSLROOTCERT !== "system" ||
    PGPORT !== "5432" ||
    !PGOPTIONS?.includes("default_transaction_read_only=on") ||
    DATABASE_URL ||
    POSTGRES_URL
  ) {
    throw new Error("Unsafe database probe configuration");
  }
  const sql = args.at(-1) ?? "";
  if (sql.includes("current_database()")) output(`tearleads-${tier}`);
  else if (sql.includes("pg_tables"))
    output(fault("wrong-schema") ? tables.slice(0, -1) : tables);
  else if (sql.includes("json_agg(hash"))
    output([
      createHash("sha256")
        .update(
          readFileSync(
            join(
              root,
              "repo/packages/api-shared/drizzle/0000_greenfield_baseline.sql",
            ),
          ),
        )
        .digest("hex"),
    ]);
  else
    output(
      fault("api-deployed")
        ? tables.map((name) => ({ name, rows: 0 }))
        : fault("old-relations")
          ? ["users"]
          : [],
    );
} else if (tool === "aws") {
  for (const key of [
    "AWS_PROFILE",
    "AWS_DEFAULT_PROFILE",
    "AWS_SESSION_TOKEN",
    "AWS_SECURITY_TOKEN",
  ]) {
    if (key in process.env) throw new Error(`Unexpected inherited ${key}`);
  }
  output(fault("old-blobs") ? { Contents: [{ Key: "old" }] } : {});
} else if (tool === "deployApi.sh")
  writeFileSync(join(root, "api-deployed"), "");
else if (
  tool === "bun" &&
  args[0] === "scripts/workerDefines.ts" &&
  !fault("empty-worker-defines")
)
  console.log("ENVIRONMENT:production");
