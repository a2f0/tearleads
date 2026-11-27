import { expect, test } from "bun:test";
import { parseScenarioOptions } from "./options";

test("parses scenario profiling flags and defaults", () => {
  expect(parseScenarioOptions([])).toEqual({
    mode: "run",
    scenarios: [],
    samples: 1,
    baseline: null,
    statements: false,
    paramHash: false,
    clientStatements: false,
    payloadAudit: false,
    stacks: false,
  });
  expect(
    parseScenarioOptions([
      "--scenario",
      "rotation",
      "--scenario",
      "baseline",
      "--samples",
      "3",
      "--baseline",
      "before.json",
      "--statements",
      "--param-hash",
      "--client-statements",
      "--payload-audit",
      "--stacks",
    ]),
  ).toEqual({
    mode: "run",
    scenarios: ["rotation", "baseline"],
    samples: 3,
    baseline: "before.json",
    statements: true,
    paramHash: true,
    clientStatements: true,
    payloadAudit: true,
    stacks: true,
  });
  expect(parseScenarioOptions(["--help"])).toBeNull();
});

test("parses --compare mode and enforces flag dependencies", () => {
  expect(
    parseScenarioOptions(["--compare", "before.json", "after.json"]),
  ).toEqual({ mode: "compare", before: "before.json", after: "after.json" });
  expect(() => parseScenarioOptions(["--param-hash"])).toThrow(
    /--param-hash needs --statements/u,
  );
  expect(() => parseScenarioOptions(["--stacks"])).toThrow(
    /--stacks needs --payload-audit/u,
  );
  expect(() => parseScenarioOptions(["--compare", "only-one.json"])).toThrow(
    /exactly two report paths/u,
  );
  expect(() =>
    parseScenarioOptions([
      "--compare",
      "a.json",
      "b.json",
      "--scenario",
      "rotation",
    ]),
  ).toThrow(/runs no scenarios/u);
});
