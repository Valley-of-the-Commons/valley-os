// @holons/core/calendar — RSVP / participation tracking
// Retained for the live Telegram /rsvp command and the mcp-ui calendar tools;
// the rest of the RSVP path was retired in v2b (sessions replace it).
// UI-agnostic: no Telegraf, no DOM.

/** Display fields used to build a participant label. */
export interface RSVPUser {
    id: string | number;
    username?: string;
    first_name?: string;
    second_name?: string;
    /**
     * Map of `messageId -> attending?` for legacy bot storage. The bot
     * stores per-message RSVP state on the user record.
     */
    participated?: Record<string, boolean | undefined> | null;
}

/** Display name for a user, falling back through the available fields. */
export function rsvpDisplayName(user: RSVPUser): string {
    const first = user.first_name || user.username || String(user.id);
    return user.second_name ? `${first} ${user.second_name}` : first;
}

/** Whether the user is currently marked attending for the given event/message. */
export function isAttending(
    user: RSVPUser,
    eventKey: string | number
): boolean {
    if (!user || typeof user.participated !== 'object' || !user.participated) {
        return false;
    }
    return Boolean(user.participated[String(eventKey)]);
}

/**
 * Toggle the user's RSVP state for the given event/message key.
 * Mutates and returns the user (ensuring `participated` is an object).
 */
export function toggleRSVP<T extends RSVPUser>(
    user: T,
    eventKey: string | number
): T {
    if (typeof user.participated !== 'object' || !user.participated) {
        user.participated = {};
    }
    const key = String(eventKey);
    user.participated[key] = !user.participated[key];
    return user;
}
