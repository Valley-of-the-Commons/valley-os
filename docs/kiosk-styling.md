<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

# Kiosk styling guide

The kiosk app (`apps/kiosk`) has no Tailwind and no component library. Every
component ships a scoped Svelte `<style>` block, and every scoped block draws
its colours, spacing, and shadows from the CSS custom properties defined once
in `apps/kiosk/src/app.css`. There is no separate "design system" package:
`app.css` is the token source, and the components below are the closest thing
the kiosk has to a shared UI kit. This document exists because none did
before (valley-os v2c AC-c10).

New session/shift/room components (`SessionEditor.svelte`,
`SessionDetail.svelte`, `ShiftDetail.svelte`, `RoomsPanel.svelte`) import and
wrap `Modal.svelte` rather than building their own dialog chrome, and
`ProgrammeGrid.svelte` reuses the post-it card conventions documented below
instead of inventing new ones.

## Tokens

All tokens are CSS custom properties on `:root`, defined in
`apps/kiosk/src/app.css:5-57`. Light (default) values:

| Token | Light value | Purpose |
|---|---|---|
| `--paper` | `#f7f4ec` | Page/background surface |
| `--paper-deep` | `#efeadd` | Recessed surface (tracks, panels, empty pills) |
| `--card` | `#fffdf8` | Raised surface (modal body, side panel) |
| `--ink` | `#20302f` | Primary text |
| `--ink-soft` | `#4d5e5c` | Secondary text (meta lines, labels) |
| `--muted` | `#8a9794` | Tertiary text (placeholders, disabled-ish) |
| `--teal` | `#0e6b66` | Brand accent: primary buttons, active states, selection |
| `--teal-deep` | `#0a4f4a` | Darker accent (column headers, "today" marker) |
| `--line` | `#e3ddcd` | Hairline borders, input borders |
| `--warn` | `#c8542a` | The one alarm colour: contested items, delete/danger, errors |
| `--note-sun` | `#ffe79a` | Post-it: keynote cards |
| `--note-mint` | `#c4e8cd` | Post-it: shift cards |
| `--note-sky` | `#c2e3f0` | Post-it: default session cards |
| `--note-coral` | `#ffc7b8` | Post-it palette (other note kinds) |
| `--note-lav` | `#ddd2f1` | Post-it: "mine" cards |
| `--note-lime` | `#e6efa7` | Post-it palette (other note kinds) |
| `--shadow-note` | `0 10px 22px rgba(28,48,46,.14)` | Drop shadow for a lifted post-it |
| `--shadow-soft` | `0 6px 18px rgba(28,48,46,.08)` | Lighter shadow for chips, active pill segments |
| `--radius` | `18px` | Default corner radius |
| `--tap` | `64px` | Reference large tap-target size |

(`app.css:5-33`.) Not every token is used by every component; the table lists
what the file defines. `--font-logo` (`app.css:35-39`) is a display font
stack for the wordmark only, not general UI text.

## Dark theme

Dark mode is applied by setting `data-theme="dark"` on `<html>`
(`app.css:66`, driven by `lib/theme.ts`, including an automatic sunset
switch). It only re-points the tokens above; component markup and scoped
styles are unchanged:

- Surfaces invert (`--paper: #14181a`, `--card: #1c2226`), ink goes
  near-white (`--ink: #eef2f0`), `--line` and `--muted` darken to match
  (`app.css:66-86`).
- The post-it palette (`--note-*`) is re-cast as deep jewel tones instead of
  pale pastels, because note text still reads via `--ink`, which is now
  light, and needs a dark ground to stay legible (`app.css:77-82`).
- `--teal` is intentionally **not** overridden: the accent carries across
  both skins.
- A few global overrides exist for content authored with hard-coded
  light-theme colours (`.tag`, `.kind`, `.chip`, `.open`, `.fixednote`,
  `.when`, `.where`, `.src`, `.tool`, `.take.in`, `.ghost`), re-tinted under
  `:root[data-theme="dark"]` so they don't go invisible on a dark card
  (`app.css:94-119`). New components should prefer `var(--ink)` /
  `var(--ink-soft)` directly so they don't need one of these overrides.
- `Modal.svelte` also has its own dark-mode rule: instead of flooding the
  whole dialog with the category tint, the card stays on `var(--card)` and
  the tint shows as a wash (`Modal.svelte:98-105`).

