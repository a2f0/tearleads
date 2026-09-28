import { expect, test } from "bun:test";
import { createNativeTestExecSql } from "@tearleads/test-utils";
import {
  createParentProjection,
  createParentProjectionUserKeyResolver,
} from "../../../test/helpers/containerFixtures";
import { unwrapContainerKekPath } from "../documents/shared/containerKekPath";

test("KEK unwrapping classifies a malformed key epoch hash as a security failure", async () => {
  const parent = await createParentProjection();
  const projection = structuredClone(parent.projection);
  const kek = projection.containerKeks[0];
  if (!kek) throw new Error("Missing fixture KEK");
  kek.keyEpochHash = "f".repeat(64);
  const database = createNativeTestExecSql();
  try {
    await expect(
      unwrapContainerKekPath({
        execSql: database.execSql,
        projection,
        secretKey: parent.secretKey,
        resolveProjectionUserKey: createParentProjectionUserKeyResolver(parent),
      }),
    ).rejects.toMatchObject({
      name: "KeyingVerificationError",
      code: "invalid_shape",
    });
  } finally {
    database.close();
  }
});
