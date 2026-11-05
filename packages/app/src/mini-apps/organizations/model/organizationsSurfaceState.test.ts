import { describe, expect, test } from "bun:test";
import { ORGANIZATIONS_LABELS } from "../labels";
import { resolveOrganizationsSurfaceState } from "./organizationsSurfaceState";

const PROGRESS = {
  description: "Registering your identity.",
  title: "Creating your account",
};

describe("resolveOrganizationsSurfaceState", () => {
  test("shows account setup instead of loading or empty", () => {
    for (const ready of [false, true]) {
      expect(
        resolveOrganizationsSurfaceState({
          cardCount: 0,
          progress: PROGRESS,
          ready,
        }),
      ).toEqual({
        busy: true,
        description: PROGRESS.description,
        title: PROGRESS.title,
      });
    }
  });

  test("shows loading while the dashboard is not ready", () => {
    expect(
      resolveOrganizationsSurfaceState({
        cardCount: 0,
        progress: null,
        ready: false,
      }),
    ).toEqual({
      busy: true,
      description: undefined,
      title: ORGANIZATIONS_LABELS.loading,
    });
  });

  test("shows the empty state once ready with no organizations", () => {
    expect(
      resolveOrganizationsSurfaceState({
        cardCount: 0,
        progress: null,
        ready: true,
      }),
    ).toEqual({
      busy: false,
      description: ORGANIZATIONS_LABELS.emptyDescription,
      title: ORGANIZATIONS_LABELS.empty,
    });
  });

  test("shows the list once organizations exist, even mid account setup", () => {
    expect(
      resolveOrganizationsSurfaceState({
        cardCount: 1,
        progress: PROGRESS,
        ready: true,
      }),
    ).toBeNull();
  });
});
