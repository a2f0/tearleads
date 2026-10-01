// Messages other mini-apps send to Contacts over the mini-app bus.
export interface ContactsImportMessage {
  appId: "contacts";
  type: "import-contact";
  userId: string;
}

export type ContactsMiniAppMessage = ContactsImportMessage;
