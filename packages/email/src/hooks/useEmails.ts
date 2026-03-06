import { VFS_V2_GET_EMAILS_CONNECT_PATH } from '@tearleads/shared';
import { useCallback, useState } from 'react';
import { useEmailApi } from '../context';
import type { EmailItem } from '../lib';

const DEFAULT_GET_EMAILS_LIMIT = 50;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  if (!Array.isArray(value)) {
    return false;
  }

  for (const entry of value) {
    if (typeof entry !== 'string') {
      return false;
    }
  }

  return true;
}

function isEmailItem(value: unknown): value is EmailItem {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value['id'] === 'string' &&
    typeof value['from'] === 'string' &&
    isStringArray(value['to']) &&
    typeof value['subject'] === 'string' &&
    typeof value['receivedAt'] === 'string' &&
    typeof value['size'] === 'number'
  );
}

function unwrapConnectJsonEnvelope(payload: unknown): unknown {
  if (!isRecord(payload)) {
    return payload;
  }

  const json = payload['json'];
  if (typeof json !== 'string') {
    return payload;
  }

  if (json.trim().length === 0) {
    return {};
  }

  try {
    return JSON.parse(json);
  } catch {
    throw new Error('Invalid email payload from server');
  }
}

function readEmailsFromPayload(payload: unknown): EmailItem[] {
  const normalized = unwrapConnectJsonEnvelope(payload);
  if (!isRecord(normalized)) {
    return [];
  }

  const emails = normalized['emails'];
  if (!Array.isArray(emails)) {
    return [];
  }

  return emails.filter(isEmailItem);
}

function readErrorField(value: unknown): string | null {
  if (!isRecord(value)) {
    return null;
  }

  if (typeof value['error'] === 'string' && value['error'].length > 0) {
    return value['error'];
  }

  if (typeof value['message'] === 'string' && value['message'].length > 0) {
    return value['message'];
  }

  return null;
}

async function getFetchErrorDetail(response: Response): Promise<string> {
  try {
    const payload: unknown = await response.json();
    const bodyMessage = readErrorField(payload);
    if (bodyMessage) {
      return bodyMessage;
    }
  } catch {
    // Keep fallback behavior if body parsing fails.
  }

  if (response.statusText.trim().length > 0) {
    return response.statusText;
  }

  return `API error: ${String(response.status)}`;
}

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
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(authHeader ? { Authorization: authHeader } : {})
      };

      const response = await fetch(
        `${apiBaseUrl}${VFS_V2_GET_EMAILS_CONNECT_PATH}`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            offset: 0,
            limit: DEFAULT_GET_EMAILS_LIMIT
          })
        }
      );
      if (!response.ok) {
        const detail = await getFetchErrorDetail(response);
        throw new Error(`Failed to fetch emails: ${detail}`);
      }
      const payload: unknown = await response.json();
      setEmails(readEmailsFromPayload(payload));
    } catch (err) {
      console.error('Failed to fetch emails:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [apiBaseUrl, getAuthHeader]);

  return { emails, loading, error, fetchEmails };
}
