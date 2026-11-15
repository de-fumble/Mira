import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { MeetingSummary } from "./transcript";

const SummarySchema = z.object({
  title: z.string().describe("Short, specific meeting title, max 8 words"),
  summary: z.string().describe("2-4 sentence overview in plain language"),
  key_points: z.array(z.string()),
  decisions: z.array(z.string()),
  action_items: z.array(
    z.object({
      task: z.string(),
      owner: z.string().nullable().describe("Person responsible, or null if not stated"),
      due: z.string().nullable().describe("Deadline as said in the meeting, or null"),
    }),
  ),
});

const SYSTEM_PROMPT = `You write clear, accurate notes from meeting transcripts.

The transcript comes from automatic speech recognition, so expect occasional misheard words. Speakers are labelled "Speaker 1", "Speaker 2", etc. If someone's name is clearly stated (for example, they introduce themselves or are addressed by name), use the name; otherwise keep the speaker label. Never invent names, facts, decisions, owners or deadlines that the transcript does not support.

Write in plain, friendly language that someone who missed the meeting can understand at a glance.
- key_points: the main topics and facts discussed, one short sentence each.
- decisions: only things the group actually agreed on. Empty list if none.
- action_items: concrete follow-ups someone committed to or was asked to do. Empty list if none.
If the transcript is very short or has no real discussion, say so briefly in the summary and leave the lists empty.`;

export class SummaryUnavailableError extends Error {}

export async function summarizeTranscript(transcriptText: string): Promise<MeetingSummary> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new SummaryUnavailableError(
      "ANTHROPIC_API_KEY is not set. Add it to .env.local and restart the server.",
    );
  }

  const client = new Anthropic();

  const response = await client.beta.messages.parse({
    model: "claude-opus-5-5",
    max_tokens: 16000,
    // On a safety decline, the API re-runs the request on a suitable fallback model.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: {
      effort: "medium",
      format: betaZodOutputFormat(SummarySchema),
    },
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `<transcript>\n${transcriptText}\n</transcript>\n\nWrite the meeting notes.`,
      },
    ],
  });

  if (response.stop_reason === "refusal") {
    throw new Error("The summary request was declined.");
  }
  if (response.stop_reason === "max_tokens" || !response.parsed_output) {
    throw new Error("The summary came back incomplete. Please try again.");
  }
  return response.parsed_output;
}
