import { UserIcon } from "@phosphor-icons/react/dist/csr/User";
import { classNames } from "../../components/shared/classNames";
import "./ContactAvatar.css";

type ContactAvatarSize = "large" | "medium" | "small";

export function ContactAvatar({
  alt,
  className,
  imageUrl,
  size = "small",
}: {
  // Accessible name for the avatar image. Omit when the avatar is decorative
  // (e.g. beside the contact's name in a list row).
  alt?: string | undefined;
  className?: string | undefined;
  imageUrl?: string | null | undefined;
  size?: ContactAvatarSize | undefined;
}) {
  return (
    <span
      aria-hidden={alt ? undefined : true}
      className={classNames(
        "contact-avatar",
        `contact-avatar--${size}`,
        className,
      )}
    >
      {imageUrl ? (
        <img alt={alt ?? ""} className="contact-avatar-image" src={imageUrl} />
      ) : (
        <UserIcon
          aria-hidden
          className="contact-avatar-silhouette"
          weight="fill"
        />
      )}
    </span>
  );
}
