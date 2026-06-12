import { ContactsProvider } from "../../stores/contacts/ContactsProvider";
import { AppWindow } from "../AppWindow";
import { LocalKeyringUnlockGate } from "../LocalKeyringUnlockGate";
import { Contacts } from "./Contacts";

export function ContactsApp() {
  return (
    <LocalKeyringUnlockGate appName="Contacts">
      <AppWindow Provider={ContactsProvider}>
        <Contacts />
      </AppWindow>
    </LocalKeyringUnlockGate>
  );
}
