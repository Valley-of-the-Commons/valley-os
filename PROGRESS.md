# valley-os v2 Progress

Stack: `feat/v2b-sessions-core` (core) <- `feat/v2a-chrome-cleanup` (kiosk chrome) <- `feat/v2c-unified-tab` (the programme).

# v2b

## Current commit
See `git log -1` on `feat/v2b-sessions-core`.

## Smoke test
`pnpm --filter @holons/core typecheck && pnpm --filter @holons/core test && pnpm --filter @holons/core lint`: green (122 files, 1618 tests at the last run).

Workspace gate (`pnpm -r --no-bail`): pre-existing failures only, unrelated to v2b:
- typecheck: mcp-ui (vitest types in test files), voice-ui (`@holons/core/actions` missing)
- test: holosphere (adapter-indexeddb), voice-ui, mcp-ui (`vitest: command not found`)
- lint: apps/web, apps/kiosk (Prettier on files unformatted before v2)

## Feature list

States move to `passing` only on a green verification run plus an independent evaluator PASS. Evaluation history (2026-09-25): round 2 FAILED b1-b4, b6, b9, persistence; round 3 FAILED b3, b6, persistence; round 4 FAILED b3, b4, b6, persistence; round 5 FAILED b3 only; round 6 PASSED b3 (all other ACs pass on regression).

| # | Behavior | Verification | State |
|---|---|---|---|
| b1 | Slot ownership: half-open instants (not text), transitive clusters, deterministic sorted output, single session owns, contested has no owner until ruled, provisional winner | `pnpm --filter @holons/core exec vitest run src/sessions` | passing |
| b2 | Admin rulings: only the admin's count; a ruling holds while the clash holds only the talks it ruled on; a new talk reopens it; later ruling wins, tie to smaller id; chosen talk deleted reopens | same | passing |
| b3 | Swaps as offers about positions: proposals snapshot both talks and are void once either moves; one live proposal per target position, judged by history (no revival, no blocking by dead proposals); only the holder accepts/declines in time, only the requester withdraws; accepting moves both talks (applySwap), refused if a destination is taken | `pnpm --filter @holons/core exec vitest run src/sessions/swap.test.ts` | passing |
| b4 | Series: hub-local weekdays/until/exceptions, wall-clock time held across DST, duration kept across midnight, invalid interval yields nothing, half-open window | same | passing |
| b5 | Stars: per-person count through the registry, stable ranking | same | passing |
| b6 | Write tiers: table-driven; own-session resolves both ids; keynotes admin-locked via sessionAction/canWriteSession; admin denies unknown actions | same | passing |
| b7 | Registry: coordinator attestations and verified dual links only; forged link grants nothing; ids normalised (Telegram, hex, EVM) | same | passing |
| b8 | RSVP path retired where unused; generateICalFeed kept | grep in DECISIONS 2026-09-24 + discord-ui tests | passing |
| b9 | Core gate, SPDX, subpath exports, no UI imports | core gate | passing |
| grid | Sessions start and end on :00/:30 hub-local; off-grid sessions dropped from the store | same | passing |
| persistence | Lens map, validating parsers (canonical UTC instants, outcomes, intervals), soft delete, collision-free star ids | same | passing |

## b8 outcome (owner answers, 2026-09-24)
- Telegram `/rsvp` (@ElinorOstromBot) is LIVE: `packages/telegram-ui/src/RSVP.js` kept (wired at `HolonsMultiBot.js:23,123`; the command registers at `RSVP.js:33`).
- discord-ui is not deployed: its RSVP feature was removed (`features/rsvp.ts` deleted; `/calendar` lost its RSVP button and attendee count; `/ical` unchanged).
- mcp-ui RSVP tools: usage unknown, so kept.
- Core `rsvp.ts` keeps `toggleRSVP`, `isAttending`, `rsvpDisplayName`, `RSVPUser`; `buildRSVPList`, `countAttendees`, `RSVPEntry` removed (no remaining caller).
- apps/web and apps/kiosk only mention RSVP in comments; no change.

## Known limitations (accepted, recorded in DECISIONS)
- Authorship on public lenses is self-declared: the kiosk signs with a per-device key and `actingAs` is not bound to the person. The permission and ruling rules protect honest clients only. Real protection needs server-signed session writes for Telegram users (like shift RSVPs); not in v2.
- Sessions-mine equals shifts-mine only for coordinator attestations; the shifts board also honours other providers. If no coordinator is configured (`VITE_KIOSK_SHIFT_COORDINATOR`), key-login users resolve only to themselves.
- Commit `e7f16d4d` (already pushed) lacks a sign-off, and three early commit subjects contain em dashes. A squash merge fixes both without rewriting pushed history.

## Next steps
1. Squash-merge the v2 stack after Deca reviews v2c by clicking.
2. Spec docs in the vault to amend with the 2026-09-25 decisions (ruling by talk set, accepted swap moves both, half-hour grid, hub-local series).

# v2a (kiosk chrome, `feat/v2a-chrome-cleanup`)

Local check: `pnpm -F kiosk dev` with the root `.env` (dev namespace `ValleyOSDev`, dev user 100000001), then open http://localhost:5273/commons/calendar and compare with http://localhost:5273/liminal/calendar.

