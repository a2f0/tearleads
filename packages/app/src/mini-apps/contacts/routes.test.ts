import { expect, test } from "bun:test";
import {
  createContactsSelectionRouteSnapshot,
  formatContactsRouteSegments,
  parseContactsRouteSegments,
} from "./routes";

test("contacts route segments round-trip selected contacts and actions", () => {
  expect(parseContactsRouteSegments([])).toEqual({
    route: "selection",
    selectedContactId: null,
  });
  expect(parseContactsRouteSegments(["contact", "ada"])).toEqual({
    route: "selection",
    selectedContactId: "ada",
  });
  expect(parseContactsRouteSegments(["new"])).toEqual({
    route: "new-contact",
    selectedContactId: null,
  });
  expect(parseContactsRouteSegments(["import"])).toEqual({
    route: "import-contact",
    selectedContactId: null,
  });

  expect(
    formatContactsRouteSegments({
      route: "selection",
      selectedContactId: "ada",
    }),
  ).toEqual(["contact", "ada"]);
  expect(
    formatContactsRouteSegments({
      route: "new-contact",
      selectedContactId: null,
    }),
  ).toEqual(["new"]);
});

test("contacts selection route snapshot clears selection in compact routed mode", () => {
  expect(createContactsSelectionRouteSnapshot(false, "ada")).toEqual({
    route: "selection",
    selectedContactId: "ada",
  });

  expect(createContactsSelectionRouteSnapshot(true, "ada")).toEqual({
    route: "selection",
    selectedContactId: null,
  });
});
