import { expect, test } from "bun:test";
import {
  CLOSED_ORG_MANAGER_DIALOGS,
  type OrgManagerDialogsEvent,
  type OrgManagerDialogsState,
  orgManagerDialogDraft,
  transitionOrgManagerDialogs,
} from "./orgManagerDialogsMachine";

const CLOSED = CLOSED_ORG_MANAGER_DIALOGS;
const CREATE_GROUP: OrgManagerDialogsState = {
  draft: "Ops",
  status: "createGroup",
};
const IMPORT_USER: OrgManagerDialogsState = {
  draft: "link",
  status: "importUser",
};
const EMPTY_CREATE_GROUP: OrgManagerDialogsState = {
  draft: "",
  status: "createGroup",
};
const EMPTY_IMPORT_USER: OrgManagerDialogsState = {
  draft: "",
  status: "importUser",
};

const OPEN_CREATE_GROUP: OrgManagerDialogsEvent = {
  dialog: "createGroup",
  type: "open",
};
const OPEN_IMPORT_USER: OrgManagerDialogsEvent = {
  dialog: "importUser",
  type: "open",
};
const EDIT_CREATE_GROUP: OrgManagerDialogsEvent = {
  dialog: "createGroup",
  draft: "x",
  type: "editDraft",
};
const EDIT_IMPORT_USER: OrgManagerDialogsEvent = {
  dialog: "importUser",
  draft: "x",
  type: "editDraft",
};
const CLOSE_CREATE_GROUP: OrgManagerDialogsEvent = {
  dialog: "createGroup",
  type: "close",
};
const CLOSE_IMPORT_USER: OrgManagerDialogsEvent = {
  dialog: "importUser",
  type: "close",
};
const RESET: OrgManagerDialogsEvent = { type: "reset" };

/** Every state against every event; `null` means the same state comes back. */
const CASES: ReadonlyArray<
  readonly [
    OrgManagerDialogsState,
    OrgManagerDialogsEvent,
    OrgManagerDialogsState | null,
  ]
> = [
  [CLOSED, OPEN_CREATE_GROUP, EMPTY_CREATE_GROUP],
  [CLOSED, OPEN_IMPORT_USER, EMPTY_IMPORT_USER],
  [CLOSED, EDIT_CREATE_GROUP, null],
  [CLOSED, EDIT_IMPORT_USER, null],
  [CLOSED, CLOSE_CREATE_GROUP, null],
  [CLOSED, CLOSE_IMPORT_USER, null],
  [CLOSED, RESET, null],
  [CREATE_GROUP, OPEN_CREATE_GROUP, EMPTY_CREATE_GROUP],
  [CREATE_GROUP, OPEN_IMPORT_USER, EMPTY_IMPORT_USER],
  [CREATE_GROUP, EDIT_CREATE_GROUP, { draft: "x", status: "createGroup" }],
  [CREATE_GROUP, EDIT_IMPORT_USER, null],
  [CREATE_GROUP, CLOSE_CREATE_GROUP, CLOSED],
  [CREATE_GROUP, CLOSE_IMPORT_USER, null],
  [CREATE_GROUP, RESET, CLOSED],
  [IMPORT_USER, OPEN_CREATE_GROUP, EMPTY_CREATE_GROUP],
  [IMPORT_USER, OPEN_IMPORT_USER, EMPTY_IMPORT_USER],
  [IMPORT_USER, EDIT_CREATE_GROUP, null],
  [IMPORT_USER, EDIT_IMPORT_USER, { draft: "x", status: "importUser" }],
  [IMPORT_USER, CLOSE_CREATE_GROUP, null],
  [IMPORT_USER, CLOSE_IMPORT_USER, CLOSED],
  [IMPORT_USER, RESET, CLOSED],
];

test("org manager dialogs follow the transition table", () => {
  for (const [state, event, expected] of CASES) {
    const next = transitionOrgManagerDialogs(state, event);
    if (expected === null) {
      expect(next).toBe(state);
    } else {
      expect(next).toEqual(expected);
    }
  }
});

test("retyping the same draft keeps the state", () => {
  expect(
    transitionOrgManagerDialogs(CREATE_GROUP, {
      dialog: "createGroup",
      draft: "Ops",
      type: "editDraft",
    }),
  ).toBe(CREATE_GROUP);
});

test("opening one dialog drops the other's draft for good", () => {
  const events: OrgManagerDialogsEvent[] = [
    OPEN_IMPORT_USER,
    EDIT_IMPORT_USER,
    OPEN_CREATE_GROUP,
    CLOSE_CREATE_GROUP,
  ];
  const state = events.reduce(transitionOrgManagerDialogs, CLOSED);
  expect(state).toBe(CLOSED);
  expect(orgManagerDialogDraft(state, "importUser")).toBe("");
});

test("only the open dialog has a draft", () => {
  expect(orgManagerDialogDraft(CREATE_GROUP, "createGroup")).toBe("Ops");
  expect(orgManagerDialogDraft(CREATE_GROUP, "importUser")).toBe("");
  expect(orgManagerDialogDraft(IMPORT_USER, "importUser")).toBe("link");
  expect(orgManagerDialogDraft(CLOSED, "createGroup")).toBe("");
});
