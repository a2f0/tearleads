import { WindowSidebarProvider } from '@tearleads/window-manager';
import { fireEvent, render, screen } from '@testing-library/react';
import { TagSidebar } from './TagSidebar';

function setViewportWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    writable: true,
    value: width
  });
}

describe('TagSidebar rendering', () => {
  afterEach(() => {
    setViewportWidth(1024);
  });

  it('renders empty state with clickable silhouette', () => {
    const onCreateTag = vi.fn();

    render(
      <TagSidebar
        tags={[]}
        activeTagId={null}
        onSelectTag={() => {}}
        onMoveTag={() => {}}
        onReorderTag={() => {}}
        onCreateTag={onCreateTag}
        searchValue=""
        onSearchChange={() => {}}
      />
    );

    const silhouette = screen.getByLabelText('Create new tag');
    expect(silhouette).toBeInTheDocument();

    fireEvent.click(silhouette);
    expect(onCreateTag).toHaveBeenCalledTimes(1);
  });

  it('renders tags and emits events', () => {
    const onSelectTag = vi.fn();
    const onMoveTag = vi.fn();

    render(
      <TagSidebar
        tags={[
          { id: 'tag-1', name: 'Work' },
          { id: 'tag-2', name: 'Personal' }
        ]}
        activeTagId="tag-2"
        onSelectTag={onSelectTag}
        onMoveTag={onMoveTag}
        onReorderTag={() => {}}
        searchValue=""
        onSearchChange={() => {}}
      />
    );

    fireEvent.click(screen.getByLabelText('Select tag Work'));
    expect(onSelectTag).toHaveBeenCalledWith('tag-1');

    fireEvent.contextMenu(screen.getByLabelText('Select tag Work'));
    fireEvent.click(screen.getByLabelText('Move tag Work down'));
    expect(onMoveTag).toHaveBeenCalledWith('tag-1', 'down');

    fireEvent.contextMenu(screen.getByLabelText('Select tag Personal'));
    fireEvent.click(screen.getByLabelText('Move tag Personal up'));
    expect(onMoveTag).toHaveBeenCalledWith('tag-2', 'up');

    fireEvent.contextMenu(screen.getByLabelText('Select tag Work'));
    expect(screen.queryByLabelText('Move tag Work up')).not.toBeInTheDocument();
    fireEvent.contextMenu(screen.getByLabelText('Select tag Personal'));
    expect(
      screen.queryByLabelText('Move tag Personal down')
    ).not.toBeInTheDocument();
  });

  it('renders left-side drag handles for tags', () => {
    render(
      <TagSidebar
        tags={[
          { id: 'tag-1', name: 'Work' },
          { id: 'tag-2', name: 'Personal' }
        ]}
        activeTagId={null}
        onSelectTag={() => {}}
        onMoveTag={() => {}}
        onReorderTag={() => {}}
        searchValue=""
        onSearchChange={() => {}}
      />
    );

    expect(screen.getAllByTitle('Drag tag')).toHaveLength(2);
  });

  it('renders search input and calls onSearchChange', () => {
    const onSearchChange = vi.fn();

    render(
      <TagSidebar
        tags={[{ id: 'tag-1', name: 'Work' }]}
        activeTagId={null}
        onSelectTag={() => {}}
        onMoveTag={() => {}}
        onReorderTag={() => {}}
        searchValue="test"
        onSearchChange={onSearchChange}
      />
    );

    expect(screen.getByDisplayValue('test')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Search tags'), {
      target: { value: 'work' }
    });

    expect(onSearchChange).toHaveBeenCalledWith('work');
  });

  it('uses a distinct background for active tags', () => {
    render(
      <TagSidebar
        tags={[
          { id: 'tag-1', name: 'Work' },
          { id: 'tag-2', name: 'Personal' }
        ]}
        activeTagId="tag-1"
        onSelectTag={() => {}}
        onMoveTag={() => {}}
        onReorderTag={() => {}}
        searchValue=""
        onSearchChange={() => {}}
      />
    );

    const activeTagItem = screen
      .getByLabelText('Select tag Work')
      .closest('li');
    if (!activeTagItem) throw new Error('Expected active tag list item');
    expect(activeTagItem).toHaveClass('bg-accent');
    expect(activeTagItem).not.toHaveClass('bg-primary/20');
  });

  it('displays note counts for tags when provided', () => {
    render(
      <TagSidebar
        tags={[
          { id: 'tag-1', name: 'Work' },
          { id: 'tag-2', name: 'Personal' }
        ]}
        activeTagId={null}
        noteCountByTagId={{ 'tag-1': 5, 'tag-2': 0 }}
        onSelectTag={() => {}}
        onMoveTag={() => {}}
        onReorderTag={() => {}}
        searchValue=""
        onSearchChange={() => {}}
      />
    );

    expect(screen.getByText('Work (5)')).toBeInTheDocument();
    expect(screen.getByText('Personal (0)')).toBeInTheDocument();
  });

  it('adds footer-clearing bottom padding in mobile drawer', () => {
    render(
      <WindowSidebarProvider
        value={{ closeSidebar: () => {}, isMobileDrawer: true }}
      >
        <TagSidebar
          tags={[{ id: 'tag-1', name: 'Work' }]}
          activeTagId={null}
          onSelectTag={() => {}}
          onMoveTag={() => {}}
          onReorderTag={() => {}}
          searchValue=""
          onSearchChange={() => {}}
        />
      </WindowSidebarProvider>
    );

    const container = screen.getByTestId('tag-sidebar-search-container');
    expect(container.style.paddingBottom).toContain('56px');
    expect(container.style.paddingBottom).toContain('safe-area-inset-bottom');
  });
});
