import { useMemo } from "react";
import { MiniAppStatus } from "../../../components/mini-app/MiniAppLayout";
import { recoveryKeyQrSvg } from "../../../identity/recoveryKeyQr";

export function RecoveryKeyQrCode({ seedPhrase }: { seedPhrase: string }) {
  const image = useMemo(
    () =>
      `data:image/svg+xml,${encodeURIComponent(recoveryKeyQrSvg(seedPhrase))}`,
    [seedPhrase],
  );

  return (
    <div className="identity-manager-recovery-qr">
      <img
        alt="Recovery key QR code"
        className="identity-manager-recovery-qr-image"
        height={320}
        src={image}
        width={320}
      />
      <MiniAppStatus>
        On your other device, open Identity Manager → Recovery Key → Recovery
        and choose Scan QR Code. Anyone with this code can access your identity.
      </MiniAppStatus>
    </div>
  );
}
