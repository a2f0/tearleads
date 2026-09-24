import { computeContainerKekPublicCommitment } from "./containerKekMaterial";
import { containerWrappingPublicKeyForTest } from "./containerWrapping.testFixtures";

export async function fixtureContainerKekMaterialId(
  label: string,
  containerId: string,
  keyEpoch = 1,
) {
  const containerKeyPublicKey = containerWrappingPublicKeyForTest(label);
  const id = await computeContainerKekPublicCommitment({
    containerId,
    keyEpoch,
    containerKeyPublicKey,
  });
  containerWrappingPublicKeyForTest(id, containerKeyPublicKey);
  return id;
}
