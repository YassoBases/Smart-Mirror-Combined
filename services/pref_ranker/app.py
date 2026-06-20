"""pref_ranker sidecar — per-profile outfit preference model (LightGBM LGBMRanker).

POST /score  { profile_id, candidates: [{ item_ids?, items: [<attrs>] }], context }
               -> { scores: [float, ...] }      (heuristic if no model yet)
POST /train  { profile_id, samples: [{ items: [<attrs>], context, label }] }
               -> { trained: bool, n: int, model_path, trained_at }
GET  /health -> { status, models: {profile_id: trained_at} }

Models are persisted with joblib to models/{profile_id}.lgb as a bundle of the
ranker + the derived stats (centroid, co-occurrence, subcategory vocab) needed to
rebuild features at score time.
"""
from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import joblib
from fastapi import FastAPI
from pydantic import BaseModel

import features as feat

MODELS_DIR = os.environ.get("MODELS_DIR", os.path.join(os.path.dirname(__file__), "models"))
os.makedirs(MODELS_DIR, exist_ok=True)

app = FastAPI(title="pref_ranker")


class Candidate(BaseModel):
    item_ids: Optional[List[int]] = None
    items: List[Dict[str, Any]] = []


class ScoreRequest(BaseModel):
    profile_id: int
    candidates: List[Candidate] = []
    context: Dict[str, Any] = {}


class Sample(BaseModel):
    items: List[Dict[str, Any]] = []
    context: Dict[str, Any] = {}
    label: int = 0


class TrainRequest(BaseModel):
    profile_id: int
    samples: List[Sample] = []


def _model_path(profile_id: int) -> str:
    return os.path.join(MODELS_DIR, f"{profile_id}.lgb")


def _load(profile_id: int):
    path = _model_path(profile_id)
    if not os.path.exists(path):
        return None
    try:
        return joblib.load(path)
    except Exception:
        return None


@app.get("/health")
def health():
    models: Dict[str, Any] = {}
    for name in os.listdir(MODELS_DIR):
        if name.endswith(".lgb"):
            pid = name[:-4]
            try:
                bundle = joblib.load(os.path.join(MODELS_DIR, name))
                models[pid] = bundle.get("trained_at")
            except Exception:
                models[pid] = None
    return {"status": "ok", "models": models}


@app.post("/score")
def score(req: ScoreRequest):
    bundle = _load(req.profile_id)
    scores: List[float] = []

    if bundle is None:
        # No model yet — context-fit heuristic keeps Claude's ordering sensible.
        for c in req.candidates:
            scores.append(feat.heuristic_score(c.items, req.context))
        return {"scores": scores, "model": False}

    model = bundle["model"]
    stats = bundle["stats"]
    rows = [feat.candidate_features(c.items, req.context, stats) for c in req.candidates]
    if rows:
        preds = model.predict(rows)
        scores = [float(p) for p in preds]
    return {"scores": scores, "model": True}


@app.post("/train")
def train(req: TrainRequest):
    samples = [s.model_dump() for s in req.samples]
    if len(samples) < 2 or len({int(s["label"]) for s in samples}) < 2:
        # Need at least one like and one dislike to learn a ranking.
        return {"trained": False, "n": len(samples), "reason": "insufficient labeled data"}

    import lightgbm as lgb

    stats = feat.build_stats(samples)
    X = [feat.candidate_features(s["items"], s.get("context", {}), stats) for s in samples]
    y = [int(s["label"]) for s in samples]

    ranker = lgb.LGBMRanker(
        objective="lambdarank",
        n_estimators=100,
        num_leaves=15,
        min_child_samples=1,
        random_state=42,
    )
    # Whole sample set is one ranking group.
    ranker.fit(X, y, group=[len(X)])

    trained_at = datetime.now(timezone.utc).isoformat()
    joblib.dump({"model": ranker, "stats": stats, "trained_at": trained_at}, _model_path(req.profile_id))
    return {
        "trained": True,
        "n": len(samples),
        "model_path": _model_path(req.profile_id),
        "trained_at": trained_at,
    }
