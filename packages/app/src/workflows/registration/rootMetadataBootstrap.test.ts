import { expect, test } from "bun:test";
import { importUpdates } from "@tearleads/loro";
import {
  createContainerMetadataDocument,
  readContainerMetadataValue,
} from "../../data/containers/containerMetadataDocument";
import { createInitialRootMetadataBootstrap } from "./rootMetadataBootstrap";

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
