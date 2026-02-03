import { createMarkdownToolbarFilter } from '@rapid/notes';
import MDEditor, { commands } from '@uiw/react-md-editor';
import { zIndex } from '@/constants/zIndex';

const markdownToolbarCommandsFilter = createMarkdownToolbarFilter(
  zIndex.tooltip
);

interface MarkdownEditorProps {
  value: string;
  onChange: (value: string | undefined) => void;
  colorMode: 'light' | 'dark';
  hideToolbar?: boolean;
}

export function MarkdownEditor({
  value,
  onChange,
  colorMode,
  hideToolbar = false
}: MarkdownEditorProps) {
  return (
    <MDEditor
      value={value}
      onChange={onChange}
      height="100%"
      preview="edit"
      hideToolbar={hideToolbar}
      visibleDragbar={false}
      commandsFilter={markdownToolbarCommandsFilter}
      extraCommands={[
        commands.codeEdit,
        commands.codePreview,
        commands.divider,
        commands.fullscreen
      ]}
      data-color-mode={colorMode}
    />
  );
}
