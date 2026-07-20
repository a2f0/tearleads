import { expect, test } from "bun:test";
import {
  getExplorerContainerIcon,
  SELECTABLE_CONTAINER_ICON_SLUGS,
  toSelectableContainerIconSlug,
  toStoredContainerIcon,
} from "./explorerContainerIcons";

test("the playlist and album slugs resolve to their own glyphs", () => {
  expect(
    getExplorerContainerIcon({ icon: "playlist", isOpen: false }).name,
  ).toBe("playlist");
  expect(getExplorerContainerIcon({ icon: "album", isOpen: false }).name).toBe(
    "album",
  );
});

test("unset and unknown icons fall back to the folder glyph", () => {
  expect(getExplorerContainerIcon({ icon: null, isOpen: false }).name).toBe(
    "folder",
  );
  expect(getExplorerContainerIcon({ icon: null, isOpen: true }).name).toBe(
    "folder-open",
  );
  expect(
    getExplorerContainerIcon({ icon: "mystery", isOpen: false }).name,
  ).toBe("folder");
});

test("the trash slug is preserved for the app-managed trash folder", () => {
  expect(getExplorerContainerIcon({ icon: "trash", isOpen: true }).name).toBe(
    "trash",
  );
});

test("the contacts slug resolves to the address-book glyph regardless of open state", () => {
  expect(
    getExplorerContainerIcon({ icon: "contacts", isOpen: false }).name,
  ).toBe("contacts");
  expect(
    getExplorerContainerIcon({ icon: "contacts", isOpen: true }).name,
  ).toBe("contacts");
});

test("stored icon values map to the picker slugs, defaulting to folder", () => {
  expect(toSelectableContainerIconSlug(null)).toBe("folder");
  expect(toSelectableContainerIconSlug(undefined)).toBe("folder");
  expect(toSelectableContainerIconSlug("")).toBe("folder");
  expect(toSelectableContainerIconSlug("  playlist  ")).toBe("playlist");
  expect(toSelectableContainerIconSlug("album")).toBe("album");
  // trash is app-managed and not a user-selectable option, so it reads as folder.
  expect(toSelectableContainerIconSlug("trash")).toBe("folder");
  // contacts is likewise app-managed and not user-selectable.
  expect(toSelectableContainerIconSlug("contacts")).toBe("folder");
});

test("the folder slug persists as null while others persist verbatim", () => {
  expect(toStoredContainerIcon("folder")).toBeNull();
  expect(toStoredContainerIcon("playlist")).toBe("playlist");
  expect(toStoredContainerIcon("album")).toBe("album");
});

test("every selectable slug round-trips back to itself", () => {
  for (const slug of SELECTABLE_CONTAINER_ICON_SLUGS) {
    expect(toSelectableContainerIconSlug(toStoredContainerIcon(slug))).toBe(
      slug,
    );
  }
});
