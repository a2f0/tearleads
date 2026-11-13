import { isDeepStrictEqual } from "node:util";

type StorageRecord = Record<string, unknown> & {
  address?: unknown;
  mode?: unknown;
  change?: unknown;
  actions?: unknown;
  after_unknown?: unknown;
  before?: unknown;
  after?: unknown;
};

function record(value: unknown): StorageRecord | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function bucket(value: unknown) {
  const fields = record(value);
  if (
    !fields ||
    !["id", "account_id", "name"].every(
      (key) => typeof fields[key] === "string" && fields[key] !== "",
    )
  )
    return undefined;
  return fields;
}

export function bucketLocationCasingOnly(
  resource: StorageRecord,
  stack: string,
) {
  if (
    stack !== "storage" ||
    resource.address !== "cloudflare_r2_bucket.blobs" ||
    resource.mode !== "managed"
  )
    return false;
  const change = record(resource.change);
  if (
    !change ||
    !isDeepStrictEqual(change.actions, ["update"]) ||
    (Object.hasOwn(change, "after_unknown") &&
      !isDeepStrictEqual(change.after_unknown, {}))
  )
    return false;
  const before = bucket(change.before);
  const after = bucket(change.after);
  if (!before || !after) return false;
  const { location: oldLocation, ...oldValues } = before;
  const { location: newLocation, ...newValues } = after;
  // Cloudflare 5.24's finite location codes, not a generic string normalizer.
  // IDs, credentials, policy and every unlisted field still compare exactly.
  return (
    typeof oldLocation === "string" &&
    typeof newLocation === "string" &&
    /^(apac|eeur|enam|weur|wnam|oc)$/i.test(oldLocation) &&
    oldLocation !== newLocation &&
    oldLocation.toLowerCase() === newLocation.toLowerCase() &&
    isDeepStrictEqual(oldValues, newValues)
  );
}
