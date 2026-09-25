import { afterEach, expect, setSystemTime, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import {
  BloodPressureQuickAdd,
  type BloodPressureQuickReading,
} from "../blood-pressure/BloodPressureQuickAdd";
import {
  WeightQuickAdd,
  type WeightQuickEntry,
} from "../weight/WeightQuickAdd";

afterEach(() => {
  cleanup();
  setSystemTime();
});

test("weight quick add saves a local time and refreshes it for the next entry", () => {
  const added: WeightQuickEntry[] = [];
  const view = render(
    <WeightQuickAdd
      controlsDisabled={false}
      onAddEntry={(entry) => {
        added.push(entry);
        return Promise.resolve("e-new");
      }}
      onPendingChange={() => undefined}
      unit="lb"
    />,
  );

  setSystemTime(new Date(2026, 8, 25, 14, 7));
  fireEvent.click(view.getByRole("button", { name: "Add Entry" }));
  expect(
    (view.getByLabelText("Quick add measured at") as HTMLInputElement).value,
  ).toBe("2026-09-25T14:07");
  fireEvent.change(view.getByLabelText("Quick add weight"), {
    target: { value: "178.5" },
  });
  fireEvent.click(view.getByRole("button", { name: "Save Entry" }));
  expect(added[0]?.measuredAt).toBe("2026-09-25T14:07");

  setSystemTime(new Date(2026, 8, 25, 14, 12));
  fireEvent.click(view.getByRole("button", { name: "Add Entry" }));
  expect(
    (view.getByLabelText("Quick add measured at") as HTMLInputElement).value,
  ).toBe("2026-09-25T14:12");
});

test("blood pressure quick add saves a local time and refreshes it for the next reading", () => {
  const added: BloodPressureQuickReading[] = [];
  const view = render(
    <BloodPressureQuickAdd
      controlsDisabled={false}
      onAddReading={(reading) => {
        added.push(reading);
        return Promise.resolve("r-new");
      }}
      onPendingChange={() => undefined}
    />,
  );

  setSystemTime(new Date(2026, 8, 25, 14, 7));
  fireEvent.click(view.getByRole("button", { name: "Add Reading" }));
  expect(
    (view.getByLabelText("Quick add measured at") as HTMLInputElement).value,
  ).toBe("2026-09-25T14:07");
  fireEvent.change(view.getByLabelText("Quick add systolic"), {
    target: { value: "120" },
  });
  fireEvent.change(view.getByLabelText("Quick add diastolic"), {
    target: { value: "80" },
  });
  fireEvent.click(view.getByRole("button", { name: "Save Reading" }));
  expect(added[0]?.measuredAt).toBe("2026-09-25T14:07");

  setSystemTime(new Date(2026, 8, 25, 14, 12));
  fireEvent.click(view.getByRole("button", { name: "Add Reading" }));
  expect(
    (view.getByLabelText("Quick add measured at") as HTMLInputElement).value,
  ).toBe("2026-09-25T14:12");
});
