# @tearleads/ui

Product-neutral React UI shared by the [app](../app/README.md) and the
[website](../website/README.md): the Tearleads header and footer frame, the
logo, the theme-invert icon, and the theme token stylesheets they render with.
It depends only on React and must not import application implementation code.

| Export | Use for |
| --- | --- |
| `TearleadsFrame`, `TearleadsHeader`, `TearleadsFooter` | The branded page frame, header, and footer |
| `TearleadsLogo` | The Tearleads mark |
| `ThemeInvertIcon` | The light/dark toggle icon |

## Styles

Importing a component loads its stylesheets:

- [`src/styles.css`](src/styles.css) declares every color token. Its `:root`
  block is the Light
  theme, and each other theme re-declares the same tokens under
  `:root[data-theme="<id>"]`.
- [`src/styles.dusk.css`](src/styles.dusk.css) holds the Dusk theme's token
  block.
- [`src/styles.routed.css`](src/styles.routed.css) holds touch and
  routed-layout overrides, and must
  load after [`styles.css`](src/styles.css).
- [`src/styles.links.css`](src/styles.links.css) resets anchors for every shell.

The app's theme list
([`packages/app/src/theme/themes.ts`](../app/src/theme/themes.ts)) and the
website's
tokens
([`packages/website/src/styles/tokens.css`](../website/src/styles/tokens.css))
mirror these values. See the
[UI design system](../../docs/ui-design-system.md) for the conventions they
follow.

The package has no tests of its own; the app and website suites cover it.
