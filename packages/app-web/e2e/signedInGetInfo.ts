import {
  expect,
  type Locator,
  type Page,
  type Response,
} from "@playwright/test";
import { SIGNED_IN_API_URL } from "./signedInServer";

/*
 * Get Info's remote tables on a signed-in phone. Signed out, Container Info has
 * no Sharing, Security, or Sync tables and Document Info no attribution, so
 * these helpers sign a fresh browser context in against the e2e run's
 * in-memory API (see signedInServer.ts) and create one folder and one note
 * whose Get Info fills all five multi-column tables:
 *
 * - the folder's grants (an Admins grant inherited from the root),
 * - its security path (the root, then the folder),
 * - its sync cursors (one row per lane),
 * - the note's attachments (one uploaded file), and
 * - its edit ranges (two synced edits; behind the document-edit-ranges flag).
 *
 * Every step waits for the API response or the screen that proves it landed,
 * never for a fixed time.
 */

export const PHONE_VIEWPORT = { width: 390, height: 844 };

export const SIGNED_IN_FOLDER = "Field Notes";
export const SIGNED_IN_NOTE = "Field log";

const NOTE_TEXT = `${SIGNED_IN_NOTE}\nFirst line of the field log.`;
const NOTE_EDIT = "A second edit adds another range.";
const ATTACHMENT = {
  buffer: Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="#0d6b32"/></svg>',
  ),
  mimeType: "image/svg+xml",
  // Long, so any column that shows it has to truncate it. Once uploaded, Get
  // Info's attachments table shows the MIME type instead: the SDK keeps no
  // name for a stored attachment, only for a pending one.
  name: "field-sketch-with-a-deliberately-long-file-name-for-layout.svg",
};

const EDIT_RANGES_FLAG_KEY = "tearleads.feature-flags:document-edit-ranges";

/** Each table is found by the heading of the Get Info section it sits in. */
const GET_INFO_TABLE_HEADINGS = {
  /** Container Info > Sharing. */
  grants: "Principal Grants",
  /** Container Info > Security. */
  path: "Container Path",
  /** Container Info > Sync. */
  syncCursors: "Sync Cursors",
  /** Document Info > Blobs. */
  attachments: "Attachments & Blobs",
  /** Document Info > Attribution, once {@link showEditRanges} has run. */
  editRanges: "Edit Ranges",
} as const;

type GetInfoTable = keyof typeof GET_INFO_TABLE_HEADINGS;

function apiResponse(
  page: Page,
  method: string,
  pathname: RegExp,
): Promise<Response> {
  return page.waitForResponse(
    (response) => {
      const url = new URL(response.url());
      return (
        url.origin === SIGNED_IN_API_URL &&
        response.request().method() === method &&
        pathname.test(url.pathname) &&
        response.status() === 200
      );
    },
    { timeout: 60_000 },
  );
}

/**
 * The default host profile generates a fresh identity, asks what to call the
 * user, and registers and logs it in once answered. This page comes from its
 * own browser context, outside the appTest fixture, so it answers here.
 */
async function signIn(page: Page): Promise<void> {
  await page.addInitScript((key) => {
    localStorage.setItem(key, "enabled");
  }, EDIT_RANGES_FLAG_KEY);
  const loggedIn = apiResponse(page, "POST", /^\/auth\/verify$/u);
  await page.goto("/app/explorer");
  const prompt = page
    .getByRole("textbox", { name: "What should we call you?" })
    .first();
  await prompt.fill("Bob", { timeout: 60_000 });
  await prompt.press("Enter");
  await loggedIn;
}

async function createFolder(page: Page): Promise<void> {
  const create = page.getByRole("button", {
    name: "Create Child Folder",
    exact: true,
  });
  await expect(create).toBeEnabled({ timeout: 60_000 });
  await create.click();
  const dialog = page.getByRole("dialog", { name: "Create Child Folder" });
  await dialog
    .getByRole("textbox", { name: "Container name" })
    .fill(SIGNED_IN_FOLDER);
  const created = apiResponse(
    page,
    "POST",
    /^\/containers\/with-metadata-document$/u,
  );
  await dialog.getByRole("button", { name: "Create", exact: true }).click();
  await created;
  // Creating a folder opens it, so the note below is created inside it.
  await expect(
    page.getByRole("button", { name: `Folder actions: ${SIGNED_IN_FOLDER}` }),
  ).toBeVisible({ timeout: 30_000 });
}

