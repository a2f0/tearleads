import { expect, test } from "bun:test";
import {
  type ContactAddressCreationState,
  transitionContactAddressCreation as transition,
} from "./contactAddressCreationState";

const creating: ContactAddressCreationState = { status: "creating" };
const fields = { street: "Original", postalCode: "00123" };

test("creation records identity once and keeps edited retry cells until acknowledged", () => {
  const unconfirmed = transition(creating, {
    type: "returned",
    id: "original-id",
    fields,
  });
  expect(unconfirmed).toEqual({
    status: "unconfirmed",
    id: "original-id",
    fields,
  });
  const identified = transition(unconfirmed, {
    type: "reconciled",
    exists: true,
  });
  expect(identified).toEqual({
    status: "identified",
    id: "original-id",
    fields,
  });
  expect(
    transition(identified, { type: "returned", id: "duplicate", fields }),
  ).toBe(identified);
  const updating = transition(identified, {
    type: "edit",
    fields: { ...fields, street: "Edited" },
  });
  expect(updating).toEqual({
    status: "updating",
    id: "original-id",
    fields: { ...fields, street: "Edited" },
    patch: { street: "Edited" },
  });
  const retry = transition(updating, { type: "edit", fields });
  expect(retry).toEqual({
    status: "updating",
    id: "original-id",
    fields,
    patch: { street: "Original" },
  });
  const saved = transition(retry, { type: "saved" });
  expect(saved).toEqual(identified);
  expect(transition(saved, { type: "edit", fields })).toEqual({
    status: "updating",
    id: "original-id",
    fields,
    patch: {},
  });
});

test("only an unconfirmed absent creation may be attempted again after reconciliation", () => {
  const unconfirmed = transition(creating, {
    type: "returned",
    id: "possibly-pending",
    fields,
  });
  expect(transition(unconfirmed, { type: "edit", fields })).toBe(unconfirmed);
  expect(transition(unconfirmed, { type: "saved" })).toBe(unconfirmed);
  expect(
    transition(unconfirmed, { type: "returned", id: "duplicate", fields }),
  ).toBe(unconfirmed);
  expect(
    transition(unconfirmed, { type: "reconciled", exists: false }),
  ).toEqual(creating);
  const identified = transition(unconfirmed, {
    type: "reconciled",
    exists: true,
  });
  expect(transition(identified, { type: "reconciled", exists: false })).toBe(
    identified,
  );
  const updating = transition(identified, { type: "edit", fields });
  expect(transition(updating, { type: "reconciled", exists: false })).toBe(
    updating,
  );
  expect(transition(creating, { type: "reconciled", exists: false })).toBe(
    creating,
  );
});

test("an unknown creation identity cannot be edited or acknowledged", () => {
  expect(transition(creating, { type: "edit", fields })).toBe(creating);
  expect(transition(creating, { type: "saved" })).toBe(creating);
});
