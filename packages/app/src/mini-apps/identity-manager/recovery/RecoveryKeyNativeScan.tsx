import {
  normalizeIdentitySeedPhrase,
  validateIdentitySeedPhrase,
} from "@tearleads/crypto";
import { useEffect, useRef, useState } from "react";
import {
  MiniAppButton,
  MiniAppStatus,
} from "../../../components/mini-app/MiniAppLayout";
import type { Scanner } from "../../../host/Scanner";
import { decodeRecoveryKeyPhoto } from "./recoveryKeyPhoto";

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
  if (disabled && busy) {
    generation.current++;
    busyRef.current = false;
    setBusy(false);
  }

  const ifCurrent = (request: number, update: () => void) => {
    if (generation.current === request) update();
  };

  const capture = async () => {
    if (disabled || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    const request = ++generation.current;
    try {
      const photo = await scanner.capturePhoto();
      if (!photo || generation.current !== request) return;
      const value = await decodeRecoveryKeyPhoto(photo);
      if (generation.current !== request) return;
      if (value.length > 512 || !validateIdentitySeedPhrase(value)) {
        setError(
          "This photo does not contain a valid recovery key. Capture the QR code shown in Identity Manager.",
        );
        return;
      }
      onScan(normalizeIdentitySeedPhrase(value));
    } catch {
      ifCurrent(request, () => {
        setError(
          "Could not scan the recovery QR code. Check camera access and try a clear photo of the code, or enter your passphrase.",
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
