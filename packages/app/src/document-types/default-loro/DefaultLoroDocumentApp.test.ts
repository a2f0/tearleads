import { expect, test } from "bun:test";
import { ORGANIZATION_PROFILE_DOCUMENT_KIND } from "@tearleads/client-sdk";
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

test("default Loro document serializer tolerates pending document state", () => {
  expect(
    serializeDefaultLoroDocument({
      documentKind: null,
      structuredFields: null,
      text: null,
    }),
  ).toEqual({
    documentKind: "",
    fields: {},
    text: "",
  });
});
