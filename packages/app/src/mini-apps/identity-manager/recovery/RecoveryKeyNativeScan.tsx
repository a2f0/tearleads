import {
  normalizeIdentitySeedPhrase,
  validateIdentitySeedPhrase,
} from "@tearleads/crypto";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  MiniAppButton,
  MiniAppStatus,
} from "../../../components/mini-app/MiniAppLayout";
import type { Scanner } from "../../../host/Scanner";
import { decodeRecoveryKeyPhoto } from "./recoveryKeyPhoto";

function recoveryPhrase(value: string | null): string | null {
  if (
    value === null ||
    value.length > 512 ||
    !validateIdentitySeedPhrase(value)
  )
    return null;
  return normalizeIdentitySeedPhrase(value);
}

export function RecoveryKeyNativeScan({
  disabled,
  onScan,
  scanner,
}: {
  disabled: boolean;
  onScan: (phrase: string) => void;
  scanner: Scanner;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const busyRef = useRef(false);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  useLayoutEffect(() => {
    if (disabled) {
      generation.current++;
      busyRef.current = false;
      setBusy(false);
      setError(null);
    }
  }, [disabled]);

  const ifCurrent = (request: number, update: () => void) => {
    if (generation.current === request) update();
  };

  const capture = async () => {
    if (disabled || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    const request = ++generation.current;
    let captured = false;
    try {
      const photo = await scanner.capturePhoto();
      if (!photo || generation.current !== request) return;
      captured = true;
      const phrase = recoveryPhrase(await decodeRecoveryKeyPhoto(photo));
      if (generation.current !== request) return;
      if (!phrase) {
        setError(
          "This photo does not contain a valid recovery key. Capture the QR code shown in Identity Manager.",
        );
        return;
      }
      onScan(phrase);
    } catch {
      ifCurrent(request, () => {
        setError(
          captured
            ? "Could not read the captured photo. Try a clear photo of the recovery QR code, or enter your passphrase."
            : "Could not capture a photo. Check camera access and try again, or enter your passphrase.",
        );
      });
    } finally {
      ifCurrent(request, () => {
        busyRef.current = false;
        setBusy(false);
      });
    }
  };

  return (
    <div className="identity-manager-recovery-key-form">
      <MiniAppStatus>
        Capture the recovery QR code on your other device using the camera.
      </MiniAppStatus>
      <MiniAppButton disabled={disabled || busy} onClick={() => void capture()}>
        {busy ? "Scanning..." : "Scan QR Code"}
      </MiniAppButton>
      {error && (
        <MiniAppStatus role="alert" tone="error">
          {error}
        </MiniAppStatus>
      )}
    </div>
  );
}
