import { afterEach, expect, test } from "bun:test";
import {
  cleanup,
  fireEvent,
  render,
  waitFor,
  within,
} from "@testing-library/react";
import {
  useWindowTitleBarActions,
  WindowMenuProvider,
} from "../../components/window/WindowMenuContext";
import { BloodPressureFields } from "./BloodPressure";
import type { BloodPressureQuickReading } from "./BloodPressureQuickAdd";
import type { BloodPressureReadingRow } from "./bloodPressureReadings";

afterEach(cleanup);

// Stands in for the pane header's toolbar. Labels are prefixed so a toolbar
// action never collides with a same-named body/menu control in queries.
function ToolbarProbe() {
  const actions = useWindowTitleBarActions();

  return (
    <div aria-label="Toolbar" role="toolbar">
      {actions.map((action) => (
        <button
          aria-label={`Toolbar ${action.label}`}
          disabled={action.disabled}
          key={action.id}
          type="button"
          onClick={action.onClick}
        />
      ))}
    </div>
  );
}

function makeReading(
  overrides: Partial<BloodPressureReadingRow> & { id: string },
): BloodPressureReadingRow {
  return {
    systolic: "",
    diastolic: "",
    pulse: "",
    measuredAt: "",
    notes: "",
    createdAt: "",
    createdBy: "",
    createdByPeer: null,
    updatedAt: "",
    updatedBy: "",
    updatedByPeer: null,
    fieldEditors: {},
    ...overrides,
  };
}

const readings: BloodPressureReadingRow[] = [
  makeReading({
    id: "r1",
    systolic: "120",
    diastolic: "80",
    pulse: "72",
    measuredAt: "2026-07-16T08:30",
    notes: "Before coffee",
    updatedAt: "2026-07-16T08:30:00.000Z",
    updatedBy: "user-alice",
    updatedByPeer: "7",
  }),
  makeReading({
    id: "r2",
    systolic: "118",
    diastolic: "76",
    measuredAt: "2026-07-16T20:15",
  }),
];

// A fully-attributed reading: systolic was last written by peer 9 (→ user-bob);
// every other cell by peer 7 (→ user-alice, the local author, shown as "you").
const attributedReading = makeReading({
  id: "r1",
  systolic: "120",
  diastolic: "80",
  pulse: "72",
  measuredAt: "2026-07-16T08:30",
  notes: "Before coffee",
  createdAt: "2026-07-16T08:00:00.000Z",
  createdBy: "user-alice",
  createdByPeer: "7",
  updatedAt: "2026-07-16T09:00:00.000Z",
  updatedBy: "user-alice",
  updatedByPeer: "9",
  fieldEditors: {
    systolic: "9",
    diastolic: "7",
    pulse: "7",
    measuredAt: "7",
    notes: "7",
  },
});

const attributedResolver = (peer: string | null): string | null => {
  if (peer === "9") {
    return "user-bob";
  }
  if (peer === "7") {
    return "user-alice";
  }
  return null;
};

function renderBloodPressureFields(params?: {
  currentAuthorId?: string | null;
  isEditing?: boolean | undefined;
  onAddReading?: (reading?: BloodPressureQuickReading) => void;
  onEnterEdit?: (() => void) | undefined;
  onRemoveReading?: (id: string) => void;
  onRenameTracker?: (value: string) => void;
  onToggleEditing?: () => void;
  onUpdateReading?: (id: string, field: string, value: string) => void;
  readings?: BloodPressureReadingRow[];
  ready?: boolean;
  resolveRowWriter?: (updatedByPeer: string | null) => string | null;
  trackerName?: string;
}) {
  return render(
    <WindowMenuProvider>
      <ToolbarProbe />
      <BloodPressureFields
        currentAuthorId={params?.currentAuthorId ?? null}
        isEditing={params?.isEditing}
        onAddReading={params?.onAddReading ?? (() => undefined)}
        onEnterEdit={params?.onEnterEdit}
        onRemoveReading={params?.onRemoveReading ?? (() => undefined)}
        onRenameTracker={params?.onRenameTracker ?? (() => undefined)}
        onToggleEditing={params?.onToggleEditing ?? (() => undefined)}
        onUpdateReading={params?.onUpdateReading ?? (() => undefined)}
        readings={params?.readings ?? readings}
        ready={params?.ready ?? true}
        resolveRowWriter={params?.resolveRowWriter}
        trackerName={params?.trackerName ?? "Home log"}
        trackerNameInputId="blood-pressure-name"
      />
    </WindowMenuProvider>,
  );
}

