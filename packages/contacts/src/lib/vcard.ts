/**
 * vCard 4.0 generation utilities per RFC 6350.
 */

export interface VCardEmail {
  email: string;
  label: string | null;
  isPrimary: boolean;
}

export interface VCardPhone {
  phoneNumber: string;
  label: string | null;
  isPrimary: boolean;
}

export interface VCardContact {
  id: string;
  firstName: string;
  lastName: string | null;
  birthday: string | null;
  emails: VCardEmail[];
  phones: VCardPhone[];
}

/**
 * Escape special characters per RFC 6350.
 * Backslash, semicolon, and comma need escaping.
 */
export function escapeValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,');
}

/**
 * Map application labels to vCard TYPE parameters.
 * Common labels: Work, Home, Mobile, Main, Other
 */
export function mapLabelToType(label: string | null): string | null {
  if (!label) return null;

  const normalized = label.toLowerCase().trim();
  switch (normalized) {
    case 'work':
      return 'work';
    case 'home':
      return 'home';
    case 'mobile':
    case 'cell':
      return 'cell';
    case 'main':
      return 'voice';
    case 'fax':
      return 'fax';
    case 'pager':
      return 'pager';
    case 'other':
      return null;
    default:
      return null;
  }
}

/**
 * Generate a single vCard 4.0 string for a contact.
 */
export function generateVCard(contact: VCardContact): string {
  const lines: string[] = [];

  lines.push('BEGIN:VCARD');
  lines.push('VERSION:4.0');

  // FN (formatted name) - required
  const fullName = contact.lastName
    ? `${contact.firstName} ${contact.lastName}`
    : contact.firstName;
  lines.push(`FN:${escapeValue(fullName)}`);

  // N (structured name)
  const lastName = escapeValue(contact.lastName ?? '');
  const firstName = escapeValue(contact.firstName);
  lines.push(`N:${lastName};${firstName};;;`);

  // BDAY (birthday) - format YYYYMMDD
  if (contact.birthday) {
    // Remove dashes if present (convert YYYY-MM-DD to YYYYMMDD)
    const bday = contact.birthday.replace(/-/g, '');
    lines.push(`BDAY:${bday}`);
  }

  // TEL (phone numbers)
  for (const phone of contact.phones) {
    const params: string[] = [];
    const type = mapLabelToType(phone.label);
    if (type) {
      params.push(`TYPE=${type}`);
    }
    if (phone.isPrimary) {
      params.push('PREF=1');
    }
    const paramStr = params.length > 0 ? `;${params.join(';')}` : '';
    lines.push(`TEL${paramStr}:${phone.phoneNumber}`);
  }

  // EMAIL (email addresses)
  for (const email of contact.emails) {
    const params: string[] = [];
    const type = mapLabelToType(email.label);
    if (type) {
      params.push(`TYPE=${type}`);
    }
    if (email.isPrimary) {
      params.push('PREF=1');
    }
    const paramStr = params.length > 0 ? `;${params.join(';')}` : '';
    lines.push(`EMAIL${paramStr}:${email.email}`);
  }

  lines.push('END:VCARD');

  return lines.join('\r\n');
}

/**
 * Generate a VCF file containing multiple vCards.
 * Per RFC 6350, multiple vCards are simply concatenated.
 */
export function generateVCards(contacts: VCardContact[]): string {
  return contacts.map(generateVCard).join('\r\n');
}

/**
 * Generate a filename for vCard export.
 * For single contact: "FirstName LastName.vcf"
 * For multiple contacts: "contacts-YYYY-MM-DD.vcf"
 */
export function generateVCardFilename(contacts: VCardContact[]): string {
  const [contact] = contacts;
  if (contacts.length === 1 && contact) {
    const name = contact.lastName
      ? `${contact.firstName} ${contact.lastName}`
      : contact.firstName;
    // Remove characters that are problematic in filenames
    const safeName = name.replace(/[<>:"/\\|?*]/g, '').trim();
    return `${safeName}.vcf`;
  }

  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `contacts-${year}-${month}-${day}.vcf`;
}
