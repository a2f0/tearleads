import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import {
  useWindowTitleBarActions,
  WindowMenuProvider,
} from "../../components/window/WindowMenuContext";
import { createAppHostConfig } from "../../host/AppHostConfig";
import { AppHostConfigProvider } from "../../providers/host/AppHostConfigProvider";
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

const hostConfig = createAppHostConfig({
  apiBaseUrl: "http://api.example.test",
  wsUrl: "ws://api.example.test/events",
});

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
  let toggleCount = 0;
  const view = render(
    <AppHostConfigProvider value={hostConfig}>
      <WindowMenuProvider>
        <ToolbarProbe />
        <ContactDocumentFields
          canWrite={true}
          isEditing={false}
          ready={true}
          toggleEditing={() => {
            toggleCount += 1;
          }}
          setStructuredFields={async () => undefined}
          values={values}
        />
      </WindowMenuProvider>
    </AppHostConfigProvider>,
  );

  await waitFor(() => {
    expect(view.getByRole("button", { name: "Edit" })).toBeTruthy();
  });
  expect(view.container.querySelector(".mini-app-actions")).toBeNull();

  fireEvent.click(view.getByRole("button", { name: "Edit" }));

  expect(toggleCount).toBe(1);
});
