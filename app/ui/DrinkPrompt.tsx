"use client";

import { bottleFocus, useBottleFocus } from "../game/bottleFocus";
import InteractPrompt from "./InteractPrompt";

/** "Drink": while Gugut is close to a bottle of water and looking at it (game/bottleFocus). */
export default function DrinkPrompt({ touch }: { touch: boolean }) {
  const { focused, grab } = useBottleFocus();
  if (focused < 0 || grab) return null;
  return (
    <InteractPrompt
      touch={touch}
      label="Drink"
      ariaLabel="Drink the water"
      iconClassName="text-sky-300!"
      // A water drop.
      icon={<path fill="currentColor" d="M12 3s6 6.4 6 10.5A6 6 0 0 1 6 13.5C6 9.4 12 3 12 3Z" />}
      onPress={() => bottleFocus.grab()}
    />
  );
}
