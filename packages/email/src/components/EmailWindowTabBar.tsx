import { X } from 'lucide-react';

interface EmailWindowTabBarProps {
  activeTab: 'inbox' | 'compose';
  onTabChange: (tab: 'inbox' | 'compose') => void;
  selectedFolderName: string;
  isComposeTabOpen: boolean;
  onCloseCompose: () => void;
}

export function EmailWindowTabBar({
  activeTab,
  onTabChange,
  selectedFolderName,
  isComposeTabOpen,
  onCloseCompose
}: EmailWindowTabBarProps) {
  return (
    <div
      role="tablist"
      aria-label="Email panel tabs"
      className="flex shrink-0 border-b bg-muted/20 px-2"
    >
      <button
        type="button"
        role="tab"
        aria-selected={activeTab === 'inbox'}
        onClick={() => onTabChange('inbox')}
        className="rounded-t-md px-3 py-2 text-sm hover:bg-muted/50 data-[active=true]:bg-background data-[active=true]:font-medium"
        data-active={activeTab === 'inbox'}
        data-testid="email-tab-inbox"
      >
        {selectedFolderName}
      </button>
      {isComposeTabOpen && (
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'compose'}
          onClick={(e) => {
            if (
              e.target instanceof HTMLElement &&
              e.target.closest('[data-close-tab="true"]')
            ) {
              onCloseCompose();
              return;
            }
            onTabChange('compose');
          }}
          onKeyDown={(e) => {
            if (e.key === 'Delete' || e.key === 'Backspace') {
              e.preventDefault();
              onCloseCompose();
            }
          }}
          className="group flex items-center gap-2 rounded-t-md py-2 pr-2 pl-3 text-sm hover:bg-muted/50 data-[active=true]:bg-background data-[active=true]:font-medium"
          data-active={activeTab === 'compose'}
          data-testid="email-tab-compose"
        >
          New Message
          <span
            aria-hidden="true"
            data-close-tab="true"
            className="flex items-center justify-center rounded p-1 text-muted-foreground hover:bg-muted/80 hover:text-foreground"
            data-testid="email-tab-compose-close"
          >
            <X className="h-3.5 w-3.5" />
          </span>
        </button>
      )}
    </div>
  );
}
