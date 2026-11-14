import { expect, mock, test } from "bun:test";
import type { ContainerNode } from "@tearleads/client-sdk";
import { act, render, waitFor } from "@testing-library/react";
import { createDeferred } from "../../../../test/helpers/databaseRuntimeFactories";
import {
  createProfileEditorHarness,
  installProfileEditorHost,
  PROFILE_CONTAINER_ID,
  PROFILE_ORGANIZATION_ID,
  profileEditorUser,
} from "../../../../test/helpers/org-manager/profileEditorHarness";
import { RosterProfileEditor } from "../directory/RosterProfileEditor";
import { ORG_MANAGER_LABELS } from "../labels";
import { OrganizationProfileEditor } from "../organization/OrganizationProfileEditor";

for (const kind of ["roster", "organization"] as const) {
  test(`${kind} rejects held container lookups after A-B-A and runtime replacement`, async () => {
    const f = await createProfileEditorHarness(kind);
    const requests: ReturnType<typeof createDeferred<ContainerNode | null>>[] =
      [];
    const ensure = mock(() => {
      const request = createDeferred<ContainerNode | null>();
      requests.push(request);
      return request.promise;
    });
    const restoreHost = installProfileEditorHost(f.sdk, {
      ensureRosterProfileContainer: ensure,
      ensureOrganizationMetadataContainer: ensure,
    });
    const onNameChange = () => undefined;
    const editor = (organizationId: string) =>
      kind === "roster" ? (
        <RosterProfileEditor
          canEdit={false}
          organizationId={organizationId}
          user={profileEditorUser(f.documentId)}
        />
      ) : (
        <OrganizationProfileEditor
          canEdit={false}
          onNameChange={onNameChange}
          organizationId={organizationId}
          pending={false}
          profileDocumentId={f.documentId}
        />
      );
    const loading =
      kind === "roster"
        ? ORG_MANAGER_LABELS.loadingProfileDocument
        : ORG_MANAGER_LABELS.loadingOrganizationProfile;
    const content = kind === "roster" ? "Ada" : "Existing organization";
    const container: ContainerNode = {
      id: PROFILE_CONTAINER_ID,
      kind: "container",
      name: "Profile container",
      organizationId: PROFILE_ORGANIZATION_ID,
      parentId: null,
      syncState: {
        lastError: null,
        pendingAttachmentBytes: 0,
        pendingAttachmentCount: 0,
        pendingUpdateCount: 0,
        status: "synced",
      },
    };
    const view = render(editor(PROFILE_ORGANIZATION_ID));
    try {
      await waitFor(() => expect(ensure).toHaveBeenCalledTimes(1));
      view.rerender(editor("00000000-0000-4000-8000-000000000099"));
      expect(view.getByText(loading)).toBeTruthy();
      await waitFor(() => expect(ensure).toHaveBeenCalledTimes(2));
      view.rerender(editor(PROFILE_ORGANIZATION_ID));
      await waitFor(() => expect(ensure).toHaveBeenCalledTimes(3));
      await act(async () => {
        requests[0]?.resolve(container);
        requests[1]?.resolve(container);
      });
      expect(view.queryByText(content)).toBeNull();
      expect(view.getByText(loading)).toBeTruthy();
      const version = f.sdk.runtime.version;
      await act(async () => {
        f.sdk.session.setSyncEnabled(false);
      });
      expect(f.sdk.runtime.version).not.toBe(version);
      await waitFor(() => expect(ensure).toHaveBeenCalledTimes(4));
      await act(async () => {
        requests[2]?.resolve(container);
      });
      expect(view.queryByText(content)).toBeNull();
      expect(view.getByText(loading)).toBeTruthy();
      await act(async () => {
        requests[3]?.resolve(container);
      });
      expect(await view.findByText(content)).toBeTruthy();
      await f.assertOnlyOriginalRecord();
      // A ready binding must disappear on the identity-changing render, not
      // remain visible while the replacement container request is held.
      view.rerender(editor("00000000-0000-4000-8000-000000000099"));
      expect(view.queryByText(content)).toBeNull();
      expect(view.getByText(loading)).toBeTruthy();
      await waitFor(() => expect(ensure).toHaveBeenCalledTimes(5));
    } finally {
      view.unmount();
      await act(async () => {
        for (const request of requests) request.resolve(null);
      });
      restoreHost();
      f.close();
    }
  });
}
