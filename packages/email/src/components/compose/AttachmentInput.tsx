import { Paperclip } from 'lucide-react';
import { useCallback, useRef } from 'react';

interface AttachmentInputProps {
  onFileSelected: (file: File) => void;
  disabled?: boolean;
  maxSizeMB?: number;
}

export function AttachmentInput({
  onFileSelected,
  disabled = false,
  maxSizeMB = 25
}: AttachmentInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleClick = useCallback(() => {
    inputRef.current?.click();
  }, []);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        const maxBytes = maxSizeMB * 1024 * 1024;
        if (file.size > maxBytes) {
          alert(`File size exceeds ${maxSizeMB}MB limit`);
          return;
        }
        onFileSelected(file);
      }
      if (inputRef.current) {
        inputRef.current.value = '';
      }
    },
    [onFileSelected, maxSizeMB]
  );

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        onChange={handleChange}
        className="hidden"
        aria-label="Attach file"
        data-testid="attachment-file-input"
      />
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled}
        className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50"
        title="Attach file"
        data-testid="attachment-button"
      >
        <Paperclip className="h-4 w-4" />
        Attach
      </button>
    </>
  );
}
