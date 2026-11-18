// Dictation: spoken punctuation and commands → document text. Shared by the
// editor (live text), the accuracy pass (/api/documents/:id/polish) and the
// list of commands shown while dictating.

/* ------------------------------------------------------------------ */
/* Dictation clean-up                                                  */
/* ------------------------------------------------------------------ */

const PROPER = [
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
  "january", "february", "april", "june", "july", "september", "october", "november", "december",
];
const PROPER_RE = new RegExp(`\\b(${PROPER.join("|")})\\b`, "gi");
const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);

// Spoken commands → what they type. Longest first so "question mark" wins over shorter matches.
const COMMANDS: [string, string][] = [
  ["new paragraph", "\n\n"],
  ["next paragraph", "\n\n"],
  ["new line", "\n"],
  ["next line", "\n"],
  ["question mark", "?"],
  ["exclamation mark", "!"],
  ["exclamation point", "!"],
  ["full stop", "."],
  ["period", "."],
  ["comma", ","],
  ["semicolon", ";"],
  ["semi colon", ";"],
  ["colon", ":"],
  ["open quote", "“"],
  ["open quotes", "“"],
  ["close quote", "”"],
  ["close quotes", "”"],
  ["end quote", "”"],
  ["unquote", "”"],
  ["open bracket", "("],
  ["close bracket", ")"],
];
const CMD_WORDS = COMMANDS.map(([w]) => w.replace(" ", "\\s+")).sort((a, b) => b.length - a.length).join("|");
const P = "[,.;:!?]";
// A spoken command is said at a pause, so the speech service puts punctuation
// next to it ("Lagos, period." / "budget, question mark."). Words with no
// punctuation around them ("the trial period ends", "colon surgery") are left alone.
const CMD_RE = new RegExp(
  `[ \\t]*${P}*[ \\t]*(?:(?<=^|${P}[ \\t]*)\\b(${CMD_WORDS})\\b|\\b(${CMD_WORDS})\\b(?=[ \\t]*(?:${P}|$)))[ \\t]*${P}*`,
  "gi",
);
const lookup = (w: string) => COMMANDS.find(([c]) => c === w.toLowerCase().replace(/\s+/g, " "))?.[1] ?? "";

/**
 * Turns what the speech service returns into document text: spoken
 * punctuation and paragraphs, spacing, naira amounts, dates and capitals.
 */
