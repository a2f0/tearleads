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

## Testing

- **React Testing Library** patterns - query by role, label, text
- **User-centric assertions** - test behavior, not implementation
- **MSW for API mocking** - handlers in `packages/*/src/mocks/`
