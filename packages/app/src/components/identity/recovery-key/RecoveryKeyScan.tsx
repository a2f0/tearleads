import { useMemo } from "react";
import { useAppHostConfig } from "../../../providers/host/AppHostConfigProvider";
import { RecoveryKeyNativeScan } from "./RecoveryKeyNativeScan";
import { RecoveryKeyScanControl } from "./RecoveryKeyScanControl";
import "./RecoveryKeyScan.css";

/**
 * Reads a recovery key from its QR code with whatever camera this device has:
 * a native shell's photo capture where the host provides a scanner, otherwise
 * the browser's live camera. `onScan` receives only a valid, normalized phrase.
 */
export function RecoveryKeyScan({
  disabled,
  label,
  onScan,
}: {
  readonly disabled: boolean;
  readonly label: string;
  readonly onScan: (phrase: string) => void;
}) {
  const { createScanner } = useAppHostConfig();
  const scanner = useMemo(() => createScanner?.(), [createScanner]);
  return scanner ? (
    <RecoveryKeyNativeScan
      disabled={disabled}
      label={label}
      onScan={onScan}
      scanner={scanner}
    />
  ) : (
    <RecoveryKeyScanControl disabled={disabled} label={label} onScan={onScan} />
  );
}
