import { useTranslation } from 'react-i18next';

interface TagSidebarSearchInputProps {
  searchInputRef: React.RefObject<HTMLInputElement | null>;
  searchValue: string;
  onSearchChange: (value: string) => void;
  onSearchKeyDown?:
    | ((event: React.KeyboardEvent<HTMLInputElement>) => void)
    | undefined;
}

export function TagSidebarSearchInput({
  searchInputRef,
  searchValue,
  onSearchChange,
  onSearchKeyDown
}: TagSidebarSearchInputProps) {
  const { t } = useTranslation('classic');

  return (
    <input
      ref={searchInputRef}
      type="text"
      value={searchValue}
      onChange={(event) => onSearchChange(event.target.value)}
      onKeyDown={onSearchKeyDown}
      className="box-border w-full border border-border px-2 py-1 text-sm focus:border-ring focus:outline-none"
      aria-label={t('searchTags')}
    />
  );
}
