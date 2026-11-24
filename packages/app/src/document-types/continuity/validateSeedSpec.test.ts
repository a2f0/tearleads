import { expect, test } from "bun:test";
import { validateSeedSpec } from "./validateSeedSpec";

const seed = {
  schemaVersion: 3,
  identitySeedPhrase: "validated by the SDK",
};

test("seed validation rejects unsupported versions and malformed document data", () => {
  expect(() => validateSeedSpec(seed)).not.toThrow();
  for (const value of [
    null,
    { ...seed, schemaVersion: 2 },
    { ...seed, identitySeedPhrase: "" },
    { ...seed, files: {} },
    { ...seed, notes: [{ text: "" }] },
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

test("seed groups name existing contacts once each, under distinct names", () => {
  const contact = (id: string) => ({ id, fields: { firstName: id } });
  const contacts = [contact("rosa"), contact("theo")];
  const family = { name: "Family", members: ["rosa", "theo"] };
  expect(() =>
    validateSeedSpec({ ...seed, contacts, groups: [family] }),
  ).not.toThrow();
  for (const value of [
    { ...seed, contacts: [{ fields: { firstName: "No id" } }] },
    { ...seed, contacts: [contact("rosa"), contact("rosa")] },
    { ...seed, contacts, groups: {} },
    { ...seed, contacts, groups: [{ ...family, name: "" }] },
    { ...seed, contacts, groups: [{ ...family, members: ["sam"] }] },
    { ...seed, contacts, groups: [{ ...family, members: ["rosa", "rosa"] }] },
    { ...seed, contacts, groups: [family, family] },
  ]) {
    expect(() => validateSeedSpec(value)).toThrow();
  }
});
