import { expect, test } from "bun:test";
import { SymCrypt } from "../client";

test("org profile titles without a host projector", () => {
  // Every save re-projects through the client's one resolved registry: the
  // SDK-owned organization-profile kind must keep its stable title when the
  // host never registers a projector for it, or a later save would replace
  // the bootstrap title with the generic untitled form.
  const sdk = new SymCrypt({
    documentProjectors: [],
    logger: { log: () => undefined, logError: () => undefined },
  });
  const { documentProjectors } = sdk.runtime.input().infra;

  expect(
    documentProjectors.projectStoredDocumentState({
      documentKind: "organization_profile",
      structuredFields: {},
      text: "",
    }).title,
  ).toBe("Organization Profile");
  expect(
    documentProjectors.getUntitledDocumentTitle("organization_profile"),
  ).toBe("Organization Profile");
});
