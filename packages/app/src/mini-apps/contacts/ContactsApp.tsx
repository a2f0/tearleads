import { AppWindow } from "../AppWindow";
import { Contacts } from "./Contacts";
import { ContactsProvider } from "./ContactsProvider";

export function ContactsApp() {
  return (
    <AppWindow Provider={ContactsProvider}>
      <Contacts />
    </AppWindow>
  );
}
