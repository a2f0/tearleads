import { ContactsProvider } from "../../stores/contacts/ContactsProvider";
import { AppWindow } from "../AppWindow";
import { Contacts } from "./Contacts";

export function ContactsApp() {
  return (
    <AppWindow Provider={ContactsProvider}>
      <Contacts />
    </AppWindow>
  );
}