## Modal

`Modal.svelte` (`apps/kiosk/src/lib/components/Modal.svelte`) is the shared
"card zooms up from a dimmed backdrop" dialog. It dispatches a `close` event;
it does not manage its own open/closed state, so the parent renders it
conditionally (`{#if ...}<Modal on:close={...}>...</Modal>{/if}`).

Props (`Modal.svelte:9-19`):

| Prop | Default | Meaning |
|---|---|---|
| `tint` | `"var(--card)"` | Background colour of the card, e.g. a post-it tone |
| `holo` | `false` | Render the card as a `.holo` hologram projection (see `app.css:175-406`) |
| `glow` | `undefined` | Source-holon glow hue driving the hologram's colour |
| `seed` | `undefined` | Per-record `[0,1)` clock seed so a hologram's flicker doesn't sync across cards |
| `wide` | `false` | Widen the card to `min(64rem, 100%)` for sheets that pair a form with a board preview |
| `sheet` | `false` | Below 768px, fill the screen as a full-height sheet instead of a centred card |

Behaviour:

- Backdrop click and `Escape` both close the modal. The backdrop only closes
  on a `pointerdown` + `click` pair that both land on the backdrop itself,
  not on the card, so a drag that ends outside the card doesn't dismiss it
  mid-gesture (`Modal.svelte:23-36`).
- A 44×44px circular `✕` button sits top-right (`Modal.svelte:60-62`,
  `.x` at `Modal.svelte:121-134`) with an `aria-label` from `$t("common.close")`.
- With `sheet`, the `@media (max-width: 767px)` block removes the backdrop
  padding and makes `.card` full width/height with square corners
  (`Modal.svelte:142-157`). Without `sheet`, the modal stays a centred card
  at any width.

Use `sheet` for anything meant to be a full workflow on a phone (forms,
detail views with actions): `SessionEditor.svelte`, `SessionDetail.svelte`
(implicitly via its own wrapping, see below), `ShiftDetail.svelte`,
`RoomsPanel.svelte` all pass `sheet`. Example, from
`SessionEditor.svelte:104`:

```svelte
<Modal sheet on:close={onClose}>
  <form class="editor" on:submit|preventDefault={save}>
    ...
  </form>
</Modal>
```

`ShiftDetail.svelte:29` shows `sheet` combined with a `tint`:

```svelte
<Modal sheet tint="var(--note-mint)" on:close={onClose}>
```

## Cards (post-it notes)

The kiosk's recurring content unit is a "post-it": a small rectangle with a
solid pastel background, `border-radius: 10px`, and `box-shadow:
var(--shadow-soft)`. `ProgrammeGrid.svelte` is the reference implementation
(`.card` at `ProgrammeGrid.svelte:187-204`).

Palette (kind → background token):

| Kind class | Token | Meaning |
|---|---|---|
| (none, default) | `--note-sky` | Plain session |
| `.keynote` | `--note-sun` | Keynote session |
| `.shift` | `--note-mint` | Shift |
| `.mine` | `--note-lav` | Session/shift the viewer owns (overrides the kind colour) |

State markers, layered on top of the base card without changing its box:

- `.contested` adds a diagonal hatched background
  (`repeating-linear-gradient`, `ProgrammeGrid.svelte:222-228`); paired with
  a `.contested-badge` pill (`--warn` background, white text,
  `ProgrammeGrid.svelte:266-269`).
- `.pending` (a write in flight) drops opacity to `0.55` and switches the
  border to dashed `--muted` (`ProgrammeGrid.svelte:232-236`).
- `.full` (a shift at capacity) drops opacity to `0.7`
  (`ProgrammeGrid.svelte:229-231`), plus a `.full-badge`
  (`--ink-soft` background, white text, `ProgrammeGrid.svelte:274-277`).
- `.mine` also renders a `.mine-badge`.
- `.emphasised` (starred) changes only the `border-color` to `--teal`
  (`ProgrammeGrid.svelte:218-221`) and adds a `.star-badge` showing the
  count; it never changes size or position. This is a stated rule in the
  component's own header comment: "Star emphasis is a badge and a border
  only; it never changes a card's position or size"
  (`ProgrammeGrid.svelte:6-7`).
