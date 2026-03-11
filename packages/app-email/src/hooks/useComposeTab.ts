import { useCallback, useEffect, useState } from 'react';
import type { ComposeOpenRequest } from '../components/EmailWindowContent.js';
import type { EmailItem } from '../lib/email.js';
import type { ComposeMode } from '../lib/quoteText.js';
import { buildComposeRequest } from '../lib/quoteText.js';

type MainTab = 'inbox' | 'compose';

const COMPOSE_MODE_TAB_LABELS: Record<ComposeMode, string> = {
  new: 'New Message',
  reply: 'Reply',
  replyAll: 'Reply All',
  forward: 'Forward'
};

interface UseComposeTabOptions {
  selectedEmail: EmailItem | undefined;
  emailBodyText: string;
  openComposeRequest: ComposeOpenRequest | undefined;
  openEmailId: string | null | undefined;
  openRequestId: number | undefined;
  fetchEmails: () => void;
  setSelectedEmailId: (id: string | null) => void;
}

export function useComposeTab({
  selectedEmail,
  emailBodyText,
  openComposeRequest: externalRequest,
  openEmailId,
  openRequestId,
  fetchEmails,
  setSelectedEmailId
}: UseComposeTabOptions) {
  const [activeTab, setActiveTab] = useState<MainTab>('inbox');
  const [isComposeTabOpen, setIsComposeTabOpen] = useState(false);
  const [composeOpenRequest, setComposeOpenRequest] =
    useState<ComposeOpenRequest | null>(null);
  const [composeRequestCounter, setComposeRequestCounter] = useState(0);

  const closeComposeTab = useCallback(() => {
    setIsComposeTabOpen(false);
    setActiveTab('inbox');
  }, []);

  const handleCompose = useCallback(() => {
    setComposeOpenRequest(null);
    setIsComposeTabOpen(true);
    setActiveTab('compose');
  }, []);

  const openComposeWith = useCallback(
    (email: EmailItem, body: string, mode: ComposeMode) => {
      const fields = buildComposeRequest(email, body, mode);
      setComposeRequestCounter((c) => c + 1);
      setComposeOpenRequest({
        ...fields,
        requestId: composeRequestCounter + 1
      });
      setSelectedEmailId(null);
      setIsComposeTabOpen(true);
      setActiveTab('compose');
    },
    [composeRequestCounter, setSelectedEmailId]
  );

  const openComposeForMode = useCallback(
    (mode: ComposeMode) => {
      if (!selectedEmail) return;
      openComposeWith(selectedEmail, emailBodyText, mode);
    },
    [selectedEmail, emailBodyText, openComposeWith]
  );

  const handleComposeForEmail = useCallback(
    (email: EmailItem, mode: ComposeMode) => openComposeWith(email, '', mode),
    [openComposeWith]
  );

  const handleEmailSent = useCallback(() => {
    fetchEmails();
    closeComposeTab();
  }, [fetchEmails, closeComposeTab]);

  useEffect(() => {
    if (!externalRequest) return;
    setComposeOpenRequest(externalRequest);
    setSelectedEmailId(null);
    setIsComposeTabOpen(true);
    setActiveTab('compose');
  }, [externalRequest, setSelectedEmailId]);

  useEffect(() => {
    if (!openRequestId || !openEmailId) return;
    setSelectedEmailId(openEmailId);
    setIsComposeTabOpen(false);
    setActiveTab('inbox');
  }, [openEmailId, openRequestId, setSelectedEmailId]);

  const composeLabel =
    COMPOSE_MODE_TAB_LABELS[composeOpenRequest?.composeMode ?? 'new'];

  return {
    activeTab,
    setActiveTab,
    isComposeTabOpen,
    composeOpenRequest,
    composeLabel,
    closeComposeTab,
    handleCompose,
    openComposeForMode,
    handleComposeForEmail,
    handleEmailSent
  };
}
