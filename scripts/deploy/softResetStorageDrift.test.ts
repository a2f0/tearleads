import { expect, test } from "bun:test";
import { validateResourceDrift } from "./softResetDrift";
import { bucketLocationDrift } from "./softResetDrift.testUtils";

const message = "Terraform drift requires manual reconciliation.";

test("storage accepts an omitted unknown marker but refuses explicit unknown shapes", () => {
  const drift = bucketLocationDrift();
  Reflect.deleteProperty(drift.change, "after_unknown");
  expect(() => validateResourceDrift([drift], "storage")).not.toThrow();
  for (const value of [
    undefined,
    null,
    true,
    false,
    [],
    "{}",
    { location: true },
    { id: false },
  ]) {
    drift.change.after_unknown = value;
    expect(() => validateResourceDrift([drift], "storage")).toThrow(message);
  }
});

test("storage requires a real casing change, never a region change", () => {
  const drift = bucketLocationDrift();
  for (const after of ["wnam", "WNAM", "enam"]) {
    drift.change.after.location = after;
    expect(() => validateResourceDrift([drift], "storage")).toThrow(message);
  }
});

test("storage requires known string locations on both snapshots", () => {
  for (const side of ["before", "after"] as const) {
    for (const value of [undefined, null, 1, true, {}, []]) {
      const drift = bucketLocationDrift();
      drift.change[side].location = value;
      expect(() => validateResourceDrift([drift], "storage")).toThrow(message);
      Reflect.deleteProperty(drift.change[side], "location");
      expect(() => validateResourceDrift([drift], "storage")).toThrow(message);
    }
  }
});

test("storage requires object snapshots and nonempty string identities", () => {
  for (const side of ["before", "after"] as const) {
    for (const value of [null, [], true, "bucket"]) {
      const drift = bucketLocationDrift();
      Object.assign(drift.change, { [side]: value });
      expect(() => validateResourceDrift([drift], "storage")).toThrow(message);
    }
  }
  for (const key of ["id", "account_id", "name"]) {
    for (const value of [undefined, null, "", 123, [], {}]) {
      const drift = bucketLocationDrift();
      drift.change.before[key] = value;
      drift.change.after[key] = value;
      expect(() => validateResourceDrift([drift], "storage")).toThrow(message);
      Reflect.deleteProperty(drift.change.before, key);
      Reflect.deleteProperty(drift.change.after, key);
      expect(() => validateResourceDrift([drift], "storage")).toThrow(message);
    }
  }
});

test.each([
  ["id", "TEARLEADS-BLOBS-PROD"],
  ["account_id", "A".repeat(32)],
  ["name", "TEARLEADS-BLOBS-PROD"],
  ["jurisdiction", "eu"],
  ["storage_class", "InfrequentAccess"],
  ["creation_date", "2026-01-02T00:00:00Z"],
  ["policy", { allow: false, nested: { location: "ENAM" } }],
  ["unknown_property", "SECRET_CANARY"],
])("storage refuses changed %s beside location casing", (key, value) => {
  const drift = bucketLocationDrift();
  drift.change.after[String(key)] = value;
  expect(() => validateResourceDrift([drift], "storage")).toThrow(message);
});

test("storage compares nested policy, serialized bytes and removed properties", () => {
  for (const [before, after] of [
    [{ location: "enam" }, { location: "ENAM" }],
    [{ allow: true }, { allow: false }],
    [
      ["read", "write"],
      ["write", "read"],
    ],
    ['{"allow":true}', '{ "allow": true }'],
    [{ allow: true }, undefined],
  ]) {
    const drift = bucketLocationDrift();
    drift.change.before.policy = before;
    if (after !== undefined) drift.change.after.policy = after;
    expect(() => validateResourceDrift([drift], "storage")).toThrow(message);
  }
  const drift = bucketLocationDrift();
  drift.change.before.policy = { allow: true, nested: { location: "enam" } };
  drift.change.after.policy = { nested: { location: "enam" }, allow: true };
  expect(() => validateResourceDrift([drift], "storage")).not.toThrow();
});

test("storage exception is limited to its stack", () => {
  expect(() =>
    validateResourceDrift([bucketLocationDrift()], "postgres"),
  ).toThrow(message);
});

test("storage exception is limited to the exact application address", () => {
  for (const address of [
    "cloudflare_r2_bucket.downloads",
    "module.other.cloudflare_r2_bucket.blobs",
    "cloudflare_account_token.objects",
  ]) {
    const drift = bucketLocationDrift();
    drift.address = address;
    expect(() => validateResourceDrift([drift], "storage")).toThrow(message);
  }
});

test("storage exception requires managed mode", () => {
  const drift = bucketLocationDrift();
  drift.mode = "data";
  expect(() => validateResourceDrift([drift], "storage")).toThrow(message);
});

test("storage exception requires only an update action", () => {
  for (const actions of [
    ["create"],
    ["delete"],
    ["delete", "create"],
    ["create", "delete"],
    ["read"],
    ["update", "no-op"],
    [],
  ]) {
    const drift = bucketLocationDrift();
    drift.change.actions = actions;
    expect(() => validateResourceDrift([drift], "storage")).toThrow(message);
  }
});

test("storage accepts only equivalent known location codes with changed casing", () => {
  for (const code of ["apac", "eeur", "enam", "weur", "wnam", "oc"]) {
    const drift = bucketLocationDrift();
    for (const [before, after] of [
      [code, code.toUpperCase()],
      [code.toUpperCase(), code],
      [code, code.slice(0, 1).toUpperCase() + code.slice(1)],
    ]) {
      drift.change.before.location = before;
      drift.change.after.location = after;
      expect(() => validateResourceDrift([drift], "storage")).not.toThrow();
    }
  }
});

test("storage refuses invalid region lexemes even when case-equivalent", () => {
  for (const code of ["enam\n", "unknown", " enam", "enam ", "eNaM\t", ""]) {
    const drift = bucketLocationDrift();
    drift.change.before.location = code;
    drift.change.after.location = code.toUpperCase();
    expect(() => validateResourceDrift([drift], "storage")).toThrow(message);
  }
});
