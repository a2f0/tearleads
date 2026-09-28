import { expect, test } from "bun:test";
import { signOrganizationReplacementAuthorization } from "@tearleads/crypto";
import { isPlainObject } from "@tearleads/validators/isPlainObject";
import { createReplacementAuthorizationFixture } from "../../../test/helpers/organizationReplacementAuthorization";

for (const attack of [
  "same organization",
  "shared root",
  "system root",
  "nested root",
  "different founder",
  "non-genesis policy",
] as const) {
  test(`replacement signer refuses ${attack}`, async () => {
    const { input, signingKeyPair } =
      await createReplacementAuthorizationFixture();
    if (!isPlainObject(input.initialRootContainer.body))
      throw new Error("Expected root body");
    switch (attack) {
      case "same organization":
        input.replacesOrganizationId = input.organizationId;
        break;
      case "shared root":
        Reflect.set(input.initialRootContainer.body, "directGrants", [
          {
            subjectType: "group",
            subjectId: input.initialAdminGroup.groupId,
            accessLevel: "admin",
          },
          {
            subjectType: "user",
            subjectId: crypto.randomUUID(),
            accessLevel: "read",
          },
        ]);
        break;
      case "system root":
        Reflect.set(input.initialRootContainer.body, "systemSlot", "contacts");
        break;
      case "nested root":
        Reflect.set(
          input.initialRootContainer.body,
          "parentContainerId",
          crypto.randomUUID(),
        );
        break;
      case "different founder":
        input.userId = crypto.randomUUID();
        break;
      case "non-genesis policy":
        input.initialOrganizationPolicy = {
          ...input.initialOrganizationPolicy,
          state: { ...input.initialOrganizationPolicy.state, version: 2 },
        };
        break;
    }
    await expect(
      signOrganizationReplacementAuthorization(input, signingKeyPair),
    ).rejects.toThrow();
  });
}
