import { lstatSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { validateResourceDrift } from "./softResetDrift";
import { type ResetRun, refuseOverrides } from "./softResetRuntime";

type Stack = "postgres" | "storage";
// Field names are known, their provider-supplied values are not. Every value
// remains unknown until the identity/scope checks below validate it.
export type ProviderRecord = Record<string, unknown> &
  Partial<
    Record<
      | "name"
      | "kind"
      | "data"
      | "branch"
      | "branch_id"
      | "organization"
      | "account_id"
      | "blob_s3_bucket"
      | "blob_s3_endpoint"
      | "blob_s3_access_key_id"
      | "blob_s3_secret_access_key"
      | "postgres_host"
      | "postgres_db"
      | "postgres_migration_port"
      | "postgres_migration_user"
      | "postgres_migration_password"
      | "value"
      | "resource_changes"
      | "resource_drift"
      | "address"
      | "mode"
      | "change"
      | "actions"
      | "after"
      | "after_unknown"
      | "variables"
      | "policies"
      | "resources"
      | "permission_groups"
      | "effect"
      | "id"
      | "rows",
      unknown
    >
  >;
export interface Identity {
  account: string;
  organization: string;
  domain: string;
}
export function object(value: unknown): ProviderRecord {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid provider JSON shape.");
  return value as Record<string, unknown>;
}
export function parse(text: string): ProviderRecord {
  try {
    return object(JSON.parse(text));
  } catch {
    throw new Error("Invalid provider JSON; inspect the private record.");
  }
}

const postgres = [
  "restapi_object.database",
  "restapi_object.main_protection",
  "planetscale_postgres_branch_role.runtime",
  "planetscale_postgres_branch_role.migrations",
  "cloudflare_hyperdrive_config.api",
];
const storage = [
  "cloudflare_r2_bucket.blobs",
  "module.storage.cloudflare_r2_managed_domain.storage",
  "module.storage.cloudflare_r2_bucket_lifecycle.storage",
  "module.storage.cloudflare_r2_bucket_cors.downloads[0]",
  "module.storage.cloudflare_account_token.objects",
];

function validateValues(
  address: string,
  value: ProviderRecord,
  unknown: Record<string, unknown>,
  tier: string,
  identity: Identity,
  creating: boolean,
) {
  const expected = (key: string, want: string, computed = false) => {
    if (
      value[key] !== want &&
      !(computed && creating && value[key] == null && unknown[key] === true)
    )
      throw new Error(`Plan identity mismatch at ${address}.${key}.`);
  };
  const database = `tearleads-${tier}`;
  const bucket = `tearleads-blobs-${tier}`;
  if (address.includes("cloudflare_")) expected("account_id", identity.account);
  if (address === "restapi_object.database") {
    expected("path", `/organizations/${identity.organization}/databases`);
    const data = parse(String(value.data));
    if (data.name !== database || data.kind !== "postgresql")
      throw new Error("Database plan identity mismatch.");
  } else if (address === "restapi_object.main_protection") {
    expected(
      "path",
      `/organizations/${identity.organization}/databases/${database}/branches/main`,
      true,
    );
    expected("object_id", "main");
  } else if (address.startsWith("planetscale_")) {
    expected("organization", identity.organization, true);
    expected("database", database, true);
    expected("branch", "main", true);
    expected(
      "name",
      address.endsWith("runtime")
        ? "tearleads-runtime"
        : "tearleads-migrations",
    );
  } else if (address === "cloudflare_hyperdrive_config.api")
    expected("name", `tearleads-api-${tier}`);
  else if (address === "cloudflare_r2_bucket.blobs") expected("name", bucket);
  else if (address.endsWith("cloudflare_account_token.objects")) {
    expected("name", `${bucket}-objects`);
    validateToken(value, identity.account, bucket);
  } else expected("bucket_name", bucket);
}

function validateToken(value: ProviderRecord, account: string, bucket: string) {
  const policies = value.policies;
  if (!Array.isArray(policies) || policies.length !== 1)
    throw new Error("Unexpected blob token policies.");
  const policy = object(policies[0]);
  const resources = parse(String(policy.resources));
  const permissions = policy.permission_groups;
  if (
    policy.effect !== "allow" ||
    Object.keys(resources).length !== 1 ||
    resources[`com.cloudflare.edge.r2.bucket.${account}_default_${bucket}`] !==
      "*" ||
    !Array.isArray(permissions) ||
    permissions.length !== 1 ||
    object(permissions[0]).id !== "2efd5506f9c8494dacb1fa10a3e7d5b6"
  )
    throw new Error("Unexpected blob token scope.");
}

function validatePlanContext(
  plan: ProviderRecord,
  stack: Stack,
  tier: string,
  identity: Identity,
) {
  validateResourceDrift(plan.resource_drift, stack);
  const variables = object(plan.variables);
  const variable = (name: string) => object(variables[name]).value;
  if (
    variable("cloudflare_account_id") !== identity.account ||
    (stack === "postgres" &&
      (variable("planetscale_organization") !== identity.organization ||
        variable("planetscale_database") !== `tearleads-${tier}`))
  )
    throw new Error("Unexpected plan variables.");
}

function validatePlan(
  plan: ProviderRecord,
  stack: Stack,
  action: "no-op" | "delete" | "create",
  tier: string,
  identity: Identity,
) {
  validatePlanContext(plan, stack, tier, identity);
  if (!Array.isArray(plan.resource_changes))
    throw new Error("Missing plan resource changes.");
  const allowed = new Set(stack === "postgres" ? postgres : storage);
  const seen = new Set<string>();
  const valueKey = action === "delete" ? "before" : "after";
  for (const entry of plan.resource_changes) {
    const resource = object(entry);
    const change = object(resource.change);
    const address = String(resource.address);
    if (resource.mode === "data") {
      if (
        ![
          "data.external.database_ready",
          "data.planetscale_postgres_branch.main",
        ].includes(address) ||
        !['["no-op"]', '["read"]', '["delete"]'].includes(
          JSON.stringify(change.actions),
        )
      )
        throw new Error("Unexpected data source in plan.");
      continue;
    }
    if (
      !allowed.has(address) ||
      seen.has(address) ||
      JSON.stringify(change.actions) !== JSON.stringify([action])
    )
      throw new Error("Plan actions/resource scope mismatch.");
    seen.add(address);
    validateValues(
      address,
      object(change[valueKey]),
      object(change.after_unknown ?? {}),
      tier,
      identity,
      action === "create",
    );
  }
  if (seen.size !== allowed.size)
    throw new Error("Incomplete application stack plan.");
}

export async function savedPlan(
  run: ResetRun,
  identity: Identity,
  stack: Stack,
  action: "no-op" | "delete" | "create",
) {
  // softReset.ts checks the exact apply confirmation before creating the run.
  // Keep the established saved-plan route: destroy-stack.sh would generate
  // and immediately apply a broader plan instead of the bytes validated here.
  refuseOverrides(run);
  const path = join(run.privateDir, `${stack}-${action}.tfplan`);
  const override = join(
    run.root,
    "terraform/stacks",
    run.tier,
    stack,
    "soft_reset_override.tf",
  );
  let owned: ReturnType<typeof lstatSync> | undefined;
  try {
    if (action === "delete") {
      const resources =
        stack === "postgres"
          ? postgres.filter((address) => !address.startsWith("cloudflare_"))
          : ["cloudflare_r2_bucket.blobs"];
      const text = resources
        .map((address) => {
          const [type, name] = address.split(".");
          return `resource "${type}" "${name}" {\n  lifecycle {\n    prevent_destroy = false\n  }\n}\n`;
        })
        .join("\n");
      writeFileSync(override, text, { flag: "wx", mode: 0o600 });
      owned = lstatSync(override);
    }
    await run.exec(
      [
        `terraform/scripts/run-${stack}-stack.sh`,
        run.tier,
        "plan",
        ...(action === "delete" ? ["-destroy"] : []),
        `-out=${path}`,
      ],
      "terraform-state",
    );
    const bytes = readFileSync(path);
    const plan = parse(
      await run.exec(
        [
          "terraform",
          `-chdir=terraform/stacks/${run.tier}/${stack}`,
          "show",
          "-json",
          path,
        ],
        "bounded-command",
      ),
    );
    validatePlan(plan, stack, action, run.tier, identity);
    // Bind the apply to exactly the bytes we inspected, not a new generated plan.
    if (!readFileSync(path).equals(bytes))
      throw new Error("Saved plan changed during inspection.");
    return { path, bytes, json: plan };
  } finally {
    if (owned) {
      const current = lstatSync(override, { throwIfNoEntry: false });
      if (current?.ino === owned.ino && current.dev === owned.dev)
        unlinkSync(override);
      // A foreign replacement is left intact and the next phase's override
      // guard refuses to proceed. Never overwrite the original failure.
    }
  }
}

export async function applyPlan(
  run: ResetRun,
  stack: Stack,
  plan: Awaited<ReturnType<typeof savedPlan>>,
) {
  refuseOverrides(run);
  if (!readFileSync(plan.path).equals(plan.bytes))
    throw new Error("Saved plan changed after inspection.");
  await run.exec(
    [`terraform/scripts/run-${stack}-stack.sh`, run.tier, "apply", plan.path],
    "terraform-state",
  );
}
