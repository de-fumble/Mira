// Stage 2 of the review pipeline: mistakes that code can find with
// certainty — no AI, no cost, no guessing. Each check is conservative: when a
// pattern could be intentional, it's left for the AI to judge in context.
// Pure — no I/O.

import type { IssueType } from "../documents";
import type { Sentence } from "./segment";

export type RuleIssue = {
  sentenceId: string;
  type: IssueType;
  quote: string;
  suggestion: string;
  explanation: string;
  /** Offsets in the document, for de-duplicating against AI flags. */
  start: number;
  end: number;
  rule: string;
};

const DAYS_MONTHS = new Set(
  // March, May and August are also ordinary words, so they're left to the AI.
  "monday tuesday wednesday thursday friday saturday sunday january february april june july september october november december".split(" "),
);
// Doubles that are often correct: "had had", "that that", "is is" (what it is is…), "very very".
const OK_DOUBLES = new Set("had that is very so no bye ha hmm ok well".split(" "));
// Spoken commands that are never ordinary words at the end of a phrase.
const SAFE_COMMANDS: [RegExp, string][] = [
  [/question\s+mark/i, "?"],
  [/exclamation\s+(?:mark|point)/i, "!"],
  [/full\s+stop/i, "."],
  [/semi\s?colon/i, ";"],
  [/comma/i, ","],
];
// "period" and "colon" are real words ("trial period", "colon cancer"); only
// flag them right after punctuation ("Lagos, period.").
const RISKY_COMMANDS: [RegExp, string][] = [
  [/period/i, "."],
  [/colon/i, ":"],
];

const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);

export function ruleChecks(sentences: Sentence[]): RuleIssue[] {
  const out: RuleIssue[] = [];
  for (const s of sentences) {
    const add = (rule: string, type: IssueType, index: number, quote: string, suggestion: string, explanation: string) => {
      if (quote === suggestion) return;
      out.push({ sentenceId: s.id, type, quote, suggestion, explanation, start: s.start + index, end: s.start + index + quote.length, rule });
    };
    const t = s.text;
    let m: RegExpExecArray | null;

    // Doubled words: "the the" → "the".
    const doubled = /\b(\p{L}+)\s+(\1)\b/giu;
    while ((m = doubled.exec(t))) {
      if (OK_DOUBLES.has(m[1].toLowerCase())) continue;
      add("doubled-word", "grammar", m.index, m[0], m[1], `“${m[1]}” is written twice.`);
    }

    // Spoken punctuation typed out as words: "budget comma." → "budget,".
    for (const [word, mark] of [...SAFE_COMMANDS, ...RISKY_COMMANDS]) {
      const risky = RISKY_COMMANDS.some(([w]) => w === word);
      const re = new RegExp(`(\\S+?)([,.;:]?)\\s+(${word.source})\\b([,.;:!?]*)(?=\\s|$)`, "gi");
      while ((m = re.exec(t))) {
        const [whole, before, punctBefore, , punctAfter] = m;
        const atEnd = m.index + whole.length === t.length;
        const said = risky ? Boolean(punctBefore) : Boolean(punctBefore || punctAfter || atEnd);
        if (!said) continue;
        add("spoken-command", "grammar", m.index, whole, `${before}${mark}`, `Looks like the spoken word “${m[3]}” was typed instead of “${mark}”.`);
      }
    }

    // A sentence that starts with a lowercase letter ("the meeting…").
    const first = t.match(/^([“"(]?)(\p{Ll}[\p{L}'’-]*)/u);
    if (first && !/\p{Lu}/u.test(first[2].slice(1)) && !/^(e\.g|i\.e|etc|vs)\b/.test(t) && s.id !== "S1") {
      add("sentence-start", "grammar", 0, first[0], first[1] + cap(first[2]), "A sentence should start with a capital letter.");
    }

    // "i" on its own: "and i think" → "and I think".
    const lone = /(^|\s)i(?=\s+\p{L}|['’](?:m|ve|ll|d)\b)(\S*)/gu;
    while ((m = lone.exec(t))) {
      const at = m.index + m[1].length;
      const next = t.slice(at).match(/^i\S*(?:\s+\S+)?/)?.[0] ?? "i";
      add("lone-i", "spelling", at, next, "I" + next.slice(1), "“I” is always a capital letter.");
    }

    // Days and months in lowercase: "on monday" → "on Monday".
    const word = /\b(\p{Ll}+)\b/gu;
    while ((m = word.exec(t))) {
      if (DAYS_MONTHS.has(m[1])) add("day-month", "spelling", m.index, m[1], cap(m[1]), "Days and months start with a capital letter.");
    }

    // Space before punctuation: "budget ," → "budget,".
    const spaceBefore = /(\S+)[ \t]+([,;:!?]|\.(?!\.))(?=\s|$)/g;
    while ((m = spaceBefore.exec(t))) {
      if (/^[-–—…]$/.test(m[1])) continue;
      add("space-before", "grammar", m.index, m[0], m[1] + m[2], "There shouldn’t be a space before this punctuation mark.");
    }

    // Missing space after punctuation: "today.The" / "budget,and".
    const noSpace = /(\p{Ll}{2,})([.!?])(\p{Lu}\p{Ll}*)|(\p{L}{2,})([,;])(\p{L}+)/gu;
    while ((m = noSpace.exec(t))) {
      const around = t.slice(Math.max(0, m.index - 12), m.index + m[0].length + 12);
      if (/@|www\.|https?:|\.\w{2,4}\b\/|\w\.\w+\.\w/.test(around)) continue; // emails, links, domains
      const [a, p, b] = m[1] ? [m[1], m[2], m[3]] : [m[4], m[5], m[6]];
      add("space-after", "grammar", m.index, m[0], `${a}${p} ${b}`, "Add a space after this punctuation mark.");
    }

    // Repeated punctuation: "budget,," → "budget," / "end.." → "end." (not "…" or "...").
    const repeated = /(\p{L}+)(,{2,}|;{2,}|:{2,}|(?<!\.)\.{2}(?!\.)|[!?]{2,}(?=\s|$))/gu;
    while ((m = repeated.exec(t))) {
      if (/^[!?]+$/.test(m[2]) && new Set(m[2]).size > 1) continue; // "?!" is a style choice
      add("repeated-punctuation", "grammar", m.index, m[0], m[1] + m[2][0], "This punctuation mark is repeated.");
    }
  }

  // One flag per spot: keep the first check that found it.
  const kept: RuleIssue[] = [];
  for (const i of out.sort((a, b) => a.start - b.start)) {
    if (!kept.some((k) => i.start < k.end && k.start < i.end)) kept.push(i);
  }
  return kept;
}
