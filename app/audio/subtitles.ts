import type { VoiceLine } from "./audioEngine";

/**
 * What Gugut says in each take of each voiceover line (public/audio/voice.json),
 * in the order scripts/build-audio.mjs packs them. `en` is shown on screen
 * (ui/Subtitles); `am` is what he says, kept here for reference and for an
 * Amharic option later. Each comment is the recording the take comes from
 * (assets-src/voice).
 */
export interface Subtitle {
  en: string;
  am: string;
}

export const SUBTITLES: Record<VoiceLine, Subtitle[]> = {
  // 1. calling out the goat.mp3, cut into four calls.
  call: [
    { en: "Gugut!", am: "ጉጉት!" },
    { en: "Hey, Gugut!", am: "እረ ጉጉት!" },
    { en: "Where are you? Please!", am: "የት ነሽ በናትሽ?" },
    { en: "Where did you get to now?", am: "የት ገባሽ ደግሞ?" },
  ],
  murmur: [
    // 2. oneself.mp3
    { en: "It's that Seble, I tell you. All because I thought she'd laugh…", am: "ይቺ ሰብለ እኮ ናት። ድሮም እኔ እሷ ትስቃለች ብዬ…" },
    // 2 oneself - 2.mp3
    { en: "Gashe's going to kill me! Oh no, I'm in trouble. Gugut's gone missing!", am: "ገደለኝ ጋሼ ገደለኝ! ወይኔ ጉዴ ፈላ ደሞ። ጉጉት ጠፍታ… ወይኔ ጉዴ!" },
    // 2-3 murmurs to self.mp3
    { en: "Mom must be done baking the bread by now. I have to get home quick.", am: "የማዬ ዳቦ ጋግራ ጨርሳ ሲሆን እንዴ? እረ ቶሎ መመለስ አለብኝ።" },
    // murmur to self.ogg
    { en: "It's that Seble… all for those lips…", am: "ይቺ ሰብሌ እኮ ናት… ያን ከንፈር ብዬ…" },
    // murmur to self 2.ogg
    { en: "Just wait till I find you, Gugut. You'll see!", am: "እረ እንዲሁ ጉጉት፣ ቆይ ላግኝሽ…" },
    // murmur to self 3.ogg
    { en: "Wait, wait, Gugut, just let me find you. The stick, and if that breaks, the axe!", am: "ቆይ ቆይ ጉጉት፣ ላግኝሽ ብቻ። በሰደፉ መጥቼ፣ ሰደፉ ተሰብሮ በመጥረቢያም…" },
  ],
  parched: [
    // 3 - dehydrated.mp3
    { en: "Gugut, I can't even shout anymore. I'm so thirsty.", am: "ጉጉት፣ መጮህ እንኳን አቃተኝ። ውሃ ጠማኝ።" },
    // 3 - 2 dehydrated.mp3
    { en: "All because of you, Gugut… Water! Somebody, water!", am: "ጉጉት አንቺን ብዬ ደግሞ… እረ ውሃ! እረ ውሃ ያለ!" },
    // hydration.ogg
    { en: "Look at this, Gugut. You've tortured me with thirst.", am: "እረ እንዲሁ ጉጉት፣ እንዲሁ አሰቃየሽኝ በውሃ ጥማት።" },
  ],
  // temesgen track.ogg
  temesgen: [{ en: "Temu, what have you got there? A krar? Go on, play me something.", am: "ተሜ፣ ምን ይዘህ ነው እዛ ጋ? ክራር? እስቲ የሆነ ነገር በልልኝ።" }],
  hum: [
    // 4 - humms.mp3
    { en: "♪ Seble, Seble, all for you ♪", am: "♪ ሰብሌ ሰብሌ አንቺን ብዬ ♪" },
    // humming.ogg
    { en: "♪ (humming) ♪", am: "♪" },
  ],
  found: [
    // 5 - 1 finding gugut.mp3
    { en: "So this is where you were hiding? Come here!", am: "እረ እዚህ ተደብቀሽ ነው እንዴ? ነይ…" },
    // 5 - 2 finding gugut.mp3
    { en: "Gugut! Yes, I found her! Let's get home before dark.", am: "ጉጉት! እሰይ አገኘኋት! በጊዜ እንግባ።" },
    // found gugut.ogg
    { en: "You! What are you doing here? What have you got there?", am: "አንቺ ምን ሆነሽ ነው እዚህ? ምን ይዘሽ ነው?" },
    // found gugut 2.ogg
    { en: "You little rascal! Sitting here, what did you find, Gugut?", am: "አንቺ ወሽካታ! እዚህ ተጎልተሽ ምን አግኝተሽ ደግሞ ጉጉት?" },
    // found gugut 3.ogg
    { en: "You! Making my blood boil like that!", am: "" },
  ],
  congrats: [
    // 6 congrats.mp3
    { en: "Who were you hiding from? Who do you think I am?", am: "ከማን ተወሽቀሽ፣ ማነኝ ብለሽ አንቺ?" },
    // congrats.ogg
    { en: "I'm my father's son! Nothing gets past me!", am: "የአባቴ ልጅ ነኝ እኔ! የአባቴ ልጅ!" },
  ],
};
