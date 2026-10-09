"use client";

import { useEffect, useMemo, useState } from "react";
import { posterFont } from "../fonts";
import { getProfile, useProfile } from "../game/profile";
import { useRun, type RunState } from "../game/runStore";
import { submitRun } from "../leaderboard/client";
import { formatTime, type SubmitResponse } from "../leaderboard/shared";
import LeaderboardTable from "./LeaderboardTable";
import ShareDialog, { type ShareCard } from "./ShareDialog";
import { LEVELS } from "../maze/levels";

/**
 * One submission per finished run (and retry): React runs effects twice in
 * development (StrictMode), and a second POST would see the first one's
 * time and report "not a new best". Keyed by the run's finish time.
 */
const submissions = new Map<string, Promise<SubmitResponse>>();
function submitOnce(key: string, submit: () => Promise<SubmitResponse>): Promise<SubmitResponse> {
  let pending = submissions.get(key);
  if (!pending) {
    pending = submit();
    submissions.set(key, pending);
    // A failed attempt may be retried under a new key; drop old entries.
    if (submissions.size > 20) submissions.delete(submissions.keys().next().value!);
  }
  return pending;
}

interface Actions {
  onPlayAgain: () => void;
  onChangeLevel: () => void;
  onChangeName: () => void;
}

/**
 * The end of a run, when the player reaches the goat: first the end of the
 * story (Epilogue — the red berries, the first coffee), then the results:
 * the time, a star rating for how few calls it took, the badges earned, and
 * the level's leaderboard (the time goes to it straight away, while the
 * story is read) — and a card to share the time (ui/ShareDialog).
 */
export default function GameOver(actions: Actions) {
  const run = useRun();
  if (run.phase !== "won") return null;
  // A fresh panel (and submission) for every finished run.
  return <Panel key={run.finishedAt} run={run} {...actions} />;
}

