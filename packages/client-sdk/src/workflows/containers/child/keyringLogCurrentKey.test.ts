import { expect, test } from "bun:test";
import {
  makeEpochKeys,
  makeLogEpoch,
} from "../../../../test/helpers/keyringRotationFixtures";
import { rebuildKeyringEntriesFromLog } from "../../../data/documents/shared/keyringRebuild";

for (const count of [1, 3]) {
  test(`a ${count}-epoch log binds the supplied current key even with no bridges`, async () => {
    const containerId = crypto.randomUUID();
    const keys = await makeEpochKeys(containerId, count);
    const head = keys.at(-1);
    if (!head) throw new Error("Expected head");
    const input = {
      containerId,
      currentContainerKey: head.keyMaterial,
      currentContainerKeyEpochId: head.containerKeyEpochId,
      log: {
        containerId,
        epochs: keys.map((key) => makeLogEpoch(key, { bridge: null })),
      },
    };
    await expect(rebuildKeyringEntriesFromLog(input)).resolves.toMatchObject({
      missingEpochIds: keys.slice(0, -1).map((key) => key.containerKeyEpochId),
    });
    const wrong = head.keyMaterial.slice();
    wrong[0] = (wrong[0] ?? 0) ^ 1;
    await expect(
      rebuildKeyringEntriesFromLog({ ...input, currentContainerKey: wrong }),
    ).rejects.toThrow("current key material");
  });
}
