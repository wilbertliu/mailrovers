# Style lint evaluation

Evaluated on 2026-07-15 against the Tailwind CSS 4 desktop application.

## Decision

Use `eslint-plugin-better-tailwindcss` as an Oxlint JavaScript plugin. Its `no-restricted-classes` rule replaces the custom class-string scans, while Oxlint's built-in `no-restricted-imports` and `react/forbid-elements` rules enforce component boundaries. This removes the hand-written `scripts/check-styles.mjs` and does not add ESLint.

## Alternatives considered

- Oxlint core has no Tailwind-specific or `no-arbitrary-value` rule in its current built-in rule catalog. Oxlint supports JavaScript plugins, which lets the existing Oxlint command host the Tailwind rule.
- `eslint-plugin-better-tailwindcss` supports Tailwind CSS 4, Oxlint, JSX attributes, `cn()`, and CVA. Its configurable `no-restricted-classes` rule explicitly supports regular-expression restrictions for semantic colors and arbitrary values.
- `eslint-plugin-tailwindcss` provides `no-arbitrary-value`, but requires ESLint 9 or 10 and therefore adds a second lint runner. Its rule also bans every arbitrary value unless suppressed, which is a worse fit for the structural layout escape hatch.
- `oxlint-tailwindcss` also provides native-looking Oxlint Tailwind rules, including `no-arbitrary-value` and `no-hardcoded-colors`. Better Tailwind CSS was selected because one established plugin covers the project's exact restriction patterns and is already documented to run under Oxlint.

## Canary test

A temporary feature component included a direct Base UI import, raw `button`, `bg-blue-500`, `text-[13px]`, and `p-[18px]`. Oxlint reported all five through `no-restricted-imports`, `react/forbid-elements`, and `better-tailwindcss/no-restricted-classes`. The canary was removed after verification.

## Primary sources

- [Better Tailwind CSS rules and Oxlint support](https://github.com/schoero/eslint-plugin-better-tailwindcss)
- [Better Tailwind CSS restricted-class rule](https://github.com/schoero/eslint-plugin-better-tailwindcss/blob/main/docs/rules/no-restricted-classes.md)
- [Oxlint built-in rule catalog](https://oxc.rs/docs/guide/usage/linter/rules)
- [ESLint Plugin Tailwind CSS rules and requirements](https://github.com/francoismassart/eslint-plugin-tailwindcss)
- [Oxlint Tailwind CSS package](https://www.npmjs.com/package/oxlint-tailwindcss)
