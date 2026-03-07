// component-complexity: allow — pre-existing complexity, only added attachment hydration
import { clsx } from 'clsx';
import { Save, Send, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useCompose } from '../../hooks';
import type { ComposeMode } from '../../lib/quoteText.js';
import type { ComposeState } from '../../types';
import {
  formatEmailAddresses,
  parseEmailAddresses,
  validateEmailAddresses
} from '../../types';
import { AttachmentInput } from './AttachmentInput';
import { ComposeFormFields } from './ComposeFormFields';

const COMPOSE_MODE_TITLES: Record<ComposeMode, string> = {
  new: 'New Message',
  reply: 'Reply',
  replyAll: 'Reply All',
  forward: 'Forward'
};

function appendRecipient(currentValue: string, email: string): string {
  const parsed = parseEmailAddresses(currentValue);
  const normalized = email.trim().toLowerCase();
  if (parsed.some((entry) => entry.toLowerCase() === normalized)) {
    return formatEmailAddresses(parsed);
  }
  return formatEmailAddresses([...parsed, email.trim()]);
}

function canSendMessage(state: ComposeState): boolean {
  return (
    state.to.trim().length > 0 &&
    state.subject.trim().length > 0 &&
    !state.isSending &&
    !state.isSaving
  );
}

interface ComposeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  draftId?: string | null;
  onEmailSent?: () => void;
  className?: string;
  openRequest?: {
    to?: string[];
    cc?: string[];
    bcc?: string[];
    subject?: string;
    body?: string;
    composeMode?: ComposeMode;
    attachments?: Array<{
      fileName: string;
      mimeType: string;
      size: number;
      content: string;
    }>;

    requestId: number;
  };
}

export function ComposeDialog({
  open,
  onOpenChange,
  draftId = null,
  onEmailSent,
  className,
  openRequest
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
    addAttachmentFromPayload,
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

  useEffect(() => {
    if (!open || !openRequest) return;
    setTo(formatEmailAddresses(openRequest.to ?? []));
    setCc(formatEmailAddresses(openRequest.cc ?? []));
    setBcc(formatEmailAddresses(openRequest.bcc ?? []));
    setSubject(openRequest.subject ?? '');
    setBody(openRequest.body ?? '');
    if (openRequest.attachments) {
      for (const att of openRequest.attachments) {
        addAttachmentFromPayload(att);
      }
    }
    setAddressBookOpen(false);
  }, [
    open,
    openRequest,
    setBcc,
    setBody,
    setCc,
    setSubject,
    setTo,
    addAttachmentFromPayload
  ]);

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
    if (!toValidation.valid) return;
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
      const setters = { to: setTo, cc: setCc, bcc: setBcc };
      const values = { to: state.to, cc: state.cc, bcc: state.bcc };
      setters[field](appendRecipient(values[field], email));
    },
    [setTo, setCc, setBcc, state.to, state.cc, state.bcc]
  );

  const canSend = canSendMessage(state);

  if (!open) return null;

  const title = COMPOSE_MODE_TITLES[openRequest?.composeMode ?? 'new'];

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
            {title}
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

        <ComposeFormFields
          to={state.to}
          cc={state.cc}
          bcc={state.bcc}
          subject={state.subject}
          body={state.body}
          attachments={state.attachments}
          isSending={state.isSending}
          isSaving={state.isSaving}
          addressBookOpen={addressBookOpen}
          toInputRef={toInputRef}
          onToChange={setTo}
          onCcChange={setCc}
          onBccChange={setBcc}
          onSubjectChange={setSubject}
          onBodyChange={setBody}
          onRemoveAttachment={removeAttachment}
          onAddressBookOpen={() => setAddressBookOpen(true)}
          onAddressBookClose={() => setAddressBookOpen(false)}
          onAddRecipient={addRecipientToField}
        />

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
