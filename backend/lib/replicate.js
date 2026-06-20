// Wraps Replicate's HTTP API for virtual try-on (VTON).
//
// Reads REPLICATE_API_TOKEN and REPLICATE_VTON_MODEL (default a current IDM-VTON
// model id). Runs one garment onto a person image and returns the output image
// URL. The model id is verified at call time — a clear error surfaces if it's
// wrong. If the token is unset, isConfigured() is false and callers fall back to
// a no-op render (returning the base body photo).

const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN || "";
// Default to a current IDM-VTON model on Replicate. Override via env.
const REPLICATE_VTON_MODEL =
  process.env.REPLICATE_VTON_MODEL ||
  "cuuupid/idm-vton:c871bb9b046607b680449ecbae55fd8c6d945e0a1948644bf2361b3d021d3ff4";

const API_BASE = "https://api.replicate.com/v1";

function isConfigured() {
  return !!REPLICATE_API_TOKEN;
}

// Splits "owner/name:version" → { ref, version }. Replicate's predictions API
// takes the version hash; if no ":version" is present we surface a clear error.
function parseModel(model) {
  const idx = model.indexOf(":");
  if (idx === -1) {
    throw Object.assign(
      new Error(
        `REPLICATE_VTON_MODEL must be "owner/name:version" — got "${model}"`,
      ),
      { code: "REPLICATE_MODEL_INVALID" },
    );
  }
  return { ref: model.slice(0, idx), version: model.slice(idx + 1) };
}

async function poll(predictionUrl, headers, { timeoutMs = 120000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const res = await fetch(predictionUrl, { headers });
    const data = await res.json();
    if (data.status === "succeeded") return data;
    if (data.status === "failed" || data.status === "canceled") {
      throw new Error(`Replicate prediction ${data.status}: ${data.error || ""}`);
    }
    if (Date.now() > deadline) throw new Error("Replicate prediction timed out");
    await new Promise((r) => setTimeout(r, 2000));
  }
}

/**
 * Runs one VTON step.
 * @param {{ humanImageUrl:string, garmentImageUrl:string, garmentDes?:string }} args
 * @returns {Promise<string>} output image URL
 */
async function tryOn({ humanImageUrl, garmentImageUrl, garmentDes }) {
  if (!REPLICATE_API_TOKEN) {
    throw Object.assign(new Error("REPLICATE_API_TOKEN not configured"), {
      code: "REPLICATE_UNSET",
    });
  }
  const { version } = parseModel(REPLICATE_VTON_MODEL);
  const headers = {
    Authorization: `Bearer ${REPLICATE_API_TOKEN}`,
    "Content-Type": "application/json",
  };

  const createRes = await fetch(`${API_BASE}/predictions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      version,
      input: {
        human_img: humanImageUrl,
        garm_img: garmentImageUrl,
        garment_des: garmentDes || "garment",
      },
    }),
  });
  const created = await createRes.json();
  if (!createRes.ok) {
    // 422 with "version does not exist" is the classic wrong-model-id signal.
    throw new Error(
      `Replicate create failed (${createRes.status}): ${
        created?.detail || created?.title || "unknown error"
      }`,
    );
  }

  const done = await poll(created.urls.get, headers);
  const out = Array.isArray(done.output) ? done.output[done.output.length - 1] : done.output;
  if (!out) throw new Error("Replicate returned no output image");
  return out;
}

module.exports = { tryOn, isConfigured, parseModel, REPLICATE_VTON_MODEL };
