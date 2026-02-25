import { useCallback, useState } from 'react';
import { useEmailApi } from '../context';
import type { EmailItem } from '../lib';

export function useEmails() {
  const { apiBaseUrl, getAuthHeader } = useEmailApi();
  const [emails, setEmails] = useState<EmailItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchEmails = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const authHeader = getAuthHeader?.();
      const response = await fetch(
        `${apiBaseUrl}/vfs/emails`,
        authHeader ? { headers: { Authorization: authHeader } } : {}
      );
      if (!response.ok) {
        throw new Error(`Failed to fetch emails: ${response.statusText}`);
      }
      const data = await response.json();
      setEmails(data.emails ?? []);
    } catch (err) {
      console.error('Failed to fetch emails:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [apiBaseUrl, getAuthHeader]);

  return { emails, loading, error, fetchEmails };
}
