# Style lint evaluation

Evaluated on 2026-07-15 against the Tailwind CSS 4 desktop application.

## Decision

Use `oxlint-tailwindcss` as an Oxlint JavaScript plugin. Its `no-restricted-classes` rule replaces the custom class-string scans, while Oxlint's built-in `no-restricted-imports` and `react/forbid-elements` rules enforce component boundaries. The plugin reads the Tailwind CSS 4 design system from `apps/desktop/src/styles.css`. This setup does not add ESLint.

## Alternatives considered

- Oxlint core has no Tailwind-specific or `no-arbitrary-value` rule in its current built-in rule catalog. Oxlint supports JavaScript plugins, so the existing Oxlint command can host the Tailwind rules.
- `oxlint-tailwindcss` supports Tailwind CSS 4, Oxlint, JSX attributes, `cn()`, and CVA. Its `no-restricted-classes` rule accepts regular expressions for the project's semantic color and arbitrary-value restrictions.
- `eslint-plugin-tailwindcss` provides `no-arbitrary-value`, but requires ESLint 9 or 10 and therefore adds a second lint runner. Its rule also bans every arbitrary value unless suppressed, which is a worse fit for the structural layout escape hatch.
- `eslint-plugin-better-tailwindcss` can enforce the same restriction patterns through Oxlint. `oxlint-tailwindcss` was selected because it is built for Oxlint and Tailwind CSS 4, loads the project's CSS entry point explicitly, and keeps the policy under the `tailwindcss` rule namespace.

## Canary test

A temporary feature component included a direct Base UI import, raw `button`, `bg-blue-500`, `text-[13px]`, and `p-[18px]`. Oxlint reported all five through `no-restricted-imports`, `react/forbid-elements`, and `tailwindcss/no-restricted-classes`. The canary was removed after verification.

## Primary sources

- [Oxlint Tailwind CSS setup and rules](https://github.com/sergioazoc/oxlint-tailwindcss)
- [Oxlint built-in rule catalog](https://oxc.rs/docs/guide/usage/linter/rules)
- [ESLint Plugin Tailwind CSS rules and requirements](https://github.com/francoismassart/eslint-plugin-tailwindcss)
- [Better Tailwind CSS rules and Oxlint support](https://github.com/schoero/eslint-plugin-better-tailwindcss)
