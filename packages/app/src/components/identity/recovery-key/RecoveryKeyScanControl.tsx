import { useEffect, useEffectEvent, useRef, useState } from "react";
import { recoveryKeyScanPhrase } from "../../../identity/recoveryKeyScanPhrase";
import { MiniAppButton, MiniAppStatus } from "../../mini-app/MiniAppLayout";
import { startRecoveryKeyCamera } from "./recoveryKeyCamera";
import "./RecoveryKeyScan.css";

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
    const phrase = recoveryKeyScanPhrase(value);
    if (!phrase) {
      setError(
        "This QR code does not contain a valid recovery key. Scan the recovery QR code from Identity Manager or your printed recovery key.",
      );
      return false;
    }
    onScan(phrase);
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
    <div className="recovery-key-scan">
      <MiniAppStatus>Point your camera at your recovery QR code.</MiniAppStatus>
      <video
        aria-label="Recovery QR code camera"
        className="recovery-key-scan-camera"
        muted
        playsInline
        ref={videoRef}
      />
      {error && (
        <MiniAppStatus role="alert" tone="error">
          {error}
        </MiniAppStatus>
      )}
      <MiniAppButton onClick={onCancel}>Cancel Scan</MiniAppButton>
    </div>
  );
}

export function RecoveryKeyScanControl({
  disabled,
  label,
  onScan,
}: {
  disabled: boolean;
  label: string;
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
    <MiniAppButton disabled={disabled} onClick={() => setScanning(true)}>
      {label}
    </MiniAppButton>
  );
}
