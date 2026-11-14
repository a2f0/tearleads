import {
  MiniAppActions,
  MiniAppButton,
  MiniAppField,
  MiniAppInput,
  MiniAppStatus,
} from "../../components/mini-app/MiniAppLayout";
import { CONTACT_ADDRESS_FIELD_DESCRIPTORS } from "./contactAddressModel";
import type { useContactAddressEditor } from "./useContactAddressEditor";

export function ContactAddressesEditor({
  editor,
}: {
  editor: ReturnType<typeof useContactAddressEditor>;
}) {
  const { state, dispatch, writable } = editor;
  if (state.status !== "editing" && state.status !== "saving") return null;
  const busy = state.status === "saving";
  return (
    <form
      aria-label="Address editor"
      className="contact-addresses-editor"
      onSubmit={(event) => {
        event.preventDefault();
        editor.save();
      }}
    >
      <div className="contact-addresses-fields">
        {CONTACT_ADDRESS_FIELD_DESCRIPTORS.map(({ key, label }) => (
          <MiniAppField key={key}>
            {label}
            <MiniAppInput
              value={state.draft.values[key]}
              disabled={!writable || busy}
              onChange={(event) =>
                dispatch({ type: "change", key, value: event.target.value })
              }
            />
          </MiniAppField>
        ))}
      </div>
      {state.draft.submitted !== null ? (
        <MiniAppStatus>
          Changes may already be applied locally. Retry to confirm they are
          saved before closing this draft.
        </MiniAppStatus>
      ) : null}
      <MiniAppActions>
        <MiniAppButton type="submit" disabled={!writable || busy}>
          Save address
        </MiniAppButton>
        <MiniAppButton
          disabled={busy || state.draft.submitted !== null}
          onClick={() => dispatch({ type: "cancel" })}
        >
          Cancel address editing
        </MiniAppButton>
      </MiniAppActions>
    </form>
  );
}
