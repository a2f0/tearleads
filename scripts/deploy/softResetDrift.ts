import { isDeepStrictEqual } from "node:util";
import {
  bucketLocationCasingOnly,
  tokenModifiedOnOnly,
} from "./softResetStorageDrift";

type DriftRecord = Record<string, unknown> &
  Partial<
    Record<
      | "id"
      | "path"
      | "data"
      | "api_data"
      | "api_response"
      | "address"
      | "mode"
      | "change"
      | "actions"
      | "after_unknown"
      | "before"
      | "after",
      unknown
    >
  >;

const databaseMetadata = [
  "default_branch_table_count",
  "ready",
  "schema_last_updated_at",
  "state",
  "updated_at",
];
const protectionMetadata = [
  "has_roles",
  "latest_image_version",
  "ready",
  "schema_last_updated_at",
  "stale_schema",
  "state",
  "updated_at",
];

function record(value: unknown): DriftRecord | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function jsonRecord(value: unknown) {
  if (typeof value !== "string") return undefined;
  try {
    return record(JSON.parse(value));
  } catch {
    return undefined;
  }
}

function omit(value: Record<string, unknown>, keys: readonly string[]) {
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => !keys.includes(key)),
  );
}

function observations(value: DriftRecord | undefined) {
  if (
    !value ||
    typeof value.id !== "string" ||
    !value.id ||
    typeof value.path !== "string" ||
    !value.path ||
    !jsonRecord(value.data)
  )
    return undefined;
  const data = record(value.api_data);
  const response = jsonRecord(value.api_response);
  if (
    !data ||
    !response ||
    Object.values(data).some((entry) => typeof entry !== "string")
  )
    return undefined;
  return [data, response];
}

function metadataOnly(resource: DriftRecord, stack: string) {
  if (stack !== "postgres" || resource.mode !== "managed") return false;
  const keys =
    resource.address === "restapi_object.database"
      ? databaseMetadata
      : resource.address === "restapi_object.main_protection"
        ? protectionMetadata
        : undefined;
  const change = record(resource.change);
  if (
    !keys ||
    !change ||
    !isDeepStrictEqual(change.actions, ["update"]) ||
    (change.after_unknown !== undefined &&
      !isDeepStrictEqual(change.after_unknown, {}))
  )
    return false;
  const before = record(change.before);
  const after = record(change.after);
  const oldObservations = observations(before);
  const newObservations = observations(after);
  if (!before || !after || !oldObservations || !newObservations) return false;
  // Configuration and identity must match exactly. Only these two computed
  // representations may differ, and each is independently checked below.
  if (
    !isDeepStrictEqual(
      omit(before, ["api_data", "api_response"]),
      omit(after, ["api_data", "api_response"]),
    )
  )
    return false;
  return oldObservations.every((value, index) => {
    const refreshed = newObservations[index];
    return (
      refreshed && isDeepStrictEqual(omit(value, keys), omit(refreshed, keys))
    );
  });
}

export function validateResourceDrift(
  drift: unknown,
  stack: "postgres" | "storage",
) {
  if (drift === undefined) return;
  if (
    !Array.isArray(drift) ||
    drift.some((entry) => {
      const resource = record(entry);
      const change = record(resource?.change);
      return (
        !resource ||
        (!isDeepStrictEqual(change?.actions, ["no-op"]) &&
          !metadataOnly(resource, stack) &&
          !bucketLocationCasingOnly(resource, stack) &&
          !tokenModifiedOnOnly(resource, stack))
      );
    })
  )
    throw new Error("Terraform drift requires manual reconciliation.");
}
