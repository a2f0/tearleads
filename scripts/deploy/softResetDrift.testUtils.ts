// Synthetic Terraform observations only; never derived from private plans.
export function bucketLocationDrift(tier: "prod" | "staging" = "prod") {
  const before: Record<string, unknown> & {
    location?: unknown;
    policy?: unknown;
  } = {
    id: `tearleads-blobs-${tier}`,
    account_id: "a".repeat(32),
    name: `tearleads-blobs-${tier}`,
    location: "enam",
    jurisdiction: "default",
    storage_class: "Standard",
    creation_date: "2026-01-01T00:00:00Z",
  };
  return {
    address: "cloudflare_r2_bucket.blobs",
    mode: "managed",
    change: {
      actions: ["update"],
      before,
      after: { ...before, location: "ENAM" } as typeof before,
      after_unknown: {} as unknown,
    },
  };
}

export function metadataDrift(
  name: "database" | "main_protection",
  tier: "prod" | "staging" = "prod",
) {
  const path = `/organizations/tearleads/databases${name === "database" ? "" : `/tearleads-${tier}/branches/main`}`;
  const metadata =
    name === "database"
      ? { default_branch_table_count: 0 }
      : { has_roles: false, latest_image_version: "fixture-v1" };
  const observed = {
    ...metadata,
    ready: false,
    schema_last_updated_at: null,
    state: "pending",
    updated_at: "2026-01-01T00:00:00Z",
    id: `fixture-${name}`,
    name: name === "database" ? `tearleads-${tier}` : "main",
    deletion_protected: true,
    region: { slug: "us-east" },
    replicas: 0,
    cluster_size: "PS-5",
  };
  const refreshed = {
    ...observed,
    ...(name === "database"
      ? { default_branch_table_count: 42 }
      : { has_roles: true, latest_image_version: "fixture-v2" }),
    ready: true,
    schema_last_updated_at: "2026-01-02T00:00:00Z",
    state: "ready",
    updated_at: "2026-01-02T00:00:00Z",
  };
  const data =
    name === "database"
      ? { name: `tearleads-${tier}`, kind: "postgresql", replicas: 0 }
      : { deletion_protected: true };
  function snapshot(
    response: Record<string, unknown>,
  ): Record<string, unknown> & { api_data?: unknown; api_response?: unknown } {
    return {
      id: name === "database" ? `tearleads-${tier}` : "main",
      object_id: name === "database" ? null : "main",
      path,
      read_path: name === "database" ? null : path,
      update_path: name === "database" ? null : path,
      destroy_path: name === "database" ? null : path,
      data: JSON.stringify(data),
      ignore_server_additions: true,
      api_data: Object.fromEntries(
        Object.entries(response).map(([key, value]) => [
          key,
          typeof value === "string" ? value : JSON.stringify(value),
        ]),
      ),
      api_response: JSON.stringify(response),
    };
  }
  return {
    address: `restapi_object.${name}`,
    mode: "managed",
    type: "restapi_object",
    name,
    provider_name: "registry.terraform.io/mastercard/restapi",
    change: {
      actions: ["update"],
      before: snapshot(observed),
      after: snapshot(refreshed),
      after_unknown: {},
    },
  };
}
