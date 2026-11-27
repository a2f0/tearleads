type Fields = Readonly<Record<string, string>>;

export type ContactAddressCreationState =
  | { status: "creating" }
  | { status: "refused" }
  | { status: "unconfirmed"; id: string; fields: Fields }
  | { status: "identified"; id: string; fields: Fields }
  | { status: "updating"; id: string; fields: Fields; patch: Fields };

type Event =
  | { type: "refused" }
  | { type: "retry" }
  | { type: "returned"; id: string; fields: Fields }
  | { type: "reconciled"; exists: boolean }
  | { type: "edit"; fields: Fields }
  | { type: "saved" };

function buildEditPatch(
  state: Extract<
    ContactAddressCreationState,
    { status: "identified" | "updating" }
  >,
  nextFields: Fields,
): Fields {
  return Object.fromEntries(
    Object.entries(nextFields).filter(
      ([key, value]) =>
        value !== state.fields[key] ||
        (state.status === "updating" && key in state.patch),
    ),
  );
}

function transitionEditEvent(
  state: ContactAddressCreationState,
  nextFields: Fields,
): ContactAddressCreationState {
  if (state.status !== "identified" && state.status !== "updating") {
    return state;
  }
  return {
    status: "updating",
    id: state.id,
    fields: nextFields,
    patch: buildEditPatch(state, nextFields),
  };
}

// A thrown SDK call with no returned id stays "creating": there is no safe
// identity to recover and guessing a replacement could duplicate a live row.
// A null return proves no row was mutated, so the intent moves to "refused"
// while keeping its store, lifetime, and author bindings for a later retry.
export function transitionContactAddressCreation(
  state: ContactAddressCreationState,
  event: Event,
): ContactAddressCreationState {
  switch (event.type) {
    case "refused":
      return state.status === "creating" ? { status: "refused" } : state;
    case "retry":
      return state.status === "refused" ? { status: "creating" } : state;
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
    case "edit":
      return transitionEditEvent(state, event.fields);
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
