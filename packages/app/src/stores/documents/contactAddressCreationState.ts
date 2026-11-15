type Fields = Readonly<Record<string, string>>;

export type ContactAddressCreationState =
  | { status: "creating" }
  | { status: "unconfirmed"; id: string; fields: Fields }
  | { status: "identified"; id: string; fields: Fields }
  | { status: "updating"; id: string; fields: Fields; patch: Fields };

type Event =
  | { type: "returned"; id: string; fields: Fields }
  | { type: "reconciled"; exists: boolean }
  | { type: "edit"; fields: Fields }
  | { type: "saved" };

// A thrown SDK call with no returned id stays "creating": there is no safe
// identity to recover and guessing a replacement could duplicate a live row.
export function transitionContactAddressCreation(
  state: ContactAddressCreationState,
  event: Event,
): ContactAddressCreationState {
  switch (event.type) {
    case "returned":
      return state.status === "creating"
        ? { status: "unconfirmed", id: event.id, fields: event.fields }
        : state;
    case "reconciled":
      // Only reconcile against a clean store after flushing pending deltas.
      // An absent published row alone does not rule out a failed live creation.
      if (state.status !== "unconfirmed") return state;
      return event.exists
        ? { status: "identified", id: state.id, fields: state.fields }
        : { status: "creating" };
    case "edit": {
      if (state.status === "creating" || state.status === "unconfirmed")
        return state;
      const patch = Object.fromEntries(
        Object.entries(event.fields).filter(
          ([key, value]) =>
            value !== state.fields[key] ||
            (state.status === "updating" && key in state.patch),
        ),
      );
      return { status: "updating", id: state.id, fields: event.fields, patch };
    }
    case "saved":
      return state.status === "updating"
        ? { status: "identified", id: state.id, fields: state.fields }
        : state;
    default: {
      const exhaustive: never = event;
      return exhaustive;
    }
  }
}
