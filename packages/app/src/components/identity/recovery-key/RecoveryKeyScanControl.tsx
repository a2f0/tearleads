import { useEffect, useEffectEvent, useReducer, useRef, useState } from "react";
import { recoveryKeyScanPhrase } from "../../../identity/recoveryKeyScanPhrase";
import { MiniAppButton, MiniAppStatus } from "../../mini-app/MiniAppLayout";
import { RecoveryKeyScanOverlay } from "./RecoveryKeyScanOverlay";
import { startRecoveryKeyCamera } from "./recoveryKeyCamera";
import {
  INITIAL_RECOVERY_KEY_SCAN_STATE,
  type RecoveryKeyScanState,
  transitionRecoveryKeyScan,
} from "./recoveryKeyScanState";
import "./RecoveryKeyScan.css";

const POINT_HINT = "Point your camera at your recovery QR code.";
const HINTS: Record<RecoveryKeyScanState["status"], string | null> = {
  starting: "Starting the camera...",
  searching: POINT_HINT,
  located: "QR code found. Hold steady while it is read.",
  rejected: POINT_HINT,
  failed: null,
};
const REJECTED_MESSAGE =
  "This QR code does not contain a valid recovery key. Scan the recovery QR code from Identity Manager or your printed recovery key.";

function scanAlert(state: RecoveryKeyScanState): string | null {
  if (state.status === "failed") return state.message;
  return state.status === "rejected" ? REJECTED_MESSAGE : null;
}

function RecoveryKeyCamera({
  onCancel,
  onScan,
}: {
  onCancel: () => void;
  onScan: (phrase: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [state, dispatch] = useReducer(
    transitionRecoveryKeyScan,
    INITIAL_RECOVERY_KEY_SCAN_STATE,
  );
  const cancel = useEffectEvent(onCancel);
  const accept = useEffectEvent((value: string) => {
    const phrase = recoveryKeyScanPhrase(value);
    if (!phrase) return false;
    onScan(phrase);
    return true;
  });

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const stop = startRecoveryKeyCamera(video, {
      onDecode: (value) => accept(value),
      onError: (message) => dispatch({ type: "fail", message }),
      onFrame: (frame) => dispatch({ type: "frame", frame }),
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

  const hint = HINTS[state.status];
  const alert = scanAlert(state);
  const frame = "frame" in state ? state.frame : undefined;
  return (
    <div className="recovery-key-scan">
      <div
        className="recovery-key-scan-viewport"
        style={
          frame
            ? { aspectRatio: `${frame.width} / ${frame.height}` }
            : undefined
        }
      >
        <video
          aria-label="Recovery QR code camera"
          className="recovery-key-scan-camera"
          muted
          playsInline
          ref={videoRef}
        />
        <RecoveryKeyScanOverlay state={state} />
      </div>
      {hint && <MiniAppStatus aria-live="polite">{hint}</MiniAppStatus>}
      {alert && (
        <MiniAppStatus role="alert" tone="error">
          {alert}
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
