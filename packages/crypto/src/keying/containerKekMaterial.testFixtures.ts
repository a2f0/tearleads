import { fixtureHash } from "./testFixtures";
import { CONTAINER_KEK_MATERIAL_ID_PREFIX } from "./types";

export async function fixtureContainerKekMaterialId(
  label: string,
): Promise<`${typeof CONTAINER_KEK_MATERIAL_ID_PREFIX}${string}`> {
  return `${CONTAINER_KEK_MATERIAL_ID_PREFIX}${await fixtureHash(label)}`;
}
