"use client";

/**
 * The story's pieces, shared by the preloader (ui/LoadingOverlay — the start
 * of the story) and the outro (ui/OutroStory — its end): the words writing
 * themselves in over the picture, and the gold button that follows them.
 */

/** The picture the story is written on (up past the tree, at the sky). */
export const STORY_SRC = "/preloader/second.webp";

/** Soft shadow so the cream lettering holds up over bright sky. */
export const SHADOW = "[text-shadow:0_2px_14px_rgba(20,16,8,0.45)]";

/** When each word starts writing in (ms after mount), and how long one takes. */
const FIRST_WORD_MS = 200;
const PER_WORD_MS = 45;
const WORD_MS = 520;

/** How long `lines` take to write themselves in (ms). */
export function storyWritingMs(lines: readonly string[]): number {
  const words = lines.reduce((n, line) => n + line.split(" ").length, 0);
  return FIRST_WORD_MS + words * PER_WORD_MS + WORD_MS;
}

/**
 * The story, written onto the picture word by word (placed to sit on the
 * sky of the preloader's second image). Mounted per showing, so it writes
 * itself again each time.
 */
export function StoryText({ lines }: { lines: readonly string[] }) {
  let word = 0;
  return (
    <div
      className={`absolute right-6 left-6 space-y-[2.2vh] leading-[1.25] tracking-wide text-[#fdf3d4] portrait:top-[40svh] portrait:text-[clamp(1.05rem,4.6vw,1.6rem)] landscape:top-[max(18vh,4.5rem)] landscape:right-[13vw] landscape:left-[41.5vw] landscape:text-[clamp(0.95rem,min(1.9vw,4.4vh),2.2rem)] ${SHADOW}`}
    >
      {lines.map((line) => (
        <p key={line}>
          {line.split(" ").map((w, i) => (
            <span
              key={i}
              className="inline-block opacity-0"
              style={{ animation: `story-word-in ${WORD_MS}ms ease-out ${FIRST_WORD_MS + word++ * PER_WORD_MS}ms forwards` }}
            >
              {w}&nbsp;
            </span>
          ))}
        </p>
      ))}
    </div>
  );
}

/**
 * The gold button under the story ("Enter the maze", "See how you did").
 * Focused, so Enter / Space press it.
 */
export function StoryButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      autoFocus
      onClick={onClick}
      className="group absolute right-[6vw] bottom-[6vh] flex items-center gap-3 rounded-full bg-[#c9a45c] py-2 pr-2 pl-7 text-[clamp(1.6rem,min(2.6vw,5.5vh),2.8rem)] leading-none text-[#2a2312] opacity-0 shadow-[0_6px_30px_rgba(20,16,8,0.35)] transition-[background-color,scale] duration-300 hover:scale-105 hover:bg-[#d8b46a] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#fdf3d4]"
      style={{ animation: "notice-in 700ms ease-out forwards" }}
    >
      {label}
      <svg viewBox="0 0 24 24" aria-hidden className="size-[1.3em] transition-transform duration-300 group-hover:translate-x-0.5">
        <circle cx="12" cy="12" r="12" fill="#fdf3d4" />
        <path d="M9.5 7.5v9l7-4.5z" fill="#c9a45c" />
      </svg>
    </button>
  );
}
