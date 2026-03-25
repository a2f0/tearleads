import { expect, test } from "bun:test";
import { v1 } from "@authzed/authzed-node";
import client from "./spicedb";

test("adds a user to SpiceDB", async () => {
  await client.promises.writeSchema(
    v1.WriteSchemaRequest.create({
      schema: `definition tearleads/user {}

      definition tearleads/organization {
        relation member: tearleads/user
      }`,
    }),
  );

  const response = await client.promises.writeRelationships(
    v1.WriteRelationshipsRequest.create({
      updates: [
        v1.RelationshipUpdate.create({
          operation: v1.RelationshipUpdate_Operation.TOUCH,
          relationship: v1.Relationship.create({
            resource: v1.ObjectReference.create({
              objectType: "tearleads/organization",
              objectId: "main",
            }),
            relation: "member",
            subject: v1.SubjectReference.create({
              object: v1.ObjectReference.create({
                objectType: "tearleads/user",
                objectId: "user_1",
              }),
            }),
          }),
        }),
      ],
    }),
  );

  expect(response).toBeTruthy();

  client.close();
});
