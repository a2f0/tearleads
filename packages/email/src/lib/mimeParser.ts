import DOMPurify from 'dompurify';
import PostalMime from 'postal-mime';
import type {
  EmailAttachmentPart,
  ParsedEmailBody
} from '../types/emailBody.js';

const ALLOWED_TAGS = [
  'a',
  'b',
  'blockquote',
  'br',
  'code',
  'div',
  'em',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'i',
  'img',
  'li',
  'ol',
  'p',
  'pre',
  'span',
  'strong',
  'table',
  'tbody',
  'td',
  'th',
  'thead',
  'tr',
  'u',
  'ul'
];

const ALLOWED_ATTRS = [
  'href',
  'src',
  'alt',
  'title',
  'class',
  'style',
  'width',
  'height',
  'colspan',
  'rowspan',
  'target'
];

function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR: ALLOWED_ATTRS,
    ALLOW_DATA_ATTR: false,
    ADD_ATTR: ['target'],
    FORBID_TAGS: ['script', 'iframe', 'form', 'object', 'embed'],
    FORBID_ATTR: [
      'onerror',
      'onclick',
      'onload',
      'onmouseover',
      'onfocus',
      'onblur'
    ]
  });
}

export async function parseMimeMessage(
  rawMime: string
): Promise<ParsedEmailBody> {
  const parsed = await PostalMime.parse(rawMime);

  const attachments: EmailAttachmentPart[] = (parsed.attachments ?? []).map(
    (att) => {
      let size = 0;
      if (att.content) {
        size =
          typeof att.content === 'string'
            ? att.content.length
            : att.content.byteLength;
      }
      return {
        filename: att.filename ?? 'untitled',
        mimeType: att.mimeType ?? 'application/octet-stream',
        size,
        contentId: att.contentId ?? null
      };
    }
  );

  const text = parsed.text ?? null;
  const html =
    typeof parsed.html === 'string' && parsed.html.length > 0
      ? sanitizeHtml(parsed.html)
      : null;

  return { text, html, attachments };
}
