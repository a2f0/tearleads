import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { moduleDeclaresToken } from "./lintFormalAbstractionMaps";
import {
  NEGATIVE_CONTROLS,
  parseConfig,
  renderNegativeControlConfig,
  violationPattern,
} from "./protocolNegativeControls";

const SAMPLE = `SPECIFICATION Spec

CONSTANTS
  Devices = {d1, d2}
  Locked = TRUE
CONSTANT Inline = 3

INVARIANT TypeOK
INVARIANT NoLoss

PROPERTY Monotone
PROPERTY Eventually
`;

test("parses block and inline constants, invariants, and properties", () => {
  expect(parseConfig(SAMPLE)).toEqual({
    specification: "Spec",
    constants: [
      ["Devices", "{d1, d2}"],
      ["Locked", "TRUE"],
      ["Inline", "3"],
    ],
    invariants: ["TypeOK", "NoLoss"],
    properties: ["Monotone", "Eventually"],
  });
});

test("refuses configuration features it cannot reproduce", () => {
  expect(() => parseConfig("SPECIFICATION Spec\nCONSTRAINT Bound\n")).toThrow(
    "not supported",
  );
  expect(() => parseConfig("INVARIANT TypeOK\n")).toThrow("no SPECIFICATION");
});

test("renders the override and only the expected check", () => {
  const rendered = renderNegativeControlConfig(parseConfig(SAMPLE), {
    id: "sample",
    module: "formal/x/Sample.tla",
    config: "formal/x/Sample.cfg",
    constants: { Locked: "FALSE" },
    expect: { kind: "invariant", name: "NoLoss" },
    why: "sample",
  });
  expect(rendered).toBe(`SPECIFICATION Spec

CONSTANTS
  Devices = {d1, d2}
  Locked = FALSE
  Inline = 3

INVARIANT NoLoss
`);
});

test("refuses an override the base does not assign or a check it does not run", () => {
  const base = parseConfig(SAMPLE);
  const control = {
    id: "sample",
    module: "formal/x/Sample.tla",
    config: "formal/x/Sample.cfg",
    why: "sample",
  };
  expect(() =>
    renderNegativeControlConfig(base, {
      ...control,
      constants: { Missing: "TRUE" },
      expect: { kind: "invariant", name: "NoLoss" },
    }),
  ).toThrow("does not assign");
  expect(() =>
    renderNegativeControlConfig(base, {
      ...control,
      constants: {},
      expect: { kind: "invariant", name: "Monotone" },
    }),
  ).toThrow("does not check");
  expect(() =>
    renderNegativeControlConfig(base, {
      ...control,
      constants: {},
      expect: { kind: "liveness", name: "NoLoss" },
    }),
  ).toThrow("does not check");
});

test("matches TLC's exact violation reports", () => {
  expect(
    violationPattern({ kind: "invariant", name: "NoLoss" }).test(
      "Error: Invariant NoLoss is violated.\n",
    ),
  ).toBe(true);
  expect(
    violationPattern({ kind: "action", name: "Monotone" }).test(
      "Error: Action property Monotone is violated.\n",
    ),
  ).toBe(true);
  expect(
    violationPattern({ kind: "liveness", name: "Eventually" }).test(
      "Error: Temporal properties were violated.\n",
    ),
  ).toBe(true);
  expect(
    violationPattern({ kind: "invariant", name: "NoLoss" }).test(
      "Error: Invariant TypeOK is violated.\n",
    ),
  ).toBe(false);
});

test("every registered control names files, constants, and checks that exist", () => {
  const ids = new Set<string>();
  for (const control of NEGATIVE_CONTROLS) {
    expect(ids.has(control.id)).toBe(false);
    ids.add(control.id);
    expect(existsSync(control.module)).toBe(true);
    expect(existsSync(control.config)).toBe(true);
    const module = readFileSync(control.module, "utf8");
    for (const name of Object.keys(control.constants)) {
      expect(moduleDeclaresToken(module, name)).toBe(true);
    }
    expect(moduleDeclaresToken(module, control.expect.name)).toBe(true);
    expect(() =>
      renderNegativeControlConfig(
        parseConfig(readFileSync(control.config, "utf8")),
        control,
      ),
    ).not.toThrow();
  }
});
