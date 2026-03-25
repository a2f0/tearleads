import { expect, test } from "bun:test";
import { v1 } from "@authzed/authzed-node";
import client from "./spicedb";

test("writes a user relationship to SpiceDB", async () => {
  const schemaRequest = v1.WriteSchemaRequest.create({
    schema: `definition tearleads/user {}

    definition tearleads/platform {
      relation member: tearleads/user
      permission access = member
    }
    `,
  });

  await client.promises.writeSchema(schemaRequest);

  const user = v1.ObjectReference.create({
    objectType: "tearleads/user",
    objectId: "user_1",
  });

  const platform = v1.ObjectReference.create({
    objectType: "tearleads/platform",
    objectId: "main",
  });

  const writeRequest = v1.WriteRelationshipsRequest.create({
    updates: [
      v1.RelationshipUpdate.create({
        relationship: v1.Relationship.create({
          resource: platform,
          relation: "member",
          subject: v1.SubjectReference.create({
            object: user,
          }),
        }),
        operation: v1.RelationshipUpdate_Operation.CREATE,
      }),
    ],
  });

  const writeResponse = await client.promises.writeRelationships(writeRequest);
  expect(writeResponse).toBeTruthy();

  const checkRequest = v1.CheckPermissionRequest.create({
    resource: platform,
    permission: "access",
    subject: v1.SubjectReference.create({
      object: user,
    }),
    consistency: v1.Consistency.create({
      requirement: {
        oneofKind: "fullyConsistent",
        fullyConsistent: true,
      },
    }),
  });

  const checkResponse = await client.promises.checkPermission(checkRequest);
  expect(checkResponse?.permissionship).toBe(
    v1.CheckPermissionResponse_Permissionship.HAS_PERMISSION,
  );

  client.close();
});
