import { useCallback, useEffect, useRef, useState } from 'react';
import { useEmailApi } from '../context';
import type {
  Attachment,
  ComposeState,
  DraftEmail,
  DraftListItem
} from '../types';
import {
  formatEmailAddresses,
  initialComposeState,
  parseEmailAddresses
} from '../types';

const AUTO_SAVE_DELAY_MS = 5000;

interface UseComposeOptions {
  draftId?: string | null;
  onSent?: () => void;
}

interface UseComposeReturn {
  state: ComposeState;
  setTo: (value: string) => void;
  setCc: (value: string) => void;
  setBcc: (value: string) => void;
  setSubject: (value: string) => void;
  setBody: (value: string) => void;
  addAttachment: (file: File) => void;
  removeAttachment: (id: string) => void;
  saveDraft: () => Promise<string | null>;
  send: () => Promise<boolean>;
  reset: () => void;
  loadDraft: (id: string) => Promise<void>;
}

export function useCompose(options: UseComposeOptions = {}): UseComposeReturn {
  const { draftId, onSent } = options;
  const { apiBaseUrl, getAuthHeader, draftOperations } = useEmailApi();
  const [state, setState] = useState<ComposeState>(initialComposeState);
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentDraftIdRef = useRef<string | null>(draftId ?? null);

  const getHeaders = useCallback(() => {
    const authHeader = getAuthHeader?.();
    return {
      'Content-Type': 'application/json',
      ...(authHeader ? { Authorization: authHeader } : {})
    };
  }, [getAuthHeader]);

  const updateField = useCallback(
    <K extends keyof ComposeState>(field: K, value: ComposeState[K]) => {
      setState((prev) => ({
        ...prev,
        [field]: value,
        isDirty: true,
        error: null
      }));
    },
    []
  );

  const setTo = useCallback(
    (value: string) => updateField('to', value),
    [updateField]
  );
  const setCc = useCallback(
    (value: string) => updateField('cc', value),
    [updateField]
  );
  const setBcc = useCallback(
    (value: string) => updateField('bcc', value),
    [updateField]
  );
  const setSubject = useCallback(
    (value: string) => updateField('subject', value),
    [updateField]
  );
  const setBody = useCallback(
    (value: string) => updateField('body', value),
    [updateField]
  );

  const addAttachment = useCallback((file: File) => {
    const attachment: Attachment = {
      id: crypto.randomUUID(),
      fileName: file.name,
      mimeType: file.type || 'application/octet-stream',
      size: file.size,
      file
    };
    setState((prev) => ({
      ...prev,
      attachments: [...prev.attachments, attachment],
      isDirty: true
    }));
  }, []);

  const removeAttachment = useCallback((id: string) => {
    setState((prev) => ({
      ...prev,
      attachments: prev.attachments.filter((a) => a.id !== id),
      isDirty: true
    }));
  }, []);

  const saveDraft = useCallback(async (): Promise<string | null> => {
    setState((prev) => ({ ...prev, isSaving: true, error: null }));

    try {
      const attachmentsWithContent = await Promise.all(
        state.attachments.map(async (att) => {
          if (att.content) {
            return {
              id: att.id,
              fileName: att.fileName,
              mimeType: att.mimeType,
              size: att.size
            };
          }
          if (att.file) {
            const buffer = await att.file.arrayBuffer();
            return {
              id: att.id,
              fileName: att.fileName,
              mimeType: att.mimeType,
              size: att.size,
              content: btoa(String.fromCharCode(...new Uint8Array(buffer)))
            };
          }
          return {
            id: att.id,
            fileName: att.fileName,
            mimeType: att.mimeType,
            size: att.size
          };
        })
      );

      if (!draftOperations) {
        throw new Error('Draft operations are unavailable');
      }

      const data = await draftOperations.saveDraft({
        id: currentDraftIdRef.current,
        to: parseEmailAddresses(state.to),
        cc: parseEmailAddresses(state.cc),
        bcc: parseEmailAddresses(state.bcc),
        subject: state.subject,
        body: state.body,
        attachments: attachmentsWithContent
      });
      currentDraftIdRef.current = data.id;

      setState((prev) => ({
        ...prev,
        draftId: data.id,
        isSaving: false,
        isDirty: false,
        lastSavedAt: data.updatedAt
      }));

      return data.id;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to save';
      setState((prev) => ({
        ...prev,
        isSaving: false,
        error: errorMsg
      }));
      return null;
    }
  }, [draftOperations, state]);

  const send = useCallback(async (): Promise<boolean> => {
    setState((prev) => ({ ...prev, isSending: true, error: null }));

    try {
      const attachmentsWithContent = await Promise.all(
        state.attachments.map(async (att) => {
          if (att.content) {
            return {
              fileName: att.fileName,
              mimeType: att.mimeType,
              content: att.content
            };
          }
          if (att.file) {
            const buffer = await att.file.arrayBuffer();
            return {
              fileName: att.fileName,
              mimeType: att.mimeType,
              content: btoa(String.fromCharCode(...new Uint8Array(buffer)))
            };
          }
          return null;
        })
      );

      const response = await fetch(`${apiBaseUrl}/vfs/emails/send`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({
          draftId: currentDraftIdRef.current,
          to: parseEmailAddresses(state.to),
          cc: parseEmailAddresses(state.cc),
          bcc: parseEmailAddresses(state.bcc),
          subject: state.subject,
          body: state.body,
          attachments: attachmentsWithContent.filter(Boolean)
        })
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error ?? 'Failed to send email');
      }

      setState((prev) => ({
        ...prev,
        isSending: false,
        isDirty: false
      }));

      onSent?.();
      return true;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to send';
      setState((prev) => ({
        ...prev,
        isSending: false,
        error: errorMsg
      }));
      return false;
    }
  }, [apiBaseUrl, getHeaders, state, onSent]);

  const reset = useCallback(() => {
    currentDraftIdRef.current = null;
    setState(initialComposeState);
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
  }, []);

  const loadDraft = useCallback(
    async (id: string): Promise<void> => {
      try {
        if (!draftOperations) {
          throw new Error('Draft operations are unavailable');
        }

        const draft: DraftEmail | null = await draftOperations.getDraft(id);

        if (!draft) {
          throw new Error('Failed to load draft');
        }
        currentDraftIdRef.current = draft.id;

        setState({
          draftId: draft.id,
          to: formatEmailAddresses(draft.to),
          cc: formatEmailAddresses(draft.cc),
          bcc: formatEmailAddresses(draft.bcc),
          subject: draft.subject,
          body: draft.body,
          attachments: draft.attachments,
          isDirty: false,
          isSaving: false,
          isSending: false,
          lastSavedAt: draft.updatedAt,
          error: null
        });
      } catch (err) {
        console.error('Failed to load draft:', err);
        setState((prev) => ({
          ...prev,
          error: err instanceof Error ? err.message : 'Failed to load draft'
        }));
      }
    },
    [draftOperations]
  );

  useEffect(() => {
    if (draftId) {
      loadDraft(draftId);
    }
  }, [draftId, loadDraft]);

  useEffect(() => {
    if (!state.isDirty || state.isSaving || state.isSending) {
      return;
    }

    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
    }

    autoSaveTimerRef.current = setTimeout(() => {
      saveDraft();
    }, AUTO_SAVE_DELAY_MS);

    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
    };
  }, [state.isDirty, state.isSaving, state.isSending, saveDraft]);

  return {
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
    reset,
    loadDraft
  };
}

export function useDrafts() {
  const { draftOperations } = useEmailApi();
  const [drafts, setDrafts] = useState<DraftListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchDrafts = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      if (!draftOperations) {
        throw new Error('Draft operations are unavailable');
      }

      const data = await draftOperations.fetchDrafts();
      setDrafts(data);
    } catch (err) {
      console.error('Failed to fetch drafts:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [draftOperations]);

  const deleteDraft = useCallback(
    async (id: string): Promise<boolean> => {
      try {
        if (!draftOperations) {
          throw new Error('Draft operations are unavailable');
        }

        const ok = await draftOperations.deleteDraft(id);
        if (!ok) {
          throw new Error('Failed to delete draft');
        }

        setDrafts((prev) => prev.filter((d) => d.id !== id));
        return true;
      } catch (err) {
        console.error('Failed to delete draft:', err);
        return false;
      }
    },
    [draftOperations]
  );

  return { drafts, loading, error, fetchDrafts, deleteDraft };
}
