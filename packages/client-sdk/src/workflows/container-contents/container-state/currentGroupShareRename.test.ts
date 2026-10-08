import { expect, test } from "bun:test";
import { createCurrentShareMetadataFixture } from "../../../../test/helpers/currentShareMetadata";
import { prepareCurrentShareRename } from "../../../../test/helpers/currentShareRename";
import { shareRemoteContainerWithGroup } from "./remote";

test("Current grant mint rechecks the chosen name after a concurrent signed rename", async () => {
  const f = await createCurrentShareMetadataFixture();
  try {
    const rename = await prepareCurrentShareRename(f);
    let recoveries = 0;
    let commits = 0;
    Object.assign(f.runtime.apiClient, {
      recoverPendingPrincipalMutation: async () => {
        recoveries += 1;
        if (recoveries === 2) rename();
      },
    });
    f.options.apiClient.commitOrganizationGroupPolicy = async () => {
      commits += 1;
      throw new Error("A renamed group must not receive the grant");
    };
    const result = await shareRemoteContainerWithGroup({
      accessLevel: "read",
      containerId: f.rootProjection.containerId,
      expectedGroupName: f.name,
      previousProjection: f.rootProjection,
      recipientGroupId: f.group.currentState.principalId,
      resolveProjectionUserKey: f.runtime.resolveTrustedUserIdentity,
      runtime: f.runtime,
    }).catch((error: unknown) => error);
    expect(recoveries).toBe(2);
    expect(commits).toBe(0);
    expect(result).toMatchObject({
      code: "object_mismatch",
      message:
        "Container share group name does not match the signed group policy",
    });
    expect(f.fullReads()).toBe(0);
  } finally {
    f.close();
  }
}, 15_000);
