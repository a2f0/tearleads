import { getExplorerContainerIcon } from "./explorerContainerIcons";

// Renders a container's glyph from its stored icon slug. This is a pure,
// synchronous mapping (see getExplorerContainerIcon) — it reads only the icon
// string already carried on a ContainerNode and never triggers a fetch, so it
// is safe to use anywhere a container is shown, including read-only info views.
export function ExplorerContainerIcon(params: {
  className?: string;
  icon: string | null | undefined;
  isOpen?: boolean;
}) {
  const resolved = getExplorerContainerIcon({
    icon: params.icon,
    isOpen: params.isOpen ?? false,
  });
  const Glyph = resolved.Component;

  return (
    <Glyph
      aria-hidden="true"
      className={params.className}
      data-container-icon={resolved.containerIcon}
      data-icon={resolved.name}
      focusable="false"
      size={16}
      weight="regular"
    />
  );
}
