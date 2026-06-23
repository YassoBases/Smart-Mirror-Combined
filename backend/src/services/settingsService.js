// Generic key/value app settings (integration keys configured from the mirror
// Settings UI). Used for secrets like the Replicate API token so they don't have
// to live in backend/.env. Read at request time, env value used as the fallback.
const { getDb } = require("../config/database");

async function getSetting(key, fallback = null) {
  const db = await getDb();
  const row = await db.get("SELECT value FROM app_settings WHERE key = ?", key);
  return row && row.value != null && row.value !== "" ? row.value : fallback;
}

async function setSetting(key, value) {
  const db = await getDb();
  await db.run(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES (?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
    key,
    value,
  );
}

module.exports = { getSetting, setSetting };
