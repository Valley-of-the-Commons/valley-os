<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // The programme's Day/Week grid (valley-os v2c AC-c3/c9). Renders a
  // GridModel: columns of rooms (Day) or days (Week), cards placed by time
  // with overlap sub-columns. Star emphasis is a badge and a border only; it
  // never changes a card's position or size.
  //
  // Cards the viewer may edit can be dragged to another time or column and
  // resized from their bottom edge, snapping to the half hour, like the
  // kiosk calendar: a mouse drags on move, a finger after a still hold (so a
  // swipe that starts on a card still scrolls the grid).
  import { onDestroy } from "svelte";
  import type { GridCard, GridColumn, GridModel } from "$lib/programmeGrid";
  import { slotAt } from "$lib/programmeTime";
  import { createEdgeScroll } from "$lib/edgescroll";
  import { t, locale } from "$lib/i18n";

  export let model: GridModel;
  /** Session ids with a write in flight (`.pending`). */
  export let pending: Set<string> = new Set();
  export let onCard: (card: GridCard) => void = () => {};
  export let onEmpty: (column: GridColumn, time: string) => void = () => {};
  /** Empty slots invite creating a session only when the viewer may. */
  export let canCreate = true;
  /** Whether the viewer may move/resize this card. */
  export let canDrag: (card: GridCard) => boolean = () => false;
  /** A drop: the card's new column and hub-local minutes (snapped). */
  export let onMove: (
    card: GridCard,
    to: { column: GridColumn; startMin: number; endMin: number },
  ) => void = () => {};
  /** A tap on the Shifts column at a time (join the shift there). */
  export let onShiftColumn: (time: string) => void = () => {};
  /** The viewer is short of shifts this week: the Shifts column glows. */
  export let glowShifts = false;

  /** Pixels per minute: an hour is 72px (84px on the shared board). */
  export let scale = 1.2;

  const STEP = 30; // the half-hour grid
  const HOLD_MS = 280;
  const HOLD_SLOP_PX = 8;

  $: hours = Array.from(
    { length: Math.max(0, (model.endMin - model.startMin) / 60) },
    (_, i) => model.startMin + i * 60,
  );
  $: height = (model.endMin - model.startMin) * scale;
  $: byColumn = new Map(
    model.columns.map((c) => [
      c.key,
      model.cards.filter((card) => card.column === c.key),
    ]),
  );
  $: bannersFor = (date: string) =>
    model.banners.filter((b) => b.date === date);

  const hourLabel = (min: number) =>
    `${String(Math.floor(min / 60)).padStart(2, "0")}:00`;
  const timeOf = (min: number) =>
    `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
  const snap = (min: number) => Math.round(min / STEP) * STEP;

  function dayLabel(date: string, loc: string) {
    return new Intl.DateTimeFormat(loc, {
      weekday: "short",
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    }).format(new Date(`${date}T12:00:00Z`));
  }
  function columnLabel(c: GridColumn, loc: string) {
    if (c.kind === "room") return c.roomName ?? "";
    if (c.kind === "shifts") return $t("programme.shiftsColumn");
    return dayLabel(c.date, loc);
  }

  const minuteAt = (el: HTMLElement, clientY: number) =>
    model.startMin + (clientY - el.getBoundingClientRect().top) / scale;

  function clickColumn(e: MouseEvent, column: GridColumn) {
    if (e.target !== e.currentTarget || justDragged) return; // a card, not empty space
    const time = slotAt(minuteAt(e.currentTarget as HTMLElement, e.clientY));
    if (column.kind === "shifts") onShiftColumn(time);
    else if (canCreate) onEmpty(column, time);
  }
  function keyColumn(e: KeyboardEvent, column: GridColumn) {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    const time = slotAt(Math.max(model.startMin, 9 * 60));
    if (column.kind === "shifts") onShiftColumn(time);
    else if (canCreate) onEmpty(column, time);
  }
  const interactive = (c: GridColumn) => c.kind === "shifts" || canCreate;

  // ── Drag and resize ──────────────────────────────────────────────────────
  type Press = {
    card: GridCard;
    mode: "move" | "resize";
    x: number;
    y: number;
    grab: number;
    armed: boolean;
  };
  let press: Press | null = null;
  let drag: {
    card: GridCard;
    mode: "move" | "resize";
    column: GridColumn;
    startMin: number;
    endMin: number;
  } | null = null;
  let holdTimer: ReturnType<typeof setTimeout> | null = null;
  let lastX = 0;
  let lastY = 0;
  let justDragged = false;
  let bodyEl: HTMLElement;

  const edgeScroll = createEdgeScroll({
    onScroll: () => {
      if (press) aim(lastX, lastY);
    },
  });

  function begin(e: PointerEvent, card: GridCard, mode: "move" | "resize") {
    if (!canDrag(card) || (e.button != null && e.button !== 0)) return;
    const colEl = (e.currentTarget as HTMLElement).closest(
      ".col",
    ) as HTMLElement;
    press = {
      card,
      mode,
      x: e.clientX,
      y: e.clientY,
      grab: minuteAt(colEl, e.clientY) - card.startMin,
      armed: e.pointerType === "mouse",
    };
    lastX = e.clientX;
    lastY = e.clientY;
    if (!press.armed)
      holdTimer = setTimeout(() => {
        holdTimer = null;
        if (!press) return;
        if (Math.hypot(lastX - press.x, lastY - press.y) > HOLD_SLOP_PX)
          cancel();
        else press = { ...press, armed: true };
      }, HOLD_MS);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    document.addEventListener("scroll", onPendingScroll, true);
  }

  // A scroll while the press is undecided means the finger is scrolling.
  function onPendingScroll() {
    if (press && !press.armed && !drag) cancel();
  }
  // Once armed, keep the finger's move ours instead of a browser pan.
  function onTouchMove(e: TouchEvent) {
    if (press?.armed || drag) e.preventDefault();
  }

  function unbind() {
    if (holdTimer) clearTimeout(holdTimer);
    holdTimer = null;
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("pointercancel", cancel);
    window.removeEventListener("touchmove", onTouchMove);
    document.removeEventListener("scroll", onPendingScroll, true);
    edgeScroll.stop();
  }
  function cancel() {
    unbind();
    press = null;
    drag = null;
  }
  onDestroy(cancel);

  /** Where the dragged card would land under the pointer. */
  function aim(x: number, y: number) {
    if (!press) return;
    const p = press;
    const under = document
      .elementsFromPoint(x, y)
      .find((el) => (el as HTMLElement).dataset?.col) as
      HTMLElement | undefined;
    const column =
      p.mode === "resize"
        ? model.columns.find((c) => c.key === p.card.column)
        : model.columns.find(
            (c) => c.key === under?.dataset.col && c.kind !== "shifts",
          );
    if (!column) return;
    const colEl = bodyEl?.querySelector(
      `[data-col="${CSS.escape(column.key)}"]`,
    ) as HTMLElement | null;
    if (!colEl) return;
    const length = p.card.endMin - p.card.startMin;
    const minute = minuteAt(colEl, y);
    if (p.mode === "resize") {
      const endMin = Math.min(
        24 * 60,
        Math.max(p.card.startMin + STEP, snap(minute)),
      );
      drag = {
        card: p.card,
        mode: "resize",
        column,
        startMin: p.card.startMin,
        endMin,
      };
    } else {
      const startMin = Math.min(
        24 * 60 - length,
        Math.max(0, snap(minute - p.grab)),
      );
      drag = {
        card: p.card,
        mode: "move",
        column,
        startMin,
        endMin: startMin + length,
      };
    }
  }

  function onPointerMove(e: PointerEvent) {
    if (!press) return;
    lastX = e.clientX;
    lastY = e.clientY;
    const moved = Math.hypot(e.clientX - press.x, e.clientY - press.y);
    if (!press.armed) {
      if (moved > HOLD_SLOP_PX) cancel(); // a swipe: let it scroll
      return;
    }
    if (!drag && moved < 6) return;
    e.preventDefault();
    aim(e.clientX, e.clientY);
    edgeScroll.move(e.clientX, e.clientY);
  }

  function onPointerUp() {
    const done = drag;
    unbind();
    press = null;
    drag = null;
    if (!done) return;
    justDragged = true; // swallow the click that follows this pointerup
    setTimeout(() => (justDragged = false), 0);
    const unchanged =
      done.column.key === done.card.column &&
      done.startMin === done.card.startMin &&
      done.endMin === done.card.endMin;
    if (!unchanged)
      onMove(done.card, {
        column: done.column,
        startMin: done.startMin,
        endMin: done.endMin,
      });
  }

  function tap(card: GridCard) {
    if (!justDragged) onCard(card);
  }
</script>

<div
  class="grid"
  class:dragging={!!drag}
  style="--cols: {model.columns.length}; --scale: {scale}; --colmin: {model
    .columns[0]?.kind === 'day'
    ? '6rem'
    : '7.5rem'};"
>
  <div class="heads">
    <span class="rail-head" aria-hidden="true"></span>
    {#each model.columns as c (c.key)}
      <div
        class="head"
        class:shifts={c.kind === "shifts"}
        class:glow={c.kind === "shifts" && glowShifts}
      >
        {columnLabel(c, $locale)}
      </div>
    {/each}
  </div>

  <!-- The all-day banner row: the day's breaks (AC-c8). -->
  <div class="banners">
    <span class="rail-head" aria-hidden="true"></span>
    {#if model.columns.some((c) => c.kind === "day")}
      {#each model.columns as c (c.key)}
        <div class="banner-cell">
          {#each bannersFor(c.date) as b (b.key)}<span class="banner"
              >{b.label} {timeOf(b.startMin)}–{timeOf(b.endMin)}</span
            >{/each}
        </div>
      {/each}
    {:else}
      <div class="banner-cell span">
        {#each model.banners as b (b.key)}<span class="banner"
            >{b.label} {timeOf(b.startMin)}–{timeOf(b.endMin)}</span
          >{/each}
      </div>
    {/if}
  </div>

  <div class="body" style="height: {height}px;" bind:this={bodyEl}>
    <div class="rail" aria-hidden="true">
      {#each hours as h (h)}
        <span style="top: {(h - model.startMin) * scale}px;"
          >{hourLabel(h)}</span
        >
      {/each}
    </div>
    {#each model.columns as c (c.key)}
      <!-- svelte-ignore a11y_no_noninteractive_tabindex a11y_no_static_element_interactions a11y_click_events_have_key_events -->
      <div
        class="col"
        class:creatable={canCreate && c.kind !== "shifts"}
        class:shifts-col={c.kind === "shifts"}
        class:glow={c.kind === "shifts" && glowShifts}
        class:drop-target={drag?.column.key === c.key}
        data-col={c.key}
        role={interactive(c) ? "button" : undefined}
        tabindex={interactive(c) ? 0 : undefined}
        aria-label={interactive(c)
          ? `${columnLabel(c, $locale)}: ${c.kind === "shifts" ? $t("programmeShifts.joinHere") : $t("programme.create")}`
          : undefined}
        on:click={(e) => clickColumn(e, c)}
        on:keydown={(e) => keyColumn(e, c)}
      >
        {#each hours as h (h)}
          <span
            class="line"
            style="top: {(h - model.startMin) * scale}px;"
            aria-hidden="true"
          ></span>
        {/each}
        {#each byColumn.get(c.key) ?? [] as card (card.key)}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            class="card {card.kind}"
            class:contested={card.contested}
            class:mine={card.mine}
            class:starred={card.starred}
            class:emphasised={card.emphasised}
            class:full={card.full}
            class:pending={pending.has(card.id)}
            class:narrow={card.lanes > 1}
            class:short={card.endMin - card.startMin <= 60}
            class:draggable={canDrag(card)}
            class:lifted={drag?.card.key === card.key}
            style="top: {(card.startMin - model.startMin) *
              scale}px; height: {(card.endMin - card.startMin) *
              scale}px; left: calc({card.lane} * 100% / {card.lanes}); width: calc(100% / {card.lanes});"
            on:pointerdown={(e) => begin(e, card, "move")}
          >
            <button
              type="button"
              class="face"
              aria-label={[
                card.title,
                `${timeOf(card.startMin)}–${timeOf(card.endMin)}`,
                card.kind === "keynote" ? $t("programme.keynote") : "",
                card.mine && card.kind !== "shift" ? $t("programme.mine") : "",
                card.starred ? $t("sessionDetail.unstar") : "",
              ]
                .filter(Boolean)
                .join(", ")}
              on:click={() => tap(card)}
            >
              <span class="title">{card.title}</span>
              <!-- Time, room and labels share one wrapping line, so short cards keep them. -->
              <span class="meta">
                <span class="time"
                  >{timeOf(card.startMin)}–{timeOf(
                    card.endMin,
                  )}{#if card.kind !== "shift" && c.kind === "day" && card.roomName}{" · "}{card.roomName}{/if}</span
                >
                {#if card.contested}<span class="badge contested-badge"
                    >{$t("programme.contested")}</span
                  >{/if}
                {#if card.kind === "shift"}
                  {#if card.mine}<span class="badge on-badge"
                      >{$t("programmeShifts.onIt")}</span
                    >{/if}
                  {#if card.full}<span class="badge full-badge"
                      >{$t("programme.full")}</span
                    >{/if}
                  <span class="badge"
                    >{card.lanes > 1
                      ? `${card.taken} ✋`
                      : $t("programme.signedUp", { count: card.taken })}</span
                  >
                {/if}
                {#if card.emphasised || card.starred}
                  <span
                    class="badge star-badge"
                    aria-label={$t("sessionDetail.starCount", {
                      count: card.stars,
                    })}>★ {card.stars}</span
                  >
                {/if}
              </span>
            </button>
            {#if canDrag(card)}
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <span
                class="resize"
                aria-hidden="true"
                on:pointerdown|stopPropagation={(e) => begin(e, card, "resize")}
              ></span>
            {/if}
          </div>
        {/each}
        {#if drag && drag.column.key === c.key}
          <div
            class="ghost {drag.card.kind}"
            style="top: {(drag.startMin - model.startMin) *
              scale}px; height: {(drag.endMin - drag.startMin) * scale}px;"
            aria-hidden="true"
          >
            <span class="title">{drag.card.title}</span>
            <span class="time"
              >{timeOf(drag.startMin)}–{timeOf(drag.endMin)}</span
            >
          </div>
        {/if}
      </div>
    {/each}
  </div>
</div>

<style>
  .grid {
    display: grid;
    grid-template-rows: auto auto 1fr;
    min-width: calc(3.5rem + var(--cols) * var(--colmin));
  }
  .grid.dragging {
    user-select: none;
    -webkit-user-select: none;
  }
  .heads,
  .body {
    display: grid;
    grid-template-columns: 3.5rem repeat(
        var(--cols),
        minmax(var(--colmin), 1fr)
      );
  }
  .heads {
    position: sticky;
    top: 0;
    z-index: 3;
    background: var(--paper);
    border-bottom: 1px solid var(--line);
  }
  .head {
    padding: 0.5rem 0.4rem;
    font-weight: 700;
    font-size: 0.85rem;
    color: var(--ink);
    text-align: center;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .head.shifts {
    color: var(--teal-deep);
  }
  .banners {
    display: grid;
    grid-template-columns: 3.5rem repeat(
        var(--cols),
        minmax(var(--colmin), 1fr)
      );
    border-bottom: 1px solid var(--line);
    min-height: 1.6rem;
  }
  .banner-cell {
    display: flex;
    flex-wrap: wrap;
    gap: 0.2rem;
    padding: 0.2rem;
    border-left: 1px solid var(--line);
  }
  .banner-cell.span {
    grid-column: 2 / -1;
  }
  .banner {
    font-size: 0.7rem;
    padding: 0.1rem 0.4rem;
    border-radius: 999px;
    background: var(--paper-deep);
    color: var(--ink-soft);
    white-space: nowrap;
  }
  .body {
    position: relative;
  }
  .rail {
    position: relative;
  }
  .rail span {
    position: absolute;
    right: 0.4rem;
    transform: translateY(-0.5em);
    font-size: 0.72rem;
    color: var(--muted);
  }
  .col {
    position: relative;
    border-left: 1px solid var(--line);
  }
  .col.creatable,
  .col.shifts-col {
    cursor: copy;
  }
  .col.drop-target {
    background: color-mix(in srgb, var(--teal) 7%, transparent);
  }
  .col:focus-visible {
    outline: 2px solid var(--teal);
    outline-offset: -2px;
  }
  /* The viewer is short of shifts this week: a red, gently pulsing glow. */
  .col.glow,
  .head.glow {
    box-shadow: inset 0 0 0 2px var(--alert);
    animation: shifts-glow 1.6s ease-in-out infinite;
  }
  @keyframes shifts-glow {
    0%,
    100% {
      box-shadow:
        inset 0 0 0 2px var(--alert),
        0 0 0 0 rgba(224, 50, 43, 0);
    }
    50% {
      box-shadow:
        inset 0 0 0 2px var(--alert),
        0 0 14px 2px rgba(224, 50, 43, 0.55);
    }
  }
  .line {
    position: absolute;
    left: 0;
    right: 0;
    border-top: 1px dashed var(--line);
    pointer-events: none;
  }
  .card {
    position: absolute;
    box-sizing: border-box;
    border: 2px solid transparent;
    border-radius: 10px;
    background: var(--note-sky);
    box-shadow: var(--shadow-soft);
    color: var(--ink);
    overflow: hidden;
    /* Glide into place after a move or resize. */
    transition:
      top 0.18s ease,
      height 0.18s ease,
      left 0.18s ease,
      width 0.18s ease,
      opacity 0.15s ease;
  }
  .card.draggable {
    cursor: grab;
  }
  .card.lifted {
    opacity: 0.35;
  }
  .face {
    all: unset;
    box-sizing: border-box;
    position: absolute;
    inset: 0;
    padding: 0.3rem 0.4rem;
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    cursor: inherit;
    text-align: left;
  }
  .face:focus-visible {
    outline: 2px solid var(--teal);
    outline-offset: -2px;
    border-radius: 8px;
  }
  .card.keynote {
    background: var(--note-sun);
  }
  .card.shift {
    background: var(--note-mint);
  }
  /* Yours: the layer's own colour stays (so cards match their toggles);
     a violet left edge and the "Yours" label mark it. */
  .card.mine:not(.shift) {
    border-left: 6px solid var(--own);
  }
  /* Starred, and star emphasis: gold, like the stars. Never positional. */
  .card.starred,
  .card.emphasised {
    border-color: var(--star);
  }
  /* A shift you are on: a solid teal edge. */
  .card.shift.mine {
    border-color: var(--teal);
    border-left-width: 6px;
  }
  .card.contested {
    background-image: repeating-linear-gradient(
      135deg,
      transparent 0 8px,
      rgba(200, 84, 42, 0.12) 8px 14px
    );
  }
  .card.full {
    opacity: 0.7;
  }
  .card.pending {
    opacity: 0.55;
    border-style: dashed;
    border-color: var(--muted);
  }
  .resize {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 10px;
    cursor: ns-resize;
  }
  /* The grip shows on hover or focus (faintly on touch screens), so it never covers the labels. */
  .resize::after {
    opacity: 0;
    transition: opacity 0.15s ease;
  }
  .card:hover .resize::after,
  .card:focus-within .resize::after {
    opacity: 1;
  }
  @media (hover: none) {
    .resize::after {
      opacity: 0.5;
    }
  }
  .resize::after {
    content: "";
    position: absolute;
    left: 40%;
    right: 40%;
    bottom: 3px;
    height: 3px;
    border-radius: 2px;
    background: rgba(0, 0, 0, 0.18);
  }
  .ghost {
    position: absolute;
    left: 2px;
    right: 2px;
    box-sizing: border-box;
    padding: 0.3rem 0.4rem;
    border: 2px dashed var(--teal);
    border-radius: 10px;
    background: color-mix(in srgb, var(--note-sky) 85%, transparent);
    box-shadow: var(--shadow-note);
    pointer-events: none;
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    z-index: 4;
    transition:
      top 0.08s linear,
      height 0.08s linear;
  }
  .ghost.keynote {
    background: color-mix(in srgb, var(--note-sun) 85%, transparent);
  }
  .time {
    font-size: 0.7rem;
    color: var(--ink-soft);
  }
  .title {
    font-weight: 700;
    font-size: 0.85rem;
    line-height: 1.2;
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    overflow-wrap: break-word;
    /* The title wins the card's height; time and badges give way. */
    flex-shrink: 0;
  }
  /* An hour or less: one title line, so the time and badges keep their room. */
  .card.short .title {
    -webkit-line-clamp: 1;
    line-clamp: 1;
  }
  /* Split cards are narrow: the title matters most, the time is in the detail. */
  .card.narrow .time {
    display: none;
  }
  /* Narrow titles: smaller, hyphenated at syllables rather than cut mid-word. */
  .card.narrow .title {
    font-size: 0.74rem;
    hyphens: auto;
    -webkit-hyphens: auto;
    overflow-wrap: normal;
  }
  .meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.2rem 0.3rem;
    min-height: 0;
    overflow: hidden;
  }
  .badge {
    font-size: 0.65rem;
    padding: 0.05rem 0.35rem;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.7);
    color: var(--ink);
    white-space: nowrap;
  }
  .contested-badge {
    background: var(--warn);
    color: #fff;
  }
  .star-badge {
    background: var(--star);
    color: #fff;
  }
  .on-badge {
    background: var(--teal);
    color: #fff;
  }
  .full-badge {
    background: var(--ink-soft);
    color: #fff;
  }
  @media (prefers-reduced-motion: reduce) {
    .card,
    .ghost {
      transition: none;
    }
    .col.glow,
    .head.glow {
      animation: none;
    }
  }
</style>
