import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ROUTED_TABLET_BREAKPOINT_PX } from "./breakpoints";

const routedDir = join(import.meta.dir, "../components/layout/routed");

/**
 * CSS media queries cannot read TS constants, so the routed shell stylesheets
 * hard-code the mobile/tablet divider that useRoutedLayoutTier resolves from
 * ROUTED_TABLET_BREAKPOINT_PX. This guard fails the moment either side moves
 * without the other, replacing the "keep the two in sync" comment with an
 * enforced contract.
 */
describe("routed tablet breakpoint", () => {
  test("routed shell CSS mirrors ROUTED_TABLET_BREAKPOINT_PX", () => {
    const expected = `@media (max-width: ${ROUTED_TABLET_BREAKPOINT_PX - 1}px)`;
    const cssFiles = readdirSync(routedDir).filter((name) =>
      name.endsWith(".css"),
    );
    expect(cssFiles.length).toBeGreaterThan(0);

    const allQueries: string[] = [];
    for (const name of cssFiles) {
      const css = readFileSync(join(routedDir, name), "utf8");
      allQueries.push(...(css.match(/@media \(max-width: \d+px\)/g) ?? []));
    }

    // The divider must be present, and no routed stylesheet may introduce a
    // max-width query at any other line — every mobile-tier guard sits exactly
    // at the shared breakpoint.
    expect(allQueries).toContain(expected);
    for (const query of allQueries) {
      expect(query).toBe(expected);
    }
  });
});
