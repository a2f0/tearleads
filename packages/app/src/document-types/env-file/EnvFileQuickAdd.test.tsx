import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { EnvFileQuickAdd } from "./EnvFileQuickAdd";

afterEach(cleanup);

test("quick-add values can be revealed without nesting the action in a label", () => {
  const view = render(
    <EnvFileQuickAdd
      controlsDisabled={false}
      onAddVariable={() => Promise.resolve("v-new")}
      onPendingChange={() => undefined}
    />,
  );

  fireEvent.click(view.getByRole("button", { name: "Add Variable" }));
  const value = view.getByLabelText(
    "Quick add env variable value",
  ) as HTMLInputElement;
  expect(value.type).toBe("text");
  expect(value.autocomplete).toBe("off");

  fireEvent.change(value, { target: { value: "secret" } });
  const reveal = view.getByRole("button", {
    name: "Show Quick add env variable value",
  });
  expect(reveal.closest("label")).toBeNull();
  fireEvent.click(reveal);
  expect(value.type).toBe("text");
  expect(value.value).toBe("secret");
});

test("unsupported text masking requires Show before editing a value", () => {
  const originalCss = Object.getOwnPropertyDescriptor(globalThis, "CSS");
  Object.defineProperty(globalThis, "CSS", {
    configurable: true,
    value: { supports: () => false },
  });
  expect(CSS.supports("-webkit-text-security", "disc")).toBe(false);

  try {
    const view = render(
      <EnvFileQuickAdd
        controlsDisabled={false}
        onAddVariable={() => Promise.resolve("v-new")}
        onPendingChange={() => undefined}
      />,
    );
    fireEvent.click(view.getByRole("button", { name: "Add Variable" }));
    const value = view.getByLabelText(
      "Quick add env variable value",
    ) as HTMLInputElement;

    expect(value.readOnly).toBe(true);
    expect(value.type).toBe("text");
    fireEvent.focus(value);
    expect(value.value).toBe("");

    fireEvent.click(
      view.getByRole("button", { name: "Show Quick add env variable value" }),
    );
    expect(value.readOnly).toBe(false);
    fireEvent.change(value, { target: { value: "secret" } });
    expect(value.value).toBe("secret");
    fireEvent.click(
      view.getByRole("button", { name: "Hide Quick add env variable value" }),
    );
    expect(value.readOnly).toBe(true);
    expect(value.value).toBe("••••••");
    fireEvent.focus(value);
    expect(value.value).toBe("••••••");
  } finally {
    if (originalCss) {
      Object.defineProperty(globalThis, "CSS", originalCss);
    } else {
      Reflect.deleteProperty(globalThis, "CSS");
    }
  }
});
