import { expect, type Locator, type Page } from "@playwright/test";
import { seedExpectations } from "./continuity";

type OpenDetail = (scope: Page | Locator) => Promise<void>;

// Blob URLs resolve asynchronously. Wait for decoded pixels before capturing.
async function assertImagesDecoded(images: Locator, count: number) {
  await expect(images).toHaveCount(count, { timeout: 20_000 });
  for (let i = 0; i < count; i++) {
    await expect(images.nth(i)).toHaveJSProperty("complete", true);
    await expect(images.nth(i)).not.toHaveJSProperty("naturalWidth", 0);
  }
}

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

function openDocumentDetail(expected: {
  title: string;
  imageCount: number;
}): OpenDetail {
  return async (scope) => {
    await scope
      .locator(".explorer-item-row-button", { hasText: expected.title })
      .first()
      .click();
    await assertImagesDecoded(
      scope.locator("img.structured-document-slot-preview-image"),
      expected.imageCount,
    );
  };
}

interface DetailScreen {
  name: string;
  route: string;
  menuLabel: string;
  open: OpenDetail;
}

export const DETAIL_SCREENS: readonly DetailScreen[] = [
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
    name: "passport-detail",
    route: "/app/explorer",
    menuLabel: "Explorer",
    open: openDocumentDetail(seedExpectations.passport),
  },
];
