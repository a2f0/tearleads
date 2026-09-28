import { expect, spyOn, test } from "bun:test";
import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import { bytesToBase64 } from "@tearleads/encoding";
import * as history from "../../access/read/principalHistory";
import { loadProjectionDirectoryBindings } from "./projectionDirectoryBindings";

type Payload = NonNullable<
  Awaited<ReturnType<typeof history.listOrganizationHistoryPayloads>>
>[number];

function payload(organizationId: string, version: number): Payload {
  return {
    principalType: "organization",
    principalId: organizationId,
    stateHash: `organization-${version}`,
    cipherSuite: "aes-256-gcm",
    ciphertextHash: "test",
    createdAt: new Date(),
    ciphertext: bytesToBase64(
      new TextEncoder().encode(
        JSON.stringify({
          version: 2,
          organizationId,
          adminGroupId: "admins",
          memberGroupId: "members",
          groupHeads: ["admins", "members"].map((principalId) => ({
            principalType: "group",
            principalId,
            version,
            keyEpoch: 1,
            stateHash: `${principalId}-${version}`,
            keyFingerprint: "key",
          })),
        }),
      ),
    ),
  };
}

test("directory binding memo reuses a head, isolates callers, and misses on successors", async () => {
  const organizationId = crypto.randomUUID();
  const input = {
    executor: {} as DatabaseSession,
    organizationId,
    stateHash: "head-1",
  };
  const load = spyOn(
    history,
    "listOrganizationHistoryPayloads",
  ).mockResolvedValue([payload(organizationId, 2), payload(organizationId, 1)]);
  try {
    const first = await loadProjectionDirectoryBindings(input);
    expect(first.latest.get("admins")?.version).toBe(2);
    expect([...first.bindingPayloadByGroupState.keys()]).toEqual([
      "admins-2",
      "members-2",
    ]);
    first.latest.clear();
    first.bindingPayloadByGroupState.clear();
    const second = await loadProjectionDirectoryBindings({ ...input });
    expect(second.latest.get("admins")?.version).toBe(2);
    expect(second.bindingPayloadByGroupState.size).toBe(2);
    expect(load).toHaveBeenCalledTimes(1);
    load.mockResolvedValue([payload(organizationId, 3)]);
    const next = await loadProjectionDirectoryBindings({
      ...input,
      stateHash: "head-2",
    });
    expect(next.latest.get("admins")?.version).toBe(3);
    expect(load).toHaveBeenCalledTimes(2);
    for (let index = 0; index < 16; index += 1)
      await loadProjectionDirectoryBindings({
        ...input,
        stateHash: `additional-small-head-${index}`,
      });
    await loadProjectionDirectoryBindings(input);
    // Small histories share the byte budget instead of evicting after 16 heads.
    expect(load).toHaveBeenCalledTimes(18);
  } finally {
    load.mockRestore();
  }
});

test("missing or foreign directory history never populates the memo", async () => {
  const input = {
    executor: {} as DatabaseSession,
    organizationId: crypto.randomUUID(),
    stateHash: "head",
  };
  const load = spyOn(
    history,
    "listOrganizationHistoryPayloads",
  ).mockResolvedValue(null);
  try {
    await expect(loadProjectionDirectoryBindings(input)).rejects.toThrow(
      "directory history missing",
    );
    load.mockResolvedValue([payload("other-organization", 1)]);
    await expect(loadProjectionDirectoryBindings(input)).rejects.toThrow(
      "directory organization mismatch",
    );
    load.mockResolvedValue([payload(input.organizationId, 1)]);
    expect((await loadProjectionDirectoryBindings(input)).latest.size).toBe(2);
    expect(load).toHaveBeenCalledTimes(3);
  } finally {
    load.mockRestore();
  }
});
