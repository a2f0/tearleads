import { expect, test } from "bun:test";
import { validateSeedSpec } from "./validateSeedSpec";

const seed = {
  schemaVersion: 4,
  identitySeedPhrase: "validated by the SDK",
};

test("seed validation rejects unsupported versions and malformed document data", () => {
  expect(() => validateSeedSpec(seed)).not.toThrow();
  for (const value of [
    null,
    { ...seed, schemaVersion: 3 },
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

test("seed groups name existing, named contacts once each, under distinct names", () => {
  const contact = (id: string) => ({
    id,
    fields: { firstName: id, lastName: "Reyes" },
  });
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
    { ...seed, contacts, groups: [{ ...family, name: "Admins" }] },
    { ...seed, contacts, groups: [{ ...family, name: " members " }] },
    {
      ...seed,
      contacts: [
        contact("rosa"),
        { id: "theo", fields: { firstName: "Theo" } },
      ],
      groups: [family],
    },
  ]) {
    expect(() => validateSeedSpec(value)).toThrow();
  }
});

test("seed avatars mark one image in the kind's photo gallery, and passcodes keep rows", () => {
  const photo = (extra: object = {}) => ({
    file: "drill.jpg",
    mimeType: "image/jpeg",
    slot: "equipment-photos",
    ...extra,
  });
  const tool = (attachments: readonly object[]) => ({
    ...seed,
    files: [{ kind: "tool", attachments }],
  });
  expect(() =>
    validateSeedSpec(tool([photo({ avatar: true }), photo()])),
  ).not.toThrow();
  expect(() =>
    validateSeedSpec({
      ...seed,
      files: [
        {
          kind: "passcode",
          fields: { title: "Alarm" },
          attachments: [],
          rows: [{ name: "Duress code", value: "2581", protected: "true" }],
        },
      ],
    }),
  ).not.toThrow();
  for (const value of [
    tool([photo({ avatar: true }), photo({ avatar: true })]),
    tool([photo({ avatar: false })]),
    tool([photo({ avatar: true, slot: "receipt-image" })]),
    tool([photo({ avatar: true, mimeType: "application/pdf" })]),
    {
      ...seed,
      files: [
        {
          kind: "image",
          attachments: [
            { file: "a.jpg", mimeType: "image/jpeg", avatar: true },
          ],
        },
      ],
    },
  ]) {
    expect(() => validateSeedSpec(value)).toThrow();
  }
});

test("seed folders grant seeded groups and take additions only from writers", () => {
  const contact = (id: string) => ({
    id,
    fields: { firstName: id, lastName: "Reyes" },
  });
  const contacts = [contact("rosa"), contact("sam")];
  const groups = [{ name: "Family", members: ["rosa"] }];
  const note = {
    text: "Plan",
    additions: [{ author: "rosa", text: "- Rosa: turkey" }],
  };
  const folder = {
    name: "Family",
    grants: [{ group: "Family", access: "write" }],
    notes: [note],
  };
  const withFolders = (folders: unknown) => ({
    ...seed,
    contacts,
    groups,
    folders,
  });
  expect(() => validateSeedSpec(withFolders([folder]))).not.toThrow();
  expect(() =>
    validateSeedSpec(withFolders([{ name: "Plain" }])),
  ).not.toThrow();
  for (const folders of [
    {},
    [{ ...folder, name: "" }],
    [{ ...folder, name: "a/b" }],
    [{ ...folder, name: " Family" }],
    [folder, folder],
    [{ ...folder, grants: [{ group: "Friends", access: "write" }] }],
    [{ ...folder, grants: [{ group: "Family", access: "admin" }] }],
    [
      {
        ...folder,
        grants: [
          { group: "Family", access: "write" },
          { group: "Family", access: "read" },
        ],
      },
    ],
    [{ ...folder, grants: [{ group: "Family", access: "read" }] }],
    [{ ...folder, notes: [{ ...note, text: "" }] }],
    [
      {
        ...folder,
        notes: [{ ...note, additions: [{ author: "sam", text: "- Sam" }] }],
      },
    ],
    [
      {
        ...folder,
        notes: [{ ...note, additions: [{ author: "rosa", text: " " }] }],
      },
    ],
    [
      {
        ...folder,
        notes: [
          {
            ...note,
            additions: [...note.additions, { author: "rosa", text: "- pie" }],
          },
        ],
      },
    ],
  ]) {
    expect(() => validateSeedSpec(withFolders(folders))).toThrow();
  }
});
