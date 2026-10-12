import { RegExpMatcher, englishDataset, englishRecommendedTransformers } from "obscenity";

/**
 * Keeping the leaderboard's names clean, for a board the whole world sees:
 * swear words and slurs (obscenity's English list, which also catches
 * l33t-speak and spacing tricks), words added here (EXTRA_WORDS, any
 * language), and links (spam). Checked by the API on every name it takes
 * (api/leaderboard, api/player), and in Settings before saving.
 *
 * Short words that are also parts of real names (Assefa, Assegid, Shitaye,
 * Dickson, Analise, Cumhur…) only count as whole words (SHORT_WORDS), so the
 * filter never turns away a player for their own name.
 */
const SHORT_WORDS = ["ass", "shit", "dick", "anal", "cum", "tit", "tits", "cock", "piss", "twat", "fag"];

const dataset = englishDataset.removePhrasesIf((p) => SHORT_WORDS.includes(p.metadata?.originalWord ?? ""));
const matcher = new RegExpMatcher({ ...dataset.build(), ...englishRecommendedTransformers });

/** The short words, alone (with l33t-speak undone, and a few endings: "shits", "shitty", "asshole"…). */
const SHORT = new RegExp(String.raw`\b(${SHORT_WORDS.join("|")})(s|es|ty|ter|head|face|hole|wipe)?\b`, "i");
const unleet = (s: string) =>
  s.replace(/[@4]/g, "a").replace(/3/g, "e").replace(/[1!|]/g, "i").replace(/0/g, "o").replace(/[$5]/g, "s").replace(/7/g, "t");

/** More words to refuse (lowercase; matched anywhere in the name), e.g. in Amharic. */
const EXTRA_WORDS: string[] = [];

const LINK = /https?:|www\.|\.(com|net|org|io|xyz|ru|me|link|ly)\b/i;

/** Why a name can't go on the board, or null if it's fine. */
export function nameProblem(name: string): string | null {
  const lower = name.normalize("NFKC").toLowerCase();
  if (matcher.hasMatch(name) || SHORT.test(unleet(lower)) || EXTRA_WORDS.some((w) => lower.includes(w))) {
    return "Please choose a different name.";
  }
  if (LINK.test(name)) return "Names can't include links.";
  return null;
}

/** A name as shown on the board: one that slipped in before the filter shows as "Goatherd". */
export function boardName(name: string): string {
  return nameProblem(name) ? "Goatherd" : name;
}
