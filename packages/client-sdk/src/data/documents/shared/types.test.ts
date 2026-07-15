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

test("projection verification rejects resolver-backed local trust", () => {
  const combined = {
    resolveProjectionUserKey: async () => null,
    trustedLocalProjection: true,
  } as unknown as ProjectionVerificationOptions;

  expect(() => resolveProjectionVerifier(combined, "Projection")).toThrow(
    "Projection cannot combine projection key verification with local projection trust",
  );
  expect(() => projectionVerificationOptions(combined)).toThrow(
    "Projection use cannot combine key verification with local projection trust",
  );
});

test("projection verification supports explicit local projections without a resolver", () => {
  const local = { trustedLocalProjection: true } as const;

  expect(resolveProjectionVerifier(local, "Projection")).toBeNull();
  expect(projectionVerificationOptions(local)).toEqual(local);
});
