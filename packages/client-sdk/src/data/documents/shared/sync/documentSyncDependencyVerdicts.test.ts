import { expect, test } from "bun:test";
import {
  createDocument,
  emptyVersionVector,
  encodeVersionVector,
  exportUpdatesSince,
  getUpdateVersionVectors,
  importUpdates,
  versionVectorsEqual,
} from "@tearleads/loro";
import { validateDocumentSyncUpdateImports } from "./documentSyncImportVerdicts";

const forgedId = "550e8400-e29b-41d4-a716-4466554400d1";

/**
 * A device that committed one edit and holds a second unsent, a reader that
 * holds only the committed one, and another writer's update that depends on
 * the unsent edit, as a writer who predicted its op id could make.
 */
async function forgedDependency() {
  const device = await createDocument("dependency-device");
  device.getText("text").update("committed");
  device.commit();
  const committed = exportUpdatesSince(device, undefined);
  device.getText("text").update("committed unsent");
  device.commit();
  const forger = await createDocument("dependency-forger");
  importUpdates(forger, [exportUpdatesSince(device, undefined)]);
  const before = encodeVersionVector(forger);
  forger.getText("text").update("committed unsent forged");
  forger.commit();
  const updateData = exportUpdatesSince(forger, before);
  forger.free();
  const reader = await createDocument("dependency-reader");
  importUpdates(reader, [committed]);
  return { device, reader, updateData };
}

async function judge(
  currentDocument: Awaited<ReturnType<typeof createDocument>>,
  update: {
    readonly dependencyVersionVector: string;
    readonly updateData: Uint8Array;
  },
) {
  const { voided } = await validateDocumentSyncUpdateImports({
    currentDocument,
    decryptedUpdates: [
      {
        ...getUpdateVersionVectors(update.updateData),
        dependencyVersionVector: update.dependencyVersionVector,
        id: forgedId,
        updateData: update.updateData,
      },
    ],
  });
  return voided.map((entry) => ({
    message: String(entry.error.message),
    stage: entry.stage,
  }));
}

test("only the device holding an op an update depends on can import it", async () => {
  const { device, reader, updateData } = await forgedDependency();
  const declared = getUpdateVersionVectors(updateData).dependencyVersionVector;
  expect(versionVectorsEqual(declared, emptyVersionVector())).toBe(false);
  try {
    // Honestly declared, the server refuses it: nobody committed the op.
    // Were it served, the readers would split on it.
    expect(
      await judge(device, { dependencyVersionVector: declared, updateData }),
    ).toEqual([]);
    expect(
      await judge(reader, { dependencyVersionVector: declared, updateData }),
    ).toHaveLength(1);
  } finally {
    device.free();
    reader.free();
  }
});

test("every reader voids an update whose payload depends on other ops than it declares", async () => {
  const { device, reader, updateData } = await forgedDependency();
  // Declaring none passes the server's dependency rule, so every reader,
  // the device that holds the op included, must void it on its own.
  const undeclared = {
    dependencyVersionVector: emptyVersionVector(),
    updateData,
  };
  try {
    for (const current of [device, reader]) {
      const voided = await judge(current, undeclared);
      expect(voided.map((entry) => entry.stage)).toEqual(["loro_metadata"]);
      expect(voided[0]?.message).toEndWith(
        "Document decrypted update dependency mismatch",
      );
    }
  } finally {
    device.free();
    reader.free();
  }
});