| # | Behavior | Verification | State |
|---|---|---|---|
| a1 | Commons Hub calendar view switch: Day and Week only; a remembered Month/Year reads as Week in both the switch and the grid; other holons and the Library keep Month/Year | `npx vitest run src/lib/hubChrome src/lib/stores.scope` + live click-path | passing (final pre-merge check 2026-09-26) |
| a2 | No visible VIEW/SHOW titles on the Commons Hub calendar tab; aria-labels kept | live | passing |
| a3 | No period heading on the Commons Hub calendar; Day shows its date band; arrows navigate | live | passing |
| a4 | No header wordmark on the Commons Hub | live | passing |
| a5 | Verify-only: the spec says the tab bar has no add-tab button, but the base has a "+" (Roberto, 6e09a780). Left unchanged; spec to correct | live | blocked (spec premise false) |
| a6 | Commons Hub scope shows Personal and Local on every tab; Federation returns on other holons in the same session; the device setting is kept; partner fetch code untouched | store tests + live | passing (final pre-merge check 2026-09-26) |
| a7 | `isAdmin` store: true only when the logged-in user resolves to settings.admin through the core registry | `npx vitest run src/lib/admin` | passing |
| a8 | Gate: kiosk typecheck + tests; changed files Prettier-clean | `pnpm -F kiosk typecheck && pnpm -F kiosk test` | passing (kiosk lint fails only on files unformatted before v2) |

Round 1 FAILED a1 and a6; round 2 passed all but one must-fix (re-selecting the shown scope or window overwrote the device preference), fixed afterwards and covered by a store test; a1 and a6 await an independent re-check.

Open questions for Deca: a4 hides the whole brand slot on the Commons Hub (a caretaker brand name or the holon name too), not only the literal "kiosk" fallback; confirm which was meant. Week view on the Commons Hub now shows no month name.

# v2c (unified programme, `feat/v2c-unified-tab`)

Local check: `pnpm -F @holons/core build && pnpm -F @holons/ai-ui build`, then `cd apps/kiosk && npx vite dev --port 5274` with the root `.env` (dev namespace `ValleyOSDev`, dev user 100000001, who is `settings.admin` in the dev namespace), and open http://localhost:5274/commons. Dev-only layout override for breakpoint checks: `localStorage.kiosk_programme_layout = "mobile" | "laptop" | "board"`.

| # | Behavior | Verification | State |
|---|---|---|---|
| c1 | Commons Hub shows exactly [programme]; toggles cannot reintroduce tabs (hidden in Settings); no "+" menu; no strip with one tab; other holons unchanged | `npx vitest run src/lib/programmeTab` + live | passing |
| c2 | Keynotes, sessions, shifts as layers with toggles; my-starred highlight; shifts show mine / signed-up / free | `npx vitest run src/lib/programmeGrid` + live | passing |
| c3 | Day (rooms as columns) and Week (Mon-Sun) only; overlaps in sub-columns; star emphasis (>= 3) as badge + border, geometry unchanged | `programmeGrid` tests + live | passing |
| c4 | Create by FAB or empty slot (prefilled room/time); popover on laptop, sheet on mobile; keynote type admin only; half-hour pickers; weekly repeat; edit own (admin any) | `npx vitest run src/lib/programmeActions` + live | passing |
| c5 | Star, public comments, shift sign-up through the existing RSVP path, cannot-sign state | actions tests + live | passing |
| c6 | Shift nudge: hub-week, threshold 2, snooze, never logged out / board / admin, not when nothing joinable | `pnpm --filter @holons/core exec vitest run src/shifts/nudge` + live | passing |
| c7 | Logged-out view and login popup (mount + 10 idle minutes); board mode per device (default off) suppresses personal features | live | passing |
| c8 | Breakpoints mobile < 768, laptop 768-1439, board >= 1440; mini-month only picks dates | live (override) | passing |
| c9 | Markers: .empty-state, .pending, .contested, keynote-locked, shift-locked, .full, mine vs others | live | passing |
| c10 | docs/kiosk-styling.md; new components import the shared Modal | file + grep | passing |
| c11 | Gate: kiosk typecheck + tests; changed files Prettier-clean; signed-off commits | `pnpm -F kiosk typecheck && pnpm -F kiosk test` | passing (kiosk `pnpm lint` still fails on 7 files unformatted before v2, none made worse) |
| swaps | Residents ask for a slot (trade places), holder accepts (both move) or declines, requester withdraws | actions tests + live | passing |
| rooms | Admin adds and renames rooms from the programme gear | actions tests + live | passing |

Deploy prerequisites (not done): (2026-09-26 additions: NOSTR_DERIVATION_SECRET obtained from Roberto, it belongs in Netlify/Infisical, never in git; a member's Holons key must be linked to their Telegram id by a kind-31926 attestation, or their kiosk sign-ups show as an anonymous key on Xavier's Elinor board: confirm with Roberto/Xavier which provider publishes that link; the Commons Hub schedule's coordinator is 3f432836… (Elinor), not the Holons coordinator 100c9e86…, so creating shifts from the kiosk planner would start a second schedule until the two are reconciled; set settings.admin to Deca's Telegram id) set `settings.admin` on the real Commons Hub to Deca's Telegram numeric id (a read on 2026-09-25 found no settings record); confirm `settings.timezone` (unknown; UTC until set); `NOSTR_DERIVATION_SECRET` for shift sign-up; confirm the shift relay URL; `VITE_KIOSK_SHIFT_COORDINATOR` so key logins link to Telegram ids.

Evaluation history (v2c, 2026-09-25): round 1 FAILED c4, c6, c7, c8, c11 and a shared-board dead end; round 2 PASSED all criteria. The two optional round-2 items (squeezed card titles, "0 signed up/ 2") are fixed.
