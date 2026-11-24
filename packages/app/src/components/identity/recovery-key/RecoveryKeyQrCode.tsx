import { useMemo } from "react";
import { recoveryKeyQrSvg } from "../../../identity/recoveryKeyQr";
import { MiniAppStatus } from "../../mini-app/MiniAppLayout";

export function RecoveryKeyQrCode({ seedPhrase }: { seedPhrase: string }) {
  const image = useMemo(
    () =>
      `data:image/svg+xml,${encodeURIComponent(recoveryKeyQrSvg(seedPhrase))}`,
    [seedPhrase],
  );

  return (
    <div className="recovery-key-qr">
      <img
        alt="Recovery key QR code"
        className="recovery-key-qr-image"
        height={320}
        src={image}
        width={320}
      />
      <MiniAppStatus>
        On a new device, choose Restore identity, then Restore from QR code. On
        a device already set up, open Identity Manager → Recovery Key → Recovery
        and choose Scan QR Code. Anyone with this code can access your identity.
      </MiniAppStatus>
    </div>
  );
}
