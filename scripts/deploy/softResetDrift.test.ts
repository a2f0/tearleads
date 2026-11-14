import { expect, test } from "bun:test";
import { validateResourceDrift } from "./softResetDrift";
import { metadataDrift } from "./softResetDrift.testUtils";
import { object } from "./softResetPlans";

const names = ["database", "main_protection"] as const;
const message = "Terraform drift requires manual reconciliation.";

test.each([
  ["api_response", "broken SECRET_CANARY"],
  ["api_response", "null"],
  ["api_response", "[]"],
  ["api_data", { id: 123 }],
  ["api_data", []],
  ["data", "not json"],
  ["id", ""],
  ["path", ""],
])("equal malformed %s snapshots are not metadata-only", (key, value) => {
  const drift = metadataDrift("database");
  drift.change.before[String(key)] = value;
  drift.change.after[String(key)] = value;
  expect(() => validateResourceDrift([drift], "postgres")).toThrow(message);
});

for (const name of names) {
  test(`${name}: only explicitly allowed observation fields can change`, () => {
    expect(() =>
      validateResourceDrift([metadataDrift(name)], "postgres"),
    ).not.toThrow();
  });

  for (const representation of ["api_data", "api_response"] as const) {
    test.each([
      ["id", "foreign-id"],
      ["name", "foreign-name"],
      ["deletion_protected", false],
      ["region", { slug: "us-west" }],
      ["replicas", 1],
      ["cluster_size", "PS-10"],
      ["unknown_field", "SECRET_CANARY"],
      [name === "database" ? "has_roles" : "default_branch_table_count", 7],
      ...(name === "database" ? [["stale_schema", true] as const] : []),
    ] as const)(
      `${name} ${representation}: refuses changed %s alongside benign metadata`,
      (key, value) => {
        const drift = metadataDrift(name);
        const after = drift.change.after;
        if (representation === "api_data")
          object(after[representation])[String(key)] =
            typeof value === "string" ? value : JSON.stringify(value);
        else {
          const response = JSON.parse(String(after[representation]));
          response[String(key)] = value;
          after[representation] = JSON.stringify(response);
        }
        expect(() => validateResourceDrift([drift], "postgres")).toThrow(
          message,
        );
      },
    );

    test(`${name} ${representation}: refuses removal and nested metadata-named changes`, () => {
      for (const mutation of ["remove", "nested"]) {
        const drift = metadataDrift(name);
        const after = drift.change.after;
        const response =
          representation === "api_data"
            ? object(after[representation])
            : JSON.parse(String(after[representation]));
        if (mutation === "remove") delete response.id;
        else
          response.region =
            representation === "api_data"
              ? JSON.stringify({ slug: "us-east", state: "changed" })
              : { slug: "us-east", state: "changed" };
        if (representation === "api_response")
          after[representation] = JSON.stringify(response);
        expect(() => validateResourceDrift([drift], "postgres")).toThrow(
          message,
        );
      }
    });
  }

  test.each([
    "id",
    "object_id",
    "path",
    "read_path",
    "update_path",
    "destroy_path",
    "data",
    "ignore_server_additions",
    "unknown_field",
  ])(`${name}: refuses top-level %s drift`, (key) => {
    const drift = metadataDrift(name);
    drift.change.after[key] =
      key === "data"
        ? JSON.stringify({
            ...JSON.parse(String(drift.change.before[key])),
            deletion_protected: false,
          })
        : "SECRET_CANARY";
    expect(() => validateResourceDrift([drift], "postgres")).toThrow(message);
  });

  test(`${name}: structural equality is insensitive only to object key order`, () => {
    const drift = metadataDrift(name);
    const after = drift.change.after;
    after.api_response = JSON.stringify(
      Object.fromEntries(
        Object.entries(JSON.parse(String(after.api_response))).reverse(),
      ),
      null,
      2,
    );
    drift.change.after = Object.fromEntries(Object.entries(after).reverse());
    expect(() => validateResourceDrift([drift], "postgres")).not.toThrow();
  });

  for (const side of ["before", "after"] as const) {
    test.each(
      [null, [], 1, "{broken SECRET_CANARY", "null", "[]", "true"].map(
        (value) => [value],
      ),
    )(`${name} ${side}: refuses malformed api_response %j`, (value) => {
      const drift = metadataDrift(name);
      drift.change[side].api_response = value;
      expect(() => validateResourceDrift([drift], "postgres")).toThrow(message);
    });
    test.each(
      [null, [], "{}", { ready: true }, { id: {} }].map((value) => [value]),
    )(`${name} ${side}: refuses malformed api_data %j`, (value) => {
      const drift = metadataDrift(name);
      drift.change[side].api_data = value;
      expect(() => validateResourceDrift([drift], "postgres")).toThrow(message);
    });
  }
}

test.each([
  ["delete"],
  ["create"],
  ["delete", "create"],
  ["create", "delete"],
  ["read"],
  ["update", "no-op"],
  [],
])("refuses drift action %j", (...actions) => {
  const drift = metadataDrift("database");
  drift.change.actions = actions;
  expect(() => validateResourceDrift([drift], "postgres")).toThrow(message);
});

test.each([
  "cloudflare_hyperdrive_config.api",
  "restapi_object.other",
  "module.other.restapi_object.database",
])("refuses other resource %s", (address) => {
  const drift = metadataDrift("database");
  drift.address = address;
  expect(() => validateResourceDrift([drift], "postgres")).toThrow(message);
});

test("refuses the storage stack and data-mode resources", () => {
  const drift = metadataDrift("database");
  expect(() => validateResourceDrift([drift], "storage")).toThrow(message);
  drift.mode = "data";
  expect(() => validateResourceDrift([drift], "postgres")).toThrow(message);
});

test.each(
  [null, {}, "[]", [null], [{}], [{ change: null }]].map((value) => [value]),
)("refuses malformed drift %j", (drift) => {
  expect(() => validateResourceDrift(drift, "postgres")).toThrow(message);
});

test.each(
  [undefined, [], [{ change: { actions: ["no-op"] } }]].map((value) => [value]),
)("retains absent, empty and no-op drift contract %j", (drift) => {
  for (const stack of ["postgres", "storage"] as const)
    expect(() => validateResourceDrift(drift, stack)).not.toThrow();
});

test.each([null, true, { api_data: true }, { api_response: true }])(
  "refuses malformed or unknown refreshed values %j",
  (unknown) => {
    const drift = metadataDrift("database");
    Object.assign(drift.change, { after_unknown: unknown });
    expect(() => validateResourceDrift([drift], "postgres")).toThrow(message);
  },
);
