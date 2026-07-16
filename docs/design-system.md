# Product design system

MailRovers currently uses shadcn preset `b1sl6tLOM` as its visual baseline. This is an intentional reset before the next redesign. Existing feature screens may look incomplete while they are migrated onto shared components.

## Source of truth

- `apps/desktop/components.json` records the shadcn configuration: Maia, Base UI, zinc neutrals, blue primary color, cyan charts, Hugeicons, DM Sans, and the default radius.
- `apps/desktop/src/styles.css` contains the generated preset theme.
- `apps/desktop/src/components/ui` contains the complete generated shadcn component set.
- `.oxlintrc.json` enforces the boundary between feature layout and component appearance.

Do not edit generated files under `components/ui` for one feature. The only current deviations from upstream are narrow TypeScript compatibility fixes required by the repository's `exactOptionalPropertyTypes` setting. If a visual change belongs in the product system, change the shared component deliberately and document the new rule here. Until the redesign defines such changes, prefer the upstream preset.

Oxlint exempts the upstream component directory from product styling restrictions and a small set of lint rules that conflict with the generated source. Repository correctness checks still apply there. Review accessibility when a generated component is adopted in a product flow.

## Preserved project rules

The reset keeps three local CSS policies:

- Tailwind's default color palette is disabled with `--color-*: initial`.
- The root document uses Tailwind antialiasing.
- Enabled buttons and elements with `role="button"` use the pointer cursor.

Tailwind's default shadow scale remains available because generated shadcn components use it. Product code outside `components/ui` cannot use shadow utilities, so elevation decisions remain inside the shared component layer.

## Dependency direction

The allowed direction is:

`styles.css -> components/ui -> product code`

Product code under `apps/desktop/src`, excluding `components/ui`, may use Tailwind for layout only, including display, grid and flex placement, spacing, sizing, positioning, overflow, responsive behavior, and text alignment or wrapping. Visual decisions belong in `components/ui`, including:

- backgrounds and colors;
- typography, font weight, line height, and tracking;
- borders, rings, radii, and shadows;
- opacity, filters, and text decoration;
- animation and transition styling.

Product code must not import Base UI or Radix directly. It must also use shared controls instead of raw `button`, `input`, `select`, or `textarea` elements.

Structural arbitrary values remain allowed for layout cases such as viewport calculations, grid tracks, breakpoints, and virtualized positioning. Arbitrary CSS property utilities are forbidden outside `components/ui`.

Inline `style` props are forbidden outside `components/ui`. Runtime geometry is the only current exception: `ConversationVirtualList.tsx` passes TanStack Virtual's calculated height and vertical transform to DOM elements. Keep that exception limited to layout values. Generated components may use inline CSS variables to expose runtime component parameters.

## Adding UI

1. Check `apps/desktop/src/components/ui` for an existing shadcn component.
2. Compose the feature from those components.
3. Keep product `className` values limited to layout.
4. If the preset cannot express a required visual treatment, pause and make an explicit design-system decision before changing shared CSS or component variants.

Run `pnpm lint` to check the boundary. Run `pnpm typecheck` after changing component usage.
