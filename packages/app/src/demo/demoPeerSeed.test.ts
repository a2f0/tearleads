import { expect, test } from "bun:test";
import type { ContactEntry } from "../document-types/contact/contactDocumentModel";
import {
  type DemoPeerSeedInput,
  demoPeerSeedActionKey,
  planDemoPeerSeed,
} from "./demoPeerSeed";

function contact(overrides: Partial<ContactEntry>): ContactEntry {
  return {
    encapsulationPublicKey: null,
    firstName: "",
    id: "contact-id",
    isSelf: false,
    lastName: "",
    nickname: "",
    userId: null,
    ...overrides,
  };
}

function input(overrides: Partial<DemoPeerSeedInput>): DemoPeerSeedInput {
  return {
    canWrite: true,
    entries: [],
    isAuthenticated: true,
    peerUserId: null,
    ready: true,
    side: "left",
    ...overrides,
  };
}

test("plans nothing until the store is ready and writable", () => {
  const entries = [contact({ id: "self", isSelf: true })];
  expect(planDemoPeerSeed(input({ entries, ready: false }))).toEqual([]);
  expect(planDemoPeerSeed(input({ entries, canWrite: false }))).toEqual([]);
});

test("names the self contact after the pane's own label when unnamed", () => {
  const entries = [contact({ id: "self", isSelf: true })];
  expect(planDemoPeerSeed(input({ entries, side: "left" }))).toEqual([
    { kind: "set-nickname", contactId: "self", nickname: "Peer 1" },
  ]);
  expect(planDemoPeerSeed(input({ entries, side: "right" }))).toEqual([
    { kind: "set-nickname", contactId: "self", nickname: "Peer 2" },
  ]);
});

test("never clobbers an already-named self contact", () => {
  const entries = [contact({ id: "self", isSelf: true, nickname: "Alice" })];
  expect(planDemoPeerSeed(input({ entries }))).toEqual([]);
});

test("imports the peer under the opposite label once authenticated", () => {
  const entries = [contact({ id: "self", isSelf: true, nickname: "Peer 1" })];
  expect(
    planDemoPeerSeed(input({ entries, peerUserId: "peer-user", side: "left" })),
  ).toEqual([{ kind: "import-peer", nickname: "Peer 2", userId: "peer-user" }]);
});

test("waits for authentication and a known peer before importing", () => {
  const entries = [contact({ id: "self", isSelf: true, nickname: "Peer 1" })];
  expect(
    planDemoPeerSeed(
      input({ entries, isAuthenticated: false, peerUserId: "peer-user" }),
    ),
  ).toEqual([]);
  expect(planDemoPeerSeed(input({ entries, peerUserId: null }))).toEqual([]);
});

test("names an already-imported but unnamed peer instead of re-importing", () => {
  const entries = [
    contact({ id: "self", isSelf: true, nickname: "Peer 1" }),
    contact({ id: "peer", userId: "peer-user" }),
  ];
  expect(
    planDemoPeerSeed(input({ entries, peerUserId: "peer-user", side: "left" })),
  ).toEqual([{ kind: "set-nickname", contactId: "peer", nickname: "Peer 2" }]);
});

test("plans nothing when self and peer are already seeded", () => {
  const entries = [
    contact({ id: "self", isSelf: true, nickname: "Peer 1" }),
    contact({ id: "peer", userId: "peer-user", nickname: "Peer 2" }),
  ];
  expect(planDemoPeerSeed(input({ entries, peerUserId: "peer-user" }))).toEqual(
    [],
  );
});

test("action keys distinguish imports from nickname writes", () => {
  expect(
    demoPeerSeedActionKey({
      kind: "import-peer",
      nickname: "Peer 2",
      userId: "peer-user",
    }),
  ).toBe("import-peer:peer-user");
  expect(
    demoPeerSeedActionKey({
      kind: "set-nickname",
      contactId: "self",
      nickname: "Peer 1",
    }),
  ).toBe("set-nickname:self:Peer 1");
});
