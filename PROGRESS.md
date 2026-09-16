# v2b Progress

## Current commit
59245d4a — feat(core/sessions): v2b session domain — fixes from adversarial eval

## Smoke test
Core: 1513 tests, 114 test files — all green. Typecheck clean. Lint clean.

## Feature list

| # | Behavior (acceptance criterion) | Verification command | State |
|---|---|---|---|
| b1 | Slot ownership reducer: half-open intervals, transitive overlap clusters, deterministic across shuffled inputs, contested flag, provisional winner (smallest createdAt then lexical id) | `pnpm --filter @holons/core test -- --reporter=verbose sessions` | passing |
| b2 | Admin-priority resolution: chosen session wins regardless of write timestamp; two conflicting resolutions → later wins; deleted session → ignored | `pnpm --filter @holons/core test -- --reporter=verbose sessions` | passing |
| b3 | Swap state machine: proposed/expired/auto-declined derived; accept-apply re-validates; decline/withdraw/delete-mid-swap; two concurrent proposals → smallest is live | `pnpm --filter @holons/core test -- --reporter=verbose sessions` | passing |
| b4 | Series expansion: weekday-specific repeats + exceptions + until inclusive + window filter + chronological output including Sunday | `pnpm --filter @holons/core test -- --reporter=verbose sessions` | passing |
| b5 | Star count and stable descending ranking (lexical sessionId tiebreak) | `pnpm --filter @holons/core test -- --reporter=verbose sessions` | passing |
| b6 | Write-tier rules (parameterised): admin-only keynote/room/track/format, logged-in own-session CRUD/star/comment, logged-out read-only | `pnpm --filter @holons/core test -- --reporter=verbose sessions` | passing |
| b7 | Canonical-uid registry: resolve unlinked→self; attested/dual-signed link; forged link rejected; 31926 ingestion makes shifts-mine = sessions-mine | `pnpm --filter @holons/core test -- --reporter=verbose sessions` | passing |
| b8 | RSVP path retired: zero grep references to retired symbols outside their definitions; generateICalFeed retained; gate green | grep + gate | not_started |
| b9 | Full gate green (core typecheck + test + lint) | `pnpm --filter @holons/core typecheck && pnpm --filter @holons/core test && pnpm --filter @holons/core lint` | passing |

## What's in progress
b8 — RSVP cleanup. Blocked on Telegram bot /rsvp live-status confirmation.

## Blockers
- **AC-b8 BLOCKED**: The Telegram bot's /rsvp live-status for the Commons Hub is unknown. Active consumers found by grep:
  - `packages/discord-ui/src/features/calendar.ts` (toggleRSVP, buildRSVPList)
  - `packages/discord-ui/src/features/rsvp.ts` (same)
  - `packages/telegram-ui/src/RSVP.js` (toggleRSVP)
  Strategy: keep all three on the retained path until Deca confirms bot /rsvp is dead.
  The iCal builder (generateICalFeed) is already retained and untouched.

## Next steps
1. Deca confirms: is @HubsNetwork_bot's /rsvp feature live on the Commons Hub?
   - If live: keep telegram-ui/RSVP.js; RSVP stays. Discord-ui is a separate deploy — treat separately.
   - If dead: remove telegram-ui/RSVP.js caller; discord-ui callers; then zero-references grep passes.
2. After b8: commit + final gate.
3. Tag `feat/v2b-sessions-core` as ready for Deca review before merging to elinor.
