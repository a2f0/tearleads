import { expect, test } from "bun:test";
import type { ContactEntry } from "../document-types/contact/contactDocumentModel";
import {
  SELF_CONTACT_NICKNAME_READY,
  selfContactNicknameStep,
  transitionSelfContactNickname,
} from "./selfContactNicknameMachine";

function contact(nickname: string | null): ContactEntry {
  return {
    encapsulationPublicKey: null,
    firstName: "",
    id: "self",
    isSelf: true,
    lastName: "",
    nickname,
    userId: "user-self",
  };
}

test("a nickname the contact already has is kept without a write", () => {
  expect(
    selfContactNicknameStep(SELF_CONTACT_NICKNAME_READY, contact("Robert")),
  ).toBe("named");
  expect(
    selfContactNicknameStep(SELF_CONTACT_NICKNAME_READY, contact(null)),
  ).toBe("write");
});

test("a failed save is no proof, and retries only once the contact changes", () => {
  const attempt = {};
  const writing = transitionSelfContactNickname(SELF_CONTACT_NICKNAME_READY, {
    attempt,
    type: "write-started",
  });
  expect(selfContactNicknameStep(writing, contact(null))).toBe("wait");
  // The failed save left its edit in memory: "Bob" shows on that same entry.
  const leftBehind = contact("Bob");
  const failed = transitionSelfContactNickname(writing, {
    attempt,
    contact: leftBehind,
    saved: false,
    type: "write-settled",
  });
  expect(selfContactNicknameStep(failed, leftBehind)).toBe("wait");
  expect(selfContactNicknameStep(failed, contact("Bob"))).toBe("write");
});

test("an acknowledged save names the contact whatever the entry shows yet", () => {
  const attempt = {};
  const saved = transitionSelfContactNickname(
    transitionSelfContactNickname(SELF_CONTACT_NICKNAME_READY, {
      attempt,
      type: "write-started",
    }),
    { attempt, contact: null, saved: true, type: "write-settled" },
  );
  expect(selfContactNicknameStep(saved, contact(null))).toBe("named");
  // A settle with no write in flight changes nothing.
  expect(
    transitionSelfContactNickname(saved, {
      attempt,
      contact: null,
      saved: false,
      type: "write-settled",
    }),
  ).toBe(saved);
});

test("only the save in flight settles it", () => {
  const writing = transitionSelfContactNickname(SELF_CONTACT_NICKNAME_READY, {
    attempt: {},
    type: "write-started",
  });
  expect(
    transitionSelfContactNickname(writing, {
      attempt: {},
      contact: null,
      saved: false,
      type: "write-settled",
    }),
  ).toBe(writing);
});
