"use client";

import { useEffect, useState, type FormEvent } from "react";
import { RESERVED_KEYS, keyLabel, setPreferences, usePreferences } from "../game/preferences";
import { setPlayerName, useProfile } from "../game/profile";
import { NAME_MAX } from "../leaderboard/shared";
import Dialog from "./Dialog";

/** Settings: the player's name on the leaderboard, the call key and sound captions. */
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
      <GameplaySettings />
    </Dialog>
  );
}

/** The call-the-goat key (press to rebind) and the sound captions switch. */
function GameplaySettings() {
  const prefs = usePreferences();
  const [listening, setListening] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // Rebinding: the next key pressed becomes the call key (Esc cancels). Caught
  // first, so it doesn't also reach the game or close the dialog.
  useEffect(() => {
    if (!listening) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setListening(false);
      if (e.code === "Escape") return;
      if (RESERVED_KEYS.has(e.code)) {
        setMessage(`${keyLabel(e.code)} is already used (moving, running, view, music or pause).`);
        return;
      }
      setPreferences({ callKey: e.code });
      setMessage(null);
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [listening]);

  return (
    <div className="mt-6 space-y-3 border-t border-white/10 pt-5">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-white/70">Call the goat key</span>
        <button
          type="button"
          onClick={() => {
            setMessage(null);
            setListening(true);
          }}
          className={`min-w-28 rounded-lg border px-3 py-1.5 font-mono text-sm transition-colors ${
            listening ? "border-amber-300/70 bg-amber-300/10 text-amber-200" : "border-white/15 bg-black/40 text-white hover:bg-white/10"
          }`}
        >
          {listening ? "Press a key…" : keyLabel(prefs.callKey)}
        </button>
      </div>
      {message && <p className="text-sm text-amber-200">{message}</p>}
      <label className="flex cursor-pointer items-center justify-between gap-3">
        <span className="text-sm text-white/70">
          Sound captions
          <span className="block text-xs text-white/40">Show which way the goat&apos;s bleat came from</span>
        </span>
        <input
          type="checkbox"
          checked={prefs.captions}
          onChange={(e) => setPreferences({ captions: e.target.checked })}
          className="h-5 w-5 accent-amber-300"
        />
      </label>
    </div>
  );
}