function Panel({ run, onPlayAgain, onChangeLevel, onChangeName }: Actions & { run: RunState }) {
  const profile = useProfile();
  const timeMs = run.finishedAt - run.startedAt - run.pausedTotal;
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ attempt: number; data: SubmitResponse | null; error: string | null }>({
    attempt: -1,
    data: null,
    error: null,
  });

  // Let go of the mouse so the buttons can be clicked.
  useEffect(() => {
    if (document.pointerLockElement) document.exitPointerLock();
  }, []);

  // Submit the run (again on "Try again").
  useEffect(() => {
    if (!run.ranked || !run.level) return;
    let cancelled = false;
    const { id, name } = getProfile();
    const level = run.level;
    submitOnce(`${run.finishedAt}:${attempt}`, () => submitRun(level, id, name, timeMs)).then(
      (data) => !cancelled && setResult({ attempt, data, error: null }),
      (e: Error) => !cancelled && setResult({ attempt, data: null, error: e.message })
    );
    return () => {
      cancelled = true;
    };
  }, [run.ranked, run.level, run.finishedAt, timeMs, attempt]);

  const submitting = run.ranked && result.attempt !== attempt;
  const data = result.attempt === attempt ? result.data : null;
  const error = result.attempt === attempt ? result.error : null;

  const [chapter, setChapter] = useState<"story" | "results">("story");
  const stars = starsFor(run.callsUsed);
  const bottlesFound = run.bottlesTaken.filter(Boolean).length;
  const badges = [
    run.callsUsed === 0 && { name: "Silent tracker", detail: "Found her without a single call" },
    bottlesFound === run.bottlesTaken.length && { name: "Well watered", detail: "Found every bottle of water" },
    run.calls === 0 && bottlesFound === 0 && run.callsUsed > 0 && { name: "Parched", detail: "Made it with a dry throat" },
  ].filter(Boolean) as { name: string; detail: string }[];

  // The share card: this run, ranked when it's their best on the board.
  const [sharing, setSharing] = useState(false);
  const badgeNames = badges.map((b) => b.name).join("|");
  const card = useMemo<ShareCard>(
    () => ({
      name: profile.name,
      level: LEVELS.find((l) => l.id === run.level)?.label ?? "Custom maze",
      timeMs,
      stars,
      badges: badgeNames ? badgeNames.split("|") : [],
      rank: data?.newBest ? data.you?.rank : undefined,
      players: data?.newBest ? data.players : undefined,
      newBest: data?.newBest,
      detail: `${run.callsUsed === 0 ? "No calls" : `Called her ${run.callsUsed === 1 ? "once" : run.callsUsed === 2 ? "twice" : `${run.callsUsed} times`}`} · ${bottlesFound} of ${run.bottlesTaken.length} bottles of water`,
    }),
    [profile.name, run.level, timeMs, stars, badgeNames, data, run.callsUsed, bottlesFound, run.bottlesTaken.length]
  );

  const button = "px-5 py-2.5 text-sm font-semibold";
  if (chapter === "story") return <Epilogue onContinue={() => setChapter("results")} />;
  return (
    <div className="absolute inset-0 z-[65] flex items-center justify-center bg-black/60 p-4">
      <div className="ui-shell flex max-h-[92vh] w-full max-w-lg flex-col p-1.5">
        <div className="ui-well min-h-0 overflow-y-auto p-6 sm:p-8">
          <p className="text-center text-xs uppercase tracking-[0.3em] text-white/50">Run complete</p>
          <h2 className={`${posterFont.className} mt-1 text-center text-5xl tracking-wide sm:text-6xl`}>You found her!</h2>
          <p className="mt-1 text-center text-sm text-white/65">Gugut&apos;s goat is safe — home before dark.</p>

          <div className="mt-5 text-center">
            <div className="font-mono text-5xl font-semibold tabular-nums text-amber-200">{formatTime(timeMs)}</div>
            {/* Stars: how few calls it took. */}
            <div className="mt-3 flex justify-center gap-1.5" aria-label={`${stars} of 3 stars`}>
              {[0, 1, 2].map((i) => (
                <svg
                  key={i}
                  viewBox="0 0 24 24"
                  className={`h-8 w-8 ${i < stars ? "text-amber-300 drop-shadow-[0_0_6px_rgba(252,211,77,0.6)]" : "text-white/15"}`}
                  fill="currentColor"
                  style={{ animation: `notice-in 300ms ease-out ${0.25 + i * 0.18}s both` }}
                >
                  <path d="m12 2.8 2.8 5.8 6.3.9-4.6 4.4 1.1 6.3L12 17.2l-5.6 3 1.1-6.3L2.9 9.5l6.3-.9L12 2.8Z" />
                </svg>
              ))}
            </div>
            <div className="mt-1.5 text-sm text-white/60">
              {run.callsUsed === 0 ? "Found without calling her" : `Called her ${run.callsUsed} ${run.callsUsed === 1 ? "time" : "times"}`}
              {" · "}
              {bottlesFound} of {run.bottlesTaken.length} bottles of water found
            </div>
            {badges.length > 0 && (
              <div className="mt-3 flex flex-wrap justify-center gap-2">
                {badges.map((b) => (
                  <span
                    key={b.name}
                    title={b.detail}
                    className="ui-tile px-3 py-1 text-xs font-semibold text-amber-200!"
                  >
                    {b.name}
                  </span>
                ))}
              </div>
            )}
            <div className="mt-2 h-5 text-sm">
              {!run.ranked && <span className="text-white/60">Custom maze — not on the leaderboard.</span>}
              {submitting && <span className="text-white/50">Saving your time…</span>}
              {data?.newBest && <span className="font-semibold text-emerald-300">New personal best!</span>}
              {data && !data.newBest && data.you && (
                <span className="text-white/65">Your best: {formatTime(data.you.timeMs)}</span>
              )}
              {data?.you && (
                <span className="text-white/65">
                  {" "}
                  · #{data.you.rank} of {data.players}
                </span>
              )}
            </div>
          </div>

          {run.ranked && (
            <div className="mt-5 rounded-xl border border-[var(--ui-line)] bg-[var(--ui-tile)] p-3">
              <div className="mb-1 flex items-baseline justify-between px-1">
                <span className="text-sm font-semibold text-white/80">Leaderboard · {run.level}</span>
                <span className="truncate pl-3 text-xs text-white/50">playing as {profile.name}</span>
              </div>
              <LeaderboardTable data={data} loading={submitting} error={error} youName={profile.name} />
              {error && (
                <div className="text-center">
                  <button type="button" onClick={() => setAttempt((n) => n + 1)} className="text-sm text-amber-200 underline">
                    Try again
                  </button>
                </div>
              )}
            </div>
          )}

          <div className="mt-6 flex flex-wrap justify-center gap-2">
            <button type="button" onClick={onPlayAgain} className={`${button} ui-cta`}>
              Play again
            </button>
            <button type="button" onClick={() => setSharing(true)} className={`${button} ui-tile flex items-center gap-2`}>
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M12 3v12M7 8l5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" />
              </svg>
              Share your time
            </button>
            <button type="button" onClick={onChangeLevel} className={`${button} ui-tile`}>
              Change level
            </button>
            <button type="button" onClick={onChangeName} className={`${button} ui-tile`}>
              Change name
            </button>
          </div>
        </div>
      </div>
      {sharing && (
        <ShareDialog card={card} onBoard={run.ranked && !!data?.you} onClose={() => setSharing(false)} />
      )}
    </div>
  );
}

