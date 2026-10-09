import { beforeAll, expect, test } from "bun:test";
import {
  ADMIN_GROUP_ID,
  ORGANIZATION_ID,
  ROOT_CONTAINER_ID,
  setUpAdminGroupRoot,
} from "../../../../test/helpers/adminGroupRoot";
import { missingPrincipalRecoveryFixture } from "../../../../test/helpers/missingPrincipalRecovery";
import { principalPolicyHead } from "../../../../test/helpers/principalPolicyFixtures";
import { ProjectionDependencyUnavailableError } from "../../../data/keyingProjectionVerification/dependencyUnavailable";
import type { ContainerState } from "../remoteHydration";
import { containerStateHasCurrentGroupGrant } from "./groupGrantVerification";
import { resolveCurrentGroupKeyEpoch } from "./groupShareEpoch";
import { shareRemoteContainerWithGroup } from "./remote";

let signed: Awaited<ReturnType<typeof setUpAdminGroupRoot>>;
beforeAll(async () => {
  signed = await setUpAdminGroupRoot();
});

for (const missing of ["custody", "pages"] as const) {
  test.each(["share", "epoch", "grant"] as const)(
    `%s refuses missing ${missing} without a full-history read or mutation`,
    async (operation) => {
      const f = await missingPrincipalRecoveryFixture(missing, ORGANIZATION_ID);
      const common = {
        accessLevel: "admin" as const,
        containerId: ROOT_CONTAINER_ID,
        groupId: ADMIN_GROUP_ID,
        organizationId: ORGANIZATION_ID,
        runtime: f.runtime,
        stillCurrent: () => true,
      };
      try {
        const pending = {
          share: () =>
            shareRemoteContainerWithGroup({
              ...common,
              previousProjection: signed.initialProjection,
              recipientGroupId: ADMIN_GROUP_ID,
              resolveProjectionUserKey: signed.resolveUserIdentity,
            }),
          epoch: () => resolveCurrentGroupKeyEpoch(common),
          grant: () =>
            containerStateHasCurrentGroupGrant({
              ...common,
              containerState: {
                container: {
                  id: ROOT_CONTAINER_ID,
                  organizationId: ORGANIZATION_ID,
                  parentId: null,
                  metadataDocumentId: "root-metadata-document",
                },
                containerWriterProjection: signed.initialProjection,
                record: {
                  accessStateHash:
                    signed.initialProjection.path.at(-1)?.manifestHash,
                },
              } as ContainerState,
              expectedContainerId: ROOT_CONTAINER_ID,
              expectedGroupHead: principalPolicyHead(signed.epochTwoPolicy),
              expectedOrganizationId: ORGANIZATION_ID,
              resolveProjectionUserKey: signed.resolveUserIdentity,
            }),
        }[operation]();
        const outcome = await pending.catch((error: unknown) => error);
        expect(f.calls).toEqual([]);
        expect(outcome).toBeInstanceOf(ProjectionDependencyUnavailableError);
      } finally {
        f.close();
      }
    },
  );
}
