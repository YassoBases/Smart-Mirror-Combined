// Wraps the Anthropic SDK for outfit suggestion. Reads ANTHROPIC_API_KEY and
// ANTHROPIC_MODEL (default claude-sonnet-4-6, env-overridable per the spec).
//
// Uses structured output (output_config.format) so the model returns strict JSON
// matching RESPONSE_SCHEMA. If ANTHROPIC_API_KEY is unset, isConfigured() is
// false and callers fall back to a deterministic local heuristic.

const Anthropic = require("@anthropic-ai/sdk");
const {
  SYSTEM_PROMPT,
  RESPONSE_SCHEMA,
  buildUserPrompt,
} = require("./outfit_prompt");

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";

let client = null;
function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!client) {
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}

function isConfigured() {
  return !!process.env.ANTHROPIC_API_KEY;
}

/**
 * Asks Claude to select outfit candidates from the wardrobe.
 * @param {{ items: object[], context: object, count: number }} args
 * @returns {Promise<{candidates: {itemIds:number[], reasoning:string, confidence:number}[]}>}
 * @throws if the API key is unset or the call fails (caller decides the fallback)
 */
async function suggestOutfits({ items, context, count = 3 }) {
  const c = getClient();
  if (!c) {
    throw Object.assign(new Error("ANTHROPIC_API_KEY not configured"), {
      code: "ANTHROPIC_UNSET",
    });
  }

  const response = await c.messages.create({
    model: MODEL,
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    output_config: { format: { type: "json_schema", schema: RESPONSE_SCHEMA } },
    messages: [
      { role: "user", content: buildUserPrompt({ items, context, count }) },
    ],
  });

  // With output_config.format the first text block is guaranteed valid JSON.
  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock) throw new Error("Anthropic returned no text content");
  const parsed = JSON.parse(textBlock.text);
  return { candidates: Array.isArray(parsed.candidates) ? parsed.candidates : [] };
}

module.exports = { suggestOutfits, isConfigured, MODEL };
