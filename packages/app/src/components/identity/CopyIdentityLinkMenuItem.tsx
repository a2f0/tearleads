import { LinkSimpleIcon } from "@phosphor-icons/react/dist/csr/LinkSimple";
import { MenuItem } from "@tearleads/windowing";
import { useUserIdentityLink } from "../../providers/identity-links/useUserIdentityLink";

export const COPY_IDENTITY_LINK_LABEL = "Copy identity link";

/**
 * Menu entry copying a user's identity link. It appears only once the link
 * resolved (a link-verified user, or the signed-in user) and the Clipboard
 * API exists, which it does not in insecure contexts.
 */
export function CopyIdentityLinkMenuItem({
  onSelect,
  userId,
}: {
  onSelect: () => void;
  userId: string | null;
}) {
  const { link } = useUserIdentityLink(userId);
  const { clipboard } = navigator;
  if (!clipboard || !link) {
    return null;
  }

  return (
    <MenuItem
      icon={LinkSimpleIcon}
      label={COPY_IDENTITY_LINK_LABEL}
      onClick={() => {
        onSelect();
        void clipboard.writeText(link).catch(() => undefined);
      }}
    />
  );
}
