import { expect, test } from "bun:test";
import { ORGANIZATION_PROFILE_DOCUMENT_KIND } from "@symcrypt/client-sdk";
import { serializeDefaultLoroDocument } from "./DefaultLoroDocumentApp";

test("default Loro document serializer preserves kind, fields, and text", () => {
  expect(
    serializeDefaultLoroDocument({
      documentKind: ORGANIZATION_PROFILE_DOCUMENT_KIND,
      structuredFields: {
        name: "Personal Org",
        zField: "last",
        aField: "first",
      },
      text: "sidecar text",
    }),
  ).toEqual({
    documentKind: ORGANIZATION_PROFILE_DOCUMENT_KIND,
    fields: {
      aField: "first",
      name: "Personal Org",
      zField: "last",
    },
    text: "sidecar text",
  });
});
