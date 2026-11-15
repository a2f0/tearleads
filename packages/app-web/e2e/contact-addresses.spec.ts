import { expect, type Locator, type Page, test } from "@playwright/test";
import { measureAttached } from "./domMeasure";

test.use({ viewport: { width: 390, height: 844 } });

const HOME = {
  Label: "Home",
  "Street address": "17 Maple Street",
  "Apartment / suite": "Apartment 02",
  "City / locality": "Boston",
  "State / region": "MA",
  "Postal code": "02108",
  "Country code": "US",
};
const WORK = {
  Label: "Work",
  "Street address": "8 King Street",
  "Apartment / suite": "Suite 4",
  "City / locality": "London",
  "State / region": "Greater London",
  "Postal code": "SW1A 1AA",
  "Country code": "GB",
};
type PostalAddress = typeof HOME;

function addresses(page: Page): Locator {
  return page.getByRole("region", { name: "Addresses", exact: true });
}

async function createContact(page: Page, name: string): Promise<string> {
  await page.goto("/app/contacts/new");
  await page.getByLabel("Nickname", { exact: true }).fill(name);
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/contacts\/contact\/[^/]+$/u);
  await expect(
    addresses(page).getByText("No addresses.", { exact: true }),
  ).toBeVisible();
  return page.url();
}

async function fillAddress(page: Page, values: PostalAddress): Promise<void> {
  const form = page.getByRole("form", { name: "Address editor" });
  for (const [label, value] of Object.entries(values)) {
    await form.getByLabel(label, { exact: true }).fill(value);
  }
}

async function expectAddresses(
  page: Page,
  values: readonly PostalAddress[],
): Promise<void> {
  const section = addresses(page);
  await expect(section.getByRole("group")).toHaveCount(values.length);
  for (const address of values) {
    const card = section.getByRole("group", {
      name: address.Label,
      exact: true,
    });
    await expect(card).toBeVisible();
    await expect(card.getByRole("definition")).toHaveText(
      Object.entries(address)
        .filter(([label]) => label !== "Label")
        .map(([, value]) => value),
    );
  }
}

async function addAddress(page: Page, values: PostalAddress): Promise<void> {
  await addresses(page).getByRole("button", { name: "Add address" }).click();
  await fillAddress(page, values);
  await page.getByRole("button", { name: "Save address", exact: true }).click();
  await expect(page.getByRole("form", { name: "Address editor" })).toHaveCount(
    0,
  );
}

async function openApp(page: Page, name: "Contacts" | "Explorer") {
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await page
    .getByRole("navigation", { name: "Apps" })
    .getByRole("link", { name, exact: true })
    .click();
}

async function openExplorerContact(page: Page, name: string): Promise<void> {
  await openApp(page, "Explorer");
  await page
    .locator(".explorer-item-row-button")
    .filter({ hasText: "Contacts" })
    .click();
  await page
    .locator(".explorer-item-row-button")
    .filter({ hasText: name })
    .click();
  // Folder-row navigation uses document-selection, not the generic items route.
  await expect(page).toHaveURL(
    /\/app\/explorer\/containers\/[^/]+\/documents\/[^/]+$/u,
  );
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const section = addresses(page);
  await expect(section).toBeVisible();
  const geometry = await measureAttached("contact addresses", () =>
    section.evaluate((element) => {
      if (!element.isConnected) return null;
      const nodes = new Set<Element>([
        element,
        ...element.querySelectorAll(
          "form, label, button, [role=group], h4, dd",
        ),
      ]);
      let parent = element.parentElement;
      while (parent) {
        nodes.add(parent);
        parent = parent.parentElement;
      }
      return {
        width: element.getBoundingClientRect().width,
        overflowing: Array.from(nodes).flatMap((node) => {
          const box = node.getBoundingClientRect();
          const overflow = node.scrollWidth - node.clientWidth;
          const overflowX = getComputedStyle(node).overflowX;
          // Explorer's non-scroll panel contains an intentional full-bleed
          // divider. Check every ancestor's bounds, but apply scrollWidth to
          // address content, scroll/clipping containers, and the page roots.
          const measuresOverflow =
            node === element ||
            element.contains(node) ||
            overflowX !== "visible" ||
            node === document.documentElement ||
            node === document.body;
          return (measuresOverflow && overflow > 1) ||
            box.left < -1 ||
            box.right > innerWidth + 1
            ? [
                {
                  tag: node.tagName,
                  className: node.className,
                  overflowX,
                  overflow,
                  left: box.left,
                  right: box.right,
                },
              ]
            : [];
        }),
      };
    }),
  );
  expect(geometry.width).toBeGreaterThan(0);
  expect(geometry.overflowing).toEqual([]);
}

