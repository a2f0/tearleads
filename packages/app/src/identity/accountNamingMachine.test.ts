import { expect, test } from "bun:test";
import {
  ACCOUNT_NAME_SEAL_FAILED_MESSAGE,
  ACCOUNT_NAMING_IDLE,
  type AccountNamingEvent,
  type AccountNamingState,
  accountNamingFor,
  sealedAccountNaming,
  transitionAccountNaming,
} from "./accountNamingMachine";

function run(events: readonly AccountNamingEvent[]): AccountNamingState {
  return events.reduce(transitionAccountNaming, ACCOUNT_NAMING_IDLE);
}

const generated = {
  fingerprint: "fp-new",
  type: "identity-generated",
} as const;

test("a generated identity waits for a name, then carries the trimmed answer", () => {
  expect(run([generated])).toEqual({
    fingerprint: "fp-new",
    status: "awaiting",
  });
  expect(
    run([
      generated,
      { fingerprint: "fp-new", name: "  Bob   Smith ", type: "name-submitted" },
    ]),
  ).toEqual({
    contactNamed: false,
    fingerprint: "fp-new",
    name: "Bob Smith",
    sealed: false,
    status: "named",
  });
});

test("a blank answer or one for another identity leaves the prompt open", () => {
  const awaiting = run([generated]);
  expect(
    transitionAccountNaming(awaiting, {
      fingerprint: "fp-new",
      name: "   ",
      type: "name-submitted",
    }),
  ).toBe(awaiting);
  expect(
    transitionAccountNaming(awaiting, {
      fingerprint: "fp-other",
      name: "Bob",
      type: "name-submitted",
    }),
  ).toBe(awaiting);
});

test("a name is given once; a later answer cannot rename the account", () => {
  const named = run([
    generated,
    { fingerprint: "fp-new", name: "Bob", type: "name-submitted" },
  ]);
  expect(
    transitionAccountNaming(named, {
      fingerprint: "fp-new",
      name: "Alice",
      type: "name-submitted",
    }),
  ).toBe(named);
});

test("the self contact is marked named only for the named identity", () => {
  const named = run([
    generated,
    { fingerprint: "fp-new", name: "Bob", type: "name-submitted" },
  ]);
  expect(
    transitionAccountNaming(named, {
      fingerprint: "fp-other",
      type: "contact-named",
    }),
  ).toBe(named);
  expect(
    transitionAccountNaming(named, {
      fingerprint: "fp-new",
      type: "contact-named",
    }),
  ).toMatchObject({ contactNamed: true, name: "Bob" });
  expect(
    transitionAccountNaming(run([generated]), {
      fingerprint: "fp-new",
      type: "contact-named",
    }),
  ).toEqual({ fingerprint: "fp-new", status: "awaiting" });
});

test("switching to another identity leaves nothing to name", () => {
  const awaiting = run([generated]);
  expect(accountNamingFor(awaiting, "fp-new")).toBe(awaiting);
  expect(accountNamingFor(awaiting, "fp-restored")).toBe(ACCOUNT_NAMING_IDLE);
  expect(accountNamingFor(awaiting, null)).toBe(ACCOUNT_NAMING_IDLE);
});

test("a sealed naming fills in a restarted identity, never one this page named", () => {
  expect(
    run([
      {
        fingerprint: "fp-new",
        naming: { name: "Bob", status: "named" },
        type: "restored",
      },
    ]),
  ).toEqual({
    contactNamed: false,
    fingerprint: "fp-new",
    name: "Bob",
    sealed: true,
    status: "named",
  });
  const named = run([
    generated,
    { fingerprint: "fp-new", name: "Alice", type: "name-submitted" },
  ]);
  expect(
    transitionAccountNaming(named, {
      fingerprint: "fp-new",
      naming: { status: "awaiting" },
      type: "restored",
    }),
  ).toBe(named);
});

test("the sealed name outlives registration until the contact's nickname is saved", () => {
  const named = run([
    generated,
    { fingerprint: "fp-new", name: "Bob", type: "name-submitted" },
  ]);
  expect(sealedAccountNaming(named, false)).toEqual({
    name: "Bob",
    status: "named",
  });
  // Registered, but a restart now must still name the contact: keep it.
  expect(sealedAccountNaming(named, true)).toBeUndefined();
  const contactNamed = transitionAccountNaming(named, {
    fingerprint: "fp-new",
    type: "contact-named",
  });
  expect(sealedAccountNaming(contactNamed, true)).toBeNull();
});

test("a pending prompt is sealed until an account exists", () => {
  expect(sealedAccountNaming(run([generated]), false)).toEqual({
    status: "awaiting",
  });
  expect(sealedAccountNaming(run([generated]), true)).toBeNull();
  expect(sealedAccountNaming(ACCOUNT_NAMING_IDLE, false)).toBeUndefined();
  expect(sealedAccountNaming(ACCOUNT_NAMING_IDLE, true)).toBeNull();
});

test("a given name holds until stored, and one that could not be is asked again", () => {
  const named = run([
    generated,
    { fingerprint: "fp-new", name: "Bob", type: "name-submitted" },
  ]);
  const sealed = transitionAccountNaming(named, {
    fingerprint: "fp-new",
    name: "Bob",
    type: "name-sealed",
  });
  expect(sealed).toMatchObject({ sealed: true, status: "named" });
  // Stored once: nothing left to write until the account exists.
  expect(sealedAccountNaming(sealed, false)).toBeUndefined();

  expect(
    transitionAccountNaming(named, {
      fingerprint: "fp-new",
      name: "Bob",
      type: "seal-failed",
    }),
  ).toEqual({
    error: ACCOUNT_NAME_SEAL_FAILED_MESSAGE,
    fingerprint: "fp-new",
    status: "awaiting",
  });
  // Another identity's or an earlier name's outcome changes nothing.
  expect(
    transitionAccountNaming(named, {
      fingerprint: "fp-new",
      name: "Alice",
      type: "seal-failed",
    }),
  ).toBe(named);
});
