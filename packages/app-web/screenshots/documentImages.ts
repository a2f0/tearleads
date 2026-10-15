import { expect, type Locator, type Page } from "@playwright/test";
import type { DocumentExpectation } from "./continuity";
import { assertImagesDecoded } from "./imageReadiness";

type OpenDetail = (scope: Page | Locator) => Promise<void>;

export function openDocumentDetail(expected: DocumentExpectation): OpenDetail {
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

export function openDocumentImage(
  expected: DocumentExpectation,
  label: string,
): OpenDetail {
  return async (scope) => {
    await openDocumentDetail(expected)(scope);
    await scope
      .getByRole("button", { name: `Open ${label}`, exact: true })
      .click();
    await assertImagesDecoded(
      scope.locator("img.explorer-blob-preview-media"),
      1,
    );
    await scope.locator(".explorer-blob-preview-open").click();
    const image = scope.locator("img.mini-app-image-viewer-image");
    await expect(image).toBeVisible();
    await assertImagesDecoded(image, 1);
  };
}
