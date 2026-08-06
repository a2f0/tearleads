import { IdentificationCardIcon } from "@phosphor-icons/react/dist/csr/IdentificationCard";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { useMemo } from "react";
import { MiniAppSelectMenu } from "../../../components/mini-app/controls/MiniAppSelectMenu";
import { MiniAppStatus } from "../../../components/mini-app/MiniAppLayout";
import type { IdentitySwitcherState } from "./useIdentitySwitcher";

export function compactIdentityFingerprint(signingFingerprint: string): string {
  if (signingFingerprint.length <= 24) {
    return signingFingerprint;
  }
  return `${signingFingerprint.slice(0, 12)}...${signingFingerprint.slice(-8)}`;
}

export function IdentitySwitcher({
  switcher,
}: {
  switcher: IdentitySwitcherState;
}) {
  const options = useMemo(
    () =>
      switcher.identities.map((identity) => ({
        icon: (
          <IdentificationCardIcon
            aria-hidden="true"
            className="mini-app-select-menu-icon"
            focusable="false"
            size={16}
            weight="regular"
          />
        ),
        id: identity.signingFingerprint,
        label: compactIdentityFingerprint(identity.signingFingerprint),
      })),
    [switcher.identities],
  );

  if (!switcher.available) {
    return null;
  }

  return (
    <div className="identity-manager-switcher">
      <MiniAppSelectMenu
        ariaLabel="Identities"
        disabled={switcher.busy}
        footer={({ close }) => (
          <button
            className="mini-app-select-menu-option"
            disabled={switcher.busy}
            onClick={() => {
              void switcher.createIdentity();
              close();
            }}
            type="button"
          >
            <PlusIcon
              aria-hidden="true"
              className="mini-app-select-menu-icon"
              focusable="false"
              size={16}
              weight="regular"
            />
            <span className="mini-app-select-menu-label">
              {switcher.busy ? "Creating identity..." : "New Identity"}
            </span>
          </button>
        )}
        onChange={(signingFingerprint) => {
          void switcher.selectIdentity(signingFingerprint);
        }}
        options={options}
        placeholder="Identities"
        value={switcher.activeIdentityId ?? ""}
      />
      {switcher.error && (
        <MiniAppStatus role="alert" tone="error">
          {switcher.error}
        </MiniAppStatus>
      )}
    </div>
  );
}
