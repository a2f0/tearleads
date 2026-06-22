import { describe, expect, test } from "bun:test";
import {
  extractMarkerIds,
  findingMarkerId,
  renderMarker,
} from "./findingMarker";

describe("findingMarker", () => {
  test("id is stable for the same path+title and differs otherwise", () => {
    const a = findingMarkerId("src/a.ts", "Possible null deref");
    expect(a).toBe(findingMarkerId("src/a.ts", "Possible null deref"));
    expect(a).not.toBe(findingMarkerId("src/a.ts", "Other issue"));
    expect(a).not.toBe(findingMarkerId("src/b.ts", "Possible null deref"));
    expect(a).toMatch(/^[0-9a-f]{12}$/);
  });

  test("extractMarkerIds round-trips a rendered marker", () => {
    const id = findingMarkerId("src/a.ts", "x");
    const body = `Some finding\n\n${renderMarker(id)}`;
    expect([...extractMarkerIds([body])]).toEqual([id]);
  });

  test("extractMarkerIds returns empty for bodies without markers", () => {
    expect(extractMarkerIds(["no marker here", ""]).size).toBe(0);
  });
});
