import {
  normalizeIdentitySeedPhrase,
  validateIdentitySeedPhrase,
} from "@tearleads/crypto";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import {
  MiniAppButton,
  MiniAppStatus,
} from "../../../components/mini-app/MiniAppLayout";
import { startRecoveryKeyCamera } from "./recoveryKeyCamera";

function RecoveryKeyCamera({
  onCancel,
  onScan,
}: {
  onCancel: () => void;
  onScan: (phrase: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const cancel = useEffectEvent(onCancel);
  const accept = useEffectEvent((value: string) => {
    if (value.length > 512 || !validateIdentitySeedPhrase(value)) {
      setError(
        "This QR code does not contain a valid recovery key. Scan the code shown in Identity Manager.",
      );
      return false;
    }
    onScan(normalizeIdentitySeedPhrase(value));
    return true;
  });

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const stop = startRecoveryKeyCamera(video, {
      onDecode: (value) => accept(value),
      onError: setError,
    });
    const close = () => {
      stop();
      cancel();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") close();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", close);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", close);
    };
  }, []);

  return (
    <div className="identity-manager-recovery-key-form">
      <MiniAppStatus>
        Point your camera at the recovery QR code on your other device.
      </MiniAppStatus>
      <video
        aria-label="Recovery QR code camera"
        className="identity-manager-recovery-camera"
        muted
        playsInline
        ref={videoRef}
      />
      {error && <MiniAppStatus tone="error">{error}</MiniAppStatus>}
      <MiniAppButton onClick={onCancel}>Cancel Scan</MiniAppButton>
    </div>
  );
}

export function RecoveryKeyScanControl({
  disabled,
  onScan,
}: {
  disabled: boolean;
  onScan: (phrase: string) => void;
}) {
  const [scanning, setScanning] = useState(false);
  if (disabled && scanning) setScanning(false);

  if (scanning && !disabled) {
    return (
      <RecoveryKeyCamera
        onCancel={() => setScanning(false)}
        onScan={(phrase) => {
          setScanning(false);
          onScan(phrase);
        }}
      />
    );
  }
  return (
    <div className="identity-manager-recovery-key-form">
      <MiniAppButton
        disabled={disabled}
        onClick={() => {
          setScanning(true);
        }}
      >
        Scan QR Code
      </MiniAppButton>
    </div>
  );
}