- `.highlight` (the caretaker's "show my starred items" mode) adds a 3px
  inset `--teal` outline (`ProgrammeGrid.svelte:214-217`), again without
  moving the card.

**Rule: emphasis never changes geometry.** Every state above is expressed as
border, outline, background-image, opacity, or a badge appended inside the
card, never as a change to width, height, padding, or position. This keeps a
day/week grid's time axis accurate regardless of which cards are
highlighted, contested, or pending.

Badges (`.badge`, `ProgrammeGrid.svelte:258-265`) are small pills: `0.65rem`
font, `999px` border-radius, default background
`rgba(255, 255, 255, 0.7)` over `var(--ink)` text, with the state-specific
overrides above replacing the background per kind.

## Controls

**Global button reset** (`app.css:141-148`): every `<button>` inherits font
and color, has no border or background, `cursor: pointer`, and a transparent
`-webkit-tap-highlight-color`. Every button style below is opt-in on top of
this reset, not a browser default being overridden per component.

**Pill buttons** are the kiosk's standard interactive control: `min-height:
44px`, `border-radius: 999px`, bold text, e.g. the modal action row in
`SessionEditor.svelte:279-284`:

```css
.actions button {
  min-height: 44px;
  padding: 0 1.1rem;
  border-radius: 999px;
  font-weight: 700;
}
```

- `.primary` = `background: var(--teal); color: #fff;` (e.g.
  `SessionEditor.svelte:285-288`, `RoomsPanel.svelte:119-122`,
  `ShiftDetail.svelte:110-113`). Used for the one affirmative action in a
  form (save, add, take a shift, log in).
- `.danger` = `background: var(--warn); color: #fff;`
  (`SessionEditor.svelte:292-295`), used for delete. A `.danger.ghost`
  variant (transparent background, `--warn` text) is the un-confirmed state
  of a two-step delete, before the caretaker taps it again to get the solid
  `.danger` confirm button (`SessionEditor.svelte:182-199`).
- A plain (non-primary, non-danger) pill button defaults to
  `background: var(--paper-deep); color: var(--ink);` (e.g.
  `RoomsPanel.svelte:108-115`, `ShiftDetail.svelte:101-109`).
- `:disabled` states drop opacity (`0.5`-`0.6`) rather than changing colour
  (`RoomsPanel.svelte:116-118`, `SessionEditor.svelte:289-291`).

**PillSwitch** (`PillSwitch.svelte`) is the segmented control shared across
views for filter/layout/sort choices (Day/Week, scope, sort order). It
renders as `role="radiogroup"` of `role="radio"` buttons on a flat
`--paper` track (no border or shadow; only the active segment is raised
with a `--teal` background and `--shadow-soft`,
`PillSwitch.svelte:120-190`). Below 560px (or when the parent passes
`compact`), it collapses into a single `.cycler` button that steps through
the options on tap, keeping the same accessible label
(`PillSwitch.svelte:199-237`). Arrow-left/right move a roving focus within
the radiogroup (`PillSwitch.svelte:51-61`).

**Settings toggle switch** (`Settings.svelte`) is the on/off pattern for
boolean settings (e.g. enabling the Tasks or Calendar tab). Markup is a
`.field.toggle-field` row: a label with an optional `.sub` line, and a
`button.switch[role="switch"]` with `aria-checked` and a sliding `.knob`
(`Settings.svelte:602-617`):

```svelte
<div class="field toggle-field">
  <span class="toggle-label"
    >{$t("settings.tasksTab")}
    <span class="sub">{$t("settings.tasksTabSub")}</span></span
  >
  <button
    type="button"
    class="switch"
    class:on={$tasksEnabled}
    role="switch"
    aria-checked={$tasksEnabled}
    aria-label={$t("settings.tasksTabAria")}
    on:click={() => commitTasks(!$tasksEnabled)}
  >
    <span class="knob"></span>
  </button>
</div>
```

The track is `3.1rem × 1.8rem`, `999px` radius, `background: var(--line)`
that switches to `var(--teal)` when `.on`; the knob is a white circle that
translates across on state change (`Settings.svelte:1409-1448`).

**Form inputs**: text/date inputs, selects, and textareas share one look
across `SessionEditor.svelte`, `RoomsPanel.svelte`, and similar forms:
`1px solid var(--line)` border, `10px` border-radius, `var(--card)`
background, `0.55rem 0.65rem` padding (`SessionEditor.svelte:230-241`,
`RoomsPanel.svelte:98-107`). Radio/checkbox `.choice` labels lay out inline
with the control before the text (`SessionEditor.svelte:261-267`).

