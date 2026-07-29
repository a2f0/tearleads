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
import { WeightFields } from "./Weight";
import type { WeightQuickEntry } from "./WeightQuickAdd";
import type { WeightUnit } from "./weightDocumentDefinition";
import type { WeightEntryRow } from "./weightEntries";

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

function makeEntry(
  overrides: Partial<WeightEntryRow> & { id: string },
): WeightEntryRow {
  return {
    weight: "",
    unit: "lb",
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

const entries: WeightEntryRow[] = [
  makeEntry({
    id: "e1",
    weight: "180.5",
    measuredAt: "2026-07-16T08:30",
    notes: "Before breakfast",
    updatedAt: "2026-07-16T08:30:00.000Z",
    updatedBy: "user-alice",
    updatedByPeer: "7",
  }),
  makeEntry({
    id: "e2",
    weight: "179",
    measuredAt: "2026-07-17T08:15",
  }),
];

// A fully-attributed entry: the weight was last written by peer 9 (→ user-bob);
// every other cell by peer 7 (→ user-alice, the local author, shown as "you").
const attributedEntry = makeEntry({
  id: "e1",
  weight: "180.5",
  measuredAt: "2026-07-16T08:30",
  notes: "Before breakfast",
  createdAt: "2026-07-16T08:00:00.000Z",
  createdBy: "user-alice",
  createdByPeer: "7",
  updatedAt: "2026-07-16T09:00:00.000Z",
  updatedBy: "user-alice",
  updatedByPeer: "9",
  fieldEditors: {
    weight: "9",
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

function renderWeightFields(params?: {
  currentAuthorId?: string | null;
  entries?: WeightEntryRow[];
  isEditing?: boolean | undefined;
  onAddEntry?: (entry?: WeightQuickEntry) => void;
  onChangeUnit?: (unit: WeightUnit) => void;
  onEnterEdit?: (() => void) | undefined;
  onRemoveEntry?: (id: string) => void;
  onRenameTracker?: (value: string) => void;
  onToggleEditing?: () => void;
  onUpdateEntry?: (id: string, field: string, value: string) => void;
  ready?: boolean;
  resolveRowWriter?: (updatedByPeer: string | null) => string | null;
  trackerName?: string;
  unit?: WeightUnit;
}) {
  return render(
    <WindowMenuProvider>
      <ToolbarProbe />
      <WeightFields
        currentAuthorId={params?.currentAuthorId ?? null}
        entries={params?.entries ?? entries}
        isEditing={params?.isEditing}
        onAddEntry={params?.onAddEntry ?? (() => undefined)}
        onChangeUnit={params?.onChangeUnit ?? (() => undefined)}
        onEnterEdit={params?.onEnterEdit}
        onRemoveEntry={params?.onRemoveEntry ?? (() => undefined)}
        onRenameTracker={params?.onRenameTracker ?? (() => undefined)}
        onToggleEditing={params?.onToggleEditing ?? (() => undefined)}
        onUpdateEntry={params?.onUpdateEntry ?? (() => undefined)}
        ready={params?.ready ?? true}
        resolveRowWriter={params?.resolveRowWriter}
        trackerName={params?.trackerName ?? "Morning weigh-ins"}
        trackerNameInputId="weight-name"
        unit={params?.unit ?? "lb"}
        unitInputId="weight-unit"
      />
    </WindowMenuProvider>,
  );
}

test("renders entries as editable rows", () => {
  const view = renderWeightFields();

  expect(
    (view.getByLabelText("Weight tracker name") as HTMLInputElement).value,
  ).toBe("Morning weigh-ins");
  expect(
    (view.getByLabelText("New entry unit") as HTMLSelectElement).value,
  ).toBe("lb");
  expect(
    (view.getByLabelText("Entry 1 weight") as HTMLInputElement).value,
  ).toBe("180.5");
  expect(
    (view.getByLabelText("Entry 1 measured at") as HTMLInputElement).value,
  ).toBe("2026-07-16T08:30");
  expect(
    (view.getByLabelText("Entry 2 weight") as HTMLInputElement).value,
  ).toBe("179");
});

test("each weight input is labelled with its own entry's unit", () => {
  const view = renderWeightFields({
    entries: [
      makeEntry({ id: "e1", weight: "180" }),
      makeEntry({ id: "e2", unit: "kg", weight: "82" }),
    ],
  });

  expect(view.getByText("Weight (lb)")).toBeTruthy();
  expect(view.getByText("Weight (kg)")).toBeTruthy();
});

test("toggles editing from the toolbar, not a body button", async () => {
  let toggleCalls = 0;
  const view = renderWeightFields({
    entries: [],
    isEditing: false,
    onToggleEditing: () => {
      toggleCalls += 1;
    },
  });

  await waitFor(() => {
    expect(view.getByRole("button", { name: "Toolbar Edit" })).toBeTruthy();
  });
  // The tracker body carries no Edit control of its own.
  expect(view.queryByRole("button", { name: "Edit" })).toBeNull();

  fireEvent.click(view.getByRole("button", { name: "Toolbar Edit" }));
  expect(toggleCalls).toBe(1);
});

test("toolbar action becomes Done while editing", async () => {
  const view = renderWeightFields({ entries: [], isEditing: true });

  await waitFor(() => {
    expect(view.getByRole("button", { name: "Toolbar Done" })).toBeTruthy();
  });
  expect(view.queryByRole("button", { name: "Toolbar Edit" })).toBeNull();
});

test("toolbar action is disabled while the document is loading", async () => {
  const view = renderWeightFields({ isEditing: false, ready: false });

  await waitFor(() => {
    expect(
      (view.getByRole("button", { name: "Toolbar Edit" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });
});

test("read mode renders formatted weights, change, and attribution", () => {
  const view = renderWeightFields({
    currentAuthorId: "user-alice",
    isEditing: false,
  });

  expect(view.queryByText("Morning weigh-ins")).toBeNull();
  expect(view.queryByText("New Entry Unit")).toBeNull();
  expect(view.getByText("180.5 lb")).toBeTruthy();
  expect(view.getByText("179 lb")).toBeTruthy();
  // The first entry has nothing to compare against; the second dropped 1.5 lb.
  expect(view.getByText("—")).toBeTruthy();
  expect(view.getByText("−1.5 lb")).toBeTruthy();
  expect(view.getByText("2026-07-16 08:30")).toBeTruthy();
  expect(view.getByText("Before breakfast")).toBeTruthy();
  expect(view.getByText("Updated 2026-07-16 08:30 by you")).toBeTruthy();
  expect(view.queryByLabelText("Weight tracker name")).toBeNull();
});

test("read mode reports a gain and an unchanged weight", () => {
  const view = renderWeightFields({
    isEditing: false,
    entries: [
      makeEntry({ id: "e1", weight: "180" }),
      makeEntry({ id: "e2", weight: "182.25" }),
      makeEntry({ id: "e3", weight: "182.25" }),
    ],
  });

  expect(view.getByText("+2.25 lb")).toBeTruthy();
  expect(view.getByText("±0 lb")).toBeTruthy();
});

test("read mode tolerates missing entry values", () => {
  const view = renderWeightFields({
    entries: [makeEntry({ id: "e-missing" })],
    isEditing: false,
  });

  // Weight and measured time both fall back to None; the change is omitted.
  expect(view.getAllByText("None")).toHaveLength(2);
  expect(view.getByText("—")).toBeTruthy();
});

test("read mode leaves the tracker name to the document title bar", () => {
  const view = renderWeightFields({
    entries: [],
    isEditing: false,
    trackerName: "",
  });

  expect(view.queryByText("Weight Tracker")).toBeNull();
  expect(view.getByText("0 entries")).toBeTruthy();
});

test("quick add saves a populated entry without entering edit mode", () => {
  const added: WeightQuickEntry[] = [];
  const view = renderWeightFields({
    isEditing: false,
    onEnterEdit: () => undefined,
    onAddEntry: (entry) => {
      if (entry) {
        added.push(entry);
      }
    },
  });

  fireEvent.click(view.getByRole("button", { name: "Add Entry" }));
  fireEvent.change(view.getByLabelText("Quick add weight"), {
    target: { value: "178.5" },
  });
  fireEvent.change(view.getByLabelText("Quick add measured at"), {
    target: { value: "2026-07-25T08:30" },
  });
  fireEvent.change(view.getByLabelText("Quick add notes"), {
    target: { value: "Before breakfast" },
  });
  fireEvent.click(view.getByRole("button", { name: "Save Entry" }));

  expect(added).toEqual([
    {
      measuredAt: "2026-07-25T08:30",
      notes: "Before breakfast",
      weight: "178.5",
    },
  ]);
  expect(view.getByRole("button", { name: "Toolbar Edit" })).toBeTruthy();
  expect(view.queryByLabelText("Weight tracker name")).toBeNull();
});

test("quick add rejects invalid weights and cancel clears the draft", () => {
  const view = renderWeightFields({
    isEditing: false,
    onEnterEdit: () => undefined,
  });

  fireEvent.click(view.getByRole("button", { name: "Add Entry" }));
  const input = view.getByLabelText("Quick add weight");
  fireEvent.change(input, { target: { value: "0" } });

  expect(input.getAttribute("aria-invalid")).toBe("true");
  expect(
    (view.getByRole("button", { name: "Save Entry" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);

  fireEvent.click(view.getByRole("button", { name: "Cancel" }));
  fireEvent.click(view.getByRole("button", { name: "Add Entry" }));
  expect(
    (view.getByLabelText("Quick add weight") as HTMLInputElement).value,
  ).toBe("");
});

test("entry count follows the rows", () => {
  const view = renderWeightFields({ isEditing: false });
  const rows = view.container.querySelectorAll(".weight-entry-read-row");
  const footer = view.container.querySelector(".weight-entry-list-footer");
  expect(footer).not.toBeNull();
  const position =
    rows[rows.length - 1]?.compareDocumentPosition(footer as Node) ?? 0;

  expect(footer?.textContent).toBe("2 entries");
  expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test("read-only viewer opens attribution directly, without showing values", () => {
  const view = renderWeightFields({
    currentAuthorId: "user-alice",
    isEditing: false,
    // No onEnterEdit → read-only viewer: the single-action kebab opens the
    // attribution overlay directly rather than a one-item menu.
    entries: [attributedEntry],
    resolveRowWriter: attributedResolver,
  });

  expect(view.queryByRole("dialog")).toBeNull();
  const kebab = view.getByRole("button", { name: "Entry 1 attribution" });
  expect(view.queryByRole("button", { name: "Add Entry" })).toBeNull();
  kebab.focus();
  fireEvent.click(kebab);

  const dialog = view.getByRole("dialog", { name: "Entry 1" });
  // The weight resolves to the other writer; the remaining cells to the local one.
  expect(within(dialog).getByText("set by user-bob")).toBeTruthy();
  expect(within(dialog).getAllByText("set by you").length).toBeGreaterThan(0);
  // The attribution view lists who set each field, never the field values.
  expect(within(dialog).queryByText("180.5 lb")).toBeNull();
  expect(within(dialog).queryByText("Before breakfast")).toBeNull();

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
  const view = renderWeightFields({
    currentAuthorId: "user-alice",
    entries: [attributedEntry],
    isEditing: false,
    onEnterEdit: () => {
      editCalls += 1;
    },
    resolveRowWriter: attributedResolver,
  });

  expect(view.queryByRole("dialog")).toBeNull();
  fireEvent.click(view.getByRole("button", { name: "Entry 1 actions" }));
  fireEvent.click(view.getByRole("button", { name: "Attribution" }));

  const dialog = view.getByRole("dialog", { name: "Entry 1" });
  expect(within(dialog).getByText("set by user-bob")).toBeTruthy();
  fireEvent.click(view.getByRole("button", { name: "Close" }));

  // Edit switches the tracker into edit mode.
  fireEvent.click(view.getByRole("button", { name: "Entry 1 actions" }));
  fireEvent.click(view.getByRole("button", { name: "Edit" }));
  expect(editCalls).toBe(1);
});

test("edits tracker name and entry cells through callbacks", () => {
  const renameCalls: string[] = [];
  const updateCalls: Array<[string, string, string]> = [];
  const view = renderWeightFields({
    onRenameTracker: (value) => renameCalls.push(value),
    onUpdateEntry: (id, field, value) => updateCalls.push([id, field, value]),
  });

  fireEvent.change(view.getByLabelText("Weight tracker name"), {
    target: { value: "Cut 2026" },
  });
  fireEvent.change(view.getByLabelText("Entry 1 weight"), {
    target: { value: "181" },
  });
  fireEvent.change(view.getByLabelText("Entry 2 notes"), {
    target: { value: "After run" },
  });

  expect(renameCalls).toEqual(["Cut 2026"]);
  expect(updateCalls).toEqual([
    ["e1", "weight", "181"],
    ["e2", "notes", "After run"],
  ]);
});

test("the new-entry unit stays changeable once the tracker holds entries", () => {
  // It only seeds the next entry; the ones already recorded keep their own unit,
  // so changing it never restates them.
  const unitCalls: WeightUnit[] = [];
  const view = renderWeightFields({
    onChangeUnit: (unit) => unitCalls.push(unit),
  });

  const select = view.getByLabelText("New entry unit") as HTMLSelectElement;
  expect(select.disabled).toBe(false);
  fireEvent.change(select, { target: { value: "kg" } });

  expect(unitCalls).toEqual(["kg"]);
  // The existing lb entries are untouched by the change.
  expect(view.getAllByText("Weight (lb)").length).toBe(2);
});

test("marks out-of-range weights invalid without blocking edits", () => {
  const view = renderWeightFields({
    entries: [makeEntry({ id: "e-bad", weight: "8000" })],
  });

  expect(
    view.getByLabelText("Entry 1 weight").getAttribute("aria-invalid"),
  ).toBe("true");
});

test("remove and save actions invoke their callbacks", () => {
  const removeCalls: string[] = [];
  let saveCalls = 0;
  const view = renderWeightFields({
    onRemoveEntry: (id) => removeCalls.push(id),
    onToggleEditing: () => {
      saveCalls += 1;
    },
  });

  const remove = view.getByRole("button", { name: "Remove entry 1" });
  fireEvent.click(remove);
  fireEvent.click(view.getByRole("button", { name: "Save" }));

  expect(removeCalls).toEqual(["e1"]);
  expect(saveCalls).toBe(1);
});

test("disables controls while the document is loading", () => {
  const view = renderWeightFields({ ready: false });

  expect(
    (view.getByLabelText("Weight tracker name") as HTMLInputElement).disabled,
  ).toBe(true);
  expect(
    (view.getByLabelText("New entry unit") as HTMLSelectElement).disabled,
  ).toBe(true);
  expect(
    (view.getByLabelText("Entry 1 weight") as HTMLInputElement).disabled,
  ).toBe(true);
  expect(
    (view.getByRole("button", { name: "Add Entry" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
});
