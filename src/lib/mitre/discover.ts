import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { serverEnv } from "@/lib/env";
import { parseTechniques, type DiscoveredTechnique } from "./parse";

const AI_MODEL = process.env.ANTHROPIC_MODEL || "claude-haiku-4-5";

const SYSTEM = [
  "You are a threat-intelligence analyst mapping report content to the MITRE",
  "ATT&CK Enterprise matrix. From the report text, identify the techniques the",
  "described adversary activity maps to. Prefer sub-techniques (e.g. T1059.003)",
  "when the text supports them, otherwise the parent technique (e.g. T1059).",
  'Return ONLY strict JSON: an array of objects {"code": string, "name": string},',
  "where code is the ATT&CK technique id and name is its official technique name.",
  "Include only techniques clearly supported by the text; do not invent or pad.",
  "Return an empty array if none apply. Use ASCII only.",
].join(" ");

/**
 * Ask the LLM to infer the MITRE ATT&CK techniques a report describes. Requires
 * an Anthropic API key; throws if unavailable so the caller can surface it.
 */
export async function discoverTechniques(
  text: string,
): Promise<DiscoveredTechnique[]> {
  const key = serverEnv.anthropicApiKey;
  if (!key) throw new Error("AI is not configured on the server.");
  const body = text.trim();
  if (!body) return [];

  const client = new Anthropic({ apiKey: key });
  const message = await client.messages.create({
    model: AI_MODEL,
    max_tokens: 1024,
    system: SYSTEM,
    messages: [{ role: "user", content: body.slice(0, 16000) }],
  });
  const out = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  return parseTechniques(out);
}
