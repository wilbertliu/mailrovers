# Product design system

Mailrovers adopts the product design system implemented in the authenticated Rinhelp web app. This document defines that system as the standard for Mailrovers product interfaces. It describes the adopted system, not a proposed redesign.

## Source of truth

MailRovers now owns the runtime source of truth for its design system:

- `apps/desktop/src/styles.css` defines the supported Tailwind theme and semantic tokens.
- `apps/desktop/src/components/ui` owns control appearance and typed variants.
- Oxlint and `oxlint-tailwindcss` enforce feature boundaries as part of `pnpm lint`.

The original Rinhelp references remain useful historical context:

- [Global tokens and fonts](../../rinhelp/apps/web/src/styles.css)
- [Component registry configuration](../../rinhelp/apps/web/components.json)
- [Application shell](../../rinhelp/apps/web/src/components/console-shell.tsx)
- [Button variants](../../rinhelp/apps/web/src/components/ui/button.tsx)
- [Form controls](../../rinhelp/apps/web/src/components/ui/input.tsx) and [field composition](../../rinhelp/apps/web/src/components/ui/field.tsx)
- [Cards](../../rinhelp/apps/web/src/components/ui/card.tsx)
- [Sidebar behavior](../../rinhelp/apps/web/src/components/ui/sidebar.tsx)

The adopted system uses Tailwind CSS 4 and shadcn's `base-maia` style with Base UI primitives. CSS variables carry the product colors. Component variants use Class Variance Authority, and `cn()` combines conditional classes.

The dependency direction is strict: `tokens → UI primitives → typed variants → product components → features`. Feature code may use Tailwind for layout, dimensions, overflow, positioning, responsive behavior, and the established spacing scale. It must not import Base UI or Radix directly, render raw controls when a shared control exists, use palette utilities, or introduce arbitrary visual or spacing values.

## Design character

The product UI is quiet and utilitarian. Neutral surfaces hold the structure, blue marks primary actions, and color appears sparingly for status or data. Rounded controls and restrained borders soften dense operational screens without making them feel decorative.

## Product foundations

### Typography

The product system uses two font families.

| Role                    | Family                         | Use                                                  |
| ----------------------- | ------------------------------ | ---------------------------------------------------- |
| Interface and headings  | `DM Sans Variable`, sans-serif | Body copy, labels, navigation, buttons, and headings |
| Code and tabular values | `JetBrains Mono`               | Code examples, API payloads, and chart values        |

`--font-heading` currently resolves to the same family as `--font-sans`. Product pages therefore create hierarchy through size, weight, spacing, and color rather than switching families.

Common product sizes:

- Page title: `text-2xl`, semibold, tight tracking.
- Card title: `text-base`, medium.
- Body, labels, controls, and navigation: `text-sm`.
- Supporting copy: `text-sm text-muted-foreground`, often with balanced or pretty wrapping.
- Code: `text-xs`, 1.5rem line height, monospace.

Use sentence case. Keep labels short. Error, empty, loading, and pending text should tell the user what happened or what the system is doing.

### Color

The product palette uses OKLCH semantic variables. Components should consume semantic Tailwind classes such as `bg-background`, `text-foreground`, and `border-border`, not copy raw color values.

