import { expect, test } from "bun:test";
import { bytesToBase64 } from "@tearleads/encoding";
import { createGroupNameDirectory } from "../../../test/helpers/groupNameDirectory";
import { withTestExecSql } from "../../../test/helpers/withTestExecSql";
import { loadVerifiedOrganizationGroupRoles } from "../../data/principals/organizationGroupRoles";
import { loadGroupNameDirectoryAuthority } from "./organizationGroupNamePolicies";

test("built-in labels require a descriptor matching its verified checkpoint", async () => {
  await withTestExecSql("verified-group-roles", async (execSql) => {
    const fixture = await createGroupNameDirectory();
    const organizationId = fixture.author.organizationId;
    expect(
      await loadVerifiedOrganizationGroupRoles(execSql, organizationId),
    ).toEqual(new Map());
    const authority = await loadGroupNameDirectoryAuthority({
      ...fixture,
      execSql,
      organizationId,
      stillCurrent: () => true,
    });
    if (!authority) throw new Error("Expected verified organization");
    expect(
      await loadVerifiedOrganizationGroupRoles(execSql, organizationId),
    ).toEqual(
      new Map([
        ["admins-group", "Admins"],
        ["members-group", "Members"],
      ]),
    );

    await execSql(
      "UPDATE principal_policies SET current_payload_json = ? WHERE principal_type = 'organization' AND principal_id = ?",
      [
        JSON.stringify({
          ...authority.bundle.currentPayload,
          ciphertext: bytesToBase64(
            new TextEncoder().encode(
              JSON.stringify({
                ...authority.descriptor,
                memberGroupId: "forged-members",
              }),
            ),
          ),
        }),
        organizationId,
      ],
    );
    expect(
      await loadVerifiedOrganizationGroupRoles(execSql, organizationId),
    ).toEqual(new Map());
  });
});
