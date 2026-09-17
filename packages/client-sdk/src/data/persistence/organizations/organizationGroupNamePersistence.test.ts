import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { organizationReadModelSnapshot } from "../../../../test/helpers/organizationReadModelProjectionFixtures";
import {
  loadOrganizationGroupDisplayNames,
  saveOrganizationGroupDisplayNames,
} from "./organizationGroupNamePersistence";
import {
  applyOrganizationReadModelResponse,
  loadOrganizationReadModelProjection,
} from "./organizationReadModelPersistence";

test("only verified local names at the projected signed head enter the scoped display cache", async () => {
  const { close, execSql } = await createTestExecSql(
    "encrypted-group-name-cache",
  );
  try {
    const response = organizationReadModelSnapshot();
    await applyOrganizationReadModelResponse({
      currentUserId: "user-1",
      execSql,
      requestedCursor: null,
      response,
    });
    const [group] = response.lanes.groups.groups;
    if (!group?.currentState) throw new Error("Expected group head");
    const input = {
      execSql,
      organizationId: response.organizationId,
      stillCurrent: () => true,
    };
    const write = (stateHash: string, name: string) =>
      saveOrganizationGroupDisplayNames({
        ...input,
        names: [{ groupId: group.groupId, stateHash, name }],
      });
    expect(
      (
        await loadOrganizationGroupDisplayNames(
          execSql,
          response.organizationId,
        )
      ).size,
    ).toBe(0);
    await write("wrong-head", "Injected name");
    expect(
      (
        await loadOrganizationGroupDisplayNames(
          execSql,
          response.organizationId,
        )
      ).size,
    ).toBe(0);
    await write(group.currentState.stateHash, "Verified decrypted name");
    expect(
      (
        await loadOrganizationGroupDisplayNames(
          execSql,
          response.organizationId,
        )
      ).get(group.groupId),
    ).toBe("Verified decrypted name");
    expect(
      (await loadOrganizationGroupDisplayNames(execSql, "other-organization"))
        .size,
    ).toBe(0);
    const projection = await loadOrganizationReadModelProjection(
      execSql,
      response.organizationId,
      "user-1",
    );
    expect(projection?.groups.groups[0]?.name).toBe("Verified decrypted name");
    await saveOrganizationGroupDisplayNames({
      ...input,
      stillCurrent: () => false,
      names: [
        {
          groupId: group.groupId,
          stateHash: group.currentState.stateHash,
          name: "Stale session",
        },
      ],
    });
    expect(
      (
        await loadOrganizationGroupDisplayNames(
          execSql,
          response.organizationId,
        )
      ).get(group.groupId),
    ).toBe("Verified decrypted name");
  } finally {
    close();
  }
});
