import type {
  VerifiedContainerAccessManifest,
  VerifiedContainerKekState,
} from "@tearleads/crypto";
import type { ContainerMutationContext } from "../types";
import { loadMutationContainerKekHistory } from "./mutationKekHistory";

export async function loadMutationKekResponseHistory(
  context: ContainerMutationContext,
  manifest: VerifiedContainerAccessManifest,
  kekState: VerifiedContainerKekState,
): Promise<
  Awaited<ReturnType<typeof loadMutationContainerKekHistory>>
> {
  return loadMutationContainerKekHistory(
    context.writerProjectionContext,
    manifest,
    kekState,
  );
}
