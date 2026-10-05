# Agent profile

`index.ts` exposes `readAgentProfile`, `saveAgentProfile`, and the inferred product
profile/update types. Pages consume that public entrypoint. Only
`agentProfileApi.ts` calls the generated API client; regenerate its contract with
`make contract`, never edit `src/api/generated` by hand.

The profile stores the companion's name, seven-preset `avatar_id`, color, speaking
style, soul text, onboarding progress, questionnaire, and optional `user_avatar`.
The user appearance is independent of the companion identity and questionnaire:

- `null`: no user appearance is selected; hide the workbench appearance.
- An object requires `id`: `xiaoping`, `mo`, `silver`, `sand`, `cat`, or `hime`.
- Optional `hair`, `skin`, and `sleeve` are six-digit `#rrggbb` colors. Omission
  uses the selected appearance's original color.
- Optional `blush` is a boolean. Omission uses the original blush.

PATCH requires `expected_version` and an idempotency key. Omitting `user_avatar`
preserves it; passing `null` clears it; an object replaces the complete appearance
selection. A stale version returns 409. Profile reads and writes are scoped to
the authenticated owner.

The six persisted welcome pages are: companion (0), name/appearance (1), user
appearance (2), imports (3), questionnaire (4), graph (5). Completion uses step 6
with `setup_completed: true`. The opening animation is not a persisted step.
Migration 0590 maps unfinished four-step profiles to the equivalent page
(`0→3`, `1→1`, `2→4`, `3→5`), preserving their existing choices. Previously
completed profiles retain their completion flag and legacy step 4. A user with
no stored profile starts at step 0. Gate access by `setup_completed`, not by the
numeric step alone.

Appearance selections never enter the runtime persona or onboarding memories.