| Token                            | Light                        | Dark                           | Purpose                                       |
| -------------------------------- | ---------------------------- | ------------------------------ | --------------------------------------------- |
| `background`                     | `oklch(1 0 0)`               | `oklch(0.141 0.005 285.823)`   | App canvas                                    |
| `foreground`                     | `oklch(0.141 0.005 285.823)` | `oklch(0.985 0 0)`             | Primary text and icons                        |
| `card`                           | `oklch(1 0 0)`               | `oklch(0.21 0.006 285.885)`    | Raised content surfaces                       |
| `primary`                        | `oklch(0.488 0.243 264.376)` | `oklch(0.424 0.199 265.638)`   | Primary actions and selected emphasis         |
| `secondary` / `muted` / `accent` | `oklch(0.967 0.001 286.375)` | `oklch(0.274 0.006 286.033)`   | Quiet fills, hover states, secondary controls |
| `muted-foreground`               | `oklch(0.552 0.016 285.938)` | `oklch(0.705 0.015 286.067)`   | Supporting text                               |
| `destructive`                    | `oklch(0.577 0.245 27.325)`  | `oklch(0.704 0.191 22.216)`    | Errors and destructive actions                |
| `border` / `input`               | neutral 92% lightness        | translucent white at 10% / 15% | Boundaries and control fills                  |
| `ring`                           | `oklch(0.705 0.015 286.067)` | `oklch(0.552 0.016 285.938)`   | Keyboard focus                                |

MailRovers additionally defines `surface`, `panel`, `control`, `selection`, `success`, and `warning` semantic roles. These preserve the desktop application's existing neutral-green appearance without exposing raw palette choices to features.

Five cyan chart tokens run from light to dark. Charts may define series-specific theme colors through `ChartConfig`, but axes, grids, cursors, and tooltips should continue to use semantic tokens.

Status colors add meaning:

- Successful states use green.
- Failed states use `destructive`.
- Work in progress uses `secondary`.
- Neutral or pending states use an outline with muted text.

Do not rely on color alone. Keep a text label such as "Complete", "Failed", or "In progress" beside the visual treatment.

### Shape, borders, and elevation

The base radius is `0.625rem` or 10px. The generated scale ranges from 6px to 26px.

- Buttons and inputs use `rounded-4xl`, which produces a pill shape at their normal heights.
- Cards use `rounded-2xl`, a 16px radius, with a 1px `foreground/10` ring.
- Code blocks and inline notices use `rounded-xl`.
- Menus, sheets, and tooltips inherit the same radius scale and semantic borders.

Prefer a faint ring or border for hierarchy. Add shadows to temporary overlays and tooltips, not every container. Product cards intentionally have no default shadow.

### Spacing and layout

Tailwind's 4px spacing scale is the baseline. Repeated product intervals include 12px control gaps, 16px compact padding, 24px card padding, and 32px page-section gaps.

The authenticated shell has these constraints:

- Desktop sidebar width: 16rem expanded and 3rem collapsed.
- Mobile sidebar sheet width: 18rem.
- Top bar height: 4rem, with a bottom border and translucent background.
- Main content: centered, `max-w-6xl`, 1rem padding by default and 2rem at `lg`.
- Desktop/mobile switch: 768px. Below it, the sidebar becomes an off-canvas sheet.

Use the shared `ConsoleShell` for authenticated routes. It keeps navigation, content width, title placement, and responsive behavior consistent.

## Product components

### Buttons

Buttons are 14px medium-weight pills with a visible 3px focus ring, a 1px active press shift, and 50% opacity when disabled.

| Variant       | Use                                                       |
| ------------- | --------------------------------------------------------- |
| `default`     | The main action in a view or form                         |
| `secondary`   | A lower-priority action that still needs a filled control |
| `outline`     | A quiet alternative or disclosure control                 |
| `ghost`       | Toolbar, sidebar, and icon actions                        |
| `destructive` | Irreversible or harmful actions                           |
| `link`        | Action visually embedded in prose                         |

Heights are 24px for `xs`, 32px for `sm`, 36px by default, and 40px for `lg`. Matching square icon sizes are available. Use the smallest size that still fits the density and input method. Give icon-only buttons an accessible name.

### Forms

Inputs are 36px-high pills with a subtle tinted fill. Focus changes the border to `ring` and adds a 3px translucent ring. Invalid controls switch both treatments to `destructive`.

Compose forms with `FieldGroup`, `Field`, `FieldLabel`, and `FieldDescription`. A vertical field has a 12px internal gap; a group uses a 28px gap. Put validation text in `FieldError` or a destructive `FieldDescription` with `role="alert"` behavior where appropriate.

