# Accessibility (a11y) Standards

Ensure all UI components are usable by people with disabilities, including screen reader users and keyboard-only users.

## Input Font Size (Critical)

**iOS Safari auto-zooms on inputs smaller than 16px.** This breaks the user experience.

```typescript
// GOOD: 16px minimum (text-base in Tailwind)
<input className="text-base ..." />
<textarea className="text-base ..." />
<select className="text-base ..." />

// BAD: Causes iOS auto-zoom
<input className="text-sm ..." />  // 14px - flag this
<input className="text-xs ..." />  // 12px - flag this
```

## Semantic HTML

Use semantic elements instead of generic `<div>` with ARIA:

```typescript
// GOOD: Semantic elements
<button onClick={onClick}>Submit</button>
<nav><a href="/home">Home</a></nav>
<main>Content</main>
<header>Header</header>
<footer>Footer</footer>

// BAD: Div soup
<div onClick={onClick}>Submit</div>  // Not focusable, no keyboard support
<div role="button" tabIndex={0}>Submit</div>  // Reinventing the wheel
```

## ARIA Attributes

### Labels

Every interactive element needs an accessible name:

```typescript
// Icon buttons need aria-label
<button aria-label="Close dialog" onClick={onClose}>
  <XIcon />
</button>

// Form inputs need labels
<label htmlFor="email">Email</label>
<input id="email" type="email" />

// Or use aria-label for visually hidden labels
<input aria-label="Search" type="search" />
```

### States

Communicate component state to assistive technology:

```typescript
// Expandable elements
<button
  aria-expanded={isOpen}
  aria-controls="dropdown-menu"
  onClick={toggle}
>
  Menu
</button>
<div id="dropdown-menu" hidden={!isOpen}>
  {/* menu items */}
</div>

// Loading states
<button aria-busy={isLoading} disabled={isLoading}>
  {isLoading ? "Saving..." : "Save"}
</button>

// Selected items
<li aria-selected={isSelected} role="option">
  {item.name}
</li>
```

### Dialogs

```typescript
<div
  role="dialog"
  aria-modal="true"
  aria-labelledby="dialog-title"
  aria-describedby="dialog-description"
>
  <h2 id="dialog-title">Confirm Delete</h2>
  <p id="dialog-description">
    This action cannot be undone.
  </p>
  <button onClick={onConfirm}>Delete</button>
  <button onClick={onCancel}>Cancel</button>
</div>
```

## Keyboard Navigation

### Focus Management

```typescript
// Trap focus in modals
useEffect(() => {
  if (!isOpen) return;

  const dialog = dialogRef.current;
  const focusable = dialog?.querySelectorAll<HTMLElement>(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  );
  if (!focusable || focusable.length === 0) return;

  const first = focusable[0];
  const last = focusable[focusable.length - 1];

  first.focus();

  const handleTab = (e: KeyboardEvent) => {
    if (e.key !== "Tab") return;

    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last?.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first?.focus();
    }
  };

  document.addEventListener("keydown", handleTab);
  return () => document.removeEventListener("keydown", handleTab);
}, [isOpen]);
```

### Escape to Close

```typescript
// Modals, dropdowns, and overlays should close on Escape
useEffect(() => {
  const handleEscape = (e: KeyboardEvent) => {
    if (e.key === "Escape") onClose();
  };

  document.addEventListener("keydown", handleEscape);
  return () => document.removeEventListener("keydown", handleEscape);
}, [onClose]);
```

### Arrow Key Navigation

```typescript
// Lists, menus, and trees use arrow keys
const handleKeyDown = (e: React.KeyboardEvent) => {
  switch (e.key) {
    case "ArrowDown":
      e.preventDefault();
      focusNext();
      break;
    case "ArrowUp":
      e.preventDefault();
      focusPrevious();
      break;
    case "Home":
      e.preventDefault();
      focusFirst();
      break;
    case "End":
      e.preventDefault();
      focusLast();
      break;
    case "Enter":
    case " ":
      e.preventDefault();
      selectCurrent();
      break;
  }
};
```

## Color and Contrast

### Contrast Ratios

- **Normal text**: 4.5:1 minimum contrast ratio
- **Large text** (18px+ or 14px+ bold): 3:1 minimum
- **UI components**: 3:1 minimum for boundaries and states

### Don't Rely on Color Alone

```typescript
// BAD: Color is only indicator
<span className={isError ? "text-red-500" : "text-green-500"}>
  {message}
</span>

// GOOD: Color + icon/text
<span className={isError ? "text-red-500" : "text-green-500"}>
  {isError ? "❌ " : "✓ "}{message}
</span>

// Or use aria-live for dynamic messages
<div role="alert" aria-live="polite">
  {errorMessage}
</div>
```

## Focus Indicators

Never remove focus outlines without replacement:

```typescript
// BAD: Removes focus visibility
<button className="focus:outline-none" />

// GOOD: Custom focus ring
<button className="focus:outline-none focus:ring-2 focus:ring-blue-500" />

// Or use focus-visible for keyboard-only
<button className="focus-visible:ring-2 focus-visible:ring-blue-500" />
```

## Testing Accessibility

### Query Priority

React Testing Library queries match accessibility:

```typescript
// Best: Matches how screen readers see elements
screen.getByRole("button", { name: "Submit" });
screen.getByRole("textbox", { name: "Email" });
screen.getByRole("dialog");

// Good: Form labels
screen.getByLabelText("Email");

// OK: Visible text
screen.getByText("Welcome");

// Last resort: Test IDs
screen.getByTestId("custom-widget");
```

### Test Keyboard Interaction

```typescript
it("closes dialog on Escape", async () => {
  const onClose = vi.fn();
  render(<Dialog isOpen onClose={onClose} />);

  fireEvent.keyDown(document, { key: "Escape" });

  expect(onClose).toHaveBeenCalled();
});

it("navigates list with arrow keys", async () => {
  render(<List items={["A", "B", "C"]} />);

  const list = screen.getByRole("listbox");
  fireEvent.keyDown(list, { key: "ArrowDown" });

  expect(screen.getByRole("option", { name: "A" }))
    .toHaveAttribute("aria-selected", "true");
});
```

### Test ARIA Attributes

```typescript
it("has correct ARIA attributes when expanded", async () => {
  render(<Dropdown />);

  const trigger = screen.getByRole("button");
  expect(trigger).toHaveAttribute("aria-expanded", "false");

  await userEvent.click(trigger);

  expect(trigger).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByRole("menu")).toBeVisible();
});
```

## Review Checklist

- [ ] Input fields use text-base (16px) minimum
- [ ] Interactive elements have accessible names (aria-label or visible label)
- [ ] Icon buttons have aria-label
- [ ] Dialogs have aria-modal, aria-labelledby
- [ ] Expandable elements have aria-expanded
- [ ] Focus is managed in modals (trapped, restored on close)
- [ ] Escape closes modals/dropdowns
- [ ] Arrow keys work for list/menu navigation
- [ ] Focus indicators are visible
- [ ] Color is not the only indicator of state
- [ ] Tests use getByRole queries
