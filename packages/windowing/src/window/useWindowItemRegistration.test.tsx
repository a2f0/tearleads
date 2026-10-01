import { afterEach, expect, test } from "bun:test";
import { cleanup, renderHook } from "@testing-library/react";
import { useWindowItemRegistration } from "./useWindowItemRegistration";
import { sameWindowItem } from "./useWindowItemRegistry";

interface TestInput {
  label: string;
  onAction: () => unknown;
}

interface RegisteredTestItem {
  label: string;
  onAction: () => unknown;
}

function createRegisteredTestItem(
  input: TestInput,
  onAction: () => unknown,
): RegisteredTestItem {
  return { label: input.label, onAction };
}

afterEach(cleanup);

test("registration keeps its identity and invokes the latest action", () => {
  const registrations = new Map<object, RegisteredTestItem>();
  let registerCount = 0;
  let unregisterCount = 0;
  let firstActionCount = 0;
  let secondActionCount = 0;
  const registerItem = (id: object, item: RegisteredTestItem) => {
    registerCount += 1;
    registrations.set(id, item);
  };
  const unregisterItem = (id: object) => {
    unregisterCount += 1;
    registrations.delete(id);
  };
  const initialInput: TestInput | null = {
    label: "Refresh",
    onAction: () => {
      firstActionCount += 1;
    },
  };
  const view = renderHook<void, { input: TestInput | null }>(
    ({ input }: { input: TestInput | null }) =>
      useWindowItemRegistration({
        action: input?.onAction ?? null,
        createRegisteredItem: createRegisteredTestItem,
        input,
        registerItem,
        unregisterItem,
      }),
    {
      initialProps: { input: initialInput },
    },
  );

  const registrationId = registrations.keys().next().value;
  expect(registrationId).toBeDefined();
  expect(registerCount).toBe(1);

  view.rerender({
    input: {
      label: "Refresh",
      onAction: () => {
        secondActionCount += 1;
      },
    },
  });
  expect(registrations.keys().next().value).toBe(registrationId);
  expect(registerCount).toBe(1);
  registrations.values().next().value?.onAction();
  expect(firstActionCount).toBe(0);
  expect(secondActionCount).toBe(1);

  view.rerender({
    input: {
      label: "Reload",
      onAction: () => {
        secondActionCount += 1;
      },
    },
  });
  expect(registrations.keys().next().value).toBe(registrationId);
  expect(registrations.values().next().value?.label).toBe("Reload");
  expect(registerCount).toBe(2);
  expect(unregisterCount).toBe(1);

  view.rerender({ input: null });
  expect(registrations.size).toBe(0);
  expect(unregisterCount).toBe(2);
});

test("window item equality compares every registered field", () => {
  const onAction = () => undefined;
  const item = { disabled: false, label: "Refresh", onAction, priority: 0 };

  expect(sameWindowItem(undefined, item)).toBe(false);
  expect(sameWindowItem({ ...item }, item)).toBe(true);
  expect(
    sameWindowItem(
      { ...item, priority: Number.NaN },
      {
        ...item,
        priority: Number.NaN,
      },
    ),
  ).toBe(true);
  expect(sameWindowItem({ ...item, priority: 1 }, item)).toBe(false);
});
