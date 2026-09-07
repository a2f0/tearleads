import { BuildingsIcon } from "@phosphor-icons/react/dist/csr/Buildings";
import { ChartBarIcon } from "@phosphor-icons/react/dist/csr/ChartBar";
import { UsersThreeIcon } from "@phosphor-icons/react/dist/csr/UsersThree";
import type { MiniAppSection } from "../../components/mini-app/MiniAppSectionNavigation";
import type { RootView } from "./routes";

export const ROOT_SECTIONS: ReadonlyArray<
  MiniAppSection<Exclude<RootView, "menu">>
> = [
  { icon: UsersThreeIcon, label: "Identities", view: "identities" },
  { icon: BuildingsIcon, label: "Organizations", view: "organizations" },
  { icon: ChartBarIcon, label: "Reports", view: "reports" },
];
