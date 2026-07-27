import { expect } from "bun:test";
import { fireEvent, waitFor, within } from "@testing-library/react";
import invariant from "invariant";
import {
  clickPaneAppMenuItem,
  getPaneStatusText,
  PANE_ASYNC_TEST_TIMEOUT_MS,
  type renderPane,
} from "./paneTestUtils";

const userIdStatusPattern =
  /(?:userId|User ID):\s*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/u;

export async function openIdentityManagerFromPane(
  view: ReturnType<typeof renderPane>,
): Promise<HTMLDivElement> {
  const existingWindowCount =
    view.container.querySelectorAll<HTMLDivElement>("div.window").length;
  fireEvent.click(view.getByRole("button", { name: "Menu" }));
  clickPaneAppMenuItem(view, "Identity Manager");

  await waitFor(() => {
    const windows =
      view.container.querySelectorAll<HTMLDivElement>("div.window");
    expect(windows.length).toBeGreaterThan(existingWindowCount);
    expect(
      view.container.querySelector(".identity-manager")?.closest(".window"),
    ).toBeInstanceOf(HTMLDivElement);
  });

  const identityManagerWindow = view.container
    .querySelector(".identity-manager")
    ?.closest(".window");
  invariant(
    identityManagerWindow instanceof HTMLDivElement,
    "identity manager window not found",
  );
  return identityManagerWindow;
}

export function openIdentityManagerSection(
  identityManagerWindow: HTMLElement,
  section: "Active Sessions" | "General" | "PIN Lock" | "Recovery Key",
): void {
  fireEvent.click(
    within(identityManagerWindow).getByRole("button", { name: section }),
  );
}

export async function registerAndWaitForUserId(
  view: ReturnType<typeof renderPane>,
): Promise<string> {
  const identityManagerWindow = await openIdentityManagerFromPane(view);
  const identityManager = within(identityManagerWindow);
  await waitFor(() => {
    expect(
      identityManager.getByRole("button", { name: "Register" }),
    ).toBeTruthy();
  });
  fireEvent.click(identityManager.getByRole("button", { name: "Register" }));

  let userId = "";
  await waitFor(
    () => {
      const statusText = getPaneStatusText(view);
      const match = userIdStatusPattern.exec(statusText);
      expect(match).toBeTruthy();
      userId = match?.[1] ?? "";
    },
    { timeout: PANE_ASYNC_TEST_TIMEOUT_MS },
  );

  const closeButton =
    identityManagerWindow.querySelector<HTMLButtonElement>(".window-close");
  invariant(closeButton, "identity manager close button not found");
  fireEvent.click(closeButton);

  return userId;
}
