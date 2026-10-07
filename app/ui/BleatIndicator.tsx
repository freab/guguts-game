"use client";

import { useEffect, useRef, useState } from "react";
import { playerStore } from "../character/playerStore";
import { useGoatAnswer, type GoatAnswer } from "../game/goatAnswer";
import { usePreferences } from "../game/preferences";

/** How long the arc and caption stay up once she answers (ms), then fade. */
const SHOW_MS = 2600;
const FADE_MS = 900;

/**
 * Where the goat's answer came from, on screen — for everyone, and essential
 * without sound: an arc on a ring round the middle of the view pointing
 * towards her (it turns as you turn), and a caption like a subtitle
 * ("Goat bleats — behind you, to the left, far away"), if captions are on.
 * Appears the moment she bleats (game/goatAnswer), then fades.
 */
export default function BleatIndicator() {
  const answer = useGoatAnswer();
  if (!answer) return null;
  return <Indicator key={answer.at} answer={answer} />;
}

/** Her direction relative to where the camera looks: radians, 0 ahead, + to the right. */
function relativeAngle(answer: GoatAnswer): number {
  const { lookX, lookZ, camX, camZ } = playerStore;
  const vx = answer.x - camX;
  const vz = answer.z - camZ;
  // Right of the look direction (y up): (-lookZ, lookX).
  return Math.atan2(vx * -lookZ + vz * lookX, vx * lookX + vz * lookZ);
}

/** "behind you, to the left" etc. from a relative angle. */
function directionWords(angle: number): string {
  const deg = (angle * 180) / Math.PI;
  const side = deg > 0 ? "to the right" : "to the left";
  const a = Math.abs(deg);
  if (a < 25) return "straight ahead";
  if (a < 65) return `ahead, ${side}`;
  if (a < 115) return side;
  if (a < 155) return `behind you, ${side}`;
  return "behind you";
}

function Indicator({ answer }: { answer: GoatAnswer }) {
  const { captions } = usePreferences();
  const arc = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState<"waiting" | "shown" | "fading" | "gone">("waiting");
  const [caption, setCaption] = useState("");

  // Wait for her bleat, show, fade, go.
  useEffect(() => {
    const wait = Math.max(0, answer.at - performance.now());
    const timers = [
      setTimeout(() => {
        const where = directionWords(relativeAngle(answer));
        const how = answer.distance < 7 ? ", close by" : answer.distance > 18 ? ", far away" : "";
        const muffled = answer.occluded ? ", beyond the walls" : "";
        setCaption(`Goat bleats — ${where}${how}${muffled}`);
        setStage("shown");
      }, wait),
      setTimeout(() => setStage("fading"), wait + SHOW_MS),
      setTimeout(() => setStage("gone"), wait + SHOW_MS + FADE_MS),
    ];
    return () => timers.forEach(clearTimeout);
  }, [answer]);

  // The arc follows her as the camera turns.
  useEffect(() => {
    if (stage === "waiting" || stage === "gone") return;
    let id = 0;
    const tick = () => {
      if (arc.current) arc.current.style.transform = `rotate(${relativeAngle(answer)}rad)`;
      id = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(id);
  }, [stage, answer]);

  if (stage === "waiting" || stage === "gone") return null;
  const opacity = stage === "fading" ? 0 : 1;
  // Nearer, bolder.
  const strength = answer.distance < 7 ? 1 : answer.distance > 18 ? 0.6 : 0.8;
  return (
    <>
      <div
        className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center transition-opacity"
        style={{ opacity, transitionDuration: `${FADE_MS}ms`, animation: "notice-in 200ms ease-out" }}
        aria-hidden
      >
        {/* A ring round the middle of the view, the arc at its top, turned towards her. */}
        <div ref={arc} className="relative" style={{ width: "min(62vmin, 520px)", height: "min(62vmin, 520px)" }}>
          <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full overflow-visible">
            <defs>
              <linearGradient id="bleat-arc" x1="0" x2="1" y1="0" y2="0">
                <stop offset="0" stopColor="#fcd34d" stopOpacity="0" />
                <stop offset="0.5" stopColor="#fde68a" stopOpacity={strength} />
                <stop offset="1" stopColor="#fcd34d" stopOpacity="0" />
              </linearGradient>
            </defs>
            {/* ~60° of the ring, centred on "up". */}
            <path
              d="M 25 6.7 A 50 50 0 0 1 75 6.7"
              fill="none"
              stroke="url(#bleat-arc)"
              strokeWidth="2.6"
              strokeLinecap="round"
              style={{ filter: "drop-shadow(0 0 3px rgba(252, 211, 77, 0.8))" }}
            />
            {/* A small chevron at its middle, pointing out towards her. */}
            <path d="M 47 4 L 50 0.5 L 53 4" fill="none" stroke="#fef3c7" strokeOpacity={strength} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      </div>
      {captions && (
        <div
          role="status"
          className="pointer-events-none absolute bottom-16 left-1/2 z-20 max-w-[90vw] -translate-x-1/2 ui-shell px-3.5 py-2 text-center text-sm transition-opacity sm:bottom-10"
          style={{ opacity, transitionDuration: `${FADE_MS}ms` }}
        >
          [{caption}]
        </div>
      )}
    </>
  );
}
