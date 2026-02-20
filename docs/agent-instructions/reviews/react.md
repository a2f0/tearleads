# React Standards

## Component Organization

- **One component per file** - Split when a file exceeds ~300 lines
- **Colocated tests** - Component.tsx + Component.test.tsx side by side
- **Feature folders** - Group related components by feature, not type
- **Shared components** in `packages/*/src/components/ui/`

## Hooks

- **Custom hooks** for shared logic - extract when used in 2+ components
- **Dependency arrays** must be complete - ESLint should catch violations
- **Avoid inline objects** in dependency arrays - use useMemo or extract

```typescript
// BAD: Creates new object every render
useEffect(() => {
  fetchData(options);
}, [{ limit: 10, offset: page * 10 }]);  // Always triggers

// GOOD: Memoize or extract
const options = useMemo(() => ({ limit: 10, offset: page * 10 }), [page]);
useEffect(() => {
  fetchData(options);
}, [options]);
```

## Performance

```typescript
// Memoize expensive computations
const expensiveValue = useMemo(() => computeExpensive(data), [data]);

// Memoize callbacks passed to children
const handleClick = useCallback((id: string) => {
  dispatch(selectItem(id));
}, [dispatch]);

// Virtualize long lists (>100 items)
<VirtualList items={items} renderItem={...} />
```

## Accessibility (a11y)

### Input Font Size

**Critical**: Input fields must use 16px minimum font size to prevent iOS Safari auto-zoom:

```typescript
// GOOD: Uses text-base (16px)
<input className="text-base ..." />
<Input className="text-base ..." />

// BAD: Will cause iOS auto-zoom on focus
<input className="text-sm ..." />  // 14px - flag this
<input className="text-xs ..." />  // 12px - flag this
```

### ARIA Attributes

Use appropriate ARIA attributes for interactive elements:

```typescript
// Buttons with icons need labels
<button aria-label="Close dialog" onClick={onClose}>
  <XIcon />
</button>

// Expandable elements
<button
  aria-expanded={isOpen}
  aria-haspopup="menu"
  onClick={toggleMenu}
>
  Menu
</button>

// Dialogs
<div
  role="dialog"
  aria-labelledby="dialog-title"
  aria-modal="true"
>
  <h2 id="dialog-title">Settings</h2>
</div>
```

### Keyboard Navigation

Interactive elements must be keyboard accessible:

```typescript
// Handle Escape to close
useEffect(() => {
  const handleEscape = (e: KeyboardEvent) => {
    if (e.key === "Escape") onClose();
  };
  document.addEventListener("keydown", handleEscape);
  return () => document.removeEventListener("keydown", handleEscape);
}, [onClose]);

// Tree navigation with arrow keys
const handleKeyDown = (e: React.KeyboardEvent) => {
  switch (e.key) {
    case "ArrowDown": focusNext(); break;
    case "ArrowUp": focusPrevious(); break;
    case "Enter":
    case " ": selectItem(); break;
  }
};
```

## Error Boundaries

Wrap feature sections with error boundaries to prevent full-page crashes:

```typescript
// Use the shared ErrorBoundary component
import { ErrorBoundary } from "@/components/ui/ErrorBoundary";

function App() {
  return (
    <ErrorBoundary>
      <FeatureSection />
    </ErrorBoundary>
  );
}

// Programmatic error handling with ref
const errorBoundaryRef = useRef<ErrorBoundaryRef>(null);

const handleError = (error: Error) => {
  errorBoundaryRef.current?.setError(error);
};
```

## State Management

### Local vs Global State

```typescript
// Local state: UI-only concerns (open/closed, form values)
const [isOpen, setIsOpen] = useState(false);

// Lift state: When siblings need to share
// Parent owns state, passes down props

// Global state: Cross-cutting concerns (auth, theme, notifications)
// Use context or state management library
```

### Async State

Handle loading, error, and success states:

```typescript
// Pattern: Async operation with states
const [state, setState] = useState<{
  loading: boolean;
  error: string | null;
  data: T | null;
}>({ loading: false, error: null, data: null });

const fetchData = async () => {
  setState({ loading: true, error: null, data: null });
  try {
    const result = await api.getData();
    setState({ loading: false, error: null, data: result });
  } catch (e) {
    setState({ loading: false, error: getErrorMessage(e), data: null });
  }
};
```

## Forms

### Controlled Inputs

```typescript
// Controlled input pattern
const [value, setValue] = useState("");

<input
  value={value}
  onChange={(e) => setValue(e.target.value)}
  className="text-base"  // 16px minimum for iOS
/>
```

### Submit Handling

```typescript
// Disable submit while processing
const [submitting, setSubmitting] = useState(false);

const handleSubmit = async (e: React.FormEvent) => {
  e.preventDefault();
  if (submitting) return;

  setSubmitting(true);
  try {
    await api.submit(formData);
  } finally {
    setSubmitting(false);
  }
};

<button type="submit" disabled={submitting || !isValid}>
  {submitting ? "Saving..." : "Save"}
</button>
```

## Testing

- **React Testing Library** patterns - query by role, label, text
- **User-centric assertions** - test behavior, not implementation
- **MSW for API mocking** - handlers in `packages/*/src/mocks/`

### Query Priority

Use the most accessible query:

```typescript
// Preferred order (most to least accessible):
screen.getByRole("button", { name: "Submit" });  // Best
screen.getByLabelText("Email");
screen.getByPlaceholderText("Search...");
screen.getByText("Welcome");
screen.getByTestId("custom-element");  // Last resort
```

### Async Testing

```typescript
import userEvent from "@testing-library/user-event";

it("submits form on click", async () => {
  const user = userEvent.setup();
  const onSubmit = vi.fn();

  render(<Form onSubmit={onSubmit} />);

  await user.type(screen.getByLabelText("Name"), "John");
  await user.click(screen.getByRole("button", { name: "Submit" }));

  expect(onSubmit).toHaveBeenCalledWith({ name: "John" });
});
```

## Review Checklist

- [ ] One component per file
- [ ] Test file colocated with component
- [ ] Input fields use text-base (16px) minimum
- [ ] Interactive elements have ARIA labels
- [ ] Keyboard navigation for custom widgets
- [ ] Error boundaries around feature sections
- [ ] Loading/error states for async operations
- [ ] Dependency arrays are complete
