import type { LucideIcon } from 'lucide-react';
import { Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface BaseFormItem {
  id: string;
  label: string;
  isPrimary: boolean;
  isDeleted?: boolean;
}

interface BaseDisplayItem {
  id: string;
  label: string | null;
  isPrimary: boolean;
}

interface ContactEditableListSectionProps<
  TDisplay extends BaseDisplayItem,
  TForm extends BaseFormItem
> {
  isEditing: boolean;
  items: TDisplay[];
  formItems: TForm[];
  icon: LucideIcon;
  sectionTitle: string;
  inputType: 'email' | 'tel';
  inputPlaceholder: string;
  addButtonLabel: string;
  primaryRadioName: string;
  valueField: keyof TForm;
  getDisplayValue: (item: TDisplay) => string;
  getLinkHref: (value: string) => string;
  testIdPrefix: string;
  onValueChange: (
    id: string,
    field: keyof TForm,
    value: string | boolean
  ) => void;
  onPrimaryChange: (id: string) => void;
  onDelete: (id: string) => void;
  onAdd: () => void;
}

export function ContactEditableListSection<
  TDisplay extends BaseDisplayItem,
  TForm extends BaseFormItem
>({
  isEditing,
  items,
  formItems,
  icon: Icon,
  sectionTitle,
  inputType,
  inputPlaceholder,
  addButtonLabel,
  primaryRadioName,
  valueField,
  getDisplayValue,
  getLinkHref,
  testIdPrefix,
  onValueChange,
  onPrimaryChange,
  onDelete,
  onAdd
}: ContactEditableListSectionProps<TDisplay, TForm>) {
  const { t } = useTranslation('contacts');

  if (isEditing) {
    return (
      <div className="rounded-lg border">
        <div className="border-b px-4 py-3">
          <h2 className="font-semibold">{sectionTitle}</h2>
        </div>
        <div className="divide-y">
          {formItems
            .filter((item) => !item.isDeleted)
            .map((item) => (
              <div key={item.id} className="flex items-center gap-2 px-4 py-3">
                <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                <Input
                  type={inputType}
                  value={String(item[valueField])}
                  onChange={(e) =>
                    onValueChange(item.id, valueField, e.target.value)
                  }
                  placeholder={inputPlaceholder}
                  className="min-w-0 flex-1"
                  data-testid={`edit-${testIdPrefix}-${item.id}`}
                />
                <Input
                  type="text"
                  value={item.label}
                  onChange={(e) =>
                    onValueChange(item.id, 'label', e.target.value)
                  }
                  placeholder={t('label')}
                  className="w-24"
                  data-testid={`edit-${testIdPrefix}-label-${item.id}`}
                />
                <label className="flex shrink-0 items-center gap-1 text-base">
                  <input
                    type="radio"
                    name={primaryRadioName}
                    checked={item.isPrimary}
                    onChange={() => onPrimaryChange(item.id)}
                    className="h-5 w-5"
                  />
                  {t('primary')}
                </label>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => onDelete(item.id)}
                  className="h-8 w-8 shrink-0"
                  data-testid={`delete-${testIdPrefix}-${item.id}`}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
        </div>
        <div className="border-t px-4 py-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={onAdd}
            data-testid={`add-${testIdPrefix}-button`}
          >
            <Plus className="mr-2 h-4 w-4" />
            {addButtonLabel}
          </Button>
        </div>
      </div>
    );
  }

  if (items.length === 0) {
    return null;
  }

  return (
    <div className="rounded-lg border">
      <div className="border-b px-4 py-3">
        <h2 className="font-semibold">{sectionTitle}</h2>
      </div>
      <div className="divide-y">
        {items.map((item) => {
          const displayValue = getDisplayValue(item);
          return (
            <div key={item.id} className="flex items-center gap-3 px-4 py-3">
              <Icon className="h-4 w-4 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <a
                  href={getLinkHref(displayValue)}
                  className="text-sm hover:underline"
                >
                  {displayValue}
                </a>
                {item.label && (
                  <span className="ml-2 text-muted-foreground text-xs">
                    ({item.label})
                  </span>
                )}
              </div>
              {item.isPrimary && (
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-primary text-xs">
                  {t('primary')}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
