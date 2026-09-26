<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // Create or edit a session (valley-os v2c AC-c4): a popover on laptop, a
  // full-screen sheet on phones. Times are picked on the half-hour grid in the
  // hub's time zone; the keynote type is offered only to the admin. The rules
  // are core's; this form collects values and shows what the action answers.
  import type {
    Format,
    Room,
    Session,
    Tag,
    Track,
  } from "@holons/core/sessions";
  import Modal from "./Modal.svelte";
  import { t } from "$lib/i18n";
  import { HALF_HOURS, instantFor, wallTimeOf } from "$lib/programmeTime";
  import type { ActionResult, SessionDraft } from "$lib/programmeActions";

  export let rooms: Room[];
  export let tracks: Track[] = [];
  export let formats: Format[] = [];
  export let tags: Tag[] = [];
  export let timezone: string;
  export let isAdmin = false;
  /** The session being edited, or null to create. */
  export let session: Session | null = null;
  /** Prefill for a new session (an empty-cell click). */
  export let prefill: { roomId?: string; date: string; time?: string } | null =
    null;
  export let onSave: (
    draft: SessionDraft,
    repeatWeeklyUntil?: string,
  ) => Promise<ActionResult>;
  export let onDelete: (() => Promise<ActionResult>) | null = null;
  export let onClose: () => void;

  const start = session ? wallTimeOf(session.startsAt, timezone) : null;
  const end = session ? wallTimeOf(session.endsAt, timezone) : null;
  const defaultStart = prefill?.time ?? "10:00";
  const nextSlot = (hhmm: string) =>
    HALF_HOURS[Math.min(47, HALF_HOURS.indexOf(hhmm) + 2)] ?? "23:30";

  let title = session?.title ?? "";
  let type: "session" | "keynote" = session?.type ?? "session";
  let roomId = session?.roomId ?? prefill?.roomId ?? rooms[0]?.id ?? "";
  let date = start?.date ?? prefill?.date ?? "";
  let startTime = start?.time ?? defaultStart;
  // A session ending at midnight reads back as the next day's 00:00.
  let endTime = end
    ? end.date > (start?.date ?? "") && end.time === "00:00"
      ? "24:00"
      : end.time
    : nextSlot(defaultStart);
  let description = session?.description ?? "";
  let trackId = session?.trackId ?? "";
  let formatId = session?.formatId ?? "";
  let tagIds: string[] = [...(session?.tags ?? [])];
  let repeat = false;
  let repeatUntil = "";
  let error = "";
  let saving = false;
  let confirmingDelete = false;

  // End choices run to midnight ("24:00") and stay after the start.
  const ENDS = [...HALF_HOURS.slice(1), "24:00"];
  $: endChoices = ENDS.filter((e) => e > startTime);
  $: if (!endChoices.includes(endTime))
    endTime = endChoices[1] ?? endChoices[0];

  function message(r: ActionResult): string {
    if (r.ok) return "";
    if (r.reason === "times") return $t("editor.errTimes");
    if (r.reason === "not-allowed") return $t("editor.errNotAllowed");
    if (r.reason === "invalid") return $t("editor.errInvalid");
    return $t("editor.errWrite");
  }

  async function save() {
    error = "";
    if (!title.trim()) {
      error = $t("editor.errTitle");
      return;
    }
    saving = true;
    const draft: SessionDraft = {
      type: isAdmin
        ? type
        : session?.type === "keynote"
          ? "keynote"
          : "session",
      roomId,
      title: title.trim(),
      startsAt: instantFor(date, startTime, timezone),
      endsAt: instantFor(date, endTime, timezone),
      ...(description.trim() ? { description: description.trim() } : {}),
      trackId: trackId || null,
      formatId: formatId || null,
      tags: tagIds,
    };
    const r = await onSave(
      draft,
      !session && repeat && repeatUntil ? repeatUntil : undefined,
    );
    saving = false;
    if (r.ok) onClose();
    else error = message(r);
  }

  async function remove() {
    if (!onDelete) return;
    saving = true;
    const r = await onDelete();
    saving = false;
    if (r.ok) onClose();
    else error = message(r);
  }
</script>

