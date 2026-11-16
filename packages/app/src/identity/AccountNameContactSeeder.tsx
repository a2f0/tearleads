import { ContactsProvider } from "../stores/contacts/ContactsProvider";
import {
  SelfContactNicknameWriter,
  type SelfContactNicknameWriterProps,
} from "./SelfContactNicknameWriter";

/**
 * Gives the self contact the name the user chose at first launch, once the
 * account exists and Contacts is writable. A nickname it already carries is
 * kept. Brings its own ContactsProvider so it runs whether or not the user
 * opens Contacts; the autopilot unmounts it once the nickname is saved.
 */
export function AccountNameContactSeeder(
  props: SelfContactNicknameWriterProps,
) {
  return (
    <ContactsProvider>
      <SelfContactNicknameWriter {...props} />
    </ContactsProvider>
  );
}
