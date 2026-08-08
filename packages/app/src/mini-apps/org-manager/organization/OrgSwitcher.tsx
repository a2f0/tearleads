import { BuildingsIcon } from "@phosphor-icons/react/dist/csr/Buildings";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { useMemo } from "react";
import { MiniAppSelectMenu } from "../../../components/mini-app/controls/MiniAppSelectMenu";
import { MiniAppStatus } from "../../../components/mini-app/MiniAppLayout";
import { ORG_MANAGER_LABELS } from "../labels";
import type { OrgSwitcherState } from "./orgSwitcherTypes";

export function OrgSwitcher({ switcher }: { switcher: OrgSwitcherState }) {
  const options = useMemo(
    () =>
      switcher.organizations.map((organization) => ({
        icon: (
          <BuildingsIcon
            aria-hidden="true"
            className="mini-app-select-menu-icon"
            focusable="false"
            size={16}
            weight="regular"
          />
        ),
        id: organization.organizationId,
        label: organization.name ?? ORG_MANAGER_LABELS.unnamedOrganization,
      })),
    [switcher.organizations],
  );

  return (
    <div className="org-manager-switcher">
      <MiniAppSelectMenu
        ariaLabel={ORG_MANAGER_LABELS.organizations}
        footerAction={{
          disabled: switcher.creating || switcher.interactionDisabled,
          icon: PlusIcon,
          label: switcher.creating
            ? ORG_MANAGER_LABELS.creatingOrganization
            : ORG_MANAGER_LABELS.newOrganizationAction,
          onSelect: switcher.openCreateOrganizationDialog,
        }}
        onChange={switcher.selectOrganization}
        options={options}
        placeholder={ORG_MANAGER_LABELS.organizations}
        value={switcher.activeOrganizationId ?? ""}
        disabled={switcher.interactionDisabled}
      />
      {switcher.organizationsLoading ? (
        <MiniAppStatus>{ORG_MANAGER_LABELS.loadingOrganizations}</MiniAppStatus>
      ) : switcher.organizationsError ? (
        <MiniAppStatus tone="error">
          {switcher.organizationsError}
        </MiniAppStatus>
      ) : null}
    </div>
  );
}
