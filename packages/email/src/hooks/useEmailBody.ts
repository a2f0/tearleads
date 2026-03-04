import { useCallback, useEffect, useRef, useState } from 'react';
import {
  useEmailContext,
  useHasEmailBodyOperations
} from '../context/EmailContext.js';
import { parseMimeMessage } from '../lib/mimeParser.js';
import type { EmailBodyViewMode, ParsedEmailBody } from '../types/emailBody.js';

interface UseEmailBodyResult {
  body: ParsedEmailBody | null;
  loading: boolean;
  error: string | null;
  viewMode: EmailBodyViewMode;
  setViewMode: (mode: EmailBodyViewMode) => void;
}

export function useEmailBody(emailId: string | null): UseEmailBodyResult {
  const { bodyOperations } = useEmailContext();
  const hasBodyOps = useHasEmailBodyOperations();
  const [body, setBody] = useState<ParsedEmailBody | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<EmailBodyViewMode>('text');
  const cacheRef = useRef<Map<string, ParsedEmailBody>>(new Map());

  const fetchAndParse = useCallback(
    async (id: string) => {
      const cached = cacheRef.current.get(id);
      if (cached) {
        setBody(cached);
        setViewMode(cached.html ? 'html' : 'text');
        setError(null);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const rawMime = await bodyOperations!.fetchDecryptedBody(id);
        const parsed = await parseMimeMessage(rawMime);
        cacheRef.current.set(id, parsed);
        setBody(parsed);
        setViewMode(parsed.html ? 'html' : 'text');
      } catch (err) {
        console.error('Failed to fetch email body:', err);
        setError(err instanceof Error ? err.message : String(err));
        setBody(null);
      } finally {
        setLoading(false);
      }
    },
    [bodyOperations]
  );

  useEffect(() => {
    if (!emailId) {
      setBody(null);
      setError(null);
      setLoading(false);
      return;
    }

    if (!hasBodyOps) {
      setError('Email body operations are not configured');
      return;
    }

    void fetchAndParse(emailId);
  }, [emailId, hasBodyOps, fetchAndParse]);

  return { body, loading, error, viewMode, setViewMode };
}
