---
name: preen-window-consistency
description: Proactively search for opportunities to normalize window components, standardize refresh patterns, and consolidate shared logic into `packages/window-manager`. Use when maintaining window components or during slack time.
---


# Preen Window Consistency

Proactively search for opportunities to normalize window components, standardize refresh patterns, and consolidate shared logic into `packages/window-manager`.

## When to Run

Run this skill when maintaining window components or during slack time. It searches for:

- Duplicated patterns across windowed applications that should be centralized
- Legacy implementations that should adopt existing window-manager hooks/components
- Components in individual windows that could be promoted to window-manager
- Inconsistent refresh/refetch patterns that should use standardized hooks
- Cross-window navigation that bypasses the `WindowOpenRequestPayloads` pattern

## Discovery Phase

Search for opportunities to normalize and standardize:

```bash
# Find window components across packages
find packages -name "*Window*.tsx" -not -path "*/node_modules/*" -not -path "*/dist/*" | head -30

# Find sidebar components that might have refresh patterns
find packages -name "*Sidebar*.tsx" -not -path "*/node_modules/*" -not -path "*/dist/*" | head -30

# Find manual refreshToken patterns not using useSidebarRefetch
rg -n --glob '*.tsx' 'lastRefreshTokenRef|lastRefreshToken' packages | head -20

# Find manual refreshToken state not using useWindowRefresh
rg -n --glob '*.tsx' 'setRefreshToken.*prev.*\+.*1|refreshToken.*useState.*0' packages | head -20

# Find combined refresh token patterns not using useCombinedRefresh
rg -n --glob '*.tsx' 'combinedRefreshToken|internalRefreshToken.*external' packages | head -20

# Find potential WindowSidebarItem candidates (custom sidebar items not using the standard component)
rg -n --glob '*.tsx' 'className=.*sidebar.*item|flex.*items-center.*gap.*rounded.*text-sm' packages | rg -v 'WindowSidebarItem|node_modules' | head -20

# Find potential WindowSidebarHeader candidates
rg -n --glob '*.tsx' 'className=.*border-b.*px.*py|sidebar.*header' packages | rg -v 'WindowSidebarHeader|node_modules' | head -20

# Find drag-over patterns not using useSidebarDragOver
rg -n --glob '*.tsx' 'dragOverId|dragCounter|setDragOver' packages | rg -v 'useSidebarDragOver|window-manager' | head -20

# Find resize handle patterns not using useResizableSidebar
rg -n --glob '*.tsx' 'cursor-col-resize|onWidthChange.*width|resizeHandle' packages | rg -v 'useResizableSidebar|window-manager' | head -20

# Find cross-window navigation patterns using navigate() instead of openWindow/requestWindowOpen
# These are windows that should open in floating mode but currently route-navigate
rg -n --glob '*.tsx' 'navigate\(.*/(help|notes|contacts|photos|audio|videos|documents|files|email|chat|ai)\b' packages | rg -v 'isMobile|test\.tsx' | head -20

# Check WindowOpenRequestPayloads vs actual window types that need open requests
echo "=== Window types supporting open requests ==="
rg -A5 'interface WindowOpenRequestPayloads' packages/client/src/contexts/WindowManagerContext.tsx | head -20

# Check window-manager exports vs actual usage
echo "=== Window Manager Exports ==="
rg '^export' packages/window-manager/src/index.ts | head -30

echo "=== Unused Window Manager Components ==="
for comp in WindowSidebarItem WindowSidebarHeader WindowSidebarLoading WindowSidebarError WindowStatusBar WindowControlBar; do
  count=$(rg -l "$comp" packages --glob '*.tsx' | rg -v 'window-manager' | wc -l | tr -d ' ')
  echo "$comp: $count usages"
done

# Find windows missing File menu
echo "=== Windows Without File Menu ==="
rg -l 'FloatingWindow|DesktopFloatingWindow' packages --glob '*Window.tsx' | xargs -I {} sh -c 'rg -q "DropdownMenu trigger=\"File\"" {} || echo {}'

# Find potential duplicate back buttons or misplaced actions in content area
echo "=== Potential Misplaced Actions ==="
rg -n --glob '*Window*.tsx' '<Button.*onClick.*(ArrowLeft|Plus|RefreshCw|Trash2)' packages | rg -v 'WindowControl|test\.tsx' | head -20
```

### Dependency and Export Wiring Checks

When adopting `@tearleads/window-manager` abstractions in a package, verify package metadata and exports are aligned:

```bash
# Find packages importing window-manager in source
echo "=== Packages importing @tearleads/window-manager ==="
rg -l "from '@tearleads/window-manager'" packages/*/src --glob '*.{ts,tsx}' \
  | awk -F/ '{print $2}' | sort -u

# Find package.json files that already declare window-manager as a peer dependency
echo "=== Packages declaring window-manager peerDependency ==="
rg -l '"@tearleads/window-manager"' packages/*/package.json | awk -F/ '{print $2}' | sort -u

# Manual diff target: importers should generally also declare peerDependency
```

