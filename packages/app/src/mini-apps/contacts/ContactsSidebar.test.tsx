import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import {
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useCallback,
  useState,
} from "react";
import type { ContactEntry } from "../../data/contacts/addressBookEntry";
import { useContactsSidebarPanel } from "./ContactsSidebar";

afterEach(() => {
  cleanup();
});

const entries: ContactEntry[] = [
  {
    id: "ada",
    firstName: "Ada",
    lastName: "Lovelace",
    userId: null,
    encapsulationPublicKey: null,
    isSelf: false,
  },
  {
    id: "grace",
    firstName: "Grace",
    lastName: "Hopper",
    userId: null,
    encapsulationPublicKey: null,
    isSelf: false,
  },
];

function ContactsSidebarHarness() {
  const [blurred, setBlurred] = useState(false);
  const [selectedContactId, setSelectedContactId] = useState<string | null>(
    null,
  );
  const [sidebar, setSidebar] = useState<ReactNode>(null);
  const handleContextMenu = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => event.preventDefault(),
    [],
  );

  useContactsSidebarPanel({
    entries,
    handleContextMenu,
    ready: true,
    selectedContactId,
    setSelectedContactId,
    setSidebar,
  });

  return (
    <>
      <input aria-label="Focused field" onBlur={() => setBlurred(true)} />
      <div>{sidebar}</div>
      <output aria-label="Selected contact">{selectedContactId ?? ""}</output>
      <output aria-label="Focused field blurred">
        {blurred ? "yes" : "no"}
      </output>
    </>
  );
}

test("contacts sidebar selects on primary mouse down after blurring active fields", async () => {
  const view = render(<ContactsSidebarHarness />);
  const focusedField = view.getByLabelText("Focused field");
  focusedField.focus();

  const contactButton = await view.findByRole("button", {
    name: "Grace Hopper",
  });
  fireEvent.mouseDown(contactButton, { button: 0 });

  await waitFor(() => {
    expect(view.getByLabelText("Focused field blurred").textContent).toBe(
      "yes",
    );
    expect(view.getByLabelText("Selected contact").textContent).toBe("grace");
  });
});
