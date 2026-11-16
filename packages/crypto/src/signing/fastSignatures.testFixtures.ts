import { mock } from "bun:test";
import * as realMlDsa from "@noble/post-quantum/ml-dsa.js";
import { fastMlDsa87 } from "./fastMlDsa87.testFixtures";

// Opt-in for local iteration: with TEARLEADS_TEST_FAST_SIGNATURES=1, importing
// this module replaces ML-DSA-87 in this process with the stand-in from
// fastMlDsa87.testFixtures.ts. Unset, which is the default and what CI and the
// push gate run, it changes nothing.
//
// The mock only reaches modules that import ml-dsa.js after it is installed, so
// a test preload must import this module before anything that loads
// @tearleads/crypto. The specifier resolves from this package, so it names the
// same file signing/{generateKeyPair,sign,verify}.ts import. ML-KEM stays real.
const { TEARLEADS_TEST_FAST_SIGNATURES } = process.env;

if (TEARLEADS_TEST_FAST_SIGNATURES === "1") {
  // Copy the namespace before mocking, in case the mock updates the already
  // loaded module in place.
  const realExports = { ...realMlDsa };
  const ml_dsa87 = { ...realExports.ml_dsa87, ...fastMlDsa87 };
  mock.module("@noble/post-quantum/ml-dsa.js", () => ({
    ...realExports,
    ml_dsa87,
  }));
}