## Candidate Signals

Prioritize opportunities that meet at least two signals:

### Promote to window-manager

- Component is used in 2+ different window packages
- Component follows a consistent pattern across windows
- Component has no window-specific business logic
- Component is a generic UI primitive (sidebar item, header, loading state)

### Adopt window-manager patterns

- Sidebar uses manual refreshToken useEffect instead of `useSidebarRefetch`
- Window uses manual refreshToken state instead of `useWindowRefresh`
  - Migration recipe: replace `const [refreshToken, setRefreshToken] = useState(0)` with `const { refreshToken, triggerRefresh } = useWindowRefresh()` and replace every token increment with `triggerRefresh()`.
  - Keep passing `refreshToken` through existing props to data/list components; do not switch to remount-by-key unless already required.
  - Add `triggerRefresh` to callback dependency arrays where it's used; this replaces any dependency on the old `setRefreshToken` setter.
  - If tests mock `@tearleads/window-manager`, ensure they spread the real module exports so `useWindowRefresh` remains available.
- Component uses combined refresh tokens instead of `useCombinedRefresh`
- Component has custom drag-over tracking instead of `useSidebarDragOver`
- Component has custom resize handling instead of `useResizableSidebar`
- Cross-window navigation uses `navigate()` instead of `openWindow()`/`requestWindowOpen()`
- Package imports window-manager abstractions but does not expose dependency wiring in `peerDependencies`

### Consolidate duplicated code

- Same hook logic appears in multiple sidebars
- Same UI pattern appears in multiple windows
- Same context menu structure appears in multiple places

**Do NOT refactor:**

- Components with significant business logic that shouldn't be in window-manager
- Patterns that are intentionally different for good reasons
- Code that would require breaking API changes to standardize
- Test files or storybook files

## Window Structure Patterns

Every window should follow a consistent structure with these required elements:

### Menu Bar Pattern

All windows **must** have a menu bar with at minimum a File menu containing Close:

```tsx
<FloatingWindow ...>
  <div className="flex h-full flex-col">
    <WindowMenuBar onClose={onClose} />
    <WindowControlBar>...</WindowControlBar>
    {/* Content */}
  </div>
</FloatingWindow>
```

Standard menu bar structure:

```tsx
<div className="flex shrink-0 border-b bg-muted/30 px-1">
  <DropdownMenu trigger="File">
    {/* Optional: New, Open, Save actions */}
    <DropdownMenuItem onClick={onClose}>Close</DropdownMenuItem>
  </DropdownMenu>
  <DropdownMenu trigger="View">
    {/* Optional: View mode toggles, show/hide options */}
    <WindowOptionsMenuItem />
  </DropdownMenu>
  <DropdownMenu trigger="Help">
    <AboutMenuItem appName="AppName" version={packageJson.version} />
  </DropdownMenu>
</div>
```

Discovery command for missing menu bars:

```bash
# Find windows without menu bars
rg -l 'FloatingWindow|DesktopFloatingWindow' packages --glob '*Window.tsx' | xargs -I {} sh -c 'rg -q "DropdownMenu trigger=\"File\"" {} || echo "NO MENU: {}"'
```

### Control Bar Pattern

**All window actions belong in the WindowControlBar**, not in the content area.

Good pattern:

```tsx
<WindowControlBar>
  <WindowControlGroup>
    {showBackButton && (
      <WindowControlButton icon={<ArrowLeft />} onClick={onBack}>
        Back
      </WindowControlButton>
    )}
  </WindowControlGroup>
  <WindowControlGroup align="right">
    <WindowControlButton icon={<Plus />} onClick={onCreate}>
      New
    </WindowControlButton>
    <WindowControlButton icon={<RefreshCw />} onClick={onRefresh}>
      Refresh
    </WindowControlButton>
  </WindowControlGroup>
</WindowControlBar>
```

Bad patterns to fix:

- Duplicate back buttons (one in control bar, one in content)
- Action buttons (new, refresh, delete) inside content area
- Navigation controls scattered throughout the component

Discovery command for misplaced actions:

```bash
# Find potential misplaced actions in content (buttons with action icons not in control bar)
rg -n --glob '*Window*.tsx' '<Button.*onClick.*(ArrowLeft|Plus|RefreshCw|Trash2)' packages | rg -v 'WindowControl|test\.tsx' | head -20
```

### Detail View Pattern

When a window has list/detail views, the control bar should change based on the selected state:

