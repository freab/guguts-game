"use client";

import { temesgen, useTemesgen } from "../game/temesgen";
import InteractPrompt from "./InteractPrompt";

/** "Talk": while Gugut is close to Temesgen and looking at him (game/temesgen). */
export default function TalkPrompt({ touch }: { touch: boolean }) {
  const { near, talking } = useTemesgen();
  if (!near || talking) return null;
  return (
    <InteractPrompt
      touch={touch}
      label={touch ? "Talk" : "Talk to Temesgen"}
      ariaLabel="Talk to Temesgen"
      iconClassName="text-amber-200!"
      // A speech bubble.
      icon={
        <path
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinejoin="round"
          d="M4 5.5h16v10H10l-4 3.5v-3.5H4z"
        />
      }
      onPress={() => temesgen.talk()}
    />
  );
}
