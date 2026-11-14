import { expect, test } from "bun:test";
import { validateResourceDrift } from "./softResetDrift";
import { tokenModifiedOnDrift } from "./softResetDrift.testUtils";
import { object } from "./softResetPlans";

const message = "Terraform drift requires manual reconciliation.";

test.each([
  ["id", "foreign-token"],
  ["account_id", "b".repeat(32)],
  ["name", "tearleads-downloads-prod-objects"],
  ["issued_on", "2026-01-02T00:00:00Z"],
  ["status", "disabled"],
  ["expires_on", "2026-01-02T00:00:00Z"],
  ["not_before", "2026-01-02T00:00:00Z"],
  ["value", "different-fixture-secret"],
  ["unknown_property", true],
])("token refuses changed %s beside modification time", (key, value) => {
  const drift = tokenModifiedOnDrift();
  drift.change.after[String(key)] = value;
  expect(() => validateResourceDrift([drift], "storage")).toThrow(message);
});

test("token refuses changed policy scope, permissions and serialized bytes", () => {
  for (const field of ["effect", "resources", "permission_groups"]) {
    const drift = tokenModifiedOnDrift();
    const policies = drift.change.after.policies as unknown[];
    const policy = object(policies[0]);
    policy[field] =
      field === "effect"
        ? "deny"
        : field === "resources"
          ? JSON.stringify({ "com.cloudflare.edge.r2.bucket.foreign": "*" })
          : [{ id: "foreign-permission" }];
    expect(() => validateResourceDrift([drift], "storage")).toThrow(message);
  }
  const drift = tokenModifiedOnDrift();
  const policies = drift.change.after.policies as unknown[];
  const policy = object(policies[0]);
  policy.resources = JSON.stringify(
    JSON.parse(String(policy.resources)),
    null,
    2,
  );
  expect(() => validateResourceDrift([drift], "storage")).toThrow(message);
});

test("token refuses removed attributes", () => {
  for (const key of ["policies", "value", "issued_on", "status"]) {
    const drift = tokenModifiedOnDrift();
    Reflect.deleteProperty(drift.change.after, key);
    expect(() => validateResourceDrift([drift], "storage")).toThrow(message);
  }
});

test("token requires known timestamps on both object snapshots", () => {
  for (const side of ["before", "after"] as const) {
    for (const value of [
      undefined,
      null,
      "",
      "not-a-time",
      "2026-13-01T00:00:00Z",
      1,
      true,
      {},
      [],
    ]) {
      const drift = tokenModifiedOnDrift();
      drift.change[side].modified_on = value;
      expect(() => validateResourceDrift([drift], "storage")).toThrow(message);
    }
    for (const value of [undefined, null, [], true, "token"]) {
      const drift = tokenModifiedOnDrift();
      Object.assign(drift.change, { [side]: value });
      expect(() => validateResourceDrift([drift], "storage")).toThrow(message);
    }
  }
  for (const key of ["id", "account_id", "name"]) {
    for (const value of [undefined, null, "", 1, {}, []]) {
      const drift = tokenModifiedOnDrift();
      drift.change.before[key] = value;
      drift.change.after[key] = value;
      expect(() => validateResourceDrift([drift], "storage")).toThrow(message);
    }
  }
});

test("token refuses unknown or malformed refreshed markers", () => {
  for (const value of [
    undefined,
    null,
    true,
    false,
    [],
    "{}",
    { modified_on: true },
    { id: false },
  ]) {
    const drift = tokenModifiedOnDrift();
    drift.change.after_unknown = value;
    expect(() => validateResourceDrift([drift], "storage")).toThrow(message);
  }
});

test("token exception is restricted to its application resource and stack", () => {
  for (const address of [
    "cloudflare_account_token.objects",
    "module.downloads.cloudflare_account_token.objects",
    "module.other.cloudflare_account_token.objects",
    "cloudflare_r2_bucket.blobs",
  ]) {
    const drift = tokenModifiedOnDrift();
    drift.address = address;
    expect(() => validateResourceDrift([drift], "storage")).toThrow(message);
  }
  expect(() =>
    validateResourceDrift([tokenModifiedOnDrift()], "postgres"),
  ).toThrow(message);
  const drift = tokenModifiedOnDrift();
  drift.mode = "data";
  expect(() => validateResourceDrift([drift], "storage")).toThrow(message);
});

test("token exception requires only a managed update with a changed timestamp", () => {
  for (const actions of [
    ["create"],
    ["delete"],
    ["delete", "create"],
    ["create", "delete"],
    ["read"],
    ["update", "no-op"],
    [],
  ]) {
    const drift = tokenModifiedOnDrift();
    drift.change.actions = actions;
    expect(() => validateResourceDrift([drift], "storage")).toThrow(message);
  }
  const drift = tokenModifiedOnDrift();
  drift.change.after.modified_on = drift.change.before.modified_on;
  expect(() => validateResourceDrift([drift], "storage")).toThrow(message);
});
