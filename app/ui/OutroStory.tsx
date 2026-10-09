"use client";

import { useEffect, useState } from "react";
import { posterFont } from "../fonts";
import DissolveCanvas, { DISSOLVE_MS, type DissolveStage } from "./DissolveCanvas";
import { STORY_SRC, StoryButton, StoryText, storyWritingMs } from "./storyParts";

/** The end of the story, after the start the preloader tells: the red berries, the first coffee. */
const EPILOGUE = [
  "There she is, at the far end of the maze, next to the berry bush. Still dancing. Her mouth is red from the berries.",
  "Gugut tries one. Right away, he isn't tired anymore. He fills his pockets and walks her home as the sun sets.",
  "That night he takes the berries to the monks up on the hill. One of them tosses a handful into the fire, and the room fills with a warm, rich smell. They roast the beans, grind them and pour hot water over them. The drink is bitter, but it keeps them awake all night.",
  "They call it buna. You know it as coffee.",
];

/**
 * The outro: told the way the preloader tells the start. As the camera pulls
 * away from Gugut and the goat (scene/WinShot), the preloader's picture burns
 * in over the maze along the same noise front and ember edge (DissolveCanvas,
 * mode "in"); then the end of the story writes itself in word by word, and a
 * gold button goes on to the results.
 */
export default function OutroStory({ onContinue }: { onContinue: () => void }) {
  const [stage, setStage] = useState<DissolveStage>(1);
  const [burned, setBurned] = useState(false);
  const [written, setWritten] = useState(false);

  // Burn in as soon as it's up.
  useEffect(() => {
    const t = setTimeout(() => setStage(2), 50);
    return () => clearTimeout(t);
  }, []);
  // The button once the words are written.
  useEffect(() => {
    if (!burned) return;
    const t = setTimeout(() => setWritten(true), storyWritingMs(EPILOGUE));
    return () => clearTimeout(t);
  }, [burned]);

  return (
    <div className={`${posterFont.className} absolute inset-0 z-[65] overflow-hidden text-[#fdf3d4]`}>
      {/* Portrait phones: as on the preloader, the picture is a band across
          the top, fading into dark, with the words below. */}
      <div
        className="absolute inset-0 hidden bg-[#0b0d08] transition-opacity ease-in-out portrait:block"
        style={{ opacity: stage === 2 ? 1 : 0, transitionDuration: `${DISSOLVE_MS}ms` }}
      />
      <div className="absolute inset-0 portrait:bottom-auto portrait:h-[46svh]">
        <DissolveCanvas
          fromSrc={STORY_SRC}
          toSrc={STORY_SRC}
          stage={stage}
          mode="in"
          onDissolved={(reached) => reached === 2 && setBurned(true)}
        />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 hidden h-[35%] bg-linear-to-b from-transparent to-[#0b0d08] portrait:block" />
      </div>
      {burned && <StoryText lines={EPILOGUE} />}
      {written && <StoryButton label="See how you did" onClick={onContinue} />}
    </div>
  );
}
