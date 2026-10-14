import { expect, test } from "bun:test";
import { validateSeedSpec } from "./validateSeedSpec";

const seed = {
  schemaVersion: 2,
  password: "fixture",
  identitySeedPhrase: "validated by the SDK",
};

test("seed validation rejects unsupported versions and malformed document data", () => {
  expect(() => validateSeedSpec(seed)).not.toThrow();
  for (const value of [
    null,
    { ...seed, schemaVersion: 1 },
    { ...seed, files: {} },
    { ...seed, contacts: [{ fields: { firstName: 42 } }] },
    { ...seed, files: [{ kind: "unknown", attachments: [] }] },
    {
      ...seed,
      files: [{ kind: "weight", attachments: [], rows: [{ weight: 61 }] }],
    },
  ]) {
    expect(() => validateSeedSpec(value)).toThrow();
  }
});

test("seed attachment references are local file names and row lists belong to trackers", () => {
  for (const file of [
    "../private.jpg",
    "/tmp/photo.jpg",
    "nested/photo.jpg",
    "nested\\photo.jpg",
  ]) {
    expect(() =>
      validateSeedSpec({
        ...seed,
        files: [
          { kind: "image", attachments: [{ file, mimeType: "image/jpeg" }] },
        ],
      }),
    ).toThrow();
  }
  expect(() =>
    validateSeedSpec({
      ...seed,
      files: [{ kind: "image", attachments: [], rows: [] }],
    }),
  ).toThrow();
});
