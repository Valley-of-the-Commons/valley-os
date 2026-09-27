<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // A session's detail (valley-os v2c AC-c5/c9): public star toggle and
  // count, public comments, the clash notice, and swaps (ask for this slot,
  // accept or decline one aimed at your session, withdraw your own). What the
  // viewer may do is decided by @holons/core/sessions; this view only shows it.
  import {
    canWriteSession,
    countStars,
    deriveSwapState,
    starId,
    type Programme,
    type Session,
    type SwapRequest,
    type WriteTier,
  } from "@holons/core/sessions";
  import Modal from "./Modal.svelte";
  import { t, locale } from "$lib/i18n";
  import type { ActionResult } from "$lib/programmeActions";
  import { safeWebUrl } from "$lib/programmeTime";

  export let session: Session;
  export let programme: Programme;
  export let viewerUid: string | null;
  export let tier: WriteTier;
  export let resolve: (id: string) => string;
  export let timezone: string;
  export let contested = false;
  /** Personal controls hidden (shared board, or logged out). */
  export let ambient = false;
  export let onEdit: () => void;
  export let onStar: () => Promise<ActionResult>;
  export let onComment: (body: string) => Promise<ActionResult>;
  export let onRequestSwap: (fromSessionId: string) => Promise<ActionResult>;
  export let onAccept: (swap: SwapRequest) => Promise<ActionResult>;
  export let onDecide: (
    swap: SwapRequest,
    type: "declined" | "withdrawn",
  ) => Promise<ActionResult>;
  export let onLogin: () => void;
  export let onClose: () => void;

  $: me = viewerUid ? resolve(viewerUid) : null;
  $: room = programme.rooms.find((r) => r.id === session.roomId)?.name ?? "";
  $: labels = [
    programme.tracks.find((x) => x.id === session.trackId)?.name,
    programme.formats.find((x) => x.id === session.formatId)?.name,
    ...(session.tags ?? []).map(
      (id) => programme.tags.find((x) => x.id === id)?.name,
    ),
  ].filter((x): x is string => !!x);
  $: stars = countStars(programme.stars, session.id, resolve);
  $: starred =
    !!me && programme.stars.some((s) => s.id === starId(session.id, me!));
  $: comments = programme.comments
    .filter((c) => c.sessionId === session.id)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  $: mine = !!me && resolve(session.createdBy) === me;
  $: canEdit = canWriteSession(tier, "edit", session, viewerUid, resolve);
  $: loggedIn = tier !== "logged-out";
  $: nowIso = new Date().toISOString();
  $: live = (w: SwapRequest) =>
    deriveSwapState(
      w,
      programme.swaps,
      programme.sessions,
      nowIso,
      resolve,
      timezone,
    ) === "proposed";
  $: incoming = mine
    ? programme.swaps.filter((w) => w.targetSessionId === session.id && live(w))
    : [];
  $: outgoing = programme.swaps.filter(
    (w) =>
      w.targetSessionId === session.id &&
      live(w) &&
      !!me &&
      resolve(w.createdBy) === me,
  );
  $: myOffers = me
    ? programme.sessions.filter(
        (s) =>
          !s.deleted &&
          s.type !== "keynote" &&
          s.id !== session.id &&
          resolve(s.createdBy) === me,
      )
    : [];
  $: canAskSwap =
    loggedIn &&
    !ambient &&
    !mine &&
    session.type !== "keynote" &&
    outgoing.length === 0;

  // Comments are public and untrusted: only http(s) links become links.
  const webUrl = (text: string) => safeWebUrl(text);
  const titleOf = (id: string) =>
    programme.sessions.find((s) => s.id === id)?.title ?? "";

  function when(iso: string, loc: string) {
    return new Intl.DateTimeFormat(loc, {
      weekday: "long",
      day: "numeric",
      month: "long",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      timeZone: timezone,
    }).format(new Date(iso));
  }
  function endTime(iso: string, loc: string) {
    return new Intl.DateTimeFormat(loc, {
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      timeZone: timezone,
    }).format(new Date(iso));
  }

  let body = "";
  let posting = false;
  let notice = "";
  let swapOpen = false;
  let offerId = "";

  async function post() {
    if (!body.trim()) return;
    posting = true;
    const r = await onComment(body);
    posting = false;
    if (r.ok) body = "";
  }

  async function sendSwap() {
    if (!offerId) return;
    const r = await onRequestSwap(offerId);
    notice = r.ok ? $t("sessionDetail.swapSent") : $t("editor.errNotAllowed");
    if (r.ok) swapOpen = false;
  }

  async function decide(w: SwapRequest, type: "declined" | "withdrawn") {
    const r = await onDecide(w, type);
    notice = r.ok ? "" : $t("editor.errNotAllowed");
  }

  async function accept(w: SwapRequest) {
    const r = await onAccept(w);
    notice = r.ok
      ? ""
      : r.reason === "slot-taken"
        ? $t("sessionDetail.slotTaken")
        : $t("editor.errNotAllowed");
    if (r.ok) onClose();
  }
