/**
 * Calendar feature. `/calendar` lists upcoming scheduled events (quests with a
 * `when`); `/ical` exports the holon's events as a downloadable `.ics` feed.
 *
 * Events themselves are created via `/event` (the quests feature) and share the
 * `quests` lens. The iCal serialisation lives in `@holons/core/calendar`.
 */
import {
  AttachmentBuilder,
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { generateICalFeed, type HolonEvent } from '@holons/core/calendar';
import type { Quest } from '@holons/core/tasks';
import type { Feature, InvocationContext } from '../types.js';
import { ACCENT } from '../ui/DiscordUI.js';

const FEATURE_ID = 'calendar';
const QUESTS_BUCKET = 'quests';
const MAX_EVENT_CARDS = 5;

async function needHolon(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  await interaction.reply({
    content:
      'This server is not bound to a holon yet. Ask an admin to run `/holon bind`.',
    flags: MessageFlags.Ephemeral,
  });
}

/** Quests that carry a schedule, oldest-first. */
function scheduledEvents(quests: Quest[]): Quest[] {
  return quests
    .filter(q => q && !q._deleted && q.when)
    .sort((a, b) => String(a.when).localeCompare(String(b.when)));
}

function upcoming(quests: Quest[]): Quest[] {
  const nowIso = new Date().toISOString();
  return scheduledEvents(quests).filter(q => String(q.when) >= nowIso);
}

function eventEmbed(event: Quest): EmbedBuilder {
  const when = event.when
    ? new Date(String(event.when)).toLocaleString()
    : 'unscheduled';
  const lines = [`🗓️ ${when}`];
  if (event.location) lines.push(`📍 ${event.location}`);
  if (event.description) lines.push(`\n${event.description}`);
  return new EmbedBuilder()
    .setColor(ACCENT)
    .setTitle(event.title)
    .setDescription(lines.join('\n'));
}

export const calendarFeature: Feature = {
  id: FEATURE_ID,
  commands: [
    new SlashCommandBuilder()
      .setName('calendar')
      .setDescription('Show upcoming events'),
    new SlashCommandBuilder()
      .setName('ical')
      .setDescription('Export this holon’s events as a .ics calendar feed'),
  ],

  async handleCommand(
    interaction: ChatInputCommandInteraction,
    ctx: InvocationContext
  ): Promise<void> {
    if (!ctx.holonId) {
      await needHolon(interaction);
      return;
    }
    const quests = ((await ctx.holosphere.getAll(ctx.holonId, QUESTS_BUCKET)) ??
      []) as Quest[];

    if (interaction.commandName === 'ical') {
      const events: HolonEvent[] = scheduledEvents(quests).map(q => ({
        id: String(q.id),
        title: q.title,
        description: q.description,
        location: q.location,
        when: String(q.when),
        ends: q.ends,
        status: q.status,
        category: q.category,
      }));
      if (events.length === 0) {
        await interaction.reply({
          content: 'No scheduled events to export yet.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const ics = generateICalFeed(events, ctx.holonId, ctx.holonId);
      const file = new AttachmentBuilder(Buffer.from(ics, 'utf8'), {
        name: 'holon.ics',
      });
      await interaction.reply({
        content: `📆 ${events.length} event(s) exported.`,
        files: [file],
      });
      return;
    }

    // commandName === 'calendar'
    const events = upcoming(quests);
    if (events.length === 0) {
      await interaction.reply({
        content: 'No upcoming events. Create one with `/event`.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const cards = events.slice(0, MAX_EVENT_CARDS);
    await interaction.reply({
      content: `**Upcoming events** (${events.length})`,
    });
    for (const event of cards) {
      await interaction.followUp({
        embeds: [eventEmbed(event)],
      });
    }
    if (events.length > cards.length) {
      await interaction.followUp({
        content: `…and ${events.length - cards.length} more. Export them all with \`/ical\`.`,
        flags: MessageFlags.Ephemeral,
      });
    }
  },
};
