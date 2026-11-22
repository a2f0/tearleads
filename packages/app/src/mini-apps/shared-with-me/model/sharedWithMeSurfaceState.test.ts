import { describe, expect, test } from "bun:test";
import { SHARED_WITH_ME_LABELS } from "../labels";
import { resolveSharedWithMeSurfaceState } from "./sharedWithMeSurfaceState";

const PROGRESS = {
  description: "Registering your identity.",
  phase: "creating-account",
  title: "Creating your account",
} as const;

describe("resolveSharedWithMeSurfaceState", () => {
  test("shows account setup instead of loading or empty", () => {
    for (const ready of [false, true]) {
      expect(
        resolveSharedWithMeSurfaceState({
          progress: PROGRESS,
          ready,
          rowCount: 0,
        }),
      ).toEqual({
        busy: true,
        description: PROGRESS.description,
        title: PROGRESS.title,
      });
    }
  });

  test("shows loading while the list is not ready", () => {
    expect(
      resolveSharedWithMeSurfaceState({
        progress: null,
        ready: false,
        rowCount: 0,
      }),
    ).toEqual({
      busy: true,
      description: undefined,
      title: SHARED_WITH_ME_LABELS.loading,
    });
  });

  test("shows the empty state once ready with nothing shared", () => {
    expect(
      resolveSharedWithMeSurfaceState({
        progress: null,
        ready: true,
        rowCount: 0,
      }),
    ).toEqual({
      busy: false,
      description: SHARED_WITH_ME_LABELS.emptyDescription,
      title: SHARED_WITH_ME_LABELS.empty,
    });
  });

  test("shows the list once rows exist, even mid account setup", () => {
    expect(
      resolveSharedWithMeSurfaceState({
        progress: PROGRESS,
        ready: true,
        rowCount: 1,
      }),
    ).toBeNull();
  });
});