</script>

<Modal
  sheet
  tint={session.type === "keynote" ? "var(--note-sun)" : "var(--note-sky)"}
  on:close={onClose}
>
  <article class="detail" class:keynote={session.type === "keynote"}>
    <header>
      {#if session.type === "keynote"}<span class="tag"
          >{$t("programme.keynote")}</span
        >{/if}
      <h4>{session.title}</h4>
      <p class="meta">
        {when(session.startsAt, $locale)} – {endTime(
          session.endsAt,
          $locale,
        )}{#if room}<span class="sep"> · </span>{room}{/if}
      </p>
      {#if labels.length}<p class="labels">{labels.join(" · ")}</p>{/if}
      {#if mine}<p class="mine">{$t("sessionDetail.byYou")}</p>{/if}
    </header>

    {#if contested}
      <p class="contested notice-box">{$t("sessionDetail.contested")}</p>
    {/if}

    {#if session.description}<p class="description">
        {session.description}
      </p>{/if}

    <div class="bar">
      {#if loggedIn && !ambient}
        <button
          type="button"
          class="star"
          class:on={starred}
          aria-pressed={starred}
          on:click={onStar}
        >
          {starred ? "★" : "☆"}
          {starred ? $t("sessionDetail.unstar") : $t("sessionDetail.star")}
        </button>
      {/if}
      <span class="count"
        >{$t("sessionDetail.starCount", { count: stars })}</span
      >
      {#if canEdit && !ambient}
        <button type="button" class="edit" on:click={onEdit}
          >{$t("sessionDetail.edit")}</button
        >
      {/if}
    </div>

    {#if !loggedIn || ambient}
      <button type="button" class="login" on:click={onLogin}
        >{$t("sessionDetail.loginToAct")}</button
      >
    {/if}

    {#each incoming as w (w.id)}
      <div class="swap notice-box">
        <p>
          {$t("sessionDetail.swapIncoming", {
            title: titleOf(w.fromSessionId),
          })}
        </p>
        <div class="row">
          <button type="button" class="primary" on:click={() => accept(w)}
            >{$t("sessionDetail.accept")}</button
          >
          <button type="button" on:click={() => decide(w, "declined")}
            >{$t("sessionDetail.decline")}</button
          >
        </div>
      </div>
    {/each}
    {#each outgoing as w (w.id)}
      <div class="swap notice-box">
        <p>
          {$t("sessionDetail.swapOutgoing", {
            title: titleOf(w.fromSessionId),
          })}
        </p>
        <button type="button" on:click={() => decide(w, "withdrawn")}
          >{$t("sessionDetail.withdraw")}</button
        >
      </div>
    {/each}

    {#if canAskSwap}
      {#if swapOpen}
        <div class="swap notice-box">
          {#if myOffers.length}
            <label>
              {$t("sessionDetail.swapPick")}
              <select bind:value={offerId}>
                <option value="" disabled></option>
                {#each myOffers as s (s.id)}
                  <option value={s.id}
                    >{s.title} · {endTime(s.startsAt, $locale)}</option
                  >
                {/each}
              </select>
            </label>
            <button
              type="button"
              class="primary"
              disabled={!offerId}
              on:click={sendSwap}>{$t("sessionDetail.swapSend")}</button
            >
          {:else}
            <p>{$t("sessionDetail.swapNone")}</p>
          {/if}
        </div>
      {:else}
        <button type="button" class="ask" on:click={() => (swapOpen = true)}
          >{$t("sessionDetail.requestSwap")}</button
        >
      {/if}
    {/if}
    {#if notice}<p class="notice" role="status">{notice}</p>{/if}

    <section class="comments" aria-label={$t("sessionDetail.comments")}>
      <h5>{$t("sessionDetail.comments")}</h5>
      {#each comments as c (c.id)}
        <p class="comment">
          {#if webUrl(c.body)}<a
              href={webUrl(c.body)}
              target="_blank"
              rel="noopener noreferrer">{c.body}</a
            >{:else}{c.body}{/if}
        </p>
      {:else}
        <p class="empty">{$t("sessionDetail.noComments")}</p>
      {/each}
      {#if loggedIn && !ambient}
        <form class="composer" on:submit|preventDefault={post}>
          <input
            type="text"
            bind:value={body}
            placeholder={$t("sessionDetail.commentPlaceholder")}
            maxlength="1000"
          />
          <button
            type="submit"
            class="primary"
            disabled={posting || !body.trim()}
            >{$t("sessionDetail.post")}</button
          >
        </form>
      {/if}
    </section>
  </article>
</Modal>

<style>
  .detail {
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
    color: var(--ink);
  }
  header h4 {
    margin: 0.2rem 2.5rem 0.2rem 0;
    font-size: 1.25rem;
  }
  .tag {
    font-size: 0.72rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--teal-deep);
  }
  .meta,
  .labels,
  .mine {
    margin: 0;
    color: var(--ink-soft);
    font-size: 0.9rem;
  }
  .mine {
    font-weight: 700;
    color: var(--teal-deep);
  }
  .description {
    margin: 0;
    line-height: 1.45;
    white-space: pre-wrap;
  }
  .notice-box {
    margin: 0;
    padding: 0.6rem 0.75rem;
    border-radius: 12px;
    background: var(--paper-deep);
    font-size: 0.9rem;
  }
  .contested {
    border-left: 4px solid var(--warn);
  }
  .bar {
    display: flex;
    align-items: center;
    gap: 0.7rem;
    flex-wrap: wrap;
  }
  .count {
    color: var(--ink-soft);
    font-size: 0.88rem;
  }
  button {
    min-height: 44px;
    padding: 0 1rem;
    border-radius: 999px;
    font-weight: 700;
    background: var(--paper-deep);
    color: var(--ink);
  }
  /* Stars are always gold. */
  .star {
    color: var(--star);
  }
  .star.on {
    background: var(--star);
    color: #fff;
  }
  .edit {
    margin-left: auto;
  }
  .primary {
    background: var(--teal);
    color: #fff;
  }
  .primary:disabled {
    opacity: 0.55;
  }
  .login,
  .ask {
    align-self: flex-start;
  }
  .swap p {
    margin: 0 0 0.5rem;
  }
  .swap label {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    margin-bottom: 0.5rem;
    font-size: 0.85rem;
  }
  .row {
    display: flex;
    gap: 0.5rem;
  }
  .notice {
    margin: 0;
    font-size: 0.88rem;
    color: var(--teal-deep);
  }
  .comments h5 {
    margin: 0.4rem 0;
    font-size: 0.95rem;
  }
  .comment {
    margin: 0 0 0.45rem;
    font-size: 0.9rem;
    line-height: 1.4;
    overflow-wrap: anywhere;
  }
  .empty {
    margin: 0;
    color: var(--muted);
    font-size: 0.88rem;
  }
  .composer {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 0.4rem;
    margin-top: 0.5rem;
  }
  select,
  input[type="text"] {
    font: inherit;
    padding: 0.5rem 0.6rem;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--card);
    color: var(--ink);
    min-height: 44px;
    box-sizing: border-box;
  }
  @media (max-width: 767px) {
    .composer {
      grid-template-columns: 1fr;
    }
  }
</style>
