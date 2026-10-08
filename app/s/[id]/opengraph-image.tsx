import { isShareId } from "../../leaderboard/shared";
import { leaderboardStore } from "../../leaderboard/store";
import { CARD_SIZE, playerCard, siteCard } from "../../share/ogCard";

/** The card shown when a player's share link is posted: their best times, from the leaderboard. */
export const alt = "Best times in Gugut & the Goat";
export const size = CARD_SIZE;
export const contentType = "image/png";
// Fresh each time: their times and ranks change.
export const dynamic = "force-dynamic";

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const profile = isShareId(id) ? await leaderboardStore().profile(id).catch(() => null) : null;
  return profile ? playerCard(profile) : siteCard();
}
