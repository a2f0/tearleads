import "../../../test/helpers/mswServer";
import { afterEach, expect, test } from "bun:test";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { cleanupIdentityManagerTestEnvironment } from "../../../test/helpers/identityManagerTestRuntime";
import { renderRootWithSession } from "../../../test/helpers/renderRootConsole";
import { ROOT_TEST_IDENTITIES } from "../../../test/helpers/rootConsoleFixtures";

afterEach(async () => {
  await cleanupIdentityManagerTestEnvironment();
});

test("operators suspend and lift a member account but not a root one", async () => {
  const { restore, view } = await renderRootWithSession(true);
  try {
    const [rootIdentity, memberIdentity] = ROOT_TEST_IDENTITIES;
    if (!rootIdentity || !memberIdentity) {
      throw new Error("Expected root test identities.");
    }
    fireEvent.click(view.getByRole("button", { name: "Identities" }));
    const openIdentity = async (fingerprint: string) => {
      const table = await waitFor(() =>
        view.getByRole("table", { name: "Identities" }),
      );
      fireEvent.click(
        await waitFor(() => within(table).getByTitle(fingerprint)),
      );
      await waitFor(() => {
        expect(view.getByRole("table", { name: "Identity" })).toBeTruthy();
      });
    };

    await openIdentity(rootIdentity.signingKeyFingerprint);
    expect(view.queryByRole("button", { name: "Suspend account" })).toBeNull();
    fireEvent.click(view.getByRole("button", { name: "Back" }));

    await openIdentity(memberIdentity.signingKeyFingerprint);
    fireEvent.click(
      await waitFor(() =>
        view.getByRole("button", { name: "Suspend account" }),
      ),
    );
    const dialog = view.getByRole("dialog", { name: "Suspend account?" });
    expect(dialog.textContent).toContain(
      "signs the account out of every device",
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Suspend" }));

    await waitFor(() => {
      expect(
        view.getByRole("button", { name: "Lift suspension" }),
      ).toBeTruthy();
    });
    expect(view.queryByRole("dialog")).toBeNull();
    const summary = view.getByRole("table", { name: "Identity" });
    expect(
      within(summary).getByText("Suspended").parentElement?.textContent,
    ).not.toContain("No");

    fireEvent.click(view.getByRole("button", { name: "Lift suspension" }));
    await waitFor(() => {
      expect(
        view.getByRole("button", { name: "Suspend account" }),
      ).toBeTruthy();
    });
  } finally {
    restore();
  }
});
