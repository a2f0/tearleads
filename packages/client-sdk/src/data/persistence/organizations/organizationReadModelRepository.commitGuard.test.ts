import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  organizationReadModelGroupsDelta,
  organizationReadModelOrganizationId,
  organizationReadModelSnapshot,
  organizationReadModelUserId,
} from "../../../../test/helpers/data/organizationReadModelProjectionFixtures";
import { OrganizationReadModelRepository } from "./organizationReadModelRepository";

const organizationId = organizationReadModelOrganizationId;
const userId = organizationReadModelUserId;
const scope = { organizationId, requesterUserId: userId };
const refused = () => false;

async function seeded(name: string) {
  const { close, execSql } = await createTestExecSql(name);
  const repository = new OrganizationReadModelRepository(execSql);
  await repository.applyOrganizationReadModelResponse({
    currentUserId: userId,
    requestedCursor: null,
    response: organizationReadModelSnapshot({ cursor: "cursor-1" }),
  });
  return { close, repository };
}

test("a refused commit guard applies, records and purges nothing", async () => {
  const { close, repository } = await seeded("read-model-commit-guard-test");
  try {
    await expect(
      repository.applyOrganizationReadModelResponse({
        canCommit: refused,
        currentUserId: userId,
        requestedCursor: "cursor-1",
        response: organizationReadModelGroupsDelta({
          cursor: "cursor-2",
          groupName: "Operators",
        }),
      }),
    ).resolves.toBe("stale");
    await repository.recordOrganizationPresentationDenials(
      scope,
      ["readModel"],
      refused,
    );
    await repository.purgeOrganizationAccessProjection({
      ...scope,
      canCommit: refused,
    });
    await repository.purgeOrganizationReadModelProjection(organizationId, {
      canCommit: refused,
    });

    await expect(
      repository.hasOrganizationPresentationDenial(scope, "readModel"),
    ).resolves.toBe(false);
    await expect(
      repository.loadOrganizationReadModelProjection(organizationId, userId),
    ).resolves.toMatchObject({ cursor: "cursor-1" });
  } finally {
    close();
  }
});

test("a passing commit guard writes as before", async () => {
  const { close, repository } = await seeded("read-model-commit-pass-test");
  try {
    await expect(
      repository.applyOrganizationReadModelResponse({
        canCommit: () => true,
        currentUserId: userId,
        requestedCursor: "cursor-1",
        response: organizationReadModelGroupsDelta({
          cursor: "cursor-2",
          groupName: "Operators",
        }),
      }),
    ).resolves.toBe("applied");
    await repository.recordOrganizationPresentationDenials(
      scope,
      ["readModel"],
      () => true,
    );

    await expect(
      repository.hasOrganizationPresentationDenial(scope, "readModel"),
    ).resolves.toBe(true);
  } finally {
    close();
  }
});
