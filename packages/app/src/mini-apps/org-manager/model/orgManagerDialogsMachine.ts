/**
 * The Org Manager's create-group and import-user dialogs. At most one is
 * open, and only the open one has a draft, so a dialog hidden by a section
 * change cannot come back later with a stale draft.
 *
 * | state       | open(d)     | editDraft(d)    | close(d)         | reset  |
 * | ----------- | ----------- | --------------- | ---------------- | ------ |
 * | closed      | d, draft "" | -               | -                | -      |
 * | createGroup | d, draft "" | draft if d open | closed if d open | closed |
 * | importUser  | d, draft "" | draft if d open | closed if d open | closed |
 *
 * `-` returns the same state. Opening either dialog replaces the other, and a
 * close names the dialog it dismisses, so it cannot close its replacement.
 */
export type OrgManagerDialog = "createGroup" | "importUser";

export type OrgManagerDialogsState =
  | { readonly status: "closed" }
  | { readonly status: OrgManagerDialog; readonly draft: string };

export type OrgManagerDialogsEvent =
  /** The operator asked for the dialog; it opens with an empty draft. */
  | { readonly type: "open"; readonly dialog: OrgManagerDialog }
  /** The operator typed into the open dialog. */
  | {
      readonly type: "editDraft";
      readonly dialog: OrgManagerDialog;
      readonly draft: string;
    }
  /** Cancelled by the operator, or its mutation finished. */
  | { readonly type: "close"; readonly dialog: OrgManagerDialog }
  /** The organization scope changed: no dialog survives it. */
  | { readonly type: "reset" };

export const CLOSED_ORG_MANAGER_DIALOGS: OrgManagerDialogsState = {
  status: "closed",
};

export function transitionOrgManagerDialogs(
  state: OrgManagerDialogsState,
  event: OrgManagerDialogsEvent,
): OrgManagerDialogsState {
  switch (event.type) {
    case "open":
      return { draft: "", status: event.dialog };
    case "editDraft":
      return state.status === event.dialog && state.draft !== event.draft
        ? { draft: event.draft, status: event.dialog }
        : state;
    case "close":
      return state.status === event.dialog ? CLOSED_ORG_MANAGER_DIALOGS : state;
    case "reset":
      return state.status === "closed" ? state : CLOSED_ORG_MANAGER_DIALOGS;
    default:
      return assertNever(event);
  }
}

/** The open dialog's draft, or an empty one when `dialog` is not open. */
export function orgManagerDialogDraft(
  state: OrgManagerDialogsState,
  dialog: OrgManagerDialog,
): string {
  return state.status === dialog ? state.draft : "";
}

function assertNever(value: never): never {
  throw new Error(
    `Unhandled Org Manager dialog event: ${JSON.stringify(value)}`,
  );
}
