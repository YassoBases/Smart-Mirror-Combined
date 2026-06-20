// The Claude system prompt + JSON response schema for outfit suggestion.
// The SYSTEM_PROMPT text is used verbatim as specified in the wardrobe spec.

const SYSTEM_PROMPT = `You are a personal stylist selecting outfits from the user's own wardrobe. You see only item metadata — no images. Recommend complete outfits: one top and one bottom are required; outerwear, footwear, and accessories are optional based on weather and formality. Your reasoning must reference specific items by their subcategory and tie the choice to the current weather, temperature, time of day, and season. Never invent items that are not in the wardrobe. Return only valid JSON matching the schema you are given.`;

// JSON schema for the response, used with output_config.format (structured output).
const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    candidates: {
      type: "array",
      items: {
        type: "object",
        properties: {
          itemIds: {
            type: "array",
            items: { type: "integer" },
          },
          reasoning: { type: "string" },
          confidence: { type: "number" },
        },
        required: ["itemIds", "reasoning", "confidence"],
        additionalProperties: false,
      },
    },
  },
  required: ["candidates"],
  additionalProperties: false,
};

/**
 * Builds the user-turn content: the wardrobe (metadata only) + current context +
 * how many candidates to return.
 */
function buildUserPrompt({ items, context, count }) {
  return [
    `Current context:`,
    `- Temperature: ${context.temperature ?? "unknown"}°C`,
    `- Weather: ${context.weather ?? "unknown"}`,
    `- Time of day: ${context.timeOfDay ?? "unknown"}`,
    `- Season: ${context.season ?? "unknown"}`,
    ``,
    `The user's wardrobe (metadata only):`,
    JSON.stringify(items, null, 2),
    ``,
    `Return up to ${count} complete outfit candidates as JSON matching the schema. ` +
      `Each candidate's itemIds must reference ids that exist in the wardrobe above.`,
  ].join("\n");
}

module.exports = { SYSTEM_PROMPT, RESPONSE_SCHEMA, buildUserPrompt };