<Modal sheet on:close={onClose}>
  <form class="editor" on:submit|preventDefault={save}>
    <h4>{session ? $t("editor.editTitle") : $t("editor.newTitle")}</h4>

    <label>
      {$t("editor.title")}
      <!-- svelte-ignore a11y_autofocus -->
      <input
        type="text"
        bind:value={title}
        autofocus
        required
        maxlength="140"
      />
    </label>

    {#if isAdmin}
      <fieldset class="types">
        <legend>{$t("editor.type")}</legend>
        <label class="choice"
          ><input type="radio" bind:group={type} value="session" />
          {$t("editor.typeSession")}</label
        >
        <label class="choice"
          ><input type="radio" bind:group={type} value="keynote" />
          {$t("editor.typeKeynote")}</label
        >
      </fieldset>
    {/if}

    <label>
      {$t("editor.room")}
      <select bind:value={roomId} required>
        {#each rooms as r (r.id)}
          <option value={r.id}>{r.name}</option>
        {/each}
      </select>
    </label>

    <div class="row">
      <label>
        {$t("editor.date")}
        <input type="date" bind:value={date} required />
      </label>
      <label>
        {$t("editor.start")}
        <select bind:value={startTime}>
          {#each HALF_HOURS as h (h)}<option value={h}>{h}</option>{/each}
        </select>
      </label>
      <label>
        {$t("editor.end")}
        <select bind:value={endTime}>
          {#each endChoices as h (h)}<option value={h}>{h}</option>{/each}
        </select>
      </label>
    </div>

    {#if !session}
      <label class="choice repeat">
        <input type="checkbox" bind:checked={repeat} />
        {$t("editor.repeatWeekly")}
      </label>
      {#if repeat}
        <label>
          {$t("editor.repeatUntil")}
          <input type="date" bind:value={repeatUntil} min={date} required />
        </label>
      {/if}
    {/if}

    {#if tracks.length || formats.length}<div class="row optional">
        {#if tracks.length}<label>
            {$t("editor.track")}
            <select bind:value={trackId}>
              <option value="">{$t("editor.none")}</option>
              {#each tracks as tr (tr.id)}<option value={tr.id}
                  >{tr.name}</option
                >{/each}
            </select>
          </label>{/if}
        {#if formats.length}<label>
            {$t("editor.format")}
            <select bind:value={formatId}>
              <option value="">{$t("editor.none")}</option>
              {#each formats as f (f.id)}<option value={f.id}>{f.name}</option
                >{/each}
            </select>
          </label>{/if}
      </div>{/if}
    {#if tags.length}<fieldset class="tags">
        <legend>{$t("editor.tags")}</legend>
        {#each tags as tg (tg.id)}
          <label class="choice"
            ><input type="checkbox" bind:group={tagIds} value={tg.id} />
            {tg.name}</label
          >
        {:else}
          <span class="none">{$t("editor.none")}</span>
        {/each}
      </fieldset>{/if}

    <label>
      {$t("editor.description")}
      <textarea bind:value={description} rows="3" maxlength="2000"></textarea>
    </label>

    {#if error}<p class="error" role="alert">{error}</p>{/if}

    <div class="actions">
      {#if session && onDelete}
        {#if confirmingDelete}
          <button
            type="button"
            class="danger"
            on:click={remove}
            disabled={saving}>{$t("editor.deleteConfirm")}</button
          >
        {:else}
          <button
            type="button"
            class="danger ghost"
            on:click={() => (confirmingDelete = true)}
            >{$t("editor.delete")}</button
          >
        {/if}
      {/if}
      <button
        type="submit"
        class="primary"
        disabled={saving || !roomId || !date}
      >
        {saving ? $t("common.saving") : $t("editor.save")}
      </button>
    </div>
  </form>
</Modal>

<style>
  .editor {
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
    color: var(--ink);
  }
  h4 {
    margin: 0 2.5rem 0.2rem 0;
    font-size: 1.15rem;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--ink-soft);
  }
  input[type="text"],
  input[type="date"],
  select,
  textarea {
    font: inherit;
    font-weight: 400;
    color: var(--ink);
    padding: 0.55rem 0.65rem;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--card);
  }
  .row {
    display: grid;
    grid-template-columns: 1.4fr 1fr 1fr;
    gap: 0.6rem;
  }
  .row.optional {
    grid-template-columns: 1fr 1fr;
  }
  .tags {
    flex-wrap: wrap;
    gap: 0.4rem 1rem;
  }
  .none {
    color: var(--muted);
    font-size: 0.85rem;
  }
  fieldset {
    border: none;
    padding: 0;
    margin: 0;
    display: flex;
    gap: 1rem;
    align-items: center;
  }
  legend {
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--ink-soft);
    margin-bottom: 0.25rem;
  }
  .choice {
    flex-direction: row;
    align-items: center;
    gap: 0.4rem;
    font-weight: 500;
    color: var(--ink);
  }
  .error {
    margin: 0;
    color: var(--warn);
    font-size: 0.88rem;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.6rem;
    margin-top: 0.4rem;
  }
  .actions button {
    min-height: 44px;
    padding: 0 1.1rem;
    border-radius: 999px;
    font-weight: 700;
  }
  .primary {
    background: var(--teal);
    color: #fff;
  }
  .primary:disabled {
    opacity: 0.6;
  }
  .danger {
    background: var(--warn);
    color: #fff;
  }
  .danger.ghost {
    background: transparent;
    color: var(--warn);
    margin-right: auto;
  }
  @media (max-width: 767px) {
    .row {
      grid-template-columns: 1fr 1fr;
    }
    .row label:first-child {
      grid-column: 1 / -1;
    }
  }
</style>