/** Three stars for no calls, two for one or two, one for three or more. */
function starsFor(callsUsed: number): number {
  return callsUsed === 0 ? 3 : callsUsed <= 2 ? 2 : 1;
}

/**
 * The end of the story, after the opening one (ui/LoadingOverlay): the goat
 * by the strange bush, Gugut tasting the red berries, the monks' fire — the
 * Ethiopian legend of how coffee was found. Each paragraph fades in after the
 * last; Continue (or Enter) goes on to the results.
 */
const EPILOGUE = [
  "There she is, at the far end of the maze, next to the berry bush. Still dancing. Her mouth is red from the berries.",
  "Gugut tries one. Right away, he isn't tired anymore. He fills his pockets and walks her home as the sun sets.",
  "That night he takes the berries to the monks up on the hill. One of them tosses a handful into the fire, and the room fills with a warm, rich smell. They roast the beans, grind them and pour hot water over them. The drink is bitter, but it keeps them awake all night.",
  "They call it buna. You know it as coffee.",
];

function Epilogue({ onContinue }: { onContinue: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onContinue();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onContinue]);

  return (
    <div className="absolute inset-0 z-[65] flex items-center justify-center bg-black/75 p-4">
      <div className="ui-shell flex max-h-[92vh] w-full max-w-xl flex-col p-1.5">
        <div className="ui-well min-h-0 overflow-y-auto p-6 sm:p-9">
          {/* A coffee cherry: the red berry, its leaf. */}
          <svg viewBox="0 0 48 48" className="mx-auto h-12 w-12" style={{ animation: "notice-in 600ms ease-out both" }} aria-hidden>
            <path d="M26 10c7-6 16-4 18 1-6 4-13 4-18-1Z" fill="#3f6b2a" />
            <path d="M26 10c-1 4-2 7-4 10" stroke="#5b4632" strokeWidth="2" fill="none" strokeLinecap="round" />
            <circle cx="20" cy="29" r="10" fill="#b3261e" />
            <circle cx="29" cy="33" r="8" fill="#d23a2a" />
            <circle cx="17" cy="25" r="2.4" fill="#fff" opacity="0.35" />
          </svg>
          <h2
            className={`${posterFont.className} mt-2 text-center text-5xl tracking-wide sm:text-6xl`}
            style={{ animation: "notice-in 700ms ease-out 0.15s both" }}
          >
            The red berries
          </h2>
          <div className={`${posterFont.className} mt-5 space-y-3 text-lg leading-snug text-white/85 sm:text-xl`}>
            {EPILOGUE.map((text, i) => (
              <p
                key={i}
                className={i === EPILOGUE.length - 1 ? "pt-1 text-center text-2xl text-amber-200 sm:text-3xl" : ""}
                style={{ animation: `notice-in 900ms ease-out ${0.6 + i * 1.4}s both` }}
              >
                {text}
              </p>
            ))}
          </div>
          <div
            className="mt-7 flex justify-center"
            style={{ animation: `notice-in 600ms ease-out ${0.6 + EPILOGUE.length * 1.4}s both` }}
          >
            <button
              type="button"
              autoFocus
              onClick={onContinue}
              className="ui-cta px-6 py-2.5 text-sm"
            >
              See how you did
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
