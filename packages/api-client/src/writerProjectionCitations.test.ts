import { expect, test } from "bun:test";
import { writerProjectionCitedContainerIds } from "./writerProjectionCitations";

test("a projection cites every container field, list and container event", () => {
  expect([
    ...writerProjectionCitedContainerIds({
      authorizingContainerPaths: [{ containerId: "root" }],
      documentManifest: {
        event: { event: { objectKind: "document", objectId: "doc" } },
        state: { linkedContainerIds: ["linked"] },
      },
      history: [{ event: { objectKind: "container", objectId: "event" } }],
      parent: { parentContainerId: "parent" },
    }),
  ]).toEqual(["root", "linked", "event", "parent"]);
});
