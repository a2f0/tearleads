/**
 * A key/value list's rows as `label -> value`, read from what it renders (a
 * Get Info row's detail dialog, a details section).
 */
export function readKeyValueRows(root: HTMLElement): Record<string, string> {
  return Object.fromEntries(
    Array.from(root.querySelectorAll(".mini-app-key-value-row"), (row) => [
      row.querySelector("dt")?.textContent ?? "",
      row.querySelector("dd")?.textContent ?? "",
    ]),
  );
}
