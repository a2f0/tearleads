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
  expect(value.type).toBe("password");
  expect(value.autocomplete).toBe("new-password");

  fireEvent.change(value, { target: { value: "secret" } });
  const reveal = view.getByRole("button", {
    name: "Show Quick add env variable value",
  });
  expect(reveal.closest("label")).toBeNull();
  fireEvent.click(reveal);
  expect(value.type).toBe("text");
});
