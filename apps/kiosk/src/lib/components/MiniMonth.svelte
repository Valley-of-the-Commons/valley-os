<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // A mini-month date picker for the programme sidebar (valley-os v2c AC-c8).
  // It only picks a date for the Day/Week grid; it is not a Month view.
  import { addDays } from "@holons/core/time";
  import { monthGrid } from "$lib/programmeTime";
  import { t, locale } from "$lib/i18n";

  export let date: string;
  export let today: string;
  export let onPick: (date: string) => void;

  let shown = date;
  $: if (date.slice(0, 7) !== shown.slice(0, 7)) shown = date;
  $: weeks = monthGrid(shown);
  $: title = new Intl.DateTimeFormat($locale, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${shown.slice(0, 7)}-15T12:00:00Z`));
  $: weekdays = weeks[0].map((d) =>
    new Intl.DateTimeFormat($locale, {
      weekday: "narrow",
      timeZone: "UTC",
    }).format(new Date(`${d.date}T12:00:00Z`)),
  );
  const monthStep = (step: number) => {
    const first = `${shown.slice(0, 8)}01`;
    shown =
      step < 0
        ? `${addDays(first, -1).slice(0, 8)}01`
        : `${addDays(first, 32).slice(0, 8)}01`;
  };
</script>

<div class="mini" aria-label={$t("programme.pickDate")}>
  <div class="top">
    <button
      type="button"
      on:click={() => monthStep(-1)}
      aria-label={$t("cal.previous")}>‹</button
    >
    <span>{title}</span>
    <button
      type="button"
      on:click={() => monthStep(1)}
      aria-label={$t("cal.next")}>›</button
    >
  </div>
  <div class="days">
    {#each weekdays as w, i (i)}<span class="wd">{w}</span>{/each}
    {#each weeks as week (week[0].date)}
      {#each week as d (d.date)}
        <button
          type="button"
          class="day"
          class:out={!d.inMonth}
          class:today={d.date === today}
          class:sel={d.date === date}
          aria-pressed={d.date === date}
          on:click={() => onPick(d.date)}>{Number(d.date.slice(8))}</button
        >
      {/each}
    {/each}
  </div>
</div>

<style>
  .mini {
    font-size: 0.8rem;
    color: var(--ink);
  }
  .top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 0.3rem;
    font-weight: 700;
  }
  .top button {
    width: 32px;
    height: 32px;
    border-radius: 50%;
  }
  .days {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 2px;
    text-align: center;
  }
  .wd {
    color: var(--muted);
    font-size: 0.7rem;
  }
  .day {
    height: 30px;
    border-radius: 8px;
    font: inherit;
    color: var(--ink);
  }
  .day.out {
    color: var(--muted);
  }
  .day.today {
    font-weight: 800;
    color: var(--teal-deep);
  }
  .day.sel {
    background: var(--teal);
    color: #fff;
  }
</style>
