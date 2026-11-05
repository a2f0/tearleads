import { afterEach, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { MiniAppStatePanel } from "./MiniAppStatePanel";

afterEach(cleanup);

test("a busy panel announces its title and shows a spinner", () => {
  const view = render(
    <MiniAppStatePanel busy description="Hold on." title="Creating" />,
  );

  const status = view.getByRole("status");
  // A busy live region would defer its announcements, so none is set.
  expect(status.getAttribute("aria-busy")).toBeNull();
  expect(status.textContent).toContain("Creating");
  expect(status.textContent).toContain("Hold on.");
  expect(status.querySelector(".mini-app-state-panel-spinner")).not.toBeNull();
});

test("an idle panel renders its icon and actions without a status role", () => {
  const view = render(
    <MiniAppStatePanel icon={<svg data-testid="icon" />} title="Signed out">
      <button type="button">Login</button>
    </MiniAppStatePanel>,
  );

  expect(view.queryByRole("status")).toBeNull();
  expect(view.getByTestId("icon")).toBeTruthy();
  expect(view.getByRole("heading", { name: "Signed out" })).toBeTruthy();
  expect(view.getByRole("button", { name: "Login" })).toBeTruthy();
});
