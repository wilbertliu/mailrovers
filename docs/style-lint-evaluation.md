# Style lint evaluation

Evaluated on 2026-07-15 against the Tailwind CSS 4 desktop application.

## Decision

Use `oxlint-tailwindcss` as an Oxlint JavaScript plugin. Its `no-restricted-classes` rule limits all desktop product code outside `components/ui` to layout utilities, while Oxlint's built-in `no-restricted-imports`, `react/forbid-elements`, `react/forbid-dom-props`, and `react/forbid-component-props` rules enforce the same boundary. The generated shadcn files under `components/ui` are exempt. The virtualized conversation list has a documented inline-style exception for runtime geometry. The plugin reads the Tailwind CSS 4 design system from `apps/desktop/src/styles.css`. This setup does not add ESLint.

## Alternatives considered

- Oxlint core has no Tailwind-specific or `no-arbitrary-value` rule in its current built-in rule catalog. Oxlint supports JavaScript plugins, so the existing Oxlint command can host the Tailwind rules.
- `oxlint-tailwindcss` supports Tailwind CSS 4, Oxlint, JSX attributes, `cn()`, and CVA. Its `no-restricted-classes` rule accepts regular expressions for the project's layout-only feature boundary.
- `eslint-plugin-tailwindcss` provides `no-arbitrary-value`, but requires ESLint 9 or 10 and therefore adds a second lint runner. Its rule also bans every arbitrary value unless suppressed, which is a worse fit for the structural layout escape hatch.
- `eslint-plugin-better-tailwindcss` can enforce the same restriction patterns through Oxlint. `oxlint-tailwindcss` was selected because it is built for Oxlint and Tailwind CSS 4, loads the project's CSS entry point explicitly, and keeps the policy under the `tailwindcss` rule namespace.

## Canary test

A temporary product component included a direct Base UI import, raw `button`, `bg-primary`, `text-sm`, `rounded-lg`, `shadow-sm`, an arbitrary CSS property, and an inline `style` prop. Oxlint reported each violation through `no-restricted-imports`, `react/forbid-elements`, `react/forbid-dom-props`, and `tailwindcss/no-restricted-classes`. Layout utilities, structural arbitrary values, and the documented virtualizer exception remained allowed. The canary was removed after verification.

## Primary sources

- [Oxlint Tailwind CSS setup and rules](https://github.com/sergioazoc/oxlint-tailwindcss)
- [Oxlint built-in rule catalog](https://oxc.rs/docs/guide/usage/linter/rules)
- [ESLint Plugin Tailwind CSS rules and requirements](https://github.com/francoismassart/eslint-plugin-tailwindcss)
- [Better Tailwind CSS rules and Oxlint support](https://github.com/schoero/eslint-plugin-better-tailwindcss)
