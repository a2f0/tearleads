import { expect, test } from "bun:test";
import { contactDocumentProjectorDefinition } from "./contactDocumentDefinition";

// Addresses stay in generic rows, not the scalar contact projection schema.
for (const rows of [
  undefined,
  [],
  [
    {
      id: "postal",
      fields: {
        recordType: "postalAddress",
        postalCode: "00123",
        countryCode: "日本",
      },
    },
    { id: "future", fields: { recordType: "future" } },
  ],
]) {
  test("contact scalar projection tolerates optional and unknown row types", () => {
    const project = contactDocumentProjectorDefinition.project;
    if (!project) throw new Error("Missing contact projector");
    const projected = project({
      documentKind: "contact",
      structuredFields: { firstName: "Ada", nickname: "Countess" },
      text: "",
      rows,
    });
    expect(projected.title).toBe("Countess");
    expect(projected.fieldValidationIssues).toEqual([]);
    expect(projected.structuredFields).toEqual({
      firstName: "Ada",
      lastName: "",
      nickname: "Countess",
      isSelf: "",
      userId: "",
      encapsulationPublicKey: "",
    });
  });
}