/** Two synced edits, so attribution records more than one edit range. */
async function createNote(page: Page): Promise<void> {
  const newDocument = page.getByRole("button", {
    name: "New Document",
    exact: true,
  });
  await expect(newDocument).toBeEnabled({ timeout: 30_000 });
  await newDocument.click();
  await page.getByRole("button", { name: "Note", exact: true }).click();

  const editor = page.getByRole("textbox", { name: /Notes editor/u });
  await expect(editor).toBeEditable({ timeout: 30_000 });
  const created = apiResponse(page, "POST", /^\/documents$/u);
  await editor.fill(NOTE_TEXT);
  await created;

  const synced = apiResponse(page, "POST", /^\/documents\/[^/]+\/sync$/u);
  await editor.fill(`${NOTE_TEXT}\n${NOTE_EDIT}`);
  await synced;
}

/** Attaches a file to the open note through its attachments panel. */
async function attachFile(page: Page): Promise<void> {
  const chooser = page.waitForEvent("filechooser");
  const bound = apiResponse(
    page,
    "POST",
    /^\/blobs\/[^/]+\/attachment-bindings$/u,
  );
  await page.getByRole("button", { name: "Upload", exact: true }).click();
  await (await chooser).setFiles(ATTACHMENT);
  await bound;
  await expect(
    page.getByRole("button", { name: "All changes synced" }),
  ).toBeVisible({ timeout: 60_000 });
}

/**
 * Signs `page` in on the signed-in server and creates the folder and note the
 * five tables read. Run it once per browser context: each context registers
 * its own identity, so the names below are unique within it.
 */
export async function seedSignedInGetInfo(page: Page): Promise<void> {
  await signIn(page);
  await createFolder(page);
  await createNote(page);
  await attachFile(page);
}

async function openRowInfo(page: Page, rowName: string): Promise<void> {
  const actions = page.getByRole("button", {
    name: `Actions for ${rowName}`,
    exact: true,
  });
  await expect(actions).toBeVisible({ timeout: 30_000 });
  await actions.click();
  await page.getByText("Get Info", { exact: true }).first().click();
}

/**
 * Info loads after its tabs appear, and a tab chosen before then can be
 * replaced by the default one, so keep choosing until the tab sticks.
 */
async function selectInfoTab(page: Page, tab: string): Promise<void> {
  const tabButton = page.getByRole("tab", { name: tab, exact: true });
  await expect(tabButton).toBeVisible({ timeout: 30_000 });
  await expect(async () => {
    await tabButton.click();
    await expect(tabButton).toHaveAttribute("aria-selected", "true", {
      timeout: 1_000,
    });
  }).toPass({ timeout: 30_000 });
}

/** Opens Get Info for a folder in the root and selects `tab`. */
export async function openContainerInfoTab(
  page: Page,
  folderName: string,
  tab: string,
): Promise<void> {
  await page.goto("/app/explorer");
  await openRowInfo(page, folderName);
  await selectInfoTab(page, tab);
}

/**
 * Opens Get Info for a document in a folder in the root and selects `tab`. A
 * wide pane lists the folder in the sidebar tree too, so open the list's.
 */
export async function openDocumentInfoTab(
  page: Page,
  folderName: string,
  documentName: string,
  tab: string,
): Promise<void> {
  await page.goto("/app/explorer");
  await page
    .getByRole("table", { name: "Items in /", exact: true })
    .getByRole("button", { name: folderName, exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: `Folder actions: ${folderName}` }),
  ).toBeVisible({ timeout: 30_000 });
  await openRowInfo(page, documentName);
  await selectInfoTab(page, tab);
}

/**
 * The first table after `table`'s section heading, within that section: found
 * by heading rather than by markup, so it holds however the table is framed.
 */
export function getInfoTable(page: Page, table: GetInfoTable): Locator {
  return page
    .getByRole("tabpanel")
    .getByRole("heading", {
      name: GET_INFO_TABLE_HEADINGS[table],
      exact: true,
    })
    .locator("xpath=(following-sibling::*/descendant-or-self::table)[1]");
}

/**
 * Body rows. Not by role: a row that opens something (a grant's group) is
 * exposed as a button rather than a row.
 */
export function getInfoTableRows(table: Locator): Locator {
  return table.locator("tbody > tr");
}

/**
 * Edit ranges load on demand. The section appears once the server's
 * attribution for the note has loaded.
 */
export async function showEditRanges(page: Page): Promise<void> {
  const show = page.getByRole("button", { name: "Show edit ranges" });
  await expect(show).toBeVisible({ timeout: 30_000 });
  await show.click();
}
