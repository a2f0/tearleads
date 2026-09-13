import { requestPath } from "./dualPaneRequestSummary";
import { listProxiedApiRequests } from "./mswServer";
import { waitForPaneRuntimeToSettle } from "./paneTestUtils";
import { waitForCondition } from "./waitForCondition";

/** For fresh single-pane tests: local folders can render before remote bootstrap. */
export async function waitForPersonalBootstrap(): Promise<void> {
  await waitForCondition(
    () => {
      const requests = listProxiedApiRequests();
      return ["/containers/with-metadata-document", "/documents"].every(
        (path) =>
          requests.some(
            (request) =>
              request.method === "POST" &&
              request.status === 200 &&
              requestPath(request.url) === path,
          ),
      );
    },
    "Personal bootstrap did not promote Contacts and create the self contact.",
    20_000,
  );
  await waitForPaneRuntimeToSettle(20_000);
}
