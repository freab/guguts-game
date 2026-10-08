import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { posterFont } from "../../fonts";
import { LEVELS } from "../../maze/levels";
import { formatTime, isShareId, type ShareProfile } from "../../leaderboard/shared";
import { leaderboardStore } from "../../leaderboard/store";
import { SITE_NAME } from "../../site";

// Their times and ranks change with every run.
export const dynamic = "force-dynamic";

async function load(id: string): Promise<ShareProfile | null> {
  return isShareId(id) ? leaderboardStore().profile(id).catch(() => null) : null;
}

/** The fastest of their times, for the link's title. */
function headline(profile: ShareProfile): string {
  const done = LEVELS.filter((l) => profile.bests[l.id]);
  if (done.length === 0) return `${profile.name} is searching for Gugut's goat`;
  const top = done[done.length - 1]; // the hardest level they've finished
  return `${profile.name} found the goat in ${formatTime(profile.bests[top.id]!.timeMs)} on ${top.label}`;
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const profile = await load((await params).id);
  if (!profile) return { title: SITE_NAME };
  const title = `${headline(profile)} — ${SITE_NAME}`;
  const description = "Can you find her faster? Play free in your browser.";
  return { title, description, openGraph: { title, description }, twitter: { title, description } };
}

/** Soft shadow so the cream lettering holds up over the scene (as on the title screen). */
const SHADOW = "[text-shadow:0_2px_14px_rgba(20,16,8,0.55)]";

/**
 * A player's shared page (/s/<share id>): their best time on each level,
 * with its rank — straight from the leaderboard — and a way into the game.
 * Styled like the title screen and preloader (ui/LoadingOverlay): the maze
 * entrance filling the screen, the GUGUT wordmark, the poster's cream
 * lettering, glass rows, and a gold "Play" pill with the cream play button.
 * Its link preview is the matching card (opengraph-image.tsx).
 */
export default async function SharePage({ params }: { params: Promise<{ id: string }> }) {
  const profile = await load((await params).id);
  const rows = profile ? LEVELS.filter((l) => profile.bests[l.id]) : [];
  return (
    <main className={`${posterFont.className} text-[#fdf3d4]`}>
      {/* The scene stays put behind the page; darker on the left (the bottom
          on phones), where the words sit. */}
      <div className="fixed inset-0">
        <Image src="/preloader/first.webp" alt="" fill priority sizes="100vw" className="object-cover" />
        <div className="absolute inset-0 bg-linear-to-t from-[rgba(20,16,8,0.85)] via-[rgba(20,16,8,0.55)] to-[rgba(20,16,8,0.25)] md:bg-linear-to-r md:from-[rgba(20,16,8,0.85)] md:via-[rgba(20,16,8,0.5)] md:to-transparent" />
      </div>

      <div className="fixed inset-0 overflow-y-auto">
      <div className="flex min-h-full w-full flex-col justify-between gap-[5vh] px-6 py-[6vh] md:w-[min(46rem,60vw)] md:px-[6vw]">
        <Link href="/" aria-label={SITE_NAME} className="w-[clamp(11rem,min(20vw,30vh),16rem)]">
          <Image
            src="/logo gugut.svg"
            alt={SITE_NAME}
            width={317}
            height={210}
            className="h-auto w-full drop-shadow-[0_2px_14px_rgba(20,16,8,0.45)]"
          />
        </Link>

        <div className="space-y-[2.5vh]">
          <h1 className={`text-[clamp(2.4rem,min(5vw,9vh),4.4rem)] leading-none ${SHADOW}`}>
            {profile ? `${profile.name} found the goat` : "Gugut's goat ran into the maze"}
          </h1>
          {rows.length > 0 && (
            <div className="flex flex-col gap-[1.4vh]">
              {rows.map((l) => {
                const best = profile!.bests[l.id]!;
                return (
                  <div
                    key={l.id}
                    className="flex items-center gap-4 rounded-2xl border border-white/50 bg-white/15 px-6 py-[1.2vh] backdrop-blur-sm"
                  >
                    <span className="w-20 text-[clamp(1.2rem,min(1.8vw,3.6vh),1.8rem)] text-[#fdf3d4]/75">{l.label}</span>
                    <span className={`flex-1 text-[clamp(2.2rem,min(4vw,8vh),3.6rem)] leading-none tabular-nums ${SHADOW}`}>
                      {formatTime(best.timeMs)}
                    </span>
                    <span className="text-[clamp(1.1rem,min(1.6vw,3.2vh),1.6rem)]">
                      #{best.rank} of {best.players}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
          {profile && rows.length === 0 && <p className={`text-2xl text-[#fdf3d4]/75 ${SHADOW}`}>Still searching the maze…</p>}
          <p className={`max-w-xl text-[clamp(1.2rem,min(1.9vw,4vh),1.9rem)] leading-tight text-[#fdf3d4]/80 ${SHADOW}`}>
            Find her before the sun goes down — call her, follow her bleat, and listen to the kirar by the old tree.
            {profile && rows.length > 0 ? " Can you find her faster?" : ""}
          </p>
        </div>

        <Link
          href="/"
          className="group flex w-fit items-center gap-3 rounded-full bg-[#c9a45c] py-2 pr-2 pl-7 text-[clamp(1.6rem,min(2.6vw,5.5vh),2.6rem)] leading-none text-[#2a2312] shadow-[0_6px_30px_rgba(20,16,8,0.35)] transition-[background-color,scale] duration-300 hover:scale-105 hover:bg-[#d8b46a] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#fdf3d4]"
        >
          Play now
          <svg viewBox="0 0 24 24" aria-hidden className="size-[1.3em] transition-transform duration-300 group-hover:translate-x-0.5">
            <circle cx="12" cy="12" r="12" fill="#fdf3d4" />
            <path d="M9.5 7.5v9l7-4.5z" fill="#c9a45c" />
          </svg>
        </Link>
      </div>
      </div>
    </main>
  );
}
