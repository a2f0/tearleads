import { clsx } from 'clsx';
import { BookUser, Save, Send, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useCompose } from '../../hooks';
import {
  formatEmailAddresses,
  parseEmailAddresses,
  validateEmailAddresses
} from '../../types';
import { AddressBookPicker } from './AddressBookPicker';
import { AttachmentInput } from './AttachmentInput';
import { AttachmentList } from './AttachmentList';

interface ComposeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  draftId?: string | null;
  onEmailSent?: () => void;
  className?: string;
}

export function ComposeDialog({
  open,
  onOpenChange,
  draftId = null,
  onEmailSent,
  className
}: ComposeDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const toInputRef = useRef<HTMLInputElement>(null);
  const [addressBookOpen, setAddressBookOpen] = useState(false);

  const {
    state,
    setTo,
    setCc,
    setBcc,
    setSubject,
    setBody,
    addAttachment,
    removeAttachment,
    saveDraft,
    send,
    reset
  } = useCompose({
    draftId,
    onSent: () => {
      onEmailSent?.();
      onOpenChange(false);
    }
  });

  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => {
        toInputRef.current?.focus();
      });
    } else {
      setAddressBookOpen(false);
      reset();
    }
  }, [open, reset]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape' && !state.isSaving && !state.isSending) {
        onOpenChange(false);
      }
    },
    [onOpenChange, state.isSaving, state.isSending]
  );

  const handleSend = useCallback(async () => {
    const toValidation = validateEmailAddresses(state.to);
    if (!toValidation.valid) {
      return;
    }
    await send();
  }, [state.to, send]);

  const handleSaveDraft = useCallback(async () => {
    await saveDraft();
  }, [saveDraft]);

  const handleClose = useCallback(async () => {
    if (state.isDirty && !state.isSaving && !state.isSending) {
      await saveDraft();
    }
    setAddressBookOpen(false);
    onOpenChange(false);
  }, [state.isDirty, state.isSaving, state.isSending, saveDraft, onOpenChange]);

  const addRecipientToField = useCallback(
    (field: 'to' | 'cc' | 'bcc', email: string) => {
      const appendEmail = (value: string): string => {
        const parsed = parseEmailAddresses(value);
        const normalized = email.trim().toLowerCase();
        if (parsed.some((entry) => entry.toLowerCase() === normalized)) {
          return formatEmailAddresses(parsed);
        }
        return formatEmailAddresses([...parsed, email.trim()]);
      };

      if (field === 'to') {
        setTo(appendEmail(state.to));
        return;
      }
      if (field === 'cc') {
        setCc(appendEmail(state.cc));
        return;
      }
      setBcc(appendEmail(state.bcc));
    },
    [setTo, setCc, setBcc, state.to, state.cc, state.bcc]
  );

  const canSend =
    state.to.trim().length > 0 &&
    state.subject.trim().length > 0 &&
    !state.isSending &&
    !state.isSaving;

  if (!open) return null;

  return (
    <div
      className={clsx('flex h-full flex-col bg-background', className)}
      data-testid="compose-dialog"
    >
      <section
        ref={dialogRef}
        className="flex h-full flex-col"
        role="dialog"
        aria-labelledby="compose-dialog-title"
        onKeyDown={handleKeyDown}
      >
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 id="compose-dialog-title" className="font-semibold text-lg">
            New Message
          </h2>
          <div className="flex items-center gap-2">
            {state.lastSavedAt && (
              <span className="text-muted-foreground text-xs">
                Saved {new Date(state.lastSavedAt).toLocaleTimeString()}
              </span>
            )}
            {state.isSaving && (
              <span className="text-muted-foreground text-xs">Saving...</span>
            )}
            <button
              type="button"
              onClick={handleClose}
              className="rounded p-1 hover:bg-accent"
              aria-label="Close"
              data-testid="compose-close"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-hidden p-4">
          <div className="flex h-full flex-col gap-3">
            <div className="flex items-center gap-2">
              <label
                htmlFor="compose-to"
                className="w-12 text-muted-foreground text-sm"
              >
                To
              </label>
              <div className="relative flex-1">
                <input
                  ref={toInputRef}
                  id="compose-to"
                  type="text"
                  autoComplete="off"
                  value={state.to}
                  onChange={(e) => setTo(e.target.value)}
                  placeholder="recipient@example.com"
                  className="w-full rounded-md border bg-background px-3 py-2 pr-10 text-base focus:outline-none focus:ring-2 focus:ring-ring"
                  disabled={state.isSending}
                  data-testid="compose-to"
                />
                <button
                  type="button"
                  onClick={() => setAddressBookOpen(true)}
                  className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
                  aria-label="Open address book for To"
                  disabled={state.isSending || state.isSaving}
                  data-testid="compose-to-address-book"
                >
                  <BookUser className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <label
                htmlFor="compose-cc"
                className="w-12 text-muted-foreground text-sm"
              >
                Cc
              </label>
              <div className="relative flex-1">
                <input
                  id="compose-cc"
                  type="text"
                  autoComplete="off"
                  value={state.cc}
                  onChange={(e) => setCc(e.target.value)}
                  placeholder="cc@example.com"
                  className="w-full rounded-md border bg-background px-3 py-2 pr-10 text-base focus:outline-none focus:ring-2 focus:ring-ring"
                  disabled={state.isSending}
                  data-testid="compose-cc"
                />
                <button
                  type="button"
                  onClick={() => setAddressBookOpen(true)}
                  className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
                  aria-label="Open address book for Cc"
                  disabled={state.isSending || state.isSaving}
                  data-testid="compose-cc-address-book"
                >
                  <BookUser className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <label
                htmlFor="compose-bcc"
                className="w-12 text-muted-foreground text-sm"
              >
                Bcc
              </label>
              <div className="relative flex-1">
                <input
                  id="compose-bcc"
                  type="text"
                  autoComplete="off"
                  value={state.bcc}
                  onChange={(e) => setBcc(e.target.value)}
                  placeholder="bcc@example.com"
                  className="w-full rounded-md border bg-background px-3 py-2 pr-10 text-base focus:outline-none focus:ring-2 focus:ring-ring"
                  disabled={state.isSending}
                  data-testid="compose-bcc"
                />
                <button
                  type="button"
                  onClick={() => setAddressBookOpen(true)}
                  className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
                  aria-label="Open address book for Bcc"
                  disabled={state.isSending || state.isSaving}
                  data-testid="compose-bcc-address-book"
                >
                  <BookUser className="h-4 w-4" />
                </button>
              </div>
            </div>

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
                value={state.subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Subject"
                className="flex-1 rounded-md border bg-background px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-ring"
                disabled={state.isSending}
                data-testid="compose-subject"
              />
            </div>

            {addressBookOpen && (
              <div
                className="relative"
                data-testid="compose-address-book-panel"
              >
                <button
                  type="button"
                  onClick={() => setAddressBookOpen(false)}
                  className="absolute top-2 right-2 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                  aria-label="Close address book"
                  data-testid="address-book-close"
                >
                  <X className="h-4 w-4" />
                </button>
                <AddressBookPicker
                  disabled={state.isSending || state.isSaving}
                  onSelect={addRecipientToField}
                />
              </div>
            )}

            <div className="min-h-0 flex-1">
              <textarea
                id="compose-body"
                value={state.body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Write your message..."
                className="h-full w-full resize-none rounded-md border bg-background px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-ring"
                disabled={state.isSending}
                data-testid="compose-body"
              />
            </div>

            <AttachmentList
              attachments={state.attachments}
              onRemove={removeAttachment}
              disabled={state.isSending}
            />
          </div>
        </div>

        {state.error && (
          <div className="border-t bg-destructive/10 px-4 py-2">
            <p className="text-destructive text-sm">{state.error}</p>
          </div>
        )}

        <div className="flex items-center justify-between border-t px-4 py-3">
          <div className="flex items-center gap-2">
            <AttachmentInput
              onFileSelected={addAttachment}
              disabled={state.isSending}
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleSaveDraft}
              disabled={state.isSaving || state.isSending}
              className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50"
              data-testid="compose-save-draft"
            >
              <Save className="h-4 w-4" />
              Save Draft
            </button>
            <button
              type="button"
              onClick={handleSend}
              disabled={!canSend}
              className="flex items-center gap-1.5 rounded-md bg-primary px-4 py-1.5 text-primary-foreground text-sm hover:bg-primary/90 disabled:opacity-50"
              data-testid="compose-send"
            >
              <Send className="h-4 w-4" />
              {state.isSending ? 'Sending...' : 'Send'}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
