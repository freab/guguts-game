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

/**
 * A player's shared page (/s/<share id>): their best time on each level,
 * with its rank — straight from the leaderboard — and a way into the game.
 * Its link preview is the same card (opengraph-image.tsx).
 */
export default async function SharePage({ params }: { params: Promise<{ id: string }> }) {
  const profile = await load((await params).id);
  return (
    <main className="h-full overflow-y-auto bg-[#1c1c1c] text-[var(--ui-ink)]">
      <div className="mx-auto flex min-h-full max-w-4xl flex-col items-center gap-6 p-4 md:flex-row md:p-10">
        <div className="relative aspect-932/1368 w-56 shrink-0 overflow-hidden rounded-2xl md:w-80">
          <Image src="/share/poster.jpg" alt={SITE_NAME} fill sizes="320px" className="object-cover" priority />
        </div>
        <div className="ui-shell w-full p-1.5">
          <div className="ui-well space-y-5 p-6">
            {profile ? (
              <>
                <div>
                  <p className="text-xs uppercase tracking-[0.3em] text-white/50">Found the goat</p>
                  <h1 className={`${posterFont.className} mt-1 text-5xl tracking-wide`}>{profile.name}</h1>
                </div>
                <div className="space-y-1.5">
                  {LEVELS.filter((l) => profile.bests[l.id]).map((l) => {
                    const best = profile.bests[l.id]!;
                    return (
                      <div key={l.id} className="ui-tile flex items-center gap-4 px-4 py-3">
                        <span className="w-20 text-sm text-white/60">{l.label}</span>
                        <span className="flex-1 font-mono text-2xl font-semibold tabular-nums text-amber-200">
                          {formatTime(best.timeMs)}
                        </span>
                        <span className="text-sm text-white/70">
                          #{best.rank} of {best.players}
                        </span>
                      </div>
                    );
                  })}
                  {LEVELS.every((l) => !profile.bests[l.id]) && <p className="text-white/60">Still searching the maze…</p>}
                </div>
              </>
            ) : (
              <h1 className={`${posterFont.className} text-5xl tracking-wide`}>{SITE_NAME}</h1>
            )}
            <p className="text-white/70">
              Gugut&apos;s goat ran into the maze. Find her before the sun goes down — can you do it faster?
            </p>
            <Link href="/" className="ui-cta inline-flex px-6 py-3 text-sm">
              Play now
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
