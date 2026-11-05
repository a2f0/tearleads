import { expect, test } from "bun:test";
import {
  initialStructuredDocumentEditingState,
  type StructuredDocumentEditingState,
  transitionStructuredDocumentEditing,
} from "./structuredDocumentEditingMachine";

type EditingEvent = Parameters<typeof transitionStructuredDocumentEditing>[1];

const EDITING: StructuredDocumentEditingState = { status: "editing" };
const LOCKED: StructuredDocumentEditingState = { status: "locked" };
const VIEWING: StructuredDocumentEditingState = { status: "viewing" };
const WAITING: StructuredDocumentEditingState = {
  status: "waiting-for-write-access",
};
const GAINED: EditingEvent = { canWrite: true, type: "write-access-changed" };
const LOST: EditingEvent = { canWrite: false, type: "write-access-changed" };
const REQUESTED: EditingEvent = { type: "initial-edit-requested" };
const TOGGLED: EditingEvent = { type: "toggled" };
const ENTERED: EditingEvent = { type: "edit-entered" };

test("initial editing state combines write access and the initial request", () => {
  expect(
    initialStructuredDocumentEditingState({
      canWrite: true,
      initialEditing: true,
    }),
  ).toEqual(EDITING);
  expect(
    initialStructuredDocumentEditingState({
      canWrite: true,
      initialEditing: false,
    }),
  ).toEqual(VIEWING);
  expect(
    initialStructuredDocumentEditingState({
      canWrite: false,
      initialEditing: true,
    }),
  ).toEqual(WAITING);
  expect(
    initialStructuredDocumentEditingState({
      canWrite: false,
      initialEditing: false,
    }),
  ).toEqual(LOCKED);
});

test("structured document editing follows the transition table", () => {
  const table: ReadonlyArray<
    readonly [
      StructuredDocumentEditingState,
      EditingEvent,
      StructuredDocumentEditingState,
    ]
  > = [
    [LOCKED, REQUESTED, WAITING],
    [LOCKED, GAINED, VIEWING],
    [WAITING, GAINED, EDITING],
    [VIEWING, REQUESTED, EDITING],
    [VIEWING, TOGGLED, EDITING],
    [VIEWING, ENTERED, EDITING],
    [VIEWING, LOST, LOCKED],
    [EDITING, TOGGLED, VIEWING],
    [EDITING, LOST, LOCKED],
  ];

  for (const [state, event, expected] of table) {
    expect(transitionStructuredDocumentEditing(state, event)).toEqual(expected);
  }
});

test("structured document editing ignores events that change nothing", () => {
  const unchanged: ReadonlyArray<
    readonly [StructuredDocumentEditingState, EditingEvent]
  > = [
    [LOCKED, TOGGLED],
    [LOCKED, ENTERED],
    [LOCKED, LOST],
    [WAITING, REQUESTED],
    [WAITING, TOGGLED],
    [WAITING, ENTERED],
    [WAITING, LOST],
    [VIEWING, GAINED],
    [EDITING, REQUESTED],
    [EDITING, ENTERED],
    [EDITING, GAINED],
  ];

  for (const [state, event] of unchanged) {
    expect(transitionStructuredDocumentEditing(state, event)).toBe(state);
  }
});
