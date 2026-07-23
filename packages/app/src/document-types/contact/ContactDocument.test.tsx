import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import {
  useWindowTitleBarActions,
  WindowMenuProvider,
} from "../../components/window/WindowMenuContext";
import { ContactDocumentFields } from "./ContactDocument";
import type { ContactFieldValues } from "./contactFieldDescriptors";

afterEach(cleanup);

const values: ContactFieldValues = {
  encapsulationPublicKey: "public-key",
  firstName: "Ada",
  lastName: "Lovelace",
  nickname: "Countess",
  userId: "ada-user",
};

function ToolbarProbe() {
  const actions = useWindowTitleBarActions();

  return (
    <div aria-label="Toolbar" role="toolbar">
      {actions.map((action) => (
        <button
          aria-label={action.label}
          disabled={action.disabled}
          key={action.id}
          type="button"
          onClick={action.onClick}
        />
      ))}
    </div>
  );
}

test("contact document edits from the toolbar", async () => {
  const editingStates: boolean[] = [];
  const view = render(
    <WindowMenuProvider>
      <ToolbarProbe />
      <ContactDocumentFields
        canWrite={true}
        isEditing={false}
        ready={true}
        // The fields component toggles through the state dispatch, so resolve
        // an updater against the rendered `isEditing` before recording it.
        setEditing={(editing) =>
          editingStates.push(
            typeof editing === "function" ? editing(false) : editing,
          )
        }
        setStructuredFields={async () => undefined}
        values={values}
      />
    </WindowMenuProvider>,
  );

  await waitFor(() => {
    expect(view.getByRole("button", { name: "Edit" })).toBeTruthy();
  });
  expect(view.container.querySelector(".mini-app-actions")).toBeNull();

  fireEvent.click(view.getByRole("button", { name: "Edit" }));

  expect(editingStates).toEqual([true]);
});
