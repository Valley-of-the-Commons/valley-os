<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // The Commons Hub's unified programme (valley-os v2c): keynotes, sessions
  // and shifts on a Day/Week grid. All or Mine (my starred, my own, my
  // shifts); create by FAB or empty slot; drag to move or resize; detail,
  // star, comment, swaps; join shifts from the Shifts box or by tapping the
  // Shifts column, with a red glow while the viewer is short of shifts that
  // week; the shift nudge and the logged-out popup. Meaning comes from
  // @holons/core; this view renders the programme and calls the actions.
  import { onDestroy, onMount } from "svelte";
  import { get } from "svelte/store";
  import {
    canWriteSession,
    countStars,
    starId,
    type Session,
  } from "@holons/core/sessions";
  import {
    hubWeek,
    shiftNudgeDue,
    weekNeedsShifts,
    DEFAULT_NUDGE_THRESHOLD,
    type ShiftOccurrence,
  } from "@holons/core/shifts";
  import { toWallClock } from "@holons/core/time";
  import { t, locale } from "$lib/i18n";
  import { currentUser, loginOpen } from "$lib/auth";
  import { cannotSignReason } from "$lib/programmeSigning";
  import { isAdmin } from "$lib/adminStore";
  import {
    boardMode,
    holonId,
    rawShifts,
    settingsOpen,
    showNotice,
    holonSettingsLoaded,
    shiftsLoaded,
    now,
  } from "$lib/stores";
  import { setShiftRsvp, shiftSigner, shiftSignerSettled } from "$lib/shifts";
  import {
    actions,
    hubTimezone,
    ownership,
    programme,
    programmeLoaded,
    registry,
    shiftItems,
    startProgramme,
    viewerUid,
    writeTier,
  } from "$lib/programme";
  import {
    buildGrid,
    type GridCard,
    type GridColumn,
    type ProgrammeViewMode,
    type ShiftItem,
  } from "$lib/programmeGrid";
  import {
    instantFor,
    shiftDate,
    todayIn,
    safeWebUrl,
  } from "$lib/programmeTime";
  import type { ActionResult, SessionDraft } from "$lib/programmeActions";
  import ProgrammeGrid from "$lib/components/ProgrammeGrid.svelte";
  import SessionEditor from "$lib/components/SessionEditor.svelte";
  import SessionDetail from "$lib/components/SessionDetail.svelte";
  import ShiftDetail from "$lib/components/ShiftDetail.svelte";
  import MiniMonth from "$lib/components/MiniMonth.svelte";
  import ProgrammeSettings from "$lib/components/ProgrammeSettings.svelte";
  import ShiftSettings from "$lib/components/ShiftSettings.svelte";
  import Modal from "$lib/components/Modal.svelte";
  import Icon from "$lib/components/Icon.svelte";

  /** Minutes without interaction before the logged-out popup returns. */
  const LOGIN_POPUP_IDLE_MIN = 10;
  const VIEW_KEY = "kiosk_programme_view";
  const MINE_KEY = "kiosk_programme_mine";
  const SNOOZE_KEY = "kiosk_nudge_snoozed";

  const readPref = (key: string) => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  };
  const writePref = (key: string, value: string) => {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* storage unavailable: the choice lasts this session only */
    }
  };

  let view: ProgrammeViewMode = readPref(VIEW_KEY) === "week" ? "week" : "day";
  let mineView = readPref(MINE_KEY) === "1";
  let date = todayIn(Date.now(), get(hubTimezone));
  /** Until the viewer navigates, the view follows today in the hub zone (which loads late). */
  let dateTouched = false;
  const goTo = (d: string) => {
    dateTouched = true;
    date = d;
  };
  let layers = { keynotes: true, sessions: true, shifts: true };
  /** The layer chips wear their cards' post-it colours. */
  const LAYERS = [
    {
      key: "keynotes",
      label: "programme.layerKeynotes",
      color: "var(--note-sun)",
    },
    {
      key: "sessions",
      label: "programme.layerSessions",
      color: "var(--note-sky)",
    },
    {
      key: "shifts",
      label: "programme.layerShifts",
      color: "var(--note-mint)",
    },
  ] as const;
  let drawerOpen = false;
  let width = 1024;

  $: tz = $hubTimezone;
  // Follows the kiosk clock, so a board left on past midnight moves to the new day.
  $: today = todayIn($now.getTime(), tz);
  $: if (!dateTouched) date = today;
  $: resolve = (id: string) => $registry.resolve(id);
  $: loggedIn = $writeTier !== "logged-out";
  /** Personal features (Mine, nudge, glow, "mine" markers) are off on the shared board and when logged out. */
  $: ambient = $boardMode || !loggedIn;
  $: showMine = mineView && !ambient;
  $: me = $viewerUid ? resolve($viewerUid) : null;

  function setMine(on: boolean) {
    mineView = on;
    writePref(MINE_KEY, on ? "1" : "0");
  }

  $: starCounts = new Map(
    $programme.sessions.map((s) => [
      s.id,
      countStars($programme.stars, s.id, resolve),
    ]),
  );
  $: myStars = new Set(
    me
      ? $programme.sessions
          .filter((s) =>
            $programme.stars.some((st) => st.id === starId(s.id, me!)),
          )
          .map((s) => s.id)
      : [],
  );
  $: model = buildGrid({
    view,
    date,
    timezone: tz,
    sessions: $programme.sessions,
    rooms: $programme.rooms,
    clusters: $ownership,
    starCounts,
    myStars: ambient ? new Set() : myStars,
    viewerUid: ambient ? null : $viewerUid,
    resolve,
    shifts: $shiftItems,
    layers,
    breaks: $programme.breaks,
    onlyMine: showMine,
  });
  $: sortedRooms = [...$programme.rooms].sort(
    (a, b) =>
      (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name),
  );
  $: liveSessions = $programme.sessions.filter((s) => !s.deleted);
  $: noRooms = $programme.rooms.length === 0;
  $: empty = $programmeLoaded && liveSessions.length === 0;
  $: contestedIds = new Set(
    $ownership.filter((c) => c.contested).flatMap((c) => c.sessionIds),
  );

  // Breakpoints (AC-c8): mobile < 768, laptop 768-1439, board >= 1440.
  // Dev only: force a layout (localStorage kiosk_programme_layout) to check
  // the breakpoints from a window that cannot be resized.
  const forcedLayout = import.meta.env.DEV
    ? readPref("kiosk_programme_layout")
    : null;
  $: layout =
    forcedLayout === "mobile" ||
    forcedLayout === "laptop" ||
    forcedLayout === "board"
      ? forcedLayout
      : width < 768
        ? "mobile"
        : width < 1440
          ? "laptop"
          : "board";
  $: scale = layout === "board" ? 1.4 : layout === "mobile" ? 1 : 1.2;

  // ── Subscriptions ────────────────────────────────────────────────────────
  let stop: (() => void) | null = null;
  let bound: string | null = null;
  $: if ($holonId !== bound) {
    stop?.();
    bound = $holonId;
    stop = bound ? startProgramme(bound) : null;
  }
  onDestroy(() => stop?.());

  // ── Settings: the admin's programme settings, else the kiosk's ───────────
  let programmeSettingsOpen = false;
  let shiftPlannerOpen = false;
  $: adminGear = $isAdmin && !$boardMode;
  function openGear() {
    if (adminGear) programmeSettingsOpen = true;
    else settingsOpen.set(true);
  }

  // ── Writes, with pending markers ─────────────────────────────────────────
  let pending = new Set<string>();
  async function run(
    ids: string[],
    fn: (a: Awaited<ReturnType<typeof actions>>) => Promise<ActionResult>,
  ): Promise<ActionResult> {
    const touched = [...ids];
    const mark = (id: string) => {
      touched.push(id);
      pending = new Set([...pending, id]);
    };
    ids.forEach(mark);
    try {
      const a = await actions(mark);
      const r = await fn(a);
      if (!r.ok && r.reason === "write-failed")
        showNotice($t("editor.errWrite"));
      return r;
    } finally {
      const next = new Set(pending);
      touched.forEach((id) => next.delete(id));
      pending = next;
    }
  }

  // ── Navigation ───────────────────────────────────────────────────────────
  function setView(v: ProgrammeViewMode) {
    view = v;
    writePref(VIEW_KEY, v);
  }
  const step = (n: number) => goTo(shiftDate(date, view, n));
  $: periodLabel = periodOf(view, date, $locale);
  function periodOf(v: ProgrammeViewMode, d: string, loc: string): string {
    const noon = (x: string) => new Date(`${x}T12:00:00Z`);
    if (v === "day") {
      return new Intl.DateTimeFormat(loc, {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      }).format(noon(d));
    }
    const first = model.columns[0]?.date ?? d;
    const last = model.columns[model.columns.length - 1]?.date ?? d;
    const fmt = new Intl.DateTimeFormat(loc, {
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    });
    return fmt.formatRange
      ? fmt.formatRange(noon(first), noon(last))
      : `${fmt.format(noon(first))} – ${fmt.format(noon(last))}`;
  }

  // ── Create / edit / detail / drag ────────────────────────────────────────
  let editor: {
    session: Session | null;
    prefill: { roomId?: string; date: string; time?: string } | null;
  } | null = null;
  let detail: Session | null = null;
  let shiftOpen: { occurrence: ShiftOccurrence; card: ShiftItem } | null = null;

  /** Creating, starring, commenting and joining need a login, on the shared board too. */
  function requireLogin(): boolean {
    if (loggedIn) return true;
    loginOpen.set(true);
    return false;
  }

  function openCreate(prefill: {
    roomId?: string;
    date: string;
    time?: string;
  }) {
    if (!requireLogin()) return;
    if (noRooms) {
      showNotice($t($isAdmin ? "programme.noRoomsAdmin" : "programme.noRooms"));
      return;
    }
    editor = { session: null, prefill };
  }

  function onEmpty(column: GridColumn, time: string) {
    if (column.kind === "shifts") return;
    openCreate({ roomId: column.roomId, date: column.date, time });
  }

  function onCard(card: GridCard) {
    if (card.kind === "shift") {
      const item = $shiftItems.find((s) => s.id === card.id);
      if (item) openShift(item);
      return;
    }
    detail = $programme.sessions.find((s) => s.id === card.id) ?? null;
  }

  const sessionOf = (card: GridCard) =>
    card.kind === "shift"
      ? undefined
      : $programme.sessions.find((s) => s.id === card.id);
  $: canDrag = (card: GridCard) => {
    const s = sessionOf(card);
    return (
      loggedIn &&
      !!s &&
      canWriteSession($writeTier, "edit", s, $viewerUid, resolve)
    );
  };

  const hhmm = (min: number) =>
    `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
  async function onMove(
    card: GridCard,
    to: { column: GridColumn; startMin: number; endMin: number },
  ) {
    const s = sessionOf(card);
    if (!s) return;
    const roomId =
      to.column.kind === "room" && to.column.roomId
        ? to.column.roomId
        : s.roomId;
    const r = await run([s.id], (a) =>
      a.editSession(s, {
        roomId,
        startsAt: instantFor(to.column.date, hhmm(to.startMin), tz),
        endsAt: instantFor(to.column.date, hhmm(to.endMin), tz),
      }),
    );
    if (!r.ok && r.reason !== "write-failed")
      showNotice(
        $t(r.reason === "times" ? "editor.errTimes" : "editor.errNotAllowed"),
      );
  }

  const saveDraft = (draft: SessionDraft, repeatUntil?: string) =>
    editor?.session
      ? run([editor.session.id], (a) => a.editSession(editor!.session!, draft))
      : run([], (a) =>
          a.createSession(draft, { repeatWeeklyUntil: repeatUntil }),
        );

  const refused: ActionResult = { ok: false, reason: "invalid" };
  function deleteEdited(): Promise<ActionResult> {
    const s = editor?.session;
    return s
      ? run([s.id], (a) => a.deleteSession(s))
      : Promise.resolve(refused);
  }
  /** Run an action on the session whose detail is open. */
  function onDetail(
    fn: (s: Session) => Promise<ActionResult>,
  ): Promise<ActionResult> {
    const s = detail;
    return s ? fn(s) : Promise.resolve(refused);
  }
  function editDetail() {
    editor = { session: detail, prefill: null };
    detail = null;
  }

  // Keep an open detail in step with live data (a star, a comment, a move).
  $: if (detail)
    detail = $programme.sessions.find((s) => s.id === detail!.id) ?? null;

  // ── Shifts: the week's box, joining, the red glow ───────────────────────
  // The kiosk clock, to the minute: the box and the glow follow time on a board left open.
  $: nowSec = Math.floor($now.getTime() / 60_000) * 60;
  $: viewedWeek = hubWeek(
    Math.floor(Date.parse(instantFor(date, "12:00", tz)) / 1000),
    tz,
  );
  $: weekShifts = $shiftItems
    .filter(
      (s) =>
        s.start / 1000 >= viewedWeek.start && s.start / 1000 < viewedWeek.end,
    )
    .sort((a, b) => a.start - b.start);
  $: myWeekCount = weekShifts.filter((s) => s.mine).length;
  $: thisWeek = viewedWeek.key === hubWeek(nowSec, tz).key;
  $: weekRange = rangeOf(viewedWeek.key, $locale);
  function rangeOf(monday: string, loc: string): string {
    const noon = (x: string) => new Date(`${x}T12:00:00Z`);
    const sunday = new Date(noon(monday).getTime() + 6 * 86_400_000);
    const fmt = new Intl.DateTimeFormat(loc, {
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    });
    return fmt.formatRange
      ? fmt.formatRange(noon(monday), sunday)
      : `${fmt.format(noon(monday))} – ${fmt.format(sunday)}`;
  }
  $: openWeekShifts = weekShifts.filter(
    (s) => !s.mine && !s.full && s.end / 1000 > nowSec,
  );
  $: glowShifts =
    loggedIn &&
    !$boardMode &&
    $shiftsLoaded &&
    weekNeedsShifts({
      viewDate: date,
      nowSec,
      timezone: tz,
      myShiftStarts: $shiftItems
        .filter((s) => s.mine)
        .map((s) => s.start / 1000),
      joinableShiftStarts: $shiftItems
        .filter((s) => !s.mine && !s.full)
        .map((s) => s.start / 1000),
    });

  function openShift(item: ShiftItem) {
    const occurrence = $rawShifts.occurrences.find(
      (o) => o.address === item.id,
    );
    if (occurrence) shiftOpen = { occurrence, card: item };
  }

  $: cannotSign = cannotSignReason($currentUser, $shiftSigner);
  let joining = new Set<string>();
  async function join(item: ShiftItem) {
    if (!requireLogin()) return;
    if (!$shiftSigner) {
      showNotice(
        $t(
          cannotSign === "key"
            ? "programmeShifts.cannotSignKey"
            : "programmeShifts.cannotSignServer",
        ),
      );
      return;
    }
    const occurrence = $rawShifts.occurrences.find(
      (o) => o.address === item.id,
    );
    if (!occurrence || joining.has(item.id)) return;
    joining = new Set([...joining, item.id]);
    try {
      await setShiftRsvp(occurrence, "accepted");
    } catch (err) {
      showNotice(
        $t("shifts.rsvpFailed", {
          reason: err instanceof Error ? err.message : String(err),
        }),
      );
    } finally {
      const next = new Set(joining);
      next.delete(item.id);
      joining = next;
    }
  }

  /** A tap on the Shifts column: the open shift running at that time. */
  function onShiftColumn(time: string) {
    const [h, m] = time.split(":").map(Number);
    const minute = h * 60 + m;
    const here = $shiftItems.find((s) => {
      const from = toWallClock(s.start, tz);
      const to = toWallClock(s.end, tz);
      const end = to.date === from.date ? to.minutes : 24 * 60;
      return from.date === date && from.minutes <= minute && minute < end;
    });
    if (here) openShift(here);
    else showNotice($t("programmeShifts.noneAt"));
  }

  let shiftBusy = false;
  async function toggleShift() {
    if (!shiftOpen) return;
    shiftBusy = true;
    try {
      await setShiftRsvp(
        shiftOpen.occurrence,
        shiftOpen.card.mine ? "declined" : "accepted",
      );
      shiftOpen = null;
    } catch (err) {
      showNotice(
        $t("shifts.rsvpFailed", {
          reason: err instanceof Error ? err.message : String(err),
        }),
      );
    } finally {
      shiftBusy = false;
    }
  }
  $: if (shiftOpen) {
    const card = $shiftItems.find((s) => s.id === shiftOpen!.card.id);
    if (card) shiftOpen = { ...shiftOpen, card };
  }
  const shiftTime = (item: ShiftItem, loc: string) =>
    new Intl.DateTimeFormat(loc, {
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      timeZone: tz,
    }).format(new Date(item.start));

  // ── Shift nudge (AC-c6) ──────────────────────────────────────────────────
  // Worked out continuously once everything it depends on has loaded (hub
  // settings, the shift sign-ups, and who the viewer signs as), so a resident
  // who already has enough shifts is never nudged by a half-loaded board, and
  // it closes by itself if the count reaches the threshold. Dismissed or
  // snoozed, it stays away for the rest of this visit. A viewer who cannot
  // sign (no signing key) is not nudged about something they cannot do.
  let nudgeDismissed = false;
  $: week = hubWeek(nowSec, tz);
  $: myShiftCount = $shiftItems.filter(
    (s) => s.mine && s.start / 1000 >= week.start && s.start / 1000 < week.end,
  ).length;
  $: nudgeSettled =
    loggedIn && $holonSettingsLoaded && $shiftsLoaded && $shiftSignerSettled;
  $: nudgeDue =
    nudgeSettled &&
    !!$shiftSigner &&
    shiftNudgeDue({
      nowSec: Date.now() / 1000,
      timezone: tz,
      loggedIn,
      boardMode: $boardMode,
      isAdmin: $isAdmin,
      snoozedWeek: readPref(SNOOZE_KEY),
      myShiftStarts: $shiftItems
        .filter((s) => s.mine)
        .map((s) => s.start / 1000),
      joinableShiftStarts: $shiftItems
        .filter((s) => !s.mine && !s.full)
        .map((s) => s.start / 1000),
    });
  $: nudgeOpen = nudgeDue && !nudgeDismissed;
  function snooze() {
    writePref(SNOOZE_KEY, week.key);
    nudgeDismissed = true;
  }
  function showShifts() {
    layers = { ...layers, shifts: true };
    goTo(today);
    nudgeDismissed = true;
  }

  // ── Logged-out popup (AC-c7) ─────────────────────────────────────────────
  let loginPopup = false;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  function armIdle() {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (!loggedIn) loginPopup = true;
    }, LOGIN_POPUP_IDLE_MIN * 60_000);
  }
  onMount(() => {
    if (!loggedIn) loginPopup = true;
    armIdle();
    const onActivity = () => armIdle();
    window.addEventListener("pointerdown", onActivity, { passive: true });
    window.addEventListener("keydown", onActivity);
    return () => {
      window.removeEventListener("pointerdown", onActivity);
      window.removeEventListener("keydown", onActivity);
      if (idleTimer) clearTimeout(idleTimer);
    };
  });
  $: if (loggedIn) loginPopup = false;
  function goLogin() {
    loginPopup = false;
    loginOpen.set(true);
  }
</script>

<svelte:window bind:innerWidth={width} />

<section class="programme {layout}" aria-label={$t("programme.aria")}>
  {#if layout === "mobile" && drawerOpen}
    <!-- A tap outside the drawer closes it. -->
    <button
      type="button"
      class="scrim"
      aria-label={$t("common.close")}
      on:click={() => (drawerOpen = false)}
    ></button>
  {/if}
  {#if layout !== "mobile" || drawerOpen}
    <aside class="side" class:drawer={layout === "mobile"}>
      <div class="switch" role="radiogroup" aria-label={$t("programme.view")}>
        <button
          type="button"
          role="radio"
          aria-checked={view === "day"}
          class:on={view === "day"}
          on:click={() => setView("day")}>{$t("pills.day")}</button
        >
        <button
          type="button"
          role="radio"
          aria-checked={view === "week"}
          class:on={view === "week"}
          on:click={() => setView("week")}>{$t("pills.week")}</button
        >
      </div>
      <fieldset class="layers">
        <legend>{$t("programme.layers")}</legend>
        {#each LAYERS as l (l.key)}
          <label class="layer" class:on={layers[l.key]} style="--c: {l.color};">
            <input
              type="checkbox"
              class="sr-only"
              bind:checked={layers[l.key]}
            />
            <span class="note" aria-hidden="true"></span>
            <span class="name">{$t(l.label)}</span>
            <span class="tick" aria-hidden="true">✓</span>
          </label>
        {/each}
      </fieldset>
      {#if layout !== "mobile"}
        <MiniMonth {date} {today} onPick={goTo} />
      {/if}
      {#if loggedIn}
        <button
          type="button"
          class="create"
          on:click={() => openCreate({ date })}
          >＋ {$t("programme.create")}</button
        >
      {/if}
      {#if loggedIn && !$boardMode}
        <div class="shift-box" class:glow={glowShifts}>
          <h5>
            {thisWeek
              ? $t("programmeShifts.title")
              : $t("programmeShifts.titleWeek", { range: weekRange })}
          </h5>
          <p class="count">
            {$t(
              thisWeek ? "programmeShifts.count" : "programmeShifts.countThat",
              {
                count: myWeekCount,
                threshold: DEFAULT_NUDGE_THRESHOLD,
              },
            )}
          </p>
          {#each openWeekShifts as s (s.id)}
            <div class="open-shift">
              <button
                type="button"
                class="shift-name"
                on:click={() => openShift(s)}
              >
                <span class="when">{shiftTime(s, $locale)}</span>
                {s.title}
              </button>
              <button
                type="button"
                class="join"
                aria-label={`${$t("programmeShifts.join")}: ${s.title}, ${shiftTime(s, $locale)}`}
                disabled={joining.has(s.id)}
                on:click={() => join(s)}>{$t("programmeShifts.join")}</button
              >
            </div>
          {:else}
            <p class="none">
              {$t(
                thisWeek ? "programmeShifts.none" : "programmeShifts.noneThat",
              )}
            </p>
          {/each}
        </div>
      {/if}
      {#if layout === "mobile"}
        <button
          type="button"
          class="close-drawer"
          on:click={() => (drawerOpen = false)}>{$t("common.close")}</button
        >
      {/if}
    </aside>
  {/if}

  <div class="main">
    <div class="nav">
      {#if layout === "mobile"}
        <button
          type="button"
          class="burger"
          class:glow={glowShifts}
          aria-label={$t("programme.menu")}
          aria-expanded={drawerOpen}
          on:click={() => (drawerOpen = !drawerOpen)}>☰</button
        >
      {/if}
      <button
        type="button"
        class="arrow"
        aria-label={$t("cal.previous")}
        on:click={() => step(-1)}>‹</button
      >
      <button
        type="button"
        class="today"
        on:click={() => goTo(today)}
        disabled={date === today}>{$t("programme.today")}</button
      >
      <button
        type="button"
        class="arrow"
        aria-label={$t("cal.next")}
        on:click={() => step(1)}>›</button
      >
      <span class="period">{periodLabel}</span>
      {#if !ambient}
        <div
          class="mine-switch"
          role="radiogroup"
          aria-label={$t("programme.viewAria")}
        >
          <button
            type="button"
            role="radio"
            aria-checked={!mineView}
            class:on={!mineView}
            on:click={() => setMine(false)}>{$t("programme.viewAll")}</button
          >
          <button
            type="button"
            role="radio"
            aria-checked={mineView}
            class:on={mineView}
            on:click={() => setMine(true)}>{$t("programme.viewMine")}</button
          >
        </div>
      {/if}
      {#if $boardMode}
        <!-- Shared board mode hides personal features: say so, and offer the switch. -->
        <button
          type="button"
          class="board-tag"
          aria-label={$t("programme.boardTagAria")}
          title={$t("programme.boardTagAria")}
          on:click={() => settingsOpen.set(true)}
          >{$t("programme.boardTag")}</button
        >
      {/if}
      <button
        type="button"
        class="gear"
        aria-label={$t(adminGear ? "programme.settings" : "menu.settings")}
        title={$t(adminGear ? "programme.settings" : "menu.settings")}
        on:click={openGear}><Icon name="gear" /></button
      >
    </div>

    {#if showMine && model.cards.length === 0 && !empty}
      <div class="empty-state mine-empty">
        <p>{$t("programme.mineEmpty")}</p>
      </div>
    {/if}

    {#if empty}
      <div class="empty-state">
        <p>{$t("programme.empty")}</p>
        <p class="sub">
          {noRooms
            ? $t($isAdmin ? "programme.noRoomsAdmin" : "programme.noRooms")
            : $t("programme.emptyHint")}
        </p>
      </div>
    {/if}

    <div class="scroller">
      <ProgrammeGrid
        {model}
        {pending}
        {scale}
        canCreate={loggedIn}
        {canDrag}
        {glowShifts}
        {onCard}
        {onEmpty}
        {onMove}
        {onShiftColumn}
      />
    </div>
  </div>

  {#if layout === "mobile" && loggedIn}
    <button
      type="button"
      class="fab"
      aria-label={$t("programme.create")}
      on:click={() => openCreate({ date })}>＋</button
    >
  {/if}
</section>

{#if editor}
  <SessionEditor
    rooms={sortedRooms}
    timezone={tz}
    isAdmin={$isAdmin}
    tracks={$programme.tracks}
    formats={$programme.formats}
    tags={$programme.tags}
    session={editor.session}
    prefill={editor.prefill}
    onSave={saveDraft}
    onDelete={editor.session ? deleteEdited : null}
    onClose={() => (editor = null)}
  />
{/if}

{#if detail}
  <SessionDetail
    session={detail}
    programme={$programme}
    viewerUid={$viewerUid}
    tier={$writeTier}
    {resolve}
    timezone={tz}
    ambient={!loggedIn}
    contested={contestedIds.has(detail.id)}
    onEdit={editDetail}
    onStar={() => onDetail((d) => run([d.id], (a) => a.toggleStar(d.id)))}
    onComment={(kind, body) =>
      onDetail((d) =>
        run([], (a) =>
          a.addComment(
            d.id,
            kind,
            body,
            kind === "link" ? safeWebUrl(body) : null,
          ),
        ),
      )}
    onRequestSwap={(fromId) =>
      onDetail((d) => run([], (a) => a.requestSwap(fromId, d.id, null)))}
    onAccept={(swap) =>
      run([swap.fromSessionId, swap.targetSessionId], (a) =>
        a.acceptSwap(swap),
      )}
    onDecide={(swap, type) => run([], (a) => a.decideSwap(swap, type))}
    onLogin={() => {
      detail = null;
      loginOpen.set(true);
    }}
    onClose={() => (detail = null)}
  />
{/if}

{#if shiftOpen}
  <ShiftDetail
    occurrence={shiftOpen.occurrence}
    timezone={tz}
    mine={shiftOpen.card.mine}
    full={shiftOpen.card.full}
    taken={shiftOpen.card.taken}
    {loggedIn}
    {cannotSign}
    busy={shiftBusy}
    onToggle={toggleShift}
    onLogin={() => {
      shiftOpen = null;
      loginOpen.set(true);
    }}
    onClose={() => (shiftOpen = null)}
  />
{/if}

{#if programmeSettingsOpen}
  <ProgrammeSettings
    lists={{
      rooms: $programme.rooms,
      tracks: $programme.tracks,
      formats: $programme.formats,
      tags: $programme.tags,
    }}
    onSave={(kind, item) =>
      run(item.id ? [item.id] : [], (a) => a.saveNamed(kind, item))}
    onDelete={(kind, id) => run([id], (a) => a.deleteNamed(kind, id))}
    onMove={(kind, id, step) => run([id], (a) => a.moveNamed(kind, id, step))}
    onPlanShifts={() => (shiftPlannerOpen = true)}
    onKioskSettings={() => settingsOpen.set(true)}
    onClose={() => (programmeSettingsOpen = false)}
  />
{/if}

{#if shiftPlannerOpen && $holonId}
  <ShiftSettings
    holonId={$holonId}
    on:close={() => (shiftPlannerOpen = false)}
  />
{/if}

{#if nudgeOpen}
  <Modal on:close={() => (nudgeDismissed = true)}>
    <div class="nudge">
      <h4>{$t("nudge.title")}</h4>
      <p>
        {$t("nudge.body", {
          count: myShiftCount,
          threshold: DEFAULT_NUDGE_THRESHOLD,
        })}
      </p>
      <div class="row">
        <button type="button" class="primary" on:click={showShifts}
          >{$t("nudge.go")}</button
        >
        <button type="button" on:click={snooze}>{$t("nudge.snooze")}</button>
      </div>
    </div>
  </Modal>
{/if}

{#if loginPopup && !loggedIn}
  <Modal on:close={() => (loginPopup = false)}>
    <div class="nudge login-popup">
      <h4>{$t("loginPopup.title")}</h4>
      <p>{$t("loginPopup.body")}</p>
      <div class="row">
        <button type="button" class="primary" on:click={goLogin}
          >{$t("loginPopup.go")}</button
        >
      </div>
    </div>
  </Modal>
{/if}

<style>
  .programme {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: 15rem 1fr;
    gap: 1rem;
    padding: 0.5rem 1rem 1rem;
    color: var(--ink);
    position: relative;
  }
  .programme.mobile {
    grid-template-columns: 1fr;
    padding: 0.25rem 0.5rem 0.5rem;
  }
  /* Room below the last card so the floating ＋ never covers it. */
  .programme.mobile .scroller {
    padding-bottom: 5.5rem;
  }
  .programme.board {
    grid-template-columns: 17rem 1fr;
    font-size: 1.1rem;
  }
  .side {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    min-height: 0;
    overflow: auto;
  }
  /* The sidebar scrolls; its controls never squash (the Day/Week switch included). */
  .side > * {
    flex-shrink: 0;
  }
  .scrim {
    position: fixed;
    inset: 0;
    z-index: 39;
    background: rgba(20, 32, 31, 0.35);
  }
  .side.drawer {
    position: fixed;
    inset: 0 auto 0 0;
    width: min(80vw, 18rem);
    z-index: 40;
    padding: 1rem;
    background: var(--card);
    box-shadow: var(--shadow-note);
  }
  .switch,
  .mine-switch {
    display: flex;
    border: 1px solid var(--line);
    border-radius: 999px;
    overflow: hidden;
  }
  .switch button,
  .mine-switch button {
    flex: 1;
    min-height: 40px;
    padding: 0 0.9rem;
    font-weight: 700;
    color: var(--ink-soft);
  }
  .switch button.on,
  .mine-switch button.on {
    background: var(--teal);
    color: #fff;
  }
  .layers {
    border: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .layers legend,
  .shift-box h5 {
    font-size: 0.8rem;
    font-weight: 700;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin: 0 0 0.3rem;
  }
  /* Layer chips: a little post-it in the layer's own colour. On, it is
     stuck on at a slight tilt with a folded corner; off, only its dashed
     outline is left and the label fades. The checkbox stays underneath. */
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }
  .layer {
    display: grid;
    grid-template-columns: 1.7rem 1fr auto;
    align-items: center;
    gap: 0.65rem;
    min-height: 44px;
    padding: 0.35rem 0.7rem 0.35rem 0.55rem;
    border: 1.5px dashed var(--line);
    border-radius: 12px;
    color: var(--muted);
    cursor: pointer;
    user-select: none;
    transition:
      background 0.2s ease,
      border-color 0.2s ease,
      color 0.2s ease,
      box-shadow 0.2s ease,
      transform 0.2s ease;
  }
  .layer:hover {
    transform: translateY(-1px);
  }
  .layer.on {
    border-style: solid;
    border-color: transparent;
    background: var(--card);
    box-shadow: var(--shadow-soft);
    color: var(--ink);
  }
  .layer:has(:focus-visible) {
    outline: 2px solid var(--teal);
    outline-offset: 2px;
  }
  .note {
    width: 1.5rem;
    height: 1.5rem;
    border-radius: 3px 3px 3px 9px;
    border: 1.5px dashed var(--c);
    transform: rotate(0deg) scale(0.9);
    transition:
      transform 0.32s cubic-bezier(0.34, 1.56, 0.64, 1),
      background 0.2s ease,
      box-shadow 0.2s ease;
  }
  .layer.on .note {
    border: none;
    /* The folded bottom-right corner of a stuck-on note. */
    background:
      linear-gradient(
        315deg,
        color-mix(in srgb, var(--c) 55%, var(--ink)) 0 5px,
        transparent 5px
      ),
      var(--c);
    box-shadow: 0 3px 6px rgba(28, 48, 46, 0.18);
    transform: rotate(-6deg) scale(1);
  }
  .layer:nth-child(3).on .note {
    transform: rotate(4deg) scale(1);
  }
  .name {
    font-weight: 700;
    font-size: 0.92rem;
  }
  .tick {
    font-size: 0.85rem;
    font-weight: 800;
    color: var(--teal);
    opacity: 0;
    transform: scale(0.6);
    transition:
      opacity 0.2s ease,
      transform 0.2s ease;
  }
  .layer.on .tick {
    opacity: 1;
    transform: scale(1);
  }
  @media (prefers-reduced-motion: reduce) {
    .layer,
    .note,
    .tick {
      transition: none;
    }
  }
  .create,
  .close-drawer {
    min-height: 44px;
    border-radius: 999px;
    font-weight: 700;
    background: var(--teal);
    color: #fff;
  }
  .close-drawer {
    background: var(--paper-deep);
    color: var(--ink);
  }
  /* The week's open shifts, one tap to join. Glows red while short. */
  .shift-box {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    padding: 0.7rem;
    border-radius: 14px;
    background: var(--paper-deep);
    border: 2px solid transparent;
  }
  .shift-box .count,
  .shift-box .none {
    margin: 0;
    font-size: 0.82rem;
    color: var(--ink-soft);
  }
  .open-shift {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 0.4rem;
    align-items: center;
  }
  .shift-name {
    text-align: left;
    font-size: 0.85rem;
    color: var(--ink);
    line-height: 1.25;
  }
  .shift-name .when {
    display: block;
    font-size: 0.72rem;
    color: var(--muted);
  }
  .join {
    min-height: 36px;
    padding: 0 0.8rem;
    border-radius: 999px;
    font-weight: 700;
    background: var(--teal);
    color: #fff;
  }
  .join:disabled {
    opacity: 0.55;
  }
  /* Short of shifts: a red, gently pulsing glow, drawn inside so the
     scrolling sidebar never clips it. */
  .glow {
    border-color: var(--alert);
    animation: short-glow 1.6s ease-in-out infinite;
  }
  @keyframes short-glow {
    0%,
    100% {
      box-shadow: inset 0 0 0 0 rgba(224, 50, 43, 0);
    }
    50% {
      box-shadow: inset 0 0 14px 2px rgba(224, 50, 43, 0.45);
    }
  }
  .burger.glow {
    border: 2px solid var(--alert);
  }
  .main {
    display: flex;
    flex-direction: column;
    min-height: 0;
    min-width: 0;
  }
  .nav {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.4rem;
    padding-bottom: 0.5rem;
  }
  .nav .arrow,
  .nav .burger,
  .nav .gear {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    font-size: 1.3rem;
    background: var(--paper-deep);
    display: grid;
    place-items: center;
  }
  .nav .gear {
    margin-left: auto;
    font-size: 1.1rem;
  }
  .nav .today {
    min-height: 40px;
    padding: 0 0.9rem;
    border-radius: 999px;
    background: var(--paper-deep);
    font-weight: 700;
  }
  .nav .today:disabled {
    opacity: 0.5;
  }
  .period {
    margin-left: 0.4rem;
    font-weight: 700;
  }
  .mine-switch {
    margin-left: auto;
  }
  .board-tag {
    margin-left: auto;
    min-height: 32px;
    padding: 0 0.8rem;
    border-radius: 999px;
    border: 1.5px dashed var(--ink-soft);
    color: var(--ink-soft);
    font-size: 0.8rem;
    font-weight: 700;
  }
  .board-tag + .gear {
    margin-left: 0;
  }
  .mine-switch + .gear {
    margin-left: 0;
  }
  .scroller {
    flex: 1;
    min-height: 0;
    overflow: auto;
    border-radius: var(--radius);
    background: var(--card);
    box-shadow: var(--shadow-soft);
  }
  .empty-state {
    margin: 0 0 0.6rem;
    padding: 0.8rem 1rem;
    border-radius: 14px;
    background: var(--paper-deep);
  }
  .empty-state p {
    margin: 0;
    font-weight: 700;
  }
  .empty-state .sub {
    margin-top: 0.2rem;
    font-weight: 400;
    color: var(--ink-soft);
  }
  .fab {
    position: fixed;
    right: 1.2rem;
    bottom: 1.4rem;
    z-index: 30;
    width: 60px;
    height: 60px;
    border-radius: 50%;
    font-size: 1.8rem;
    background: var(--teal);
    color: #fff;
    box-shadow: var(--shadow-note);
  }
  .nudge {
    color: var(--ink);
  }
  .nudge h4 {
    margin: 0 2.5rem 0.5rem 0;
    font-size: 1.15rem;
  }
  .nudge p {
    margin: 0 0 1rem;
  }
  .nudge .row {
    display: flex;
    gap: 0.6rem;
    flex-wrap: wrap;
  }
  .nudge button {
    min-height: 44px;
    padding: 0 1.1rem;
    border-radius: 999px;
    font-weight: 700;
    background: var(--paper-deep);
    color: var(--ink);
  }
  .nudge .primary {
    background: var(--teal);
    color: #fff;
  }
  @media (prefers-reduced-motion: reduce) {
    .glow {
      animation: none;
    }
  }
</style>
