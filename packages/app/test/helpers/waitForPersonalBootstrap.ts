import { requestPath } from "./dualPaneRequestSummary";
import { listProxiedApiRequests } from "./mswServer";
import { waitForPaneRuntimeToSettle } from "./paneTestUtils";
import { waitForCondition } from "./waitForCondition";

/** Fresh identities can render local folders before their remote bootstrap. */
export async function waitForPersonalBootstrap(
  identityCount = 1,
): Promise<void> {
  await waitForCondition(
    () => {
      const requests = listProxiedApiRequests();
      return ["/containers/with-metadata-document", "/documents"].every(
        (path) =>
          requests.filter(
            (request) =>
              request.method === "POST" &&
              request.status === 200 &&
              requestPath(request.url) === path,
          ).length >= identityCount,
      );
    },
    "Personal bootstrap did not promote Contacts and create the self contact.",
    20_000,
  );
  await waitForPaneRuntimeToSettle(20_000);
}