## Layout and breakpoints

`ProgrammeView.svelte` defines three layouts by viewport width, checked
against `svelte:window bind:innerWidth` (`ProgrammeView.svelte:129-145,410`):

| Layout | Width | Sidebar | Notes |
|---|---|---|---|
| `mobile` | `< 768px` | Slide-out drawer (`.side.drawer`), opened by a burger button and a floating action button (FAB) | `scale = 1` |
| `laptop` | `768px`-`1439px` | Fixed sidebar alongside the grid | `scale = 1.2` |
| `board` | `>= 1440px` | Fixed sidebar alongside the grid | `scale = 1.4` (bigger cards on a wall display) |

On `mobile`, the sidebar (`<aside class="side drawer">`) only renders when
`drawerOpen` is true, closes via its own "Close" button, and a `.fab`
button (rendered only in this layout, `ProgrammeView.svelte:525-529`)
offers session/shift creation without opening the drawer. On `laptop` and
`board`, the sidebar is always visible and instead shows a `MiniMonth` date
picker and a "+ Create" button (`ProgrammeView.svelte:452-459`).

When there are no live sessions, an `.empty-state` block replaces the grid
content with a message and a contextual hint, e.g. "no rooms yet" for an
admin versus a generic empty hint for everyone else
(`ProgrammeView.svelte:502-510`).

This is distinct from the kiosk-wide phone breakpoint. `apps/kiosk/src/lib/config.ts:648`
defines `MOBILE_MAX_WIDTH_PX = 560`, used by `isPhoneDisplay()` and
`resolveTaskView()` to decide whether the *device itself* is a phone
(matching on width **or** height, so a rotated phone still counts,
`config.ts:655-660`) versus a tablet or wall display. `ProgrammeView`'s
`768px`/`1440px` values are unrelated per-view layout breakpoints for the
programme grid specifically, not a redefinition of "phone."

## Accessibility

- **44px minimum tap targets.** Pill buttons (`min-height: 44px`,
  `SessionEditor.svelte:280`), the modal close button
  (`44px × 44px`, `Modal.svelte:126-127`), the side-panel close button
  (`SidePanel.svelte:180-181`), and room-editor inputs
  (`min-height: 44px`, `RoomsPanel.svelte:105`) all hit this floor.
- **`aria-label` on icon-only controls.** Close buttons use
  `aria-label={$t("common.close")}` even though the visible content is just
  an icon (`Modal.svelte:60`, `SidePanel.svelte:120`). `PillSwitch`'s
  segmented buttons carry `aria-label={m.label}` and a matching `title`
  even when `showText` is off and no text is visible
  (`PillSwitch.svelte:87-88`). The mobile cycler explains both what it
  controls and its current value in one `aria-label`
  (`PillSwitch.svelte:102`).
- **`role="switch"`** for the Settings on/off toggle
  (`Settings.svelte:611`, with `aria-checked` bound to state), and
  **`role="radio"`/`role="radiogroup"`** for `PillSwitch`
  (`PillSwitch.svelte:68,80-81`) and the Day/Week switch in
  `ProgrammeView.svelte:415-430`.
- **`role="dialog"` + `aria-modal="true"`** on both `Modal.svelte:57-58`
  and `SidePanel.svelte:113-114`; `SidePanel` additionally implements a full
  dialog contract (`aria-labelledby`, a focus trap on Tab, and focus
  returned to the opener on close, `SidePanel.svelte:32-95`), which `Modal`
  does not.
- **`:focus-visible` outlines** exist where a non-button element is made
  interactive: `ProgrammeGrid.svelte:176-179` gives each grid column
  (`role="button"`, used for "tap empty space to create") a `2px solid
  var(--teal)` outline on keyboard focus, since it has no default browser
  focus ring of its own.
- **`prefers-reduced-motion: reduce`** globally disables all animations and
  transitions (`app.css:430-435`), with `Modal.svelte:158-162` and
  `SidePanel.svelte:238-243` providing their own reduced fallback (a plain
  fade instead of the pop/slide-in) since their entrance animations are
  otherwise not covered by the blanket rule.
