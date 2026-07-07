import { type ChangeEvent, useCallback, useRef } from "react";
import { useCryptoSession } from "../providers/crypto/CryptoSessionProvider";
import { useIdentity } from "../providers/identity/IdentityProvider";
import { useLog } from "../providers/logging/LogProvider";
import {
  createSeedPhraseFileName,
  downloadSeedPhraseFile,
  parseSeedPhraseFileText,
} from "./seedPhraseBackup";

interface SeedPhraseActionOptions {
  readonly onComplete?: (() => void) | undefined;
}

export function useBackupSeedPhraseAction({
  onComplete,
}: SeedPhraseActionOptions = {}) {
  const { seedPhrase, signingFingerprint } = useIdentity();
  const { log, logError } = useLog();

  return useCallback(async () => {
    try {
      if (!seedPhrase) {
        throw new Error("No seed phrase is available for this identity.");
      }

      downloadSeedPhraseFile({
        fileName: createSeedPhraseFileName({ signingFingerprint }),
        seedPhrase,
      });
      log("Seed phrase backup created");
    } catch (error: unknown) {
      logError("Failed to back up seed phrase", error);
    } finally {
      onComplete?.();
    }
  }, [log, logError, onComplete, seedPhrase, signingFingerprint]);
}

export function useRestoreSeedPhraseAction({
  onComplete,
}: SeedPhraseActionOptions = {}) {
  const { login } = useCryptoSession();
  const { restoreSeedPhrase } = useIdentity();
  const { log, logError } = useLog();
  const restoreSeedPhraseFileInputRef = useRef<HTMLInputElement>(null);

  const restoreSeedPhraseFromFile = useCallback(
    async (file: File) => {
      try {
        const seedPhrase = parseSeedPhraseFileText(await file.text());
        await restoreSeedPhrase(seedPhrase);
        await login();
        log("Seed phrase restored");
      } catch (error: unknown) {
        logError("Failed to restore seed phrase", error);
      } finally {
        if (restoreSeedPhraseFileInputRef.current) {
          restoreSeedPhraseFileInputRef.current.value = "";
        }
        onComplete?.();
      }
    },
    [log, logError, login, onComplete, restoreSeedPhrase],
  );

  const handleRestoreSeedPhraseClick = useCallback(() => {
    restoreSeedPhraseFileInputRef.current?.click();
  }, []);

  const handleRestoreSeedPhraseFileChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.currentTarget.files?.[0];
      if (!file) {
        return;
      }

      void restoreSeedPhraseFromFile(file);
    },
    [restoreSeedPhraseFromFile],
  );

  return {
    handleRestoreSeedPhraseClick,
    handleRestoreSeedPhraseFileChange,
    restoreSeedPhraseFileInputRef,
  };
}
