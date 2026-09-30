"use client";

import { useEffect, useState } from "react";
import { posterFont } from "../fonts";
import { getProfile, useProfile } from "../game/profile";
import { useRun, type RunState } from "../game/runStore";
import { submitRun } from "../leaderboard/client";
import { formatTime, type SubmitResponse } from "../leaderboard/shared";
import LeaderboardTable from "./LeaderboardTable";

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
 * The end of a run: shown when the player reaches the goat. Their time goes
 * to the leaderboard (which keeps their best), and the level's board is shown.
 */
export default function GameOver(actions: Actions) {
  const run = useRun();
  if (run.phase !== "won") return null;
  // A fresh panel (and submission) for every finished run.
  return <Panel key={run.finishedAt} run={run} {...actions} />;
}

function Panel({ run, onPlayAgain, onChangeLevel, onChangeName }: Actions & { run: RunState }) {
  const profile = useProfile();
  const timeMs = run.finishedAt - run.startedAt;
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

  const button = "rounded-full px-5 py-2.5 text-sm font-semibold transition-colors";
  return (
    <div className="absolute inset-0 z-[65] flex items-center justify-center bg-black/60 p-4">
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-3xl border border-white/10 bg-[#0b0d08]/92 p-6 text-[#fdf3d4] shadow-2xl sm:p-8">
        <p className="text-center text-xs uppercase tracking-[0.3em] text-white/50">Run complete</p>
        <h2 className={`${posterFont.className} mt-1 text-center text-5xl tracking-wide sm:text-6xl`}>You found her!</h2>
        <p className="mt-1 text-center text-sm text-white/65">Gugut&apos;s goat is safe — home before dark.</p>

        <div className="mt-5 text-center">
          <div className="font-mono text-5xl font-semibold tabular-nums text-amber-200">{formatTime(timeMs)}</div>
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
          <div className="mt-5 rounded-2xl bg-black/30 p-3">
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
          <button type="button" onClick={onPlayAgain} className={`${button} bg-amber-300 text-black hover:bg-amber-200`}>
            Play again
          </button>
          <button type="button" onClick={onChangeLevel} className={`${button} bg-white/10 text-white hover:bg-white/20`}>
            Change level
          </button>
          <button type="button" onClick={onChangeName} className={`${button} bg-white/10 text-white hover:bg-white/20`}>
            Change name
          </button>
        </div>
      </div>
    </div>
  );
}
