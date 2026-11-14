import { expect, test } from "bun:test";
import type {
  OrganizationDirectoryUser,
  Tearleads,
} from "@tearleads/client-sdk";
import { act, renderHook } from "@testing-library/react";
import {
  createProviderLifetimeHarness,
  type ProfileKind,
} from "../../../test/helpers/org-manager/providerLifetimeHarness";
import { OrgManagerProvider, useOrgManagerActions } from "./OrgManagerProvider";

function mountOrgManager() {
  return renderHook(useOrgManagerActions, { wrapper: OrgManagerProvider });
}

async function ensureProfile(
  kind: ProfileKind,
  actions: ReturnType<typeof useOrgManagerActions>,
  user: OrganizationDirectoryUser,
): Promise<string | null> {
  if (kind === "organization") {
    return actions.ensureOrganizationProfileDocument(null);
  }
  const updated = await actions.ensureRosterProfileDocument(user, {
    firstName: "Must not overwrite the existing profile",
  });
  return updated?.profileDocumentId ?? null;
}

function databaseRoundTrip(sdk: Tearleads) {
  const database = sdk.database.snapshot;
  const before = sdk.runtime.input();
  const version = sdk.runtime.version;
  sdk.database.clear();
  expect(sdk.database.status).toBe("idle");
  sdk.database.configure(database);
  // No await or React commit occurs during B. Real SDK subscribers observe
  // that transition and rotate the domain even though database values return.
  const after = sdk.runtime.input();
  expect(sdk.runtime.version).toBeGreaterThan(version);
  expect(sdk.database.snapshot).toEqual(database);
  expect(after.infra.execSql).toBe(before.infra.execSql);
  expect(after.infra.dbStatus).toBe(before.infra.dbStatus);
  expect(after.state.domainScope).not.toBe(before.state.domainScope);
  expect(after.state.containerId).toBe(before.state.containerId);
  expect(after.auth).toEqual(before.auth);
  expect(after.crypto).toEqual(before.crypto);
}

// Registered, readable SQLite profiles with absent organization/roster pointers.
// Host/session/container/publication metadata are fixture ports; the mounted
// provider, factories, identity selection, document stores and SQLite are real.
// This tests provider admission, not authenticated network creation/hydration.
test.each([
  ["roster", "container"],
  ["organization", "container"],
  ["roster", "identity"],
  ["roster", "document"],
  ["organization", "document"],
] as const)(
  "%s profile refuses an invocation expired during its %s lookup",
  async (kind, boundary) => {
    const h = await createProviderLifetimeHarness(kind, boundary);
    let view: ReturnType<typeof mountOrgManager> | undefined;
    let completion: Promise<string | null> = Promise.resolve(null);
    try {
      view = mountOrgManager();
      const actions = view.result.current;
      const scope = actions.captureOperationScope();
      if (!scope) throw new Error("Expected an active mounted operation scope");
      expect(actions.isOperationScopeActive(scope)).toBe(true);
      expect(h.sdk.runtime.input().state.online).toBe(false);
      const before = await h.durableState();
      expect(before.records).toEqual([
        { id: h.documentId, document_id: h.documentId },
      ]);
      expect(before.preferred).toBeNull();
      expect(before.profile?.documentId).toBe(h.documentId);

      await act(async () => {
        completion = ensureProfile(kind, actions, h.user);
        await Promise.race([
          h.gate.entered,
          completion.then(() => {
            throw new Error(
              `Profile ensure settled before its ${boundary} lookup`,
            );
          }),
        ]);
      });
      expect(h.ensureContainer).toHaveBeenCalledTimes(1);
      expect(h.ensureContainer.mock.calls[0]?.[0]).toBe(h.systemSlot);
      expect(h.open).not.toHaveBeenCalled();
      expect(h.updateRosterEntry).not.toHaveBeenCalled();
      expect(h.updateProfile).not.toHaveBeenCalled();
      expect(h.resolveVerified).toHaveBeenCalledTimes(
        kind === "roster" && boundary !== "container" ? 1 : 0,
      );
      if (boundary === "document") {
        expect(h.load).toHaveBeenCalledWith(
          h.database.execSql,
          h.preferredLocalId,
        );
      } else {
        expect(h.load).not.toHaveBeenCalled();
      }

      const outcome: { documentId: string | null } = { documentId: null };
      await act(async () => {
        databaseRoundTrip(h.sdk);
        // The old React closure has not committed a replacement yet, but the
        // actual SDK's rotated domain already invalidates its operation scope.
        expect(view?.result.current).toBe(actions);
        expect(actions.captureOperationScope()?.generation).toBe(
          scope.generation,
        );
        expect(actions.isOperationScopeActive(scope)).toBe(false);
        h.gate.release();
        outcome.documentId = await completion;
      });
      expect(h.open).not.toHaveBeenCalled();
      expect(h.updateRosterEntry).not.toHaveBeenCalled();
      expect(h.updateProfile).not.toHaveBeenCalled();
      expect(h.published).toEqual({ roster: null, organization: null });
      expect(await h.durableState()).toEqual(before);
      expect(outcome.documentId).toBeNull();
    } finally {
      // Join owned work before restoring ports/unmounting/closing SQLite, even
      // when a RED assertion or an unexpected early settlement interrupts us.
      await act(async () => {
        h.gate.release();
        await Promise.allSettled([completion]);
      });
      view?.unmount();
      h.close();
    }
  },
);

test.each(["roster", "organization"] as const)(
  "a fresh %s invocation after A-B-A opens the real profile and publishes once",
  async (kind) => {
    const h = await createProviderLifetimeHarness(kind);
    let view: ReturnType<typeof mountOrgManager> | undefined;
    try {
      view = mountOrgManager();
      const before = await h.durableState();
      const outcome: { documentId: string | null } = { documentId: null };
      await act(async () => {
        databaseRoundTrip(h.sdk);
      });
      const actions = view.result.current;
      await act(async () => {
        outcome.documentId = await ensureProfile(kind, actions, h.user);
      });
      expect(outcome.documentId).toBe(h.documentId);
      expect(h.ensureContainer).toHaveBeenCalledTimes(1);
      expect(h.open).toHaveBeenCalledTimes(1);
      expect(h.open.mock.calls[0]?.[0]).toMatchObject({
        documentId: h.documentId,
        localId: h.documentId,
      });
      expect(h.resolveVerified).toHaveBeenCalledTimes(
        kind === "roster" ? 1 : 0,
      );
      if (kind === "roster") {
        expect(h.updateRosterEntry).toHaveBeenCalledTimes(1);
        expect(h.updateRosterEntry).toHaveBeenCalledWith(
          h.user.userId,
          h.documentId,
        );
        expect(h.updateProfile).not.toHaveBeenCalled();
        expect(h.published).toEqual({
          roster: h.documentId,
          organization: null,
        });
      } else {
        expect(h.updateProfile).toHaveBeenCalledTimes(1);
        expect(h.updateProfile).toHaveBeenCalledWith(h.documentId);
        expect(h.updateRosterEntry).not.toHaveBeenCalled();
        expect(h.published).toEqual({
          roster: null,
          organization: h.documentId,
        });
      }
      expect(await h.durableState()).toEqual(before);
    } finally {
      view?.unmount();
      h.close();
    }
  },
);
