import { DevicesIcon } from "@phosphor-icons/react/dist/csr/Devices";
import { HardDriveIcon } from "@phosphor-icons/react/dist/csr/HardDrive";
import { IdentificationCardIcon } from "@phosphor-icons/react/dist/csr/IdentificationCard";
import { KeyIcon } from "@phosphor-icons/react/dist/csr/Key";
import { LockIcon } from "@phosphor-icons/react/dist/csr/Lock";
import { ShieldCheckIcon } from "@phosphor-icons/react/dist/csr/ShieldCheck";
import type { MiniAppSection } from "../../components/mini-app/MiniAppSectionNavigation";
import type { IdentityManagerView } from "./routes";

export const IDENTITY_MANAGER_SECTIONS: ReadonlyArray<
  MiniAppSection<Exclude<IdentityManagerView, "menu">>
> = [
  {
    icon: IdentificationCardIcon,
    label: "General",
    view: "general",
  },
  { icon: KeyIcon, label: "Recovery Key", view: "recovery-key" },
  { icon: LockIcon, label: "PIN Lock", view: "pin-lock" },
  { icon: ShieldCheckIcon, label: "Two-Factor", view: "two-factor" },
  {
    icon: DevicesIcon,
    label: "Active Sessions",
    view: "active-sessions",
  },
  { icon: HardDriveIcon, label: "Local Data", view: "local-data" },
];
