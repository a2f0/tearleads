import type { Icon } from "@phosphor-icons/react";
import { UserIcon } from "@phosphor-icons/react/dist/csr/User";
import { classNames } from "../../../components/shared/classNames";
import "./DocumentAvatarImage.css";

type DocumentAvatarImageSize = "large" | "medium" | "small";

/**
 * A document's avatar: its chosen photo in a circle, or the kind's fallback
 * glyph in the same circle while none is chosen or loaded. Every surface that
 * shows a document's avatar (its own view, Contacts, Explorer) renders this.
 */
export function DocumentAvatarImage({
  alt,
  className,
  imageUrl,
  fallbackIcon: FallbackIcon = UserIcon,
  size = "small",
}: {
  // Accessible name for the avatar image. Omit when the avatar is decorative
  // (e.g. beside the document's name in a list row).
  alt?: string | undefined;
  className?: string | undefined;
  fallbackIcon?: Icon | undefined;
  imageUrl?: string | null | undefined;
  size?: DocumentAvatarImageSize | undefined;
}) {
  return (
    <span
      aria-hidden={alt ? undefined : true}
      className={classNames(
        "document-avatar",
        `document-avatar--${size}`,
        className,
      )}
    >
      {imageUrl ? (
        <img alt={alt ?? ""} className="document-avatar-image" src={imageUrl} />
      ) : (
        <FallbackIcon
          aria-hidden
          className="document-avatar-fallback"
          weight="fill"
        />
      )}
    </span>
  );
}
