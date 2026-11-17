import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { organizationReadModelSnapshot } from "../../../../test/helpers/data/organizationReadModelProjectionFixtures";
import { OrganizationReadModelRepository } from "./organizationReadModelRepository";

test("only verified local names at the projected signed head enter the scoped display cache", async () => {
  const { close, execSql } = await createTestExecSql(
    "encrypted-group-name-cache",
  );
  const repository = new OrganizationReadModelRepository(execSql);
  try {
    const response = organizationReadModelSnapshot();
    await repository.applyOrganizationReadModelResponse({
      currentUserId: "user-1",
      requestedCursor: null,
      response,
    });
    const [group] = response.lanes.groups.groups;
    if (!group?.currentState) throw new Error("Expected group head");
    const input = {
      organizationId: response.organizationId,
      stillCurrent: () => true,
    };
    const write = (stateHash: string, name: string) =>
      repository.saveOrganizationGroupDisplayNames({
        ...input,
        names: [{ groupId: group.groupId, stateHash, name }],
      });
    expect(
      (
        await repository.loadOrganizationGroupDisplayNames(
          response.organizationId,
        )
      ).size,
    ).toBe(0);
    await write("wrong-head", "Injected name");
    expect(
      (
        await repository.loadOrganizationGroupDisplayNames(
          response.organizationId,
        )
      ).size,
    ).toBe(0);
    await write(group.currentState.stateHash, "Verified decrypted name");
    expect(
      (
        await repository.loadOrganizationGroupDisplayNames(
          response.organizationId,
        )
      ).get(group.groupId),
    ).toBe("Verified decrypted name");
    expect(
      (await repository.loadOrganizationGroupDisplayNames("other-organization"))
        .size,
    ).toBe(0);
    const projection = await repository.loadOrganizationReadModelProjection(
      response.organizationId,
      "user-1",
    );
    expect(projection?.groups.groups[0]?.name).toBe("Verified decrypted name");
    await repository.saveOrganizationGroupDisplayNames({
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
        await repository.loadOrganizationGroupDisplayNames(
          response.organizationId,
        )
      ).get(group.groupId),
    ).toBe("Verified decrypted name");
  } finally {
    close();
  }
});
