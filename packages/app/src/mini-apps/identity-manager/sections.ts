import type { Icon } from "@phosphor-icons/react";
import { DevicesIcon } from "@phosphor-icons/react/dist/csr/Devices";
import { IdentificationCardIcon } from "@phosphor-icons/react/dist/csr/IdentificationCard";
import { KeyIcon } from "@phosphor-icons/react/dist/csr/Key";
import { LockIcon } from "@phosphor-icons/react/dist/csr/Lock";
import type { IdentityManagerView } from "./routes";

interface IdentityManagerSection {
  icon: Icon;
  label: string;
  view: Exclude<IdentityManagerView, "menu">;
}

export const IDENTITY_MANAGER_SECTIONS: ReadonlyArray<IdentityManagerSection> =
  [
    {
      icon: IdentificationCardIcon,
      label: "General",
      view: "general",
    },
    { icon: KeyIcon, label: "Recovery Key", view: "recovery-key" },
    { icon: LockIcon, label: "PIN Lock", view: "pin-lock" },
    {
      icon: DevicesIcon,
      label: "Active Sessions",
      view: "active-sessions",
    },
  ];
