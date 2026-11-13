import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, type Page, type TestInfo, test } from "@playwright/test";
import { clearStaleLocalState } from "../screenshots/appShell";
import { restoreSeedBackup } from "../screenshots/seedRestore";

let artifactPath: string;
let folderId: string;
test.beforeAll(async ({ browserName }, testInfo) => {
  artifactPath = testInfo.outputPath(
    `container-view-${browserName}.tlbackup.json`,
  );
  const builder = fileURLToPath(
    new URL(
      "../../app/test/container-view-seed/buildContainerViewSeed.ts",
      import.meta.url,
    ),
  );
  const { stdout } = await promisify(execFile)("bun", [builder, artifactPath]);
  folderId = JSON.parse(stdout.trim()).folderId;
});

async function assertContactAndNotes(page: Page) {
  const contact = page.locator(".container-document-view");
  const notes = page.getByRole("region", { name: "Container notes" });
  await expect(
    contact.getByText("Ada Lovelace", { exact: true }),
  ).toBeVisible();
  await expect(contact.getByText("Ada", { exact: true })).toBeVisible();
  await expect(
    contact.getByRole("img", { name: "Avatar for Ada Lovelace" }),
  ).toBeVisible();
  await expect(notes).toContainText("Existing note content 2.");
  await expect(notes).toContainText("Existing note content 3.");
  const contactBox = await contact
    .getByText("Ada Lovelace", { exact: true })
    .boundingBox();
  const notesBox = await notes.boundingBox();
  if (!contactBox || !notesBox)
    throw new Error("Contact and notes must have visible geometry");
  expect(notesBox.y).toBeGreaterThan(contactBox.y);
  expect(await notes.locator('[contenteditable="true"]').count()).toBe(0);
  const overflowing = await contact.evaluate(
    (element) => element.scrollWidth > element.clientWidth + 1,
  );
  expect(overflowing).toBe(false);
  await notes
    .getByRole("button", { name: "Open Meeting notes", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Notes editor", exact: true }),
  ).toBeEditable();
  await page.goto(`/app/explorer/containers/${folderId}`);
  await expect(
    page
      .locator(".container-document-view")
      .getByText("Ada Lovelace", { exact: true }),
  ).toBeVisible();
}

async function assertContactEditingSurvivesRefresh(page: Page) {
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const firstName = page.getByRole("textbox", {
    name: "First name",
    exact: true,
  });
  const lastName = page.getByRole("textbox", {
    name: "Last name",
    exact: true,
  });
  await firstName.fill("Augusta Ada");
  // Blur commits through the real SDK and triggers Explorer's list revision.
  await lastName.focus();
  await expect(page.locator(".container-document-view h2")).toHaveText(
    "Augusta Ada Lovelace",
  );
  await expect(firstName).toHaveValue("Augusta Ada");
  await expect(lastName).toBeFocused();
  await lastName.fill("Byron");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.locator(".container-document-view h2")).toHaveText(
    "Augusta Ada Byron",
  );
  await page.reload();
  await expect(page.locator(".container-document-view h2")).toHaveText(
    "Augusta Ada Byron",
  );
  // Restore the fixture through the same editor for the remaining scenarios.
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await firstName.fill("Ada");
  await lastName.focus();
  await expect(page.locator(".container-document-view h2")).toHaveText(
    "Ada Byron",
  );
  await lastName.fill("Lovelace");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.locator(".container-document-view h2")).toHaveText(
    "Ada Lovelace",
  );
}

async function assertUnsupportedFallback(page: Page) {
  await page
    .getByRole("button", { name: "Set primary document", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "Use Follow-up notes as primary",
      exact: true,
    })
    .click();
  await expect(
    page.getByText(
      "No specialized view for this document type. Showing contents.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Supporting files", exact: true }).last(),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Clear primary document", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Set primary document", exact: true }),
  ).toBeVisible();
}

async function observeBrowserErrors(page: Page) {
  const errors: Array<{ message: string; url: string }> = [];
  page.on("pageerror", (error) =>
    errors.push({ message: error.message, url: page.url() }),
  );
  page.on("console", (message) => {
    if (message.type() === "error")
      errors.push({ message: message.text(), url: message.location().url });
  });
  await page.addInitScript(() => {
    window.addEventListener("securitypolicyviolation", (event) => {
      console.error(`CSP violation: ${event.effectiveDirective}`);
    });
  });
  return errors;
}

async function assertBrowserDiagnostics(
  errors: Awaited<ReturnType<typeof observeBrowserErrors>>,
  testInfo: TestInfo,
) {
  const path = testInfo.outputPath("browser-diagnostics.json");
  await writeFile(path, JSON.stringify(errors, null, 2));
  await testInfo.attach("browser-diagnostics", {
    path,
    contentType: "application/json",
  });
  // The E2E web server intentionally has no API. Retain those network errors in
  // the attachment, but still reject JS/CSP failures and every unrelated error.
  const unexpected = errors.filter(
    (error) =>
      !(
        error.message ===
          "Failed to load resource: net::ERR_CONNECTION_REFUSED" &&
        error.url.startsWith("http://localhost:3001/")
      ),
  );
  expect(unexpected).toEqual([]);
}

for (const viewport of [
  { name: "desktop", width: 1440, height: 1000 },
  { name: "phone", width: 390, height: 844 },
]) {
  test(`contact container views keep real notes and contents accessible on ${viewport.name}`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(90_000); // Restore + multiple real-document navigation/reload steps.
    const errors = await observeBrowserErrors(page);
    await page.setViewportSize(viewport);
    await page.goto("/app/backup-restore");
    await restoreSeedBackup(page, {
      artifactPath,
      password: "container-view-test-only",
    });
    await clearStaleLocalState(page);
    await page.goto(`/app/explorer/containers/${folderId}`);
    await expect(
      page.getByRole("button", { name: "Set primary document", exact: true }),
    ).toBeVisible();
    await expect(
      page
        .getByRole("button", { name: "Supporting files", exact: true })
        .last(),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Set primary document", exact: true })
      .click();
    await expect(
      page.getByRole("button", {
        name: "Use Offline draft as primary",
        exact: true,
      }),
    ).toBeDisabled();
    await expect(
      page.getByText(
        "New offline documents become available here after their first sync.",
      ),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Use Ada Lovelace as primary", exact: true })
      .click();
    await assertContactAndNotes(page);
    await assertContactEditingSurvivesRefresh(page);
    await page.getByRole("button", { name: "Contents", exact: true }).click();
    await expect(
      page
        .getByRole("button", { name: "Supporting files", exact: true })
        .last(),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Contact view", exact: true })
      .click();
    await page.reload();
    await expect(
      page
        .locator(".container-document-view")
        .getByText("Ada Lovelace", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Change primary document", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Use Grace Hopper as primary", exact: true })
      .click();
    await expect(
      page
        .locator(".container-document-view")
        .getByText("Grace Hopper", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Clear primary document", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Set primary document", exact: true }),
    ).toBeVisible();
    await expect(
      page
        .getByRole("button", { name: "Supporting files", exact: true })
        .last(),
    ).toBeVisible();
    await assertUnsupportedFallback(page);
    await assertBrowserDiagnostics(errors, testInfo);
  });
}
