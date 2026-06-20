// Wardrobe API for the mirror widget. The mirror holds no JWT, so it calls the
// public mirror-scoped routes keyed by the mirror's id (?mid=), which resolve the
// active profile server-side (see docs/wardrobe/00_backend_findings.md).
import { backendApi } from '../../services/backendApi';

const API_URL = (
  process.env.REACT_APP_API_URL ||
  `http://${window.location.hostname}:3000`
).replace(/\/$/, '');

const base = () =>
  `${API_URL}/api/mirrors/wardrobe`;

const mid = () => encodeURIComponent(backendApi.getMirrorId());

async function getJson(url, options) {
  const res = await fetch(url, options);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const err = new Error(data.error || `Request failed (HTTP ${res.status})`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

export const wardrobeApi = {
  // All items (id -> attributes/thumbnails), used to render the flat-lay board.
  listItems: () => getJson(`${base()}/items?mid=${mid()}`),

  suggest: (count = 3) =>
    getJson(`${base()}/outfit/suggest?mid=${mid()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ count }),
    }),

  render: (itemIds) =>
    getJson(`${base()}/outfit/render?mid=${mid()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemIds }),
    }),

  feedback: ({ itemIds, rating, reasoningShown, context }) =>
    getJson(`${base()}/outfit/feedback?mid=${mid()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemIds, rating, reasoningShown, context }),
    }),

  context: () => getJson(`${base()}/context?mid=${mid()}`),

  bodyPhoto: () => getJson(`${base()}/body-photo?mid=${mid()}`),
};
