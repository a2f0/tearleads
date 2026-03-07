import type { EmailItem } from './email';
import { formatEmailDate } from './email';

export type ComposeMode = 'new' | 'reply' | 'replyAll' | 'forward';

export interface ComposeRequestFields {
  to: string[];
  cc?: string[];
  subject: string;
  body: string;
  composeMode: ComposeMode;
}

export function buildComposeRequest(
  email: EmailItem,
  bodyText: string,
  mode: ComposeMode
): ComposeRequestFields {
  if (mode === 'reply') {
    return {
      to: [email.from],
      subject: buildReplySubject(email.subject),
      body: buildReplyBody(bodyText, email),
      composeMode: 'reply'
    };
  }
  if (mode === 'replyAll') {
    return {
      to: [email.from, ...email.to],
      cc: email.cc ?? [],
      subject: buildReplySubject(email.subject),
      body: buildReplyBody(bodyText, email),
      composeMode: 'replyAll'
    };
  }
  return {
    to: [],
    subject: buildForwardSubject(email.subject),
    body: buildForwardBody(bodyText, email),
    composeMode: 'forward'
  };
}

export function buildReplySubject(subject: string): string {
  const trimmed = subject.trim();
  if (/^re:/i.test(trimmed)) {
    return trimmed;
  }
  return `Re: ${trimmed}`;
}

export function buildForwardSubject(subject: string): string {
  const trimmed = subject.trim();
  if (/^fwd:/i.test(trimmed)) {
    return trimmed;
  }
  return `Fwd: ${trimmed}`;
}

function quoteLines(text: string): string {
  return text
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
}

export function buildReplyBody(originalBody: string, email: EmailItem): string {
  const dateStr = formatEmailDate(email.receivedAt);
  const header = `On ${dateStr}, ${email.from} wrote:`;
  return `\n\n${header}\n${quoteLines(originalBody)}`;
}

export function buildForwardBody(
  originalBody: string,
  email: EmailItem
): string {
  const lines = [
    '',
    '',
    '---------- Forwarded message ----------',
    `From: ${email.from}`,
    `Date: ${formatEmailDate(email.receivedAt)}`,
    `Subject: ${email.subject}`,
    `To: ${email.to.join(', ')}`
  ];

  if (email.cc && email.cc.length > 0) {
    lines.push(`Cc: ${email.cc.join(', ')}`);
  }

  lines.push('', originalBody);
  return lines.join('\n');
}