Labels must remain visible. Placeholders are examples or format hints, not replacements for labels. Disable the submit action while a request is pending and change its text to the current action, for example "Signing in...".

### Cards

Cards group related content on the page canvas. The default card has a 24px internal spacing variable; the small size uses 16px. Header, content, and footer align through the shared spacing variable.

A card header may contain a title, description, and right-aligned action. Avoid nesting cards merely to create spacing. Use a plain section with a border or background when the content does not need its own visual boundary.

### Navigation and sidebar

The app sidebar is persistent on desktop, collapsible to icons, and modal on mobile. `Cmd+B` or `Ctrl+B` toggles it. Store the desktop state in the `sidebar_state` cookie for seven days.

Use Hugeicons at 16px by default with a 2px stroke. Navigation items need text labels in the expanded state and tooltips in the icon-only state. The current console uses Hugeicons consistently.

### Tables

Tables use 14px text, 48px column headers, 12px cell padding, and horizontal scrolling on narrow viewports. Rows receive a muted hover fill and a stronger muted fill when selected or expanded. Keep headers in one line. Let descriptive content outside the table wrap normally.

### Tabs

Tabs support a filled default style and a `line` style. The active line is 2px and uses `foreground`. Tabs must preserve the primitive's keyboard behavior and visible focus state.

### Status badges

Badges are 24px-high pills with 10px horizontal padding and 12px medium text. Use them for compact state labels, not general metadata. Map domain states in one place so the same state cannot acquire conflicting colors.

### Code and data visualization

Code blocks use a muted surface, a faint ring, horizontal scrolling, and a copy action in the top-right corner. Syntax color is limited to primary blue, green strings or response fields, amber literals, and muted punctuation. Copy feedback lasts 1.8 seconds and changes both icon and accessible label.

Charts inherit semantic grid and label colors. Use tabular monospace numerals in tooltips. Every chart needs a nearby title and plain-language summary; color and hover detail should not be the only ways to understand the result.

## Theme behavior

The product supports `light`, `dark`, and `auto`. Store the choice under the `theme` local-storage key. `auto` follows `prefers-color-scheme` and updates when the system setting changes. An inline document-head script resolves the mode before paint, applies `.light` or `.dark`, and sets `color-scheme` to prevent a theme flash.

Use semantic variables for all new product UI so dark mode works without component-specific overrides. Logo and favicon assets have light and dark versions.

## Accessibility and interaction rules

- Preserve Base UI semantics and keyboard behavior when wrapping primitives.
- Keep the global focus treatment. Do not remove outlines unless an equally visible focus ring replaces them.
- Give every icon-only control an `aria-label` or visually hidden label.
- Pair form labels and inputs with `htmlFor` and `id`.
- Use live or alert semantics for asynchronous errors when users need immediate notice.
- Keep text labels with status colors and chart series.
- Make tables and code blocks scroll horizontally rather than shrinking text below their system size.
- Use `text-balance` for short headings and `text-pretty` for prose when it improves line breaks.
- Preserve a logical DOM and tab order when layouts rearrange at breakpoints.

## Applying the system

`pnpm lint` runs Oxlint with the Better Tailwind CSS plugin. Structural arbitrary values are intentionally allowed for viewport calculations, responsive breakpoints, complex grid tracks, and virtualized positioning. New exceptions should remain structural; a visual exception belongs in a typed `components/ui` variant instead.

For a new product screen:

1. Start with `ConsoleShell` and its `max-w-6xl` content area.
2. Use semantic color classes and the shared UI components.
3. Build hierarchy with the established 14px body and 24px page-title scale.
4. Use one primary button per immediate decision area.
5. Check light, dark, desktop, mobile, keyboard, pending, empty, error, and disabled states.

When implementation and this document disagree, update the implementation deliberately, then revise this file in the same change.