test("renders readings as editable measurement rows", () => {
  const view = renderBloodPressureFields();

  expect(
    (view.getByLabelText("Blood pressure tracker name") as HTMLInputElement)
      .value,
  ).toBe("Home log");
  expect(
    (view.getByLabelText("Reading 1 systolic") as HTMLInputElement).value,
  ).toBe("120");
  expect(
    (view.getByLabelText("Reading 1 diastolic") as HTMLInputElement).value,
  ).toBe("80");
  expect(
    (view.getByLabelText("Reading 1 pulse") as HTMLInputElement).value,
  ).toBe("72");
  expect(
    (view.getByLabelText("Reading 1 measured at") as HTMLInputElement).value,
  ).toBe("2026-07-16T08:30");
  expect(
    view.container.querySelector(".blood-pressure-reading-row"),
  ).toBeTruthy();
});

test("toggles editing from the toolbar, not a body button", async () => {
  let toggleCalls = 0;
  const view = renderBloodPressureFields({
    isEditing: false,
    onToggleEditing: () => {
      toggleCalls += 1;
    },
    readings: [],
  });

  await waitFor(() => {
    expect(view.getByRole("button", { name: "Toolbar Edit" })).toBeTruthy();
  });
  // The tracker body no longer carries its own Edit control.
  expect(view.queryByRole("button", { name: "Edit" })).toBeNull();

  fireEvent.click(view.getByRole("button", { name: "Toolbar Edit" }));
  expect(toggleCalls).toBe(1);
});

test("toolbar action becomes Done while editing", async () => {
  const view = renderBloodPressureFields({ isEditing: true, readings: [] });

  await waitFor(() => {
    expect(view.getByRole("button", { name: "Toolbar Done" })).toBeTruthy();
  });
  expect(view.queryByRole("button", { name: "Toolbar Edit" })).toBeNull();
});