```tsx
<WindowControlBar>
  <WindowControlGroup>
    {selectedItemId && (
      <WindowControlButton icon={<ArrowLeft />} onClick={handleBack}>
        Back
      </WindowControlButton>
    )}
  </WindowControlGroup>
  <WindowControlGroup align="right">
    {selectedItemId ? (
      // Detail view actions (right-aligned)
      <WindowControlButton icon={<Trash2 />} onClick={handleDelete}>
        Delete
      </WindowControlButton>
    ) : (
      // List view actions (right-aligned)
      <>
        <WindowControlButton icon={<Plus />} onClick={handleCreate}>
          New
        </WindowControlButton>
        <WindowControlButton icon={<RefreshCw />} onClick={handleRefresh}>
          Refresh
        </WindowControlButton>
      </>
    )}
  </WindowControlGroup>
</WindowControlBar>
```

Key principles:

1. **Single back button** - Only in control bar, never duplicated in content
2. **Actions right-aligned** - New, Refresh, Delete go in `WindowControlGroup align="right"`
3. **Context-aware actions** - Control bar shows relevant actions for current view state
4. **Content area is for content** - Headers in content area show only title/icon, not action buttons

## Workflow

1. **Discovery**: Run discovery commands to identify candidates across all packages.
2. **Selection**: Choose one high-value candidate meeting at least two signals.
3. **Analysis**: Understand the existing pattern and the target window-manager abstraction.
4. **Create branch**: `git checkout -b refactor/window-consistency-<component-or-pattern>`
5. **Implement**:
   - For promotion: Add component/hook to window-manager with tests
   - For adoption: Update window to use existing window-manager exports
   - For consolidation: Extract shared code into window-manager
6. **Rebuild**: Run `pnpm --filter window-manager build` to ensure exports are available
7. **Update consumers**: Update all affected window packages to use the new/existing abstractions
8. **Tests**: Ensure existing tests pass; add tests for new window-manager code
9. **Validate**: Run lint, type-check, and relevant tests
10. **Commit and merge**: Run `/commit-and-push`, then `/enter-merge-queue`

If no high-value candidate is found, report findings and stop.

## Available Window Manager Abstractions

Reference these existing exports when looking for adoption opportunities:

### Hooks

| Hook | Purpose |
| ---- | ------- |
| `useSidebarRefetch` | Watch refreshToken and trigger refetch on change |
| `useWindowRefresh` | Manage refreshToken state with triggerRefresh function |
| `useCombinedRefresh` | Combine external and internal refresh tokens |
| `useSidebarDragOver` | Track drag-over state for sidebar items |
| `useResizableSidebar` | Handle sidebar resize with keyboard support |
| `useFloatingWindow` | Manage floating window position and size |

### Components

| Component | Purpose |
| --------- | ------- |
| `WindowSidebarItem` | Standard sidebar list item with icon, label, count |
| `WindowSidebarHeader` | Standard sidebar header with title and action button |
| `WindowSidebarLoading` | Loading spinner for sidebar content |
| `WindowSidebarError` | Error message for sidebar content |
| `WindowStatusBar` | Status bar for window footer |
| `WindowControlBar` | Control bar for window actions |
| `WindowContextMenu` | Context menu container |
| `WindowContextMenuItem` | Context menu item |
| `FloatingWindow` | Base floating window component |

## Auth Requirement Patterns

Windows may require authentication at different levels. Use consistent patterns:

### Auth Levels

| Level | Component | Use Case |
|-------|-----------|----------|
| **Database unlock only** | `InlineUnlock` | Local-only features (notes, files, photos) |
| **Login only** | `InlineLogin` | API-only features with no local storage |
| **Database + Login** | `InlineRequiresLoginAndUnlock` | Features needing both local DB and API auth |

### Standard Patterns

**Database unlock only** (most local-data windows):

```tsx
// Inside window content area
{!isLoading && !isUnlocked && <InlineUnlock description="notes" />}
```

**Database + Login** (preferred composite approach):

```tsx
// Wrap content with composite - handles all states internally
<InlineRequiresLoginAndUnlock
  description="MLS Chat"
  unlockDescription="MLS chat"
>
  {/* Content only rendered when both conditions met */}
</InlineRequiresLoginAndUnlock>
```

**Database + Login** (props approach - legacy, for packages without client access):

```tsx
// In external package (e.g., @tearleads/email)
interface WindowProps {
  isUnlocked?: boolean;
  isDatabaseLoading?: boolean;
  lockedFallback?: ReactNode;
}

// In client wrapper
const isFullyUnlocked = isDatabaseUnlocked && isAuthenticated;
const lockedFallback = useMemo(() => {
  if (!isDatabaseUnlocked) return <InlineUnlock description="email" />;
  if (!isAuthenticated) return <InlineLogin description="email" />;
  return null;
}, [isDatabaseUnlocked, isAuthenticated]);
```

### Auth Discovery Commands