export function cleanDictation(raw: string): string {
  let t = raw
    .replace(CMD_RE, (_m, a?: string, b?: string) => `\u0001${lookup(a ?? b ?? "")}\u0001`)
    .replace(/\u0001([^\u0001]*)\u0001/g, "$1")
    // Spacing around punctuation.
    .replace(/[ \t]+([.,;:!?”)])/g, "$1")
    .replace(/([.!?;:,])\s*([.!?])/g, (_m, a: string, b: string) => (a === "." || a === "," || a === ";" || a === ":" ? b : a))
    .replace(/([,;:])\s*,/g, "$1")
    .replace(/([,;:”)])(?=[\p{L}“(])/gu, "$1 ") // not before digits: "2,500", "10:30"
    .replace(/(?<=\p{Ll}{2}|\d|[”)])([.!?])(?=[\p{Lu}“(])/gu, "$1 ")
    .replace(/([\p{L}\p{N},.;:!?])([“(])/gu, "$1 $2")
    .replace(/([“(])\s+/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    // Titles said in full before a name: "missus Adebayo" → "Mrs Adebayo".
    .replace(/\b[Mm]issus (?=\p{Lu})/gu, "Mrs ")
    .replace(/\b[Mm]ister (?=\p{Lu})/gu, "Mr ")
    // "N2.4 million" → "₦2.4 million" (not "N95").
    .replace(/\bN(?=\d[\d,.]*(?:\s?(?:million|billion|thousand|bn|m|k)\b|,\d{3}))/g, "₦")
    // "the March 3" (said "the third of March") → "3 March".
    .replace(/\bthe (January|February|March|April|May|June|July|August|September|October|November|December) (\d{1,2})\b/g, "$2 $1")
    .replace(PROPER_RE, (w) => cap(w.toLowerCase()))
    .replace(/\bi\b(?!\.)/g, "I"); // lone "i" (and i'm, i've…), but not "i.e."
  // Capital letter at the start of each sentence and paragraph (the very
  // start is left to joinDictated, which knows what comes before).
  t = t.replace(/((?<!\b(?:i\.e|e\.g|vs))[.!?]["”’)]?\s+|\n\s*)(“?)(\p{Ll})/gu, (_m, pre: string, q: string, ch: string) => pre + q + ch.toUpperCase());
  return t;
}

const LOWERCASE_STARTS = new Set(
  "a an and as at but by for from had has have he her his if in into is it its of on or our she so than that the their then there they this to was we were what when which who will with would you your".split(" "),
);

/**
 * Joins newly dictated text onto what comes before it: adds a space, and
 * starts a sentence with a capital only where a sentence actually starts.
 */
export function joinDictated(before: string, insert: string): string {
  let text = insert.replace(/^[ \t]+/, "");
  if (!text) return "";
  const trimmed = before.replace(/[ \t]+$/, "");
  const atStart = trimmed === "" || /[\n]$/.test(trimmed) || /[.!?]["”’)]?$/.test(trimmed);
  if (/^\n/.test(text)) return text; // starts a new line/paragraph
  if (atStart) {
    text = text.replace(/^(“?)(\p{Ll})/u, (_m, q: string, ch: string) => q + ch.toUpperCase());
  } else {
    // The speech service capitalises the start of each chunk; undo that mid-sentence.
    const first = text.match(/^(\p{Lu}\p{Ll}*)\b/u)?.[1];
    if (first && LOWERCASE_STARTS.has(first.toLowerCase())) text = first.toLowerCase() + text.slice(first.length);
  }
  const needsSpace = before !== "" && !/[\s“(]$/.test(before) && !/^[.,;:!?”)]/.test(text);
  return (needsSpace ? " " : "") + text;
}

/* ------------------------------------------------------------------ */
/* Spoken commands that control dictation                              */
/* ------------------------------------------------------------------ */

export type ControlCommand = "end" | "pause" | "caps_on" | "caps_off" | "scratch";

// When a command counts (rather than being words in a sentence):
// "anywhere" — distinctive enough to work mid-sentence;
// "either"   — needs a pause on one side of it ("put the caps on the jars" stays as words);
// "after"    — needs a pause after it ("scratch that itch" stays as words).
// A pause shows up as punctuation from the speech service, or the start/end of a phrase.
const CONTROLS: { cmd: ControlCommand; phrases: string[]; pause: "anywhere" | "either" | "after" }[] = [
  { cmd: "end", phrases: ["end dictation", "stop dictation", "stop dictating", "finish dictation"], pause: "anywhere" },
  { cmd: "pause", phrases: ["pause dictation", "pause dictating"], pause: "anywhere" },
  // How the speech service sometimes hears "pause dictation".
  { cmd: "pause", phrases: ["cause dictation", "paws dictation", "pores dictation", "pours dictation", "pose dictation"], pause: "either" },
  { cmd: "caps_on", phrases: ["all caps on", "caps lock on", "caps on"], pause: "either" },
  { cmd: "caps_off", phrases: ["all caps off", "caps lock off", "caps off"], pause: "either" },
  { cmd: "scratch", phrases: ["scratch that"], pause: "after" },
];
const phraseRe = (p: string) =>
  p
    .split(" ")
    .map((w) => (w === "caps" ? "(?:caps|cap['’]s)" : w))
    .join("[\\s-]+");
const CONTROL_RES = CONTROLS.map((c) => ({
  ...c,
  re: new RegExp(`\\b(?:${c.phrases.map(phraseRe).sort((a, b) => b.length - a.length).join("|")})\\b`, "gi"),
}));
const PAUSE_BEFORE = /(?:^|[,.;:!?])\s*$/;
const PAUSE_AFTER = /^\s*(?:[,.;:!?]|$)/;

function findControl(text: string): { cmd: ControlCommand; start: number; end: number } | null {
  let best: { cmd: ControlCommand; start: number; end: number } | null = null;
  for (const c of CONTROL_RES) {
    c.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = c.re.exec(text))) {
      if (best && m.index >= best.start) break;
      const end = m.index + m[0].length;
      const before = PAUSE_BEFORE.test(text.slice(0, m.index));
      const after = PAUSE_AFTER.test(text.slice(end));
      if (c.pause === "anywhere" || (c.pause === "either" && (before || after)) || (c.pause === "after" && after)) {
        best = { cmd: c.cmd, start: m.index, end };
        break;
      }
    }
  }
  return best;
}

type Op = { text: string } | { cmd: ControlCommand };

/** Splits what was heard into words to type and control commands, in order. */
export function splitCommands(raw: string): Op[] {
  const ops: Op[] = [];
  let rest = raw;
  for (let hit = findControl(rest); hit; hit = findControl(rest)) {
    // The punctuation the service puts after a command isn't the writer's
    // (what comes before is kept, as it would be for any pause).
    const before = rest.slice(0, hit.start).replace(/[ \t]+$/, "");
    if (before.trim()) ops.push({ text: before });
    ops.push({ cmd: hit.cmd });
    rest = rest.slice(hit.end).replace(/^[ \t]*[,.;:!?]*/, "");
  }
  if (rest.trim()) ops.push({ text: rest });
  return ops;
}

/** "scratch that": removes the last sentence (or the line break just said). */
export function scratchLast(text: string): string {
  if (/\n\s*$/.test(text)) return text.replace(/\s+$/, "");
  const body = text.replace(/\s+$/, "").replace(/[.!?]["”’)]*$/, "");
  const kept = /^[\s\S]*(?:[.!?]["”’)]*[ \t]|\n)/.exec(body);
  return kept ? kept[0].replace(/[ \t]+$/, "") : "";
}

/** Everything said in one dictation so far, as it should appear in the document. */
export type DictationState = {
  text: string;
  caps: boolean;
  ended: boolean;
  /** How many control commands were used (the accuracy pass must find at least as many). */
  commands: number;
};
export const freshDictation = (): DictationState => ({ text: "", caps: false, ended: false, commands: 0 });

/**
 * Adds what was just heard to a dictation. `before` is the document text in
 * front of the dictation (for spacing and capitals). Live dictation calls this
 * once per phrase; the accuracy pass once with the whole recording — both end
 * up with the same text. After "end dictation" everything else is ignored.
 */
export function applyDictation(
  state: DictationState,
  raw: string,
  before: string,
): { state: DictationState; pause: boolean; end: boolean } {
  if (state.ended) return { state, pause: false, end: false };
  let { text, caps, commands } = state;
  let pause = false;
  let ended = false;
  for (const op of splitCommands(raw)) {
    if ("text" in op) {
      const piece = joinDictated(before + text, cleanDictation(op.text));
      text += caps ? piece.toUpperCase() : piece;
      continue;
    }
    commands++;
    if (op.cmd === "caps_on") caps = true;
    else if (op.cmd === "caps_off") caps = false;
    else if (op.cmd === "scratch") text = scratchLast(text);
    else if (op.cmd === "pause") pause = true;
    else {
      ended = true;
      break;
    }
  }
  return { state: { text, caps, ended, commands }, pause, end: ended };
}

/** The words still being heard (not final yet), without any commands in them. */
export function previewDictation(interim: string, caps: boolean): string {
  const shown = splitCommands(interim)
    .flatMap((op) => ("text" in op ? [cleanDictation(op.text)] : []))
    .join(" ")
    .trim();
  return caps ? shown.toUpperCase() : shown;
}

/* ------------------------------------------------------------------ */
/* The list shown while dictating                                      */
/* ------------------------------------------------------------------ */

export type CommandGuideItem = { say: string[]; does: string; symbol?: boolean };

export const COMMAND_GUIDE: { title: string; items: CommandGuideItem[] }[] = [
  {
    title: "Dictation",
    items: [
      { say: ["pause dictation"], does: "Pauses until you tap Resume." },
      { say: ["end dictation"], does: "Finishes, and Mira tidies the text." },
    ],
  },
  {
    title: "Editing",
    items: [
      { say: ["scratch that"], does: "Deletes your last sentence." },
      { say: ["caps on"], does: "TYPES IN CAPITALS from here." },
      { say: ["caps off"], does: "Back to normal letters." },
    ],
  },
  {
    title: "Layout",
    items: [
      { say: ["new line"], does: "Starts a new line." },
      { say: ["new paragraph"], does: "Starts a new paragraph." },
    ],
  },
  {
    title: "Punctuation",
    items: [
      { say: ["full stop", "period"], does: ".", symbol: true },
      { say: ["comma"], does: ",", symbol: true },
      { say: ["question mark"], does: "?", symbol: true },
      { say: ["exclamation mark"], does: "!", symbol: true },
      { say: ["colon"], does: ":", symbol: true },
      { say: ["semicolon"], does: ";", symbol: true },
      { say: ["open quote", "close quote"], does: "“ ”", symbol: true },
      { say: ["open bracket", "close bracket"], does: "( )", symbol: true },
    ],
  },
];
