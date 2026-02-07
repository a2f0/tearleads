import { Save, Send, X } from 'lucide-react';
import { useCallback, useEffect, useRef } from 'react';
import { useCompose } from '../../hooks';
import { validateEmailAddresses } from '../../types';
import { AttachmentInput } from './AttachmentInput';
import { AttachmentList } from './AttachmentList';

interface ComposeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  draftId?: string | null;
  onEmailSent?: () => void;
}

export function ComposeDialog({
  open,
  onOpenChange,
  draftId = null,
  onEmailSent
}: ComposeDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const toInputRef = useRef<HTMLInputElement>(null);

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

  const handleClose = useCallback(() => {
    if (state.isDirty && !state.isSaving) {
      saveDraft();
    }
    onOpenChange(false);
  }, [state.isDirty, state.isSaving, saveDraft, onOpenChange]);

  const canSend =
    state.to.trim().length > 0 &&
    state.subject.trim().length > 0 &&
    !state.isSending &&
    !state.isSaving;

  if (!open) return null;

  return (
    <div
      className="flex h-full w-[420px] min-w-[360px] shrink-0 flex-col border-l bg-background"
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

        <div className="flex-1 overflow-y-auto p-4">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <label
                htmlFor="compose-to"
                className="w-12 text-muted-foreground text-sm"
              >
                To
              </label>
              <input
                ref={toInputRef}
                id="compose-to"
                type="text"
                value={state.to}
                onChange={(e) => setTo(e.target.value)}
                placeholder="recipient@example.com"
                className="flex-1 rounded-md border bg-background px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-ring"
                disabled={state.isSending}
                data-testid="compose-to"
              />
            </div>

            <div className="flex items-center gap-2">
              <label
                htmlFor="compose-cc"
                className="w-12 text-muted-foreground text-sm"
              >
                Cc
              </label>
              <input
                id="compose-cc"
                type="text"
                value={state.cc}
                onChange={(e) => setCc(e.target.value)}
                placeholder="cc@example.com"
                className="flex-1 rounded-md border bg-background px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-ring"
                disabled={state.isSending}
                data-testid="compose-cc"
              />
            </div>

            <div className="flex items-center gap-2">
              <label
                htmlFor="compose-bcc"
                className="w-12 text-muted-foreground text-sm"
              >
                Bcc
              </label>
              <input
                id="compose-bcc"
                type="text"
                value={state.bcc}
                onChange={(e) => setBcc(e.target.value)}
                placeholder="bcc@example.com"
                className="flex-1 rounded-md border bg-background px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-ring"
                disabled={state.isSending}
                data-testid="compose-bcc"
              />
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

            <div>
              <textarea
                id="compose-body"
                value={state.body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Write your message..."
                className="min-h-[200px] w-full resize-y rounded-md border bg-background px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-ring"
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
