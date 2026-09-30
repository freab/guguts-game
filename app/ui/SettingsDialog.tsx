"use client";

import { useState, type FormEvent } from "react";
import { setPlayerName, useProfile } from "../game/profile";
import { NAME_MAX } from "../leaderboard/shared";
import Dialog from "./Dialog";

/** Settings: the player's name on the leaderboard. */
export default function SettingsDialog({ onClose }: { onClose: () => void }) {
  const profile = useProfile();
  const [name, setName] = useState(profile.name);
  const [status, setStatus] = useState<{ saving: boolean; message: string | null; ok: boolean }>({
    saving: false,
    message: null,
    ok: false,
  });

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setStatus({ saving: true, message: null, ok: false });
    const error = await setPlayerName(name);
    setStatus({ saving: false, message: error ?? "Saved — your name is updated on the leaderboard.", ok: !error });
  };

  return (
    <Dialog title="Settings" onClose={onClose}>
      <form onSubmit={save} className="space-y-3">
        <label className="block text-sm text-white/70" htmlFor="player-name">
          Your name on the leaderboard
        </label>
        <div className="flex gap-2">
          <input
            id="player-name"
            value={name}
            maxLength={NAME_MAX}
            autoComplete="nickname"
            spellCheck={false}
            onChange={(e) => setName(e.target.value)}
            className="min-w-0 flex-1 rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-base text-white outline-none focus:border-amber-300/70"
          />
          <button
            type="submit"
            disabled={status.saving || name.trim() === profile.name}
            className="rounded-lg bg-amber-300 px-4 py-2 text-sm font-semibold text-black transition-opacity disabled:opacity-40"
          >
            {status.saving ? "Saving…" : "Save"}
          </button>
        </div>
        {status.message && (
          <p className={`text-sm ${status.ok ? "text-emerald-300" : "text-amber-200"}`}>{status.message}</p>
        )}
        <p className="text-xs text-white/40">
          Up to {NAME_MAX} characters. Your times stay with you when you rename.
        </p>
      </form>
    </Dialog>
  );
}
