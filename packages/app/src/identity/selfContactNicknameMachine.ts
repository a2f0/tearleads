import type { ContactEntry } from "../document-types/contact/contactDocumentModel";

/**
 * One page's attempt to name the account's self contact.
 *
 * - `ready`: nothing written yet; a nickname the contact already has is kept.
 * - `writing`: a save is in flight.
 * - `failed`: the last save was not acknowledged. A nickname now showing is
 *   the unsaved edit, so the writer retries once the contact changes from
 *   `contact`, the entry the failed save left behind.
 * - `saved`: the store acknowledged the nickname.
 */
export type SelfContactNicknameState =
  | { readonly status: "ready" }
  | { readonly status: "writing" }
  | { readonly contact: ContactEntry | null; readonly status: "failed" }
  | { readonly status: "saved" };

export type SelfContactNicknameEvent =
  | { readonly type: "write-started" }
  | {
      readonly contact: ContactEntry | null;
      readonly saved: boolean;
      readonly type: "write-settled";
    };

export const SELF_CONTACT_NICKNAME_READY: SelfContactNicknameState = {
  status: "ready",
};

export function transitionSelfContactNickname(
  state: SelfContactNicknameState,
  event: SelfContactNicknameEvent,
): SelfContactNicknameState {
  switch (event.type) {
    case "write-started":
      return state.status === "ready" || state.status === "failed"
        ? { status: "writing" }
        : state;
    case "write-settled":
      if (state.status !== "writing") {
        return state;
      }
      return event.saved
        ? { status: "saved" }
        : { contact: event.contact, status: "failed" };
  }
}

/** What to do about the account's self contact `self` in `state`. */
export function selfContactNicknameStep(
  state: SelfContactNicknameState,
  self: ContactEntry,
): "named" | "wait" | "write" {
  switch (state.status) {
    case "saved":
      return "named";
    case "writing":
      return "wait";
    case "ready":
      return (self.nickname ?? "").trim().length > 0 ? "named" : "write";
    case "failed":
      return state.contact === self ? "wait" : "write";
  }
}
