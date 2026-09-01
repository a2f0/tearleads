import { createMemoryBlobStore, Tearleads } from "@tearleads/client-sdk";
import { useCallback } from "react";

async function keyPackageFromSeedPhrase(seedPhrase: string) {
  const candidate = new Tearleads({ blobStore: createMemoryBlobStore() });
  try {
    await candidate.identity.importSeedPhrase(seedPhrase);
    return await candidate.identity.exportKeyPackage();
  } finally {
    candidate.dispose();
  }
}

export function useRestoreSeedPhrase(input: {
  readonly restoreKeyPackage: (keyPackage: unknown) => Promise<void>;
}): (seedPhrase: string) => Promise<void> {
  return useCallback(
    async (seedPhrase: string) => {
      const keyPackage = await keyPackageFromSeedPhrase(seedPhrase);
      await input.restoreKeyPackage(keyPackage);
    },
    [input.restoreKeyPackage],
  );
}
