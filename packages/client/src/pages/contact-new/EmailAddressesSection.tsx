import { Mail, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { EmailFormData } from './types';

interface EmailAddressesSectionProps {
  emailsForm: EmailFormData[];
  onEmailChange: (
    emailId: string,
    field: keyof EmailFormData,
    value: string | boolean
  ) => void;
  onEmailPrimaryChange: (emailId: string) => void;
  onDeleteEmail: (emailId: string) => void;
  onAddEmail: () => void;
}

export function EmailAddressesSection({
  emailsForm,
  onEmailChange,
  onEmailPrimaryChange,
  onDeleteEmail,
  onAddEmail
}: EmailAddressesSectionProps) {
  return (
    <div className="rounded-lg border">
      <div className="border-b px-4 py-3">
        <h2 className="font-semibold">Email Addresses</h2>
      </div>
      <div className="divide-y">
        {emailsForm.map((email) => (
          <div key={email.id} className="space-y-3 px-4 py-3">
            <div className="flex items-center gap-2">
              <Mail className="h-4 w-4 shrink-0 text-muted-foreground" />
              <Input
                type="email"
                value={email.email}
                onChange={(e) =>
                  onEmailChange(email.id, 'email', e.target.value)
                }
                placeholder="Email address"
                className="min-w-0 flex-1"
                data-testid={`new-email-${email.id}`}
              />
            </div>
            <div className="flex flex-wrap items-center gap-2 pl-6">
              <Input
                type="text"
                value={email.label}
                onChange={(e) =>
                  onEmailChange(email.id, 'label', e.target.value)
                }
                placeholder="Label (e.g., Work)"
                className="w-full sm:w-32"
                data-testid={`new-email-label-${email.id}`}
              />
              <label className="flex shrink-0 items-center gap-1.5 text-sm">
                <input
                  type="radio"
                  name="primaryEmail"
                  checked={email.isPrimary}
                  onChange={() => onEmailPrimaryChange(email.id)}
                  className="h-4 w-4"
                />
                Primary
              </label>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onDeleteEmail(email.id)}
                className="ml-auto text-destructive hover:bg-destructive/10 hover:text-destructive"
                data-testid={`delete-email-${email.id}`}
              >
                <Trash2 className="mr-1 h-4 w-4" />
                Remove
              </Button>
            </div>
          </div>
        ))}
      </div>
      <div className="border-t px-4 py-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={onAddEmail}
          data-testid="add-email-button"
        >
          <Plus className="mr-2 h-4 w-4" />
          Add Email
        </Button>
      </div>
    </div>
  );
}
