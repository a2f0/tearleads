import { expect, test } from "bun:test";
import {
  createContainerMetadataDocument,
  readContainerMetadataValue,
} from "@tearleads/client-sdk/data/containers/containerMetadataDocument";
import { createInitialRootMetadataBootstrap } from "@tearleads/client-sdk/workflows/registration/rootMetadataBootstrap";
import { importUpdates } from "@tearleads/loro";

test("createInitialRootMetadataBootstrap creates root metadata update", async () => {
  const bootstrap =
    await createInitialRootMetadataBootstrap("root-container-1");
  const doc = await createContainerMetadataDocument("root-container-1");

  importUpdates(doc, [bootstrap.initialUpdate]);

  expect(bootstrap.metadataDocumentId).toHaveLength(36);
  expect(bootstrap.initialUpdate.byteLength).toBeGreaterThan(0);
  expect(readContainerMetadataValue(doc, "Untitled")).toEqual({
    icon: null,
    name: "/",
  });
});
