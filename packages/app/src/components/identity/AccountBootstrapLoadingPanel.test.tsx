import { afterEach, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import {
  AccountBootstrapLoadingPanel,
  AccountBootstrapProgressContext,
} from "./AccountBootstrapLoadingPanel";

afterEach(cleanup);

test("account progress gives way to the mini-app's local loading title", () => {
  const progress = {
    title: "Signing you in",
    description: "Proving ownership of your identity to the server.",
  };
  const view = render(
    <AccountBootstrapProgressContext.Provider value={progress}>
      <AccountBootstrapLoadingPanel title="Loading contacts..." />
    </AccountBootstrapProgressContext.Provider>,
  );
  expect(view.getByRole("heading", { name: progress.title })).toBeTruthy();
  expect(view.getByRole("status").textContent).toContain(progress.description);
  expect(view.queryByText("Loading contacts...")).toBeNull();
  view.rerender(
    <AccountBootstrapProgressContext.Provider value={null}>
      <AccountBootstrapLoadingPanel title="Loading contacts..." />
    </AccountBootstrapProgressContext.Provider>,
  );
  expect(
    view.getByRole("heading", { name: "Loading contacts..." }),
  ).toBeTruthy();
  expect(view.queryByText(progress.description)).toBeNull();
  expect(
    view.getByRole("status").querySelector(".mini-app-state-panel-spinner"),
  ).not.toBeNull();
});
