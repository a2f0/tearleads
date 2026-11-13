import { expect, test } from "bun:test";
import { exportAllUpdates, importUpdates } from "@tearleads/loro";
import {
  createContainerMetadataDocument,
  readContainerMetadataValue,
  writeContainerMetadataValue,
} from "./containerMetadataDocument";

test("primary document identity survives metadata import with a custom icon", async () => {
  const source = await createContainerMetadataDocument("source");
  writeContainerMetadataValue(source, {
    name: "Person",
    icon: "user",
    primaryDocumentId: "canonical-contact-id",
  });
  const replica = await createContainerMetadataDocument("replica");
  importUpdates(replica, [exportAllUpdates(source)]);
  expect(readContainerMetadataValue(replica, "Untitled")).toEqual({
    name: "Person",
    icon: "user",
    primaryDocumentId: "canonical-contact-id",
  });
});

test("metadata patches change only explicit fields and can clear the primary", async () => {
  const doc = await createContainerMetadataDocument("patch");
  writeContainerMetadataValue(doc, {
    name: "Person",
    icon: "user",
    primaryDocumentId: "contact-a",
  });
  writeContainerMetadataValue(doc, { name: "Renamed" });
  expect(readContainerMetadataValue(doc, "/")).toEqual({
    name: "Renamed",
    icon: "user",
    primaryDocumentId: "contact-a",
  });
  writeContainerMetadataValue(doc, { primaryDocumentId: "contact-b" });
  expect(readContainerMetadataValue(doc, "/")).toEqual({
    name: "Renamed",
    icon: "user",
    primaryDocumentId: "contact-b",
  });
  writeContainerMetadataValue(doc, { primaryDocumentId: null });
  expect(readContainerMetadataValue(doc, "/")).toEqual({
    name: "Renamed",
    icon: "user",
  });
});