test("toolbar action is disabled while the document is loading", async () => {
  const view = renderBloodPressureFields({ isEditing: false, ready: false });

  await waitFor(() => {
    expect(
      (view.getByRole("button", { name: "Toolbar Edit" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });
});

test("read mode renders formatted measurements and attribution", () => {
  const view = renderBloodPressureFields({
    currentAuthorId: "user-alice",
    isEditing: false,
  });

  expect(view.queryByText("Home log")).toBeNull();
  expect(view.getByText("120/80 mmHg")).toBeTruthy();
  expect(view.getByText("72 bpm")).toBeTruthy();
  expect(view.getByText("2026-07-16 08:30")).toBeTruthy();
  expect(view.getByText("Before coffee")).toBeTruthy();
  expect(view.getByText("Updated 2026-07-16 08:30 by you")).toBeTruthy();
  expect(view.queryByLabelText("Blood pressure tracker name")).toBeNull();
});

test("read mode tolerates missing reading values", () => {
  const view = renderBloodPressureFields({
    readings: [makeReading({ id: "r-missing" })],
    isEditing: false,
  });

  // Reading pair, pulse, and measured time all fall back to None.
  expect(view.getAllByText("None")).toHaveLength(3);
});

test("read mode resolves an authoritative writer over the self-attested one", () => {
  const view = renderBloodPressureFields({
    currentAuthorId: "user-alice",
    isEditing: false,
    readings: [
      makeReading({
        id: "r1",
        systolic: "120",
        diastolic: "80",
        // Self-attested author claims alice, but the row was actually written
        // by peer "9", which the resolver maps to the verified writer user-bob.
        updatedAt: "2026-07-16T08:30:00.000Z",
        updatedBy: "user-alice",
        updatedByPeer: "9",
      }),
    ],
    resolveRowWriter: (peer) => (peer === "9" ? "user-bob" : null),
  });

  expect(view.getByText("Updated 2026-07-16 08:30 by user-bob")).toBeTruthy();
  expect(view.queryByText("Updated 2026-07-16 08:30 by you")).toBeNull();
});

test("read mode falls back to the self-attested author when unresolved", () => {
  const view = renderBloodPressureFields({
    currentAuthorId: "user-alice",
    isEditing: false,
    // r1's updatedBy is user-alice (=== currentAuthorId) → "you".
    resolveRowWriter: () => null,
  });

  expect(view.getByText("Updated 2026-07-16 08:30 by you")).toBeTruthy();
});

test("read-only viewer opens attribution directly, without showing values", () => {
  const view = renderBloodPressureFields({
    currentAuthorId: "user-alice",
    isEditing: false,
    // No onEnterEdit → read-only viewer: the single-action kebab opens the
    // attribution overlay directly rather than a one-item menu.
    readings: [attributedReading],
    resolveRowWriter: attributedResolver,
  });

  expect(view.queryByRole("dialog")).toBeNull();
  const kebab = view.getByRole("button", { name: "Reading 1 attribution" });
  expect(view.queryByRole("button", { name: "Add Reading" })).toBeNull();
  kebab.focus();
  fireEvent.click(kebab);

  const dialog = view.getByRole("dialog", { name: "Reading 1" });
  // Systolic resolves to the other writer; the remaining cells to the local one.
  expect(within(dialog).getByText("set by user-bob")).toBeTruthy();
  expect(within(dialog).getAllByText("set by you").length).toBeGreaterThan(0);
  // The attribution view lists who set each field, never the field values.
  expect(within(dialog).queryByText("120")).toBeNull();
  expect(within(dialog).queryByText("Before coffee")).toBeNull();

  // Opening moves focus into the dialog; closing restores it to the kebab so a
  // keyboard user never loses their place in the list.
  const close = view.getByRole("button", { name: "Close" });
  expect(document.activeElement).toBe(close);
  fireEvent.click(close);
  expect(view.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(kebab);
});

test("writer's kebab menu offers Edit and Attribution", () => {
  let editCalls = 0;
  const view = renderBloodPressureFields({
    currentAuthorId: "user-alice",
    isEditing: false,
    onEnterEdit: () => {
      editCalls += 1;
    },
    readings: [attributedReading],
    resolveRowWriter: attributedResolver,
  });

  // The kebab opens a menu (not the dialog directly). Attribution opens the
  // overlay with per-field writers and no values.
  expect(view.queryByRole("dialog")).toBeNull();
  fireEvent.click(view.getByRole("button", { name: "Reading 1 actions" }));
  fireEvent.click(view.getByRole("button", { name: "Attribution" }));

  const dialog = view.getByRole("dialog", { name: "Reading 1" });
  expect(within(dialog).getByText("set by user-bob")).toBeTruthy();
  expect(within(dialog).queryByText("120")).toBeNull();
  fireEvent.click(view.getByRole("button", { name: "Close" }));

  // Edit switches the tracker into edit mode.
  fireEvent.click(view.getByRole("button", { name: "Reading 1 actions" }));
  fireEvent.click(view.getByRole("button", { name: "Edit" }));
  expect(editCalls).toBe(1);
});

test("read mode leaves the tracker name to the document title bar", () => {
  const view = renderBloodPressureFields({
    isEditing: false,
    readings: [],
    trackerName: "",
  });

  expect(view.queryByText("Blood Pressure Tracker")).toBeNull();
  expect(view.getByText("0 entries")).toBeTruthy();
});

test("quick add saves a populated reading without entering edit mode", () => {
  const added: BloodPressureQuickReading[] = [];
  const view = renderBloodPressureFields({
    isEditing: false,
    onEnterEdit: () => undefined,
    onAddReading: (reading) => {
      if (reading) {
        added.push(reading);
      }
    },
  });

  fireEvent.click(view.getByRole("button", { name: "Add Reading" }));
  fireEvent.change(view.getByLabelText("Quick add systolic"), {
    target: { value: "119" },
  });
  fireEvent.change(view.getByLabelText("Quick add diastolic"), {
    target: { value: "78" },
  });
  fireEvent.change(view.getByLabelText("Quick add pulse"), {
    target: { value: "68" },
  });
  fireEvent.change(view.getByLabelText("Quick add measured at"), {
    target: { value: "2026-07-25T08:30" },
  });
  fireEvent.change(view.getByLabelText("Quick add notes"), {
    target: { value: "After waking" },
  });
  fireEvent.click(view.getByRole("button", { name: "Save Reading" }));

  expect(added).toEqual([
    {
      diastolic: "78",
      measuredAt: "2026-07-25T08:30",
      notes: "After waking",
      pulse: "68",
      systolic: "119",
    },
  ]);
  expect(view.getByRole("button", { name: "Toolbar Edit" })).toBeTruthy();
  expect(view.queryByLabelText("Blood pressure tracker name")).toBeNull();
});

test("quick add rejects invalid readings and cancel clears the draft", () => {
  const view = renderBloodPressureFields({
    isEditing: false,
    onEnterEdit: () => undefined,
  });

  fireEvent.click(view.getByRole("button", { name: "Add Reading" }));
  const systolic = view.getByLabelText("Quick add systolic");
  fireEvent.change(systolic, { target: { value: "900" } });
  fireEvent.change(view.getByLabelText("Quick add diastolic"), {
    target: { value: "80" },
  });

  expect(systolic.getAttribute("aria-invalid")).toBe("true");
  expect(
    (view.getByRole("button", { name: "Save Reading" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);

  fireEvent.click(view.getByRole("button", { name: "Cancel" }));
  fireEvent.click(view.getByRole("button", { name: "Add Reading" }));
  expect(
    (view.getByLabelText("Quick add systolic") as HTMLInputElement).value,
  ).toBe("");
});

test("reading count follows the rows", () => {
  const view = renderBloodPressureFields({ isEditing: false });
  const rows = view.container.querySelectorAll(
    ".blood-pressure-reading-read-row",
  );
  const footer = view.container.querySelector(
    ".blood-pressure-reading-list-footer",
  );
  expect(footer).not.toBeNull();
  const position =
    rows[rows.length - 1]?.compareDocumentPosition(footer as Node) ?? 0;

  expect(footer?.textContent).toBe("2 entries");
  expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test("edits tracker name and reading cells through callbacks", () => {
  const renameCalls: string[] = [];
  const updateCalls: Array<[string, string, string]> = [];
  const view = renderBloodPressureFields({
    onRenameTracker: (value) => renameCalls.push(value),
    onUpdateReading: (id, field, value) => updateCalls.push([id, field, value]),
  });

  fireEvent.change(view.getByLabelText("Blood pressure tracker name"), {
    target: { value: "Clinic" },
  });
  fireEvent.change(view.getByLabelText("Reading 1 systolic"), {
    target: { value: "125" },
  });
  fireEvent.change(view.getByLabelText("Reading 2 notes"), {
    target: { value: "After walk" },
  });

  expect(renameCalls).toEqual(["Clinic"]);
  expect(updateCalls).toEqual([
    ["r1", "systolic", "125"],
    ["r2", "notes", "After walk"],
  ]);
});

test("marks out-of-range measurements invalid without blocking edits", () => {
  const view = renderBloodPressureFields({
    readings: [makeReading({ id: "r-bad", systolic: "1200", diastolic: "80" })],
  });

  expect(
    view.getByLabelText("Reading 1 systolic").getAttribute("aria-invalid"),
  ).toBe("true");
  expect(
    view.getByLabelText("Reading 1 diastolic").getAttribute("aria-invalid"),
  ).toBeNull();
});

test("add, remove, and save actions invoke their callbacks", () => {
  const calls: string[] = [];
  const view = renderBloodPressureFields({
    onAddReading: () => calls.push("add"),
    onRemoveReading: (id) => calls.push(`remove ${id}`),
    onToggleEditing: () => calls.push("save"),
  });

  fireEvent.click(view.getByRole("button", { name: "Add Reading" }));
  fireEvent.click(view.getByRole("button", { name: "Remove reading 1" }));
  fireEvent.click(view.getByRole("button", { name: "Save" }));

  expect(calls).toEqual(["add", "remove r1", "save"]);
});

test("disables controls while the document is loading", () => {
  const view = renderBloodPressureFields({ ready: false });

  expect(
    (view.getByLabelText("Blood pressure tracker name") as HTMLInputElement)
      .disabled,
  ).toBe(true);
  expect(
    (view.getByLabelText("Reading 1 systolic") as HTMLInputElement).disabled,
  ).toBe(true);
  expect(
    (view.getByRole("button", { name: "Add Reading" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  expect(
    (view.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled,
  ).toBe(true);
});
