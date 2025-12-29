import { and, asc, desc, eq, type InferSelectModel } from 'drizzle-orm';
import {
  ArrowLeft,
  Cake,
  Calendar,
  Database,
  Loader2,
  Mail,
  Phone,
  User
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getDatabase } from '@/db';
import { useDatabaseContext } from '@/db/hooks';
import { contactEmails, contactPhones, contacts } from '@/db/schema';

type ContactInfo = InferSelectModel<typeof contacts>;
type ContactEmail = InferSelectModel<typeof contactEmails>;
type ContactPhone = InferSelectModel<typeof contactPhones>;

function formatDate(date: Date): string {
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

export function ContactDetail() {
  const { id } = useParams<{ id: string }>();
  const { isUnlocked, isLoading } = useDatabaseContext();
  const [contact, setContact] = useState<ContactInfo | null>(null);
  const [emails, setEmails] = useState<ContactEmail[]>([]);
  const [phones, setPhones] = useState<ContactPhone[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchContact = useCallback(async () => {
    if (!isUnlocked || !id) return;

    setLoading(true);
    setError(null);

    try {
      const db = getDatabase();

      const [contactResult, emailsResult, phonesResult] = await Promise.all([
        db
          .select()
          .from(contacts)
          .where(and(eq(contacts.id, id), eq(contacts.deleted, false)))
          .limit(1),
        db
          .select()
          .from(contactEmails)
          .where(eq(contactEmails.contactId, id))
          .orderBy(desc(contactEmails.isPrimary), asc(contactEmails.email)),
        db
          .select()
          .from(contactPhones)
          .where(eq(contactPhones.contactId, id))
          .orderBy(
            desc(contactPhones.isPrimary),
            asc(contactPhones.phoneNumber)
          )
      ]);

      const foundContact = contactResult[0];
      if (!foundContact) {
        setError('Contact not found');
        return;
      }

      setContact(foundContact);
      setEmails(emailsResult);
      setPhones(phonesResult);
    } catch (err) {
      console.error('Failed to fetch contact:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [isUnlocked, id]);

  useEffect(() => {
    if (isUnlocked && id) {
      fetchContact();
    }
  }, [isUnlocked, id, fetchContact]);

  const displayName = contact
    ? `${contact.firstName}${contact.lastName ? ` ${contact.lastName}` : ''}`
    : '';

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link
          to="/contacts"
          className="inline-flex items-center text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Contacts
        </Link>
      </div>

      {isLoading && (
        <div className="rounded-lg border p-8 text-center text-muted-foreground">
          Loading database...
        </div>
      )}

      {!isLoading && !isUnlocked && (
        <div className="rounded-lg border p-8 text-center">
          <Database className="mx-auto h-12 w-12 text-muted-foreground/50" />
          <p className="mt-4 text-muted-foreground">
            Database is locked. Unlock it from the SQLite page to view this
            contact.
          </p>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-destructive bg-destructive/10 p-4 text-destructive text-sm">
          {error}
        </div>
      )}

      {isUnlocked && loading && (
        <div className="flex items-center justify-center gap-2 rounded-lg border p-8 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          Loading contact...
        </div>
      )}

      {isUnlocked && !loading && !error && contact && (
        <div className="space-y-6">
          <div className="flex items-center gap-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
              <User className="h-8 w-8 text-muted-foreground" />
            </div>
            <div>
              <h1 className="font-bold text-2xl tracking-tight">
                {displayName}
              </h1>
              {contact.birthday && (
                <p className="mt-1 flex items-center gap-1 text-muted-foreground text-sm">
                  <Cake className="h-4 w-4" />
                  {contact.birthday}
                </p>
              )}
            </div>
          </div>

          {emails.length > 0 && (
            <div className="rounded-lg border">
              <div className="border-b px-4 py-3">
                <h2 className="font-semibold">Email Addresses</h2>
              </div>
              <div className="divide-y">
                {emails.map((email) => (
                  <div
                    key={email.id}
                    className="flex items-center gap-3 px-4 py-3"
                  >
                    <Mail className="h-4 w-4 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <a
                        href={`mailto:${email.email}`}
                        className="text-sm hover:underline"
                      >
                        {email.email}
                      </a>
                      {email.label && (
                        <span className="ml-2 text-muted-foreground text-xs">
                          ({email.label})
                        </span>
                      )}
                    </div>
                    {email.isPrimary && (
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-primary text-xs">
                        Primary
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {phones.length > 0 && (
            <div className="rounded-lg border">
              <div className="border-b px-4 py-3">
                <h2 className="font-semibold">Phone Numbers</h2>
              </div>
              <div className="divide-y">
                {phones.map((phone) => (
                  <div
                    key={phone.id}
                    className="flex items-center gap-3 px-4 py-3"
                  >
                    <Phone className="h-4 w-4 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <a
                        href={`tel:${phone.phoneNumber}`}
                        className="text-sm hover:underline"
                      >
                        {phone.phoneNumber}
                      </a>
                      {phone.label && (
                        <span className="ml-2 text-muted-foreground text-xs">
                          ({phone.label})
                        </span>
                      )}
                    </div>
                    {phone.isPrimary && (
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-primary text-xs">
                        Primary
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="rounded-lg border">
            <div className="border-b px-4 py-3">
              <h2 className="font-semibold">Details</h2>
            </div>
            <div className="divide-y">
              <div className="flex items-center gap-3 px-4 py-3">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <span className="text-muted-foreground text-sm">Created</span>
                <span className="ml-auto text-sm">
                  {formatDate(contact.createdAt)}
                </span>
              </div>
              <div className="flex items-center gap-3 px-4 py-3">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <span className="text-muted-foreground text-sm">Updated</span>
                <span className="ml-auto text-sm">
                  {formatDate(contact.updatedAt)}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
