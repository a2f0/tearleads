import { expect, test } from "bun:test";
import {
  findProofEscapes,
  parseLakeLeanVersion,
  parseLeanToolchain,
  parseMiseLeanPin,
} from "./leanTools";

test("the three Lean version sources parse to one version string", () => {
  expect(
    parseMiseLeanPin('rust = "1.99.1"\n"github:leanprover/lean4" = "4.35.0"\n'),
  ).toBe("4.35.0");
  expect(parseLeanToolchain("leanprover/lean4:v4.35.0\n")).toBe("4.35.0");
  expect(
    parseLakeLeanVersion(
      "Lake version 5.0.0-src+eb6cafb (Lean version 4.35.0)\n",
    ),
  ).toBe("4.35.0");
});

test("a toolchain file naming a fork, a channel, or two lines is refused", () => {
  for (const source of [
    "leanprover/lean4:stable\n",
    "leanprover/lean4-nightly:v4.35.0\n",
    "acme/lean4:v4.35.0\n",
    "leanprover/lean4:v4.35.0\nleanprover/lean4:v4.36.0\n",
  ]) {
    expect(parseLeanToolchain(source)).toBeUndefined();
  }
});

test("proof escapes are reported with their line, plural prose is not", () => {
  const source = [
    "theorem a : True := by sorry",
    "-- does not depend on any axioms",
    "theorem b : 2 = 2 := by native_decide",
    "axiom c : False",
  ].join("\n");
  expect(findProofEscapes("X.lean", source)).toEqual([
    "X.lean:1 uses `sorry`",
    "X.lean:3 uses `native_decide`",
    "X.lean:4 uses `axiom`",
  ]);
});