```bash
# Find windows using InlineUnlock (database unlock only)
rg -n --glob '*Window*.tsx' 'InlineUnlock' packages | rg -v 'InlineRequiresLoginAndUnlock|test|mock' | head -20

# Find windows using InlineRequiresLoginAndUnlock (both)
rg -n --glob '*Window*.tsx' 'InlineRequiresLoginAndUnlock' packages | rg -v 'test|mock' | head -10

# Find windows using props-based auth (email pattern)
rg -n --glob '*Window*.tsx' 'isUnlocked.*isDatabaseLoading.*lockedFallback' packages | head -10

# Find admin windows that may need auth but don't have it
rg -l --glob '*Window*.tsx' 'Admin.*Window' packages | xargs -I {} sh -c 'rg -q "InlineUnlock|InlineLogin|isUnlocked" {} || echo "NO AUTH: {}"'
```

### Admin Window Auth Requirements

Admin windows (`admin-*`) should use `InlineRequiresLoginAndUnlock` because:

1. They require API authentication to access admin endpoints
2. They may cache/display data that needs local database access
3. Consistent pattern across all protected features

For admin windows in external packages (e.g., `@tearleads/admin`), create client wrappers:

```text
packages/client/src/components/admin-users-window/
├── index.tsx           # Wrapper with InlineRequiresLoginAndUnlock
└── AdminUsersWindow.test.tsx
```

### Cross-Window Opening Pattern

When one window needs to open content in another window (e.g., search opening a help doc), use the `WindowOpenRequestPayloads` pattern instead of `navigate()`:

1. **Add payload type** to `WindowOpenRequestPayloads` in `WindowManagerContext.tsx`:

   ```typescript
   export interface WindowOpenRequestPayloads {
     // ... existing payloads
     help: { helpDocId?: HelpDocId };
   }
   ```

2. **Consume in target window** using `useWindowOpenRequest`:

   ```typescript
   const openRequest = useWindowOpenRequest('help');

   useEffect(() => {
     if (!openRequest?.requestId || !openRequest?.helpDocId) return;
     setView(openRequest.helpDocId);
   }, [openRequest?.helpDocId, openRequest?.requestId]);
   ```

3. **Open from source window** using `openWindow` + `requestWindowOpen`:

   ```typescript
   if (isMobile) {
     navigate('/help/docs/...');
     return;
   }
   openWindow('help');
   requestWindowOpen('help', { helpDocId });
   ```

This ensures that when clicking items in a floating window (e.g., search results), the target content opens in another floating window rather than route-navigating away.

## Guardrails

- Do not introduce breaking changes to window-manager public API
- Do not mix UI refactoring with behavior changes
- Do not create overly generic abstractions with limited reuse value
- Keep window-specific business logic out of window-manager
- Ensure all window-manager exports have tests
- Do not introduce `any` or unsafe type assertions
- Build window-manager before running consumer tests

## PR Strategy

Use focused PRs:

- PR 1: Add new abstraction to window-manager (if needed)
- PR 2+: Update individual windows to adopt the abstraction

In each PR description, include:

- Why this pattern was selected for normalization
- What abstraction was created or adopted
- Which windows were updated
- Confirmation of no behavior change
- Test evidence

## Metric

Count of non-standardized patterns:

```bash
MANUAL_REFRESH=$(rg -c --glob '*.tsx' 'lastRefreshTokenRef|lastRefreshToken' packages 2>/dev/null | rg -v 'window-manager' | awk -F: '{sum+=$2} END {print sum+0}')
MANUAL_DRAG=$(rg -c --glob '*.tsx' 'dragOverId.*useState|setDragOver.*Id' packages 2>/dev/null | rg -v 'window-manager' | awk -F: '{sum+=$2} END {print sum+0}')
MANUAL_RESIZE=$(rg -c --glob '*.tsx' 'cursor-col-resize.*onMouseDown|handleResize.*MouseEvent' packages 2>/dev/null | rg -v 'window-manager' | awk -F: '{sum+=$2} END {print sum+0}')
CROSS_WINDOW_NAV=$(rg -c --glob '*.tsx' 'navigate\(.*/(help|notes|contacts|email|chat|ai|audio|photos|videos|documents|files).*\)' packages 2>/dev/null | rg -v 'isMobile|test\.tsx' | awk -F: '{sum+=$2} END {print sum+0}')
echo $((MANUAL_REFRESH + MANUAL_DRAG + MANUAL_RESIZE + CROSS_WINDOW_NAV))
```

## Token Efficiency

```bash
# Limit discovery output with head commands (already done above)

# Suppress verbose validation output
pnpm --filter window-manager build >/dev/null
pnpm lint >/dev/null
pnpm typecheck >/dev/null
pnpm test >/dev/null
git commit -S -m "message" >/dev/null
git push >/dev/null
```

On failure, re-run without suppression to see errors.
