import { X } from 'lucide-react';
import type { RefObject } from 'react';
import type { Attachment } from '../../types';
import { AddressBookPicker } from './AddressBookPicker';
import { AttachmentList } from './AttachmentList';
import { RecipientInput } from './RecipientInput';

interface ComposeFormFieldsProps {
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  body: string;
  attachments: Attachment[];
  isSending: boolean;
  isSaving: boolean;
  addressBookOpen: boolean;
  toInputRef: RefObject<HTMLInputElement | null>;
  onToChange: (value: string) => void;
  onCcChange: (value: string) => void;
  onBccChange: (value: string) => void;
  onSubjectChange: (value: string) => void;
  onBodyChange: (value: string) => void;
  onRemoveAttachment: (id: string) => void;
  onAddressBookOpen: () => void;
  onAddressBookClose: () => void;
  onAddRecipient: (field: 'to' | 'cc' | 'bcc', email: string) => void;
}

export function ComposeFormFields({
  to,
  cc,
  bcc,
  subject,
  body,
  attachments,
  isSending,
  isSaving,
  addressBookOpen,
  toInputRef,
  onToChange,
  onCcChange,
  onBccChange,
  onSubjectChange,
  onBodyChange,
  onRemoveAttachment,
  onAddressBookOpen,
  onAddressBookClose,
  onAddRecipient
}: ComposeFormFieldsProps) {
  const addressBookDisabled = isSending || isSaving;

  return (
    <div className="flex-1 overflow-hidden p-4">
      <div className="flex h-full flex-col gap-3">
        <RecipientInput
          label="To"
          inputId="compose-to"
          value={to}
          placeholder="recipient@example.com"
          disabled={isSending}
          addressBookDisabled={addressBookDisabled}
          inputTestId="compose-to"
          addressBookTestId="compose-to-address-book"
          addressBookAriaLabel="Open address book for To"
          onValueChange={onToChange}
          onAddressBookClick={onAddressBookOpen}
          inputRef={toInputRef}
        />

        <RecipientInput
          label="Cc"
          inputId="compose-cc"
          value={cc}
          placeholder="cc@example.com"
          disabled={isSending}
          addressBookDisabled={addressBookDisabled}
          inputTestId="compose-cc"
          addressBookTestId="compose-cc-address-book"
          addressBookAriaLabel="Open address book for Cc"
          onValueChange={onCcChange}
          onAddressBookClick={onAddressBookOpen}
        />

        <RecipientInput
          label="Bcc"
          inputId="compose-bcc"
          value={bcc}
          placeholder="bcc@example.com"
          disabled={isSending}
          addressBookDisabled={addressBookDisabled}
          inputTestId="compose-bcc"
          addressBookTestId="compose-bcc-address-book"
          addressBookAriaLabel="Open address book for Bcc"
          onValueChange={onBccChange}
          onAddressBookClick={onAddressBookOpen}
        />

        <div className="flex items-center gap-2">
          <label
            htmlFor="compose-subject"
            className="w-12 text-muted-foreground text-sm"
          >
            Subject
          </label>
          <input
            id="compose-subject"
            type="text"
            value={subject}
            onChange={(e) => onSubjectChange(e.target.value)}
            placeholder="Subject"
            className="flex-1 rounded-md border bg-background px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-ring"
            disabled={isSending}
            data-testid="compose-subject"
          />
        </div>

        {addressBookOpen && (
          <div className="relative" data-testid="compose-address-book-panel">
            <button
              type="button"
              onClick={onAddressBookClose}
              className="absolute top-2 right-2 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label="Close address book"
              data-testid="address-book-close"
            >
              <X className="h-4 w-4" />
            </button>
            <AddressBookPicker
              disabled={addressBookDisabled}
              onSelect={onAddRecipient}
            />
          </div>
        )}

        <div className="min-h-0 flex-1">
          <textarea
            id="compose-body"
            value={body}
            onChange={(e) => onBodyChange(e.target.value)}
            placeholder="Write your message..."
            className="h-full w-full resize-none rounded-md border bg-background px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-ring"
            disabled={isSending}
            data-testid="compose-body"
          />
        </div>

        <AttachmentList
          attachments={attachments}
          onRemove={onRemoveAttachment}
          disabled={isSending}
        />
      </div>
    </div>
  );
}
