# Decisions Log (v2b)

Append-only. Format: `YYYY-MM-DD - decision - why - what it touched`.

2026-09-16 - Subpath `@holons/core/sessions` auto-resolved by existing `"./*"` glob in package.json exports map — no config change needed. - Confirms strategy from spec; just create src/sessions/index.ts. - packages/core/package.json (read-only, no change).

2026-09-16 - Pre-existing gate failures (mcp-ui vitest types; holosphere fake-indexeddb) are out of scope and pre-date this branch. The gate contract for v2b is scoped to @holons/core passing typecheck + test + lint. - These failures exist on elinor main before any v2b work. - PROGRESS.md baseline note.

2026-09-16 - Identity registry built on top of shifts/attestation.ts (attestationIdentityMap), not as a parallel system. The sessions registry extends the collapse already proven for shifts so "mine for shifts" and "mine for sessions" agree without code duplication. - Spec AC-b7 explicitly requires reusing shiftIdentity collapse. - packages/core/src/sessions/registry.ts, packages/core/src/shifts/attestation.ts (read-only dep).

2026-09-16 - RSVP cleanup: discord-ui is an ACTIVE consumer (calendar.ts + rsvp.ts both call toggleRSVP/buildRSVPList). telegram-ui/RSVP.js is an active consumer. Both are kept on the retained RSVP path; the RSVP symbols are NOT removed. The zero-references check for AC-b8 must wait for explicit confirmation that these consumers are unused/dead. FLAG for Deca before executing. - Grepping confirms live callers. Removing live consumers without confirmation violates the spec's caveat. - AC-b8 deferred; PROGRESS.md blocker note added.

2026-09-16 - series.ts Sunday ordering: within a cycle the weekdays are now sorted by Monday offset before iterating, so Sunday (dow=0, offset=6) emits after Saturday (dow=6, offset=5) and all other weekdays, preserving chronological output order. Discovered by adversarial evaluator; the initial Tue+Thu tests hid this because Tue(offset=1) < Thu(offset=3) in both iteration and calendar order. - A correctness fix; the spec doesn't constrain output order explicitly but chronological ordering is the only reasonable contract for a calendar expansion function. - series.ts lines 67-71; sessions.test.ts (new Sun+Mon test added).
