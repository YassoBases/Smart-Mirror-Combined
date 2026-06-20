// Drives the wardrobe session state machine and the backend calls:
//   idle -> loading_suggestion -> showing_board -> rendering_vton
//        -> showing_vton -> awaiting_feedback -> idle
//
// It also subscribes to a 'smartMirror:wardrobe' window event so a push message
// over the existing sync layer (or any other source) can trigger the widget
// remotely (e.g. { action: 'invoke' }).
import { useCallback, useEffect, useRef, useState } from 'react';
import { wardrobeApi } from './wardrobeApi';

export const STATES = {
  IDLE: 'idle',
  LOADING: 'loading_suggestion',
  BOARD: 'showing_board',
  RENDERING: 'rendering_vton',
  VTON: 'showing_vton',
  FEEDBACK: 'awaiting_feedback',
};

export function useWardrobeSession() {
  const [state, setState] = useState(STATES.IDLE);
  const [candidates, setCandidates] = useState([]);
  const [index, setIndex] = useState(0);
  const [itemsById, setItemsById] = useState({});
  const [context, setContext] = useState(null);
  const [renderUrl, setRenderUrl] = useState(null);
  const [fromCache, setFromCache] = useState(false);
  const [error, setError] = useState(null);
  const busy = useRef(false);

  const current = candidates[index] || null;

  const reset = useCallback(() => {
    setState(STATES.IDLE);
    setCandidates([]);
    setIndex(0);
    setRenderUrl(null);
    setFromCache(false);
    setError(null);
  }, []);

  const invoke = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setError(null);
    setState(STATES.LOADING);
    try {
      const [itemsRes, suggestRes] = await Promise.all([
        wardrobeApi.listItems(),
        wardrobeApi.suggest(3),
      ]);
      const map = {};
      for (const it of itemsRes.items || []) map[it.id] = it;
      setItemsById(map);
      setContext(suggestRes.context || null);
      const cands = suggestRes.candidates || [];
      setCandidates(cands);
      setIndex(0);
      setState(cands.length ? STATES.BOARD : STATES.IDLE);
      if (!cands.length) setError('No outfits to suggest yet. Add items to your wardrobe.');
    } catch (err) {
      setError(
        err.status === 404
          ? 'No active profile on this mirror.'
          : err.message || 'Could not load a suggestion.',
      );
      setState(STATES.IDLE);
    } finally {
      busy.current = false;
    }
  }, []);

  const nextOutfit = useCallback(() => {
    setState((s) => {
      if (s !== STATES.BOARD || candidates.length === 0) return s;
      setIndex((i) => (i + 1) % candidates.length);
      return STATES.BOARD;
    });
  }, [candidates.length]);

  const renderVton = useCallback(async () => {
    if (busy.current || !current) return;
    busy.current = true;
    setError(null);
    setState(STATES.RENDERING);
    try {
      const res = await wardrobeApi.render(current.itemIds);
      setRenderUrl(res.renderUrl);
      setFromCache(!!res.fromCache);
      setState(STATES.VTON); // VtonView flips to FEEDBACK once the image loads
    } catch (err) {
      setError(err.message || 'Could not render the outfit.');
      setState(STATES.BOARD);
    } finally {
      busy.current = false;
    }
  }, [current]);

  // Called by VtonView when the render image finishes loading.
  const markVtonReady = useCallback(() => {
    setState((s) => (s === STATES.VTON ? STATES.FEEDBACK : s));
  }, []);

  const sendFeedback = useCallback(
    async (rating) => {
      if (!current) return;
      try {
        await wardrobeApi.feedback({
          itemIds: current.itemIds,
          rating,
          reasoningShown: current.reasoning,
          context,
        });
      } catch (err) {
        // Non-fatal — feedback is best-effort.
        console.warn('[wardrobe] feedback failed:', err.message);
      }
      reset();
    },
    [current, context, reset],
  );

  const feedbackUp = useCallback(() => sendFeedback('up'), [sendFeedback]);
  const feedbackDown = useCallback(() => sendFeedback('down'), [sendFeedback]);
  const dismiss = useCallback(() => reset(), [reset]);

  // Allow remote/push triggering via the existing sync layer.
  useEffect(() => {
    const onPush = (e) => {
      const action = e.detail?.action;
      if (action === 'invoke') invoke();
      else if (action === 'dismiss') dismiss();
    };
    window.addEventListener('smartMirror:wardrobe', onPush);
    return () => window.removeEventListener('smartMirror:wardrobe', onPush);
  }, [invoke, dismiss]);

  return {
    state,
    candidates,
    index,
    current,
    itemsById,
    context,
    renderUrl,
    fromCache,
    error,
    actions: { invoke, nextOutfit, renderVton, markVtonReady, feedbackUp, feedbackDown, dismiss },
  };
}
