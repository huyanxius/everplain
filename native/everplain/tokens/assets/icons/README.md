# Exact icon sources

The Web uses two different icon families. They must not be substituted by name.

- `navigation` is the actual `app/ui/NavIcon.tsx` set used by the sidebar,
  AccountMenu, notifications and navigation controls: 24 × 24, no fill,
  currentColor stroke, width 1.75, round line caps/joins.
- `phosphor` is regular-weight artwork from the exact Web lockfile package
  `@phosphor-icons/react@2.1.10`: 256 × 256 filled paths. Composer and model
  controls use these. Import names at each source call site remain authoritative.

`icons.json` preserves original path strings and primitive attributes.
`svg/` provides standalone source SVGs; native apps can draw the same paths.
Do not map all navigation to the similarly named Phosphor icon.

Package archive integrity was checked against the exact npm SHA512 in
`SOURCE.json`; unmodified selected definitions and original MIT license are
included. The Web-owned NavIcon source remains under the source project's terms.

Regenerate with `node generate.mjs /path/to/typescript/lib/typescript.js`.
