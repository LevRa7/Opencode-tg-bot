# Expandable Blockquotes Restoration Design

## Context

The Telegram rendering pipeline already treats reasoning and thinking content as quoted HTML blocks.
Recent local changes replaced `<blockquote expandable>` with plain `<blockquote>` in the reasoning and thinking paths, which changed the Telegram UX away from the intended collapsible quote behavior.

## Goal

Restore `<blockquote expandable>` as the canonical format for reasoning, thinking, and related HTML draft frames.

## Chosen Approach

Revert the blockquote format only in the paths that generate or progressively stream reasoning/thinking HTML:

- `src/bot/utils/reasoning-format.ts`
- `src/bot/utils/thinking-message.ts`
- `src/bot/utils/send-message-draft-effect.ts`

Keep the rest of the rendering pipeline unchanged unless it must explicitly recognize the expandable form to preserve valid HTML chunks.

Align tests with the restored behavior instead of normalizing everything to plain `<blockquote>`.

## Scope Boundaries

- Restore expandable blockquotes only where the current regression removed them.
- Do not redesign the broader HTML sanitizer or Telegram formatting model.
- Do not change non-reasoning blockquote behavior unless required for consistency with this restoration.
- Do not include unrelated cleanup of temporary local files or Git synchronization policy in this change.

## Expected Outcome

Thinking and reasoning messages once again render using `<blockquote expandable>`.
Streaming and draft-effect paths preserve the same expandable wrapper, so intermediate and final Telegram payloads stay behaviorally consistent.

## Verification

- Run targeted tests covering thinking messages, reasoning formatting, and draft streaming.
- Run the full project checks: `npm test`, `npm run build`, and `npm run lint`.
- Confirm the resulting diff restores expandable wrappers only in the intended code paths.
