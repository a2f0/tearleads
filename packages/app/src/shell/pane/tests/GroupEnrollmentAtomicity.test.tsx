import { afterEach, expect, test } from "bun:test";
import { waitFor, within } from "@testing-library/react";
import {
  getPaneRoot,
  getPaneUserId,
  renderDualPane,
  waitForDualPaneProvisioning,
} from "../../../../test/helpers/dual-pane/dualPaneCore";
import { addPeerToAdminsGroup } from "../../../../test/helpers/dual-pane/dualPaneSharingKit";
import {
  listProxiedApiRequests,
  useTestApiAppHandlers,
} from "../../../../test/helpers/mswServer";
import { cleanupPaneTestEnvironment } from "../../../../test/helpers/paneTestUtils";
import { waitForPersonalBootstrap } from "../../../../test/helpers/waitForPersonalBootstrap";

afterEach(cleanupPaneTestEnvironment);

test("adding an outsider to Admins shows progress and commits both memberships once", async () => {
  useTestApiAppHandlers();
  const view = renderDualPane();
  const pane = getPaneRoot(view, "left");
  const peer = getPaneRoot(view, "right");
  await waitForDualPaneProvisioning(pane, peer);
  await waitForPersonalBootstrap(2);
  let requestStart = 0;
  const adding = addPeerToAdminsGroup(pane, getPaneUserId(peer), () => {
    requestStart = listProxiedApiRequests().length;
  });
  await waitFor(
    () => {
      const add = within(pane).getByRole("button", { name: "Add" });
      expect(add.getAttribute("aria-busy")).toBe("true");
      expect(add.hasAttribute("disabled")).toBe(true);
      expect(add.querySelector(".mini-app-button-spinner")).not.toBeNull();
    },
    { timeout: 15_000 },
  );
  try {
    await adding;
  } catch (error) {
    throw new Error(
      `Enrollment failed: ${pane.querySelector(".org-manager-error")?.textContent}; ${JSON.stringify(
        listProxiedApiRequests()
          .slice(requestStart)
          .filter((request) => request.status >= 400)
          .map(({ url, status, responseBody }) => ({
            url,
            status,
            responseBody,
          })),
      )}`,
      { cause: error },
    );
  }
  const commits = listProxiedApiRequests()
    .slice(requestStart)
    .filter(
      (request) =>
        request.method === "PUT" && request.url.endsWith("/policy-commit"),
    );
  expect(commits).toHaveLength(1);
  expect(commits[0]?.status).toBe(200);
  const request: unknown = JSON.parse(commits[0]?.requestBody ?? "null");
  expect(request).toHaveProperty("memberPolicy");
  expect(
    within(pane).getByRole("button", { name: "Add" }).getAttribute("aria-busy"),
  ).not.toBe("true");
}, 60_000);