test("postal addresses round-trip between Contacts and Explorer and survive reload", async ({
  page,
}) => {
  const name = "Postal address round trip";
  const contactUrl = await createContact(page, name);
  const updatedWork = {
    ...WORK,
    "Street address": "22 Queen Street",
    "City / locality": "Edinburgh",
  };

  await test.step("Contacts saves two complete labeled addresses", async () => {
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await addAddress(page, HOME);
    await addAddress(page, WORK);
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await expectAddresses(page, [HOME, WORK]);
  });

  await test.step("Explorer reads both and edits only the Work address", async () => {
    await openExplorerContact(page, name);
    await expectAddresses(page, [HOME, WORK]);
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await addresses(page)
      .getByRole("group", { name: "Work", exact: true })
      .getByRole("button", { name: "Edit address", exact: true })
      .click();
    const form = page.getByRole("form", { name: "Address editor" });
    await form
      .getByLabel("Street address", { exact: true })
      .fill(updatedWork["Street address"]);
    await form
      .getByLabel("City / locality", { exact: true })
      .fill(updatedWork["City / locality"]);
    await form
      .getByRole("button", { name: "Save address", exact: true })
      .click();
    await expect(form).toHaveCount(0);
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await expectAddresses(page, [HOME, updatedWork]);
  });

  await test.step("Contacts reopens the same contact with Explorer's edits", async () => {
    await openApp(page, "Contacts");
    await page
      .getByRole("region", { name: "Contacts list" })
      .getByRole("button", { name, exact: true })
      .click();
    await expect(page).toHaveURL(contactUrl);
    await expectAddresses(page, [HOME, updatedWork]);
  });

  await test.step("a real reload retains every address field", async () => {
    await page.reload();
    await expect(page).toHaveURL(contactUrl);
    await expectAddresses(page, [HOME, updatedWork]);
    await openExplorerContact(page, name);
    await expectAddresses(page, [HOME, updatedWork]);
  });
});

test("long postal address text fits phone-width editors and both read surfaces", async ({
  page,
}) => {
  const name = "Phone address wrapping";
  const longAddress = {
    ...HOME,
    Label: "LongAddressLabel".repeat(8),
    "Street address": "LongUnbrokenStreetName".repeat(12),
    "Apartment / suite": "SuiteWithALongUnbrokenName".repeat(8),
  };
  await createContact(page, name);
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await addresses(page).getByRole("button", { name: "Add address" }).click();
  await fillAddress(page, longAddress);
  await expectNoHorizontalOverflow(page);
  await page.getByRole("button", { name: "Save address", exact: true }).click();
  await expect(page.getByRole("form", { name: "Address editor" })).toHaveCount(
    0,
  );
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expectAddresses(page, [longAddress]);
  await expectNoHorizontalOverflow(page);

  await openExplorerContact(page, name);
  await expectAddresses(page, [longAddress]);
  await expectNoHorizontalOverflow(page);
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await addresses(page)
    .getByRole("group", { name: longAddress.Label, exact: true })
    .getByRole("button", { name: "Edit address", exact: true })
    .click();
  await expect(
    page
      .getByRole("form", { name: "Address editor" })
      .getByLabel("Street address", { exact: true }),
  ).toHaveValue(longAddress["Street address"]);
  await expectNoHorizontalOverflow(page);
});
