<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // The admin's programme settings (valley-os v2c): add and rename rooms,
  // tracks, formats and tags, open the shift planner (shifts are created
  // here, by the admin), and reach the kiosk's own settings. The rules are
  // core's (admin-only actions); this panel collects names.
  import Modal from "./Modal.svelte";
  import { t, type MessageKey } from "$lib/i18n";
  import type { ActionResult, NamedKind } from "$lib/programmeActions";

  type Named = { id: string; name: string; sortOrder?: number };

  export let lists: Record<NamedKind, Named[]>;
  export let onSave: (
    kind: NamedKind,
    item: { id?: string; name: string },
  ) => Promise<ActionResult>;
  export let onDelete: (kind: NamedKind, id: string) => Promise<ActionResult>;
  export let onMove: (
    kind: Exclude<NamedKind, "tags">,
    id: string,
    step: -1 | 1,
  ) => Promise<ActionResult>;
  export let onPlanShifts: () => void;
  export let onKioskSettings: () => void;
  export let onClose: () => void;

  const SECTIONS: { kind: NamedKind; title: MessageKey; add: MessageKey }[] = [
    { kind: "rooms", title: "rooms.title", add: "rooms.add" },
    {
      kind: "tracks",
      title: "programmeSettings.tracks",
      add: "programmeSettings.addTrack",
    },
    {
      kind: "formats",
      title: "programmeSettings.formats",
      add: "programmeSettings.addFormat",
    },
    {
      kind: "tags",
      title: "programmeSettings.tags",
      add: "programmeSettings.addTag",
    },
  ];

  const ordered = (items: Named[]) =>
    [...items].sort(
      (a, b) =>
        (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name),
    );

  let names: Record<string, string> = {};
  $: for (const kind of Object.keys(lists) as NamedKind[])
    for (const item of lists[kind])
      if (names[`${kind}:${item.id}`] === undefined)
        names[`${kind}:${item.id}`] = item.name;
  let adding: Record<NamedKind, string> = {
    rooms: "",
    tracks: "",
    formats: "",
    tags: "",
  };
  let error = "";
  /** A delete needs a second tap: the key of the row asking to be confirmed. */
  let confirming: string | null = null;

  const failure = (r: ActionResult) =>
    r.ok
      ? ""
      : r.reason === "in-use"
        ? $t("programmeSettings.inUse")
        : r.reason === "write-failed"
          ? $t("editor.errWrite")
          : $t("editor.errNotAllowed");

  async function remove(kind: NamedKind, id: string) {
    const key = `${kind}:${id}`;
    if (confirming !== key) {
      confirming = key;
      return;
    }
    confirming = null;
    error = failure(await onDelete(kind, id));
  }

  async function move(kind: NamedKind, id: string, step: -1 | 1) {
    if (kind === "tags") return;
    error = failure(await onMove(kind, id, step));
  }

  async function save(kind: NamedKind, item: { id?: string; name: string }) {
    error = "";
    const r = await onSave(kind, item);
    if (!r.ok) error = failure(r);
    else if (!item.id) adding = { ...adding, [kind]: "" };
  }
</script>

<Modal sheet on:close={onClose}>
  <section class="settings">
    <h4>{$t("programme.settings")}</h4>

    <div class="links">
      <button type="button" class="primary" on:click={onPlanShifts}
        >{$t("programmeSettings.planShifts")}</button
      >
      <button type="button" on:click={onKioskSettings}
        >{$t("programmeSettings.kiosk")}</button
      >
    </div>

    {#each SECTIONS as sec (sec.kind)}
      <h5>{$t(sec.title)}</h5>
      {#each ordered(lists[sec.kind]) as item, i (item.id)}
        <form
          class="row"
          on:submit|preventDefault={() =>
            save(sec.kind, {
              id: item.id,
              name: names[`${sec.kind}:${item.id}`],
            })}
        >
          <input
            type="text"
            bind:value={names[`${sec.kind}:${item.id}`]}
            aria-label={`${$t(sec.title)}: ${item.name}`}
            maxlength="80"
          />
          <button
            type="submit"
            disabled={!names[`${sec.kind}:${item.id}`]?.trim() ||
              names[`${sec.kind}:${item.id}`] === item.name}
          >
            {$t("rooms.save")}
          </button>
          {#if sec.kind !== "tags"}
            <button
              type="button"
              class="icon"
              aria-label={`${$t("programmeSettings.moveUp")}: ${item.name}`}
              disabled={i === 0}
              on:click={() => move(sec.kind, item.id, -1)}>↑</button
            >
            <button
              type="button"
              class="icon"
              aria-label={`${$t("programmeSettings.moveDown")}: ${item.name}`}
              disabled={i === lists[sec.kind].length - 1}
              on:click={() => move(sec.kind, item.id, 1)}>↓</button
            >
          {/if}
          <button
            type="button"
            class="icon danger"
            class:confirm={confirming === `${sec.kind}:${item.id}`}
            aria-label={`${$t(confirming === `${sec.kind}:${item.id}` ? "programmeSettings.confirmDelete" : "programmeSettings.delete")}: ${item.name}`}
            on:click={() => remove(sec.kind, item.id)}
            >{confirming === `${sec.kind}:${item.id}`
              ? $t("programmeSettings.confirmDelete")
              : "✕"}</button
          >
        </form>
      {/each}
      <form
        class="row"
        on:submit|preventDefault={() =>
          save(sec.kind, { name: adding[sec.kind] })}
      >
        <input
          type="text"
          bind:value={adding[sec.kind]}
          placeholder={$t(sec.add)}
          aria-label={$t(sec.add)}
          maxlength="80"
        />
        <button
          type="submit"
          class="primary"
          disabled={!adding[sec.kind].trim()}>{$t(sec.add)}</button
        >
      </form>
    {/each}
    {#if error}<p class="error" role="alert">{error}</p>{/if}
  </section>
</Modal>

<style>
  .settings {
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
    color: var(--ink);
  }
  h4 {
    margin: 0 2.5rem 0.3rem 0;
    font-size: 1.15rem;
  }
  h5 {
    margin: 0.8rem 0 0.1rem;
    font-size: 0.8rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--muted);
  }
  .links {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  .row {
    display: flex;
    gap: 0.4rem;
    align-items: center;
  }
  .row input {
    flex: 1;
    min-width: 0;
  }
  .icon {
    min-width: 44px;
    padding: 0 0.6rem;
  }
  .danger {
    color: var(--warn);
  }
  .danger.confirm {
    background: var(--warn);
    color: #fff;
  }
  input {
    font: inherit;
    padding: 0.55rem 0.65rem;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--card);
    color: var(--ink);
    min-height: 44px;
    box-sizing: border-box;
  }
  button {
    min-height: 44px;
    padding: 0 1rem;
    border-radius: 999px;
    font-weight: 700;
    background: var(--paper-deep);
    color: var(--ink);
  }
  button:disabled {
    opacity: 0.5;
  }
  .primary {
    background: var(--teal);
    color: #fff;
  }
  .error {
    margin: 0;
    color: var(--warn);
  }
</style>
