import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { type Scanner, ScannerPhotoCleanupError } from "../../../host/Scanner";
import { recoveryKeyScanPhrase } from "../../../identity/recoveryKeyScanPhrase";
import { MiniAppButton, MiniAppStatus } from "../../mini-app/MiniAppLayout";
import { decodeRecoveryKeyPhoto } from "./recoveryKeyPhoto";
import "./RecoveryKeyScan.css";

export function RecoveryKeyNativeScan({
  disabled,
  label,
  onScan,
  scanner,
}: {
  disabled: boolean;
  label: string;
  onScan: (phrase: string) => void;
  scanner: Scanner;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const busyRef = useRef(false);
  // A capture outlives the render that started it; deliver to the latest owner.
  const latestOnScan = useRef(onScan);
  useLayoutEffect(() => {
    latestOnScan.current = onScan;
  });
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

  const deliverPhrase = (request: number, phrase: string | null) => {
    if (generation.current !== request) return;
    if (!phrase) {
      setError(
        "This photo does not contain a valid recovery key. Capture the recovery QR code from Identity Manager or your printed recovery key.",
      );
      return;
    }
    latestOnScan.current(phrase);
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
      const phrase = recoveryKeyScanPhrase(await decodeRecoveryKeyPhoto(photo));
      deliverPhrase(request, phrase);
    } catch (error) {
      ifCurrent(request, () => {
        setError(
          error instanceof ScannerPhotoCleanupError
            ? "The photo was captured, but its temporary file could not be removed from this device. Enter your passphrase instead."
            : captured
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
    <div className="recovery-key-scan">
      <MiniAppStatus>Take a photo of your recovery QR code.</MiniAppStatus>
      <MiniAppButton disabled={disabled || busy} onClick={() => void capture()}>
        {busy ? "Scanning..." : label}
      </MiniAppButton>
      {error && (
        <MiniAppStatus role="alert" tone="error">
          {error}
        </MiniAppStatus>
      )}
    </div>
  );
}
