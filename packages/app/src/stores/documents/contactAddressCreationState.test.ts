import { expect, test } from "bun:test";
import {
  type ContactAddressCreationState,
  transitionContactAddressCreation as transition,
} from "./contactAddressCreationState";

const creating: ContactAddressCreationState = { status: "creating" };
const fields = { street: "Original", postalCode: "00123" };

test("creation records identity once and keeps edited retry cells until acknowledged", () => {
  const identified = transition(creating, {
    type: "created",
    id: "original-id",
    fields,
  });
  expect(identified).toEqual({
    status: "identified",
    id: "original-id",
    fields,
  });
  expect(
    transition(identified, { type: "created", id: "duplicate", fields }),
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

test("an unknown creation identity cannot be edited or acknowledged", () => {
  expect(transition(creating, { type: "edit", fields })).toBe(creating);
  expect(transition(creating, { type: "saved" })).toBe(creating);
});
