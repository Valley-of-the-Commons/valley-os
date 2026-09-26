<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // A shift on the programme (valley-os v2c AC-c5): sign up or leave through
  // the kiosk's existing shift RSVP path. Shifts take no comments. A viewer
  // whose signing key is unavailable sees why they cannot sign.
  import type { ShiftOccurrence } from "@holons/core/shifts";
  import Modal from "./Modal.svelte";
  import { t, locale } from "$lib/i18n";
  import type { CannotSign } from "$lib/programmeSigning";

  export let occurrence: ShiftOccurrence;
  export let timezone: string;
  export let mine: boolean;
  export let full: boolean;
  export let taken: number;
  export let loggedIn: boolean;
  /** Why the viewer cannot sign, if they cannot (see programmeSigning). */
  export let cannotSign: CannotSign | null = null;
  export let busy = false;
  export let onToggle: () => void;
  export let onLogin: () => void;
  export let onClose: () => void;

  const fmt = (sec: number, loc: string, opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(loc, {
      ...opts,
      hourCycle: "h23",
      timeZone: timezone,
    }).format(new Date(sec * 1000));
</script>

<Modal sheet tint="var(--note-mint)" on:close={onClose}>
  <article class="shift">
    <h4>{occurrence.title}</h4>
    <p class="meta">
      {fmt(occurrence.start, $locale, {
        weekday: "long",
        day: "numeric",
        month: "long",
        hour: "2-digit",
        minute: "2-digit",
      })}
      – {fmt(occurrence.end, $locale, { hour: "2-digit", minute: "2-digit" })}
      {#if occurrence.location}· {occurrence.location}{/if}
    </p>
    {#if occurrence.content}<p class="content">{occurrence.content}</p>{/if}
    <p class="count">
      {$t("programme.signedUp", {
        count: taken,
      })}{#if occurrence.capacity !== undefined}{" / "}{occurrence.capacity}{/if}
    </p>

    {#if !loggedIn}
      <button type="button" class="primary" on:click={onLogin}
        >{$t("loginPopup.go")}</button
      >
    {:else if cannotSign}
      <p class="cannot-sign" role="status">
        {$t(
          cannotSign === "key"
            ? "programmeShifts.cannotSignKey"
            : "programmeShifts.cannotSignServer",
        )}
      </p>
    {:else if mine}
      <button type="button" disabled={busy} on:click={onToggle}
        >{$t("shiftCard.drop")}</button
      >
    {:else if full}
      <p class="full" role="status">{$t("shiftCard.full")}</p>
    {:else}
      <button type="button" class="primary" disabled={busy} on:click={onToggle}
        >{$t("shiftCard.take")}</button
      >
    {/if}
  </article>
</Modal>

<style>
  .shift {
    display: flex;
    flex-direction: column;
    gap: 0.7rem;
    color: var(--ink);
  }
  h4 {
    margin: 0 2.5rem 0 0;
    font-size: 1.2rem;
  }
  .meta,
  .count {
    margin: 0;
    color: var(--ink-soft);
    font-size: 0.9rem;
  }
  .content {
    margin: 0;
    line-height: 1.45;
    white-space: pre-wrap;
  }
  .cannot-sign,
  .full {
    margin: 0;
    padding: 0.6rem 0.75rem;
    border-radius: 12px;
    background: var(--paper-deep);
    font-size: 0.9rem;
  }
  button {
    align-self: flex-start;
    min-height: 44px;
    padding: 0 1.1rem;
    border-radius: 999px;
    font-weight: 700;
    background: var(--paper-deep);
    color: var(--ink);
  }
  .primary {
    background: var(--teal);
    color: #fff;
  }
</style>
