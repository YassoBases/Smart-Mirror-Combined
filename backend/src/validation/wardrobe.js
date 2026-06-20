// zod request schemas for the wardrobe routes. Routes call validate(schema, data)
// and get either parsed data or a thrown 400 with a readable message.

const { z } = require("zod");

const CATEGORY = z.enum(["top", "bottom", "outerwear", "footwear", "accessory"]);
const PATTERN = z.enum(["solid", "stripe", "plaid", "print", "other"]);
const SEASON = z.enum(["winter", "spring", "summer", "autumn"]);
const RATING = z.enum(["up", "down"]);

// PATCH /items/:id — all editable attrs optional; unknown keys stripped.
const itemPatchSchema = z
  .object({
    category: CATEGORY,
    subcategory: z.string().max(120),
    primaryColor: z.string().max(40),
    secondaryColors: z.array(z.string().max(40)).max(12),
    pattern: PATTERN,
    fabricGuess: z.string().max(120),
    formality: z.number().int().min(1).max(5),
    warmth: z.number().int().min(1).max(5),
    seasons: z.array(SEASON).max(4),
    tags: z.array(z.string().max(60)).max(30),
    lastWornAt: z.string().max(40).nullable(),
  })
  .partial()
  .strip();

// GET /items query filters.
const itemListQuerySchema = z
  .object({
    category: CATEGORY.optional(),
    season: SEASON.optional(),
  })
  .strip();

// POST /outfit/suggest
const suggestSchema = z
  .object({ count: z.number().int().min(1).max(10).optional() })
  .strip();

// POST /outfit/render
const renderSchema = z
  .object({ itemIds: z.array(z.number().int().positive()).min(1).max(10) })
  .strip();

// POST /outfit/feedback
const feedbackSchema = z
  .object({
    itemIds: z.array(z.number().int().positive()).min(1).max(10),
    rating: RATING,
    reasoningShown: z.string().max(2000).optional().nullable(),
    context: z.record(z.string(), z.unknown()).optional().nullable(),
  })
  .strip();

// GET /outfit/feedback query
const feedbackListQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(200).optional(),
    offset: z.coerce.number().int().min(0).optional(),
  })
  .strip();

/**
 * Parses `data` with `schema`; throws an Error with status 400 on failure so the
 * central error handler returns { error }.
 */
function validate(schema, data) {
  const result = schema.safeParse(data);
  if (!result.success) {
    const msg = result.error.issues
      .map((i) => `${i.path.join(".") || "body"}: ${i.message}`)
      .join("; ");
    throw Object.assign(new Error(msg || "Invalid request"), { status: 400 });
  }
  return result.data;
}

module.exports = {
  validate,
  itemPatchSchema,
  itemListQuerySchema,
  suggestSchema,
  renderSchema,
  feedbackSchema,
  feedbackListQuerySchema,
};
