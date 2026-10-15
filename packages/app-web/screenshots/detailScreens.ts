import { expect, type Locator, type Page } from "@playwright/test";
import { seedExpectations } from "./continuity";

import { openDocumentDetail, openDocumentImage } from "./documentImages";
import { HOUSEHOLD_SCREENS } from "./householdScreens";
import { assertImagesDecoded } from "./imageReadiness";

type OpenDetail = (scope: Page | Locator) => Promise<void>;

const openNoteDetail: OpenDetail = async (scope) => {
  await scope
    .locator(".mini-app-row--button", { hasText: seedExpectations.note.title })
    .first()
    .click();
  const editor = scope.locator("textarea.note-document-editor");
  await expect(editor).toBeVisible({ timeout: 20_000 });
  await expect
    .poll(() => editor.inputValue(), { timeout: 20_000 })
    .toContain(seedExpectations.note.bodyLine);
};

export const openContactDetail: OpenDetail = async (scope) => {
  await scope
    .locator(".mini-app-row--button", {
      hasText: seedExpectations.contact.displayName,
    })
    .first()
    .click();
  await expect(scope.getByText("Public key").first()).toBeVisible({
    timeout: 20_000,
  });
  await assertImagesDecoded(
    scope.getByRole("img", {
      name: `Avatar for ${seedExpectations.contact.displayName}`,
      exact: true,
    }),
    1,
  );
};

interface DetailScreen {
  name: string;
  route: string;
  menuLabel: string;
  open: OpenDetail;
}

export const DETAIL_SCREENS: readonly DetailScreen[] = [
  ...HOUSEHOLD_SCREENS,
  {
    name: "note-detail",
    route: "/app/notes",
    menuLabel: "Notes",
    open: openNoteDetail,
  },
  {
    name: "contact-detail",
    route: "/app/contacts",
    menuLabel: "Contacts",
    open: openContactDetail,
  },
  {
    name: "drivers-license-detail",
    route: "/app/explorer",
    menuLabel: "Explorer",
    open: openDocumentDetail(seedExpectations.driversLicense),
  },
  {
    name: "credit-card-detail",
    route: "/app/explorer",
    menuLabel: "Explorer",
    open: openDocumentDetail(seedExpectations.creditCard),
  },
  {
    name: "birth-certificate-detail",
    route: "/app/explorer",
    menuLabel: "Explorer",
    open: openDocumentDetail(seedExpectations.birthCertificate),
  },
  {
    name: "birth-certificate-image",
    route: "/app/explorer",
    menuLabel: "Explorer",
    open: openDocumentImage(
      seedExpectations.birthCertificate,
      "Birth Certificate Image",
    ),
  },
  {
    name: "credit-card-image",
    route: "/app/explorer",
    menuLabel: "Explorer",
    open: openDocumentImage(seedExpectations.creditCard, "Front Image"),
  },
  {
    name: "passport-detail",
    route: "/app/explorer",
    menuLabel: "Explorer",
    open: openDocumentDetail(seedExpectations.passport),
  },
];
