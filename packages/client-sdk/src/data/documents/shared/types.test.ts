import { expect, test } from "bun:test";
import {
  type ProjectionVerificationOptions,
  projectionVerificationOptions,
  resolveProjectionVerifier,
} from "./types";

test("projection verification trust requires literal true", () => {
  const truthyTrustedProjection = {
    trustedLocalProjection: "true",
  } as unknown as ProjectionVerificationOptions;

  expect(() =>
    resolveProjectionVerifier(truthyTrustedProjection, "Projection"),
  ).toThrow(
    "Projection requires projection key verification or an explicitly trusted local projection",
  );
  expect(() => projectionVerificationOptions(truthyTrustedProjection)).toThrow(
    "Projection use requires key verification or an explicitly trusted local projection",
  );
});
