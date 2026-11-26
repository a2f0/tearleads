import { expect, type Locator, type Page } from "@playwright/test";
import {
  type FolderNoteExpectation,
  type PasscodeExpectation,
  seedExpectations,
} from "./continuity";
import { openItemInfo } from "./getInfoScreens";
import { openExplorerDocument } from "./householdScreens";

/*
 * The seeded Family folder: a note the account's owner wrote and three family
 * members added to through the Family group's write grant, shown by who wrote
 * each part (Get Info > Attribution) and change by change (History). Beside
 * it, a passcode with extra attributes from the root.
 */

type Scope = Page | Locator;

const folder = seedExpectations.folders.find(({ grants }) =>
  grants.some(({ access }) => access === "write"),
);
const note = folder?.notes.find(({ authors }) => authors.length >= 2);
const passcode = seedExpectations.passcodes.find(
  ({ attributeCount }) => attributeCount > 0,
);
if (!folder || !note || !passcode) {
  throw new Error("Continuity has no shared folder note or passcode.");
}
const FOLDER: string = folder.name;
const NOTE: FolderNoteExpectation = note;
const PASSCODE: PasscodeExpectation = passcode;
/** The owner shows as the signed-in user; members by their profile names. */
const WRITERS = ["You", ...NOTE.authors];
const FIRST_AUTHOR = NOTE.authors[0] ?? "";
const LAST_AUTHOR = NOTE.authors.at(-1) ?? "";

async function openFamilyFolder(scope: Scope): Promise<void> {
  // The row whose name is exactly the folder's; a phone row adds its type
  // beside the name, and a sibling may share the name's start.
  const row = scope.locator(".explorer-item-row-button").filter({
    has: scope.locator(".explorer-item-name").getByText(FOLDER, {
      exact: true,
    }),
  });
  await expect(row).toHaveCount(1, { timeout: 20_000 });
  await row.click();
  await expect(
    scope.locator(".explorer-item-row-button", { hasText: NOTE.title }),
  ).toHaveCount(1, { timeout: 30_000 });
}

async function openFamilyNote(scope: Scope): Promise<void> {
  await openFamilyFolder(scope);
  await openExplorerDocument(scope, NOTE.title);
  const editor = scope.getByRole("textbox", { name: /Notes editor/u });
  await expect(editor).toHaveValue(NOTE.text, { timeout: 30_000 });
}

async function openNoteBlame(scope: Scope): Promise<void> {
  await openFamilyFolder(scope);
  await openItemInfo(scope, NOTE.title, "Type");
  await scope.getByRole("tab", { name: "Attribution", exact: true }).click();
  const prose = scope.locator(".explorer-blame-prose");
  await expect(prose).toHaveText(NOTE.text, { timeout: 60_000 });
  const legend = scope.locator(".explorer-blame-legend-item");
  for (const writer of WRITERS) {
    // The whole label, so "You" does not also match a name containing it.
    const label = writer.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    await expect(
      legend.filter({ hasText: new RegExp(`^${label}$`, "u") }),
    ).toHaveCount(1, { timeout: 60_000 });
  }
  await expect(legend).toHaveCount(WRITERS.length);
  await expect(scope.locator(".explorer-blame-run--unattributed")).toHaveCount(
    0,
  );
  // The legend follows the prose; on a phone, scroll until all of it shows.
  await legend.last().scrollIntoViewIfNeeded();
}

function historyTimeline(scope: Scope): Locator {
  return scope.getByRole("region", { name: "History", exact: true });
}

/** The selected change has replayed and names who uploaded it. */
async function expectHistoryStop(scope: Scope, writer: string): Promise<void> {
  const timeline = historyTimeline(scope);
  await expect(
    scope.locator(".explorer-document-history-view[aria-busy='false']"),
  ).toHaveCount(1, { timeout: 30_000 });
  await expect(
    timeline.locator(".explorer-document-history-caption"),
  ).toContainText(`Uploaded by ${writer}`, { timeout: 30_000 });
}

async function openNoteHistory(scope: Scope): Promise<void> {
  await openFamilyNote(scope);
  await scope.getByRole("button", { name: "History", exact: true }).click();
  const timeline = historyTimeline(scope);
  await expect(timeline).toBeVisible({ timeout: 30_000 });
  const position = timeline.locator(".explorer-document-history-position");
  // History opens on the latest change: the last member's line.
  await expect(position).toHaveText(/^(\d+) \/ \1$/u, { timeout: 30_000 });
  await expectHistoryStop(scope, LAST_AUTHOR);
}

/** Steps back to the first member's change, with the owner's text before it. */
async function openEarlierNoteHistory(scope: Scope): Promise<void> {
  await openNoteHistory(scope);
  const timeline = historyTimeline(scope);
  const caption = timeline.locator(".explorer-document-history-caption");
  const position = timeline.locator(".explorer-document-history-position");
  const total = Number((await position.textContent())?.split(" / ")[1]);
  for (let step = 1; step < NOTE.authors.length; step += 1) {
    await timeline
      .getByRole("button", { name: "Previous change", exact: true })
      .click();
    // Each step moves the position first; then the view replays to it.
    await expect(position).toHaveText(`${total - step} / ${total}`, {
      timeout: 30_000,
    });
    await expect(
      scope.locator(".explorer-document-history-view[aria-busy='false']"),
    ).toHaveCount(1, { timeout: 30_000 });
  }
  await expect(caption).toContainText(`Uploaded by ${FIRST_AUTHOR}`, {
    timeout: 30_000,
  });
  // The pointer rests on Previous change; park it on the caption so no
  // control captures hovered.
  await caption.hover();
}

async function openPasscodeDetail(scope: Scope): Promise<void> {
  await openExplorerDocument(scope, PASSCODE.title);
  // Each key-value list is a named group.
  const entry = scope.getByRole("group", { name: "Entry", exact: true });
  await expect(entry).toBeVisible({ timeout: 20_000 });
  for (const key of ["username", "url", "notes"] as const) {
    const value = PASSCODE.fields[key];
    if (value) {
      await expect(entry.getByText(value, { exact: true })).toBeVisible();
    }
  }
  // Secrets stay masked on screen.
  const { password } = PASSCODE.fields;
  if (password) {
    await expect(entry.getByText(password, { exact: true })).toHaveCount(0);
  }
  const attributes = scope.getByRole("group", {
    name: "Additional attributes",
    exact: true,
  });
  await expect(attributes.locator("dt")).toHaveCount(PASSCODE.attributeCount);
}

export const FAMILY_SCREENS = [
  { name: "note-blame", open: openNoteBlame },
  { name: "note-history", open: openNoteHistory },
  { name: "note-history-earlier", open: openEarlierNoteHistory },
  { name: "passcode-detail", open: openPasscodeDetail },
].map((screen) => ({
  ...screen,
  route: "/app/explorer",
  menuLabel: "Explorer",
}));
