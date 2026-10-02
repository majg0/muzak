"""Bounded coherent decoding of already captured RNBert atomic head logits.

No model, score, label, or artifact I/O occurs here. The caller supplies the
audited ``rnbert.mapper()`` parser and atomically aligned CPU float32 logits.
The accepted experimental objective is fixed: head negative log scores weighted
by frame duration, plus .1 per change and .03 times onset surprise. These are
costs, not calibrated probabilities. Unknown means an unmappable retained head
combination; specials removed upstream are not represented in that mass.
"""
import math
from numbers import Integral

import numpy as np
import torch
from music21.key import Key
from musicbert_hf.decoding_helpers import get_degree, get_inversion, get_quality


CONFIGURATION = {"name": "coherent-medium", "changeCost": .1, "onsetCost": .03,
                 "observationCost": 0., "bassCost": 0.}
BUDGETS = {"candidatePairs": 6000, "states": 1024, "stateCells": 4_000_000,
           "headCells": 4_000_000}
HEADS = ("degree", "quality", "inversion")


def viterbi(emission, penalties):
    """Exact constant-change-cost DP; stable state ties and stay-on-tie.

    Positive infinity marks unavailable states. All-unavailable paths reject.
    The state budget includes one additional unknown state. No input mutates.
    """
    emission = np.asarray(emission, dtype=np.float64)
    penalties = np.asarray(penalties, dtype=np.float64)
    if emission.ndim != 2 or penalties.shape != (emission.shape[0],):
        raise ValueError("Emission/penalty shape mismatch.")
    n, states = emission.shape
    if states < 1 or states > BUDGETS["states"] + 1 or n * states > BUDGETS["stateCells"]:
        raise ValueError("Coherent decoder state-cell budget exceeded.")
    if np.isnan(emission).any() or np.isneginf(emission).any():
        raise ValueError("Emission costs contain invalid numbers.")
    if not np.isfinite(penalties).all() or (penalties < 0).any():
        raise ValueError("Change penalties must be finite and nonnegative.")
    if not n:
        return [], 0.
    back = np.full((n, states), -1, dtype=np.int16)
    previous = emission[0].copy()
    for i in range(1, n):
        prior = penalties[i]
        best = np.argsort(previous, kind="stable")[:2]
        argmin = int(best[0])
        second = int(best[1]) if states > 1 else argmin
        for state in range(states):
            other = second if argmin == state else argmin
            back[i, state] = state if previous[state] <= previous[other] + prior else other
        previous = emission[i] + previous[back[i]] + np.where(back[i] == np.arange(states), 0, prior)
    if not np.isfinite(previous).any():
        raise ValueError("Coherent decoder has no finite candidate path.")
    state = int(np.argmin(previous))
    path = [state]
    for i in range(n - 1, 0, -1):
        state = int(back[i, state])
        path.append(state)
    return path[::-1], float(np.min(previous))


def _integer(value):
    return isinstance(value, Integral) and not isinstance(value, (bool, np.bool_))


def decode_coherent(frames, logits, vocabularies, *, parse, ppq=48,
                    overrides=None, include_evidence=False):
    """Decode atomic frames using one bounded whole-input candidate inventory.

    ``frames``: ordered disjoint dicts with startTick, endTick, key (predicted
    model key), and onsetProbability (0..1, or None when no new model onset).
    ``logits``: degree/quality/inversion CPU float32 tensors [frames, classes].
    ``vocabularies``: matching ordered lists of nonspecial class strings.
    ``overrides``: optional degree and/or quality atomic tensors, same shape.
    ``parse``: audited (display_rn, key) -> {root, core, localKey}; ValueError
    denotes an unsupported interpretation. No reference labels enter this API.

    The top5 degree x top4 quality pairs at any frame are admitted under that
    frame's predicted key. States merge exact realized root/core identities;
    aliases retain the minimum head cost, not a summed posterior. Inversion
    remains part of that score and emitted token. Window merging preserves
    model key and RN, so evidence boundaries are not erased by core equality.
    """
    if not _integer(ppq) or ppq <= 0:
        raise ValueError("PPQ must be a positive integer.")
    if set(logits) != set(HEADS) or set(vocabularies) != set(HEADS):
        raise ValueError("Supply exactly degree, quality and inversion heads.")
    overrides = {} if overrides is None else overrides
    if set(overrides) - {"degree", "quality"}:
        raise ValueError("Only degree and quality logits may be overridden.")
    n = len(frames)
    prior_end = 0
    for frame in frames:
        start, end = frame["startTick"], frame["endTick"]
        if not _integer(start) or not _integer(end) or not prior_end <= start < end:
            raise ValueError("Frames must have increasing disjoint integer intervals.")
        prior_end = end
        if not isinstance(frame["key"], str) or not frame["key"]:
            raise ValueError("Each frame needs its predicted model key.")
        probability = frame["onsetProbability"]
        if probability is not None and (not math.isfinite(probability) or not 0 <= probability <= 1):
            raise ValueError("Onset probability must be null or finite in [0,1].")
    if list(vocabularies["inversion"]) != ["0.0", "1.0", "2.0", "3.0"]:
        raise ValueError("Inversion columns must be the declared 0.0 through 3.0 order.")
    head_cells = sum(n * len(vocabularies[head]) for head in HEADS)
    if head_cells > BUDGETS["headCells"]:
        raise ValueError("Coherent decoder head-cell budget exceeded.")
    logp, ranked = {}, {}
    for head in HEADS:
        vocabulary = vocabularies[head]
        if not 1 <= len(vocabulary) <= 32767 or len(set(vocabulary)) != len(vocabulary):
            raise ValueError("Head vocabulary must contain distinct bounded class names.")
        if any(not isinstance(token, str) or not token for token in vocabulary):
            raise ValueError("Head vocabulary contains an invalid class name.")
        for tensor in (logits[head], overrides[head]) if head in overrides else (logits[head],):
            if (not isinstance(tensor, torch.Tensor) or tensor.dtype != torch.float32
                    or tensor.device.type != "cpu" or tensor.shape != (n, len(vocabulary))
                    or not torch.isfinite(tensor).all()):
                raise ValueError("Atomic head logits must be finite aligned CPU float32 tensors.")
        value = overrides.get(head, logits[head]).detach()
        logp[head] = torch.log_softmax(value, -1).numpy()
        # Preserve the accepted NumPy ranking/tie behavior, not a new sort policy.
        ranked[head] = np.argsort(-logp[head], axis=1)

    cache = {}

    def interpret(key, d, q, inversion):
        degree, quality = vocabularies["degree"][d], vocabularies["quality"][q]
        identity = (key, degree, quality, inversion)
        if identity not in cache:
            primary, secondary = get_degree(degree)
            rn = primary + get_quality(quality) + get_inversion(str(float(inversion)), quality) + secondary
            try:
                value = parse(rn, key)
            except ValueError:
                cache[identity] = None
            else:
                root, core = value["root"], value["core"]
                if (not _integer(root) or not 0 <= root < 12 or not core
                        or any(not _integer(p) or not 0 <= p < 12 for p in core)
                        or list(core) != sorted(set(core))):
                    raise ValueError("Audited parser returned a malformed root/core.")
                cache[identity] = {"root": root, "core": core, "rn": rn, "localKey": value["localKey"]}
        return cache[identity]

    pairs = set()
    for i, frame in enumerate(frames):
        for d in ranked["degree"][i, :5]:
            for q in ranked["quality"][i, :4]:
                pairs.add((frame["key"], int(d), int(q)))
                if len(pairs) > BUDGETS["candidatePairs"]:
                    raise ValueError("Coherent decoder candidate-pair budget exceeded.")
    states, aliases = {}, {}
    for key, d, q in sorted(pairs):
        decoded = interpret(key, d, q, 0)
        if decoded is None:
            continue
        signature = (decoded["root"], tuple(decoded["core"]))
        if signature not in states:
            if len(states) >= BUDGETS["states"]:
                raise ValueError("Coherent decoder state budget exceeded.")
            states[signature] = len(states)
        aliases.setdefault(key, []).append((states[signature], d, q))
    signatures = list(states)
    unknown, count = len(states), len(states) + 1
    if n * count > BUDGETS["stateCells"]:
        raise ValueError("Coherent decoder state-cell budget exceeded.")
    base = np.full((n, count), np.inf, dtype=np.float64)
    choice = np.full((n, count, 3), -1, dtype=np.int16)
    for i, frame in enumerate(frames):
        for state, d, q in aliases.get(frame["key"], []):
            quality = vocabularies["quality"][q]
            allowed = range(4) if "7" in quality or quality == "aug6" else range(3)
            inversion = min(allowed, key=lambda inv: -logp["inversion"][i, inv])
            cost = -float(logp["degree"][i, d] + logp["quality"][i, q] + logp["inversion"][i, inversion])
            if cost < base[i, state]:
                base[i, state], choice[i, state] = cost, [d, q, inversion]
        for d in ranked["degree"][i, :5]:
            for q in ranked["quality"][i, :4]:
                for inv in ranked["inversion"][i, :2]:
                    if interpret(frame["key"], int(d), int(q), int(inv)) is None:
                        cost = -float(logp["degree"][i, d] + logp["quality"][i, q] + logp["inversion"][i, inv])
                        if cost < base[i, unknown]:
                            base[i, unknown], choice[i, unknown] = cost, [d, q, inv]
    quarters = np.array([(f["endTick"] - f["startTick"]) / ppq for f in frames])
    penalties = [CONFIGURATION["changeCost"] + (CONFIGURATION["onsetCost"]
                 * -math.log(max(float(f["onsetProbability"]), 1e-8))
                 if f["onsetProbability"] is not None else 0) for f in frames]
    path, objective = viterbi(base * quarters[:, None], penalties)
    windows, tonics = [], {}
    for i, state in enumerate(path):
        frame = frames[i]
        d, q, inv = (int(v) for v in choice[i, state])
        decoded = interpret(frame["key"], d, q, inv) if d >= 0 and state != unknown else None
        if frame["key"] not in tonics:
            tonics[frame["key"]] = int(Key(frame["key"]).tonic.pitchClass) * 100000
        window = {"tonicPitchClass": tonics[frame["key"]], "startTick": frame["startTick"],
                  "endTick": frame["endTick"], "selected": 0 if decoded else None, "alternatives": [],
                  "modelKey": frame["key"], "modelRn": decoded["rn"] if decoded else "unknown",
                  "localKey": decoded["localKey"] if decoded else None}
        if decoded:
            window["alternatives"] = [{"rootMillicents": decoded["root"] * 100000,
                "coreIntervals": sorted(((p - decoded["root"]) % 12) * 100000 for p in decoded["core"]),
                "colorIntervals": []}]
        if (windows and windows[-1]["endTick"] == window["startTick"]
                and all(windows[-1][k] == window[k] for k in ("modelKey", "modelRn", "selected", "alternatives"))):
            windows[-1]["endTick"] = window["endTick"]
        else:
            windows.append(window)
    result = {"prediction": {"windows": windows}, "objective": objective,
              "configuration": dict(CONFIGURATION), "budgets": dict(BUDGETS),
              "search": {"frames": n, "states": count, "candidatePairs": len(pairs), "stateCells": n * count},
              "overriddenHeads": sorted(overrides)}
    if include_evidence:
        evidence = []
        for i, frame in enumerate(frames):
            values = []
            for state, (root, core) in enumerate(signatures):
                d, q, inv = (int(v) for v in choice[i, state])
                if d < 0:
                    continue
                values.append({"root": root * 100000, "core": [p * 100000 for p in core],
                    "negativeLogDegreeScore": -float(logp["degree"][i, d]),
                    "negativeLogQualityScore": -float(logp["quality"][i, q]),
                    "negativeLogInversionScore": -float(logp["inversion"][i, inv]),
                    "negativeLogHeadScore": float(base[i, state]),
                    "degreeToken": vocabularies["degree"][d], "qualityToken": vocabularies["quality"][q],
                    "inversion": inv})
            evidence.append({"startTick": frame["startTick"], "endTick": frame["endTick"], "states": values})
        result["factorEvidence"] = evidence
    return result


def self_test():
    """Small independent exhaustive and admission controls; no model artifacts."""
    import itertools
    generator = np.random.default_rng(107)
    cases = 0
    for length in range(1, 6):
        for states in range(1, 5):
            for _ in range(10):
                emission = generator.integers(0, 4, size=(length, states)).astype(float)
                penalties = generator.integers(0, 4, size=length).astype(float) / 2
                path, cost = viterbi(emission, penalties)
                brute = min(sum(emission[i, s] for i, s in enumerate(p))
                            + sum(penalties[i] for i in range(1, length) if p[i] != p[i - 1])
                            for p in itertools.product(range(states), repeat=length))
                assert cost == brute and len(path) == length
                cases += 1
    assert viterbi(np.zeros((3, 2)), [0., 0., 0.]) == ([0, 0, 0], 0.)
    assert viterbi(np.zeros((0, 1)), []) == ([], 0.)
    rejected = 0
    for emission, penalties in ((np.full((2, 1), np.inf), [0., 0.]),
                               (np.zeros((1, 1026)), [0.]),
                               (np.zeros((1, 1)), [float("nan")])):
        try:
            viterbi(emission, penalties)
        except ValueError:
            rejected += 1
        else:
            raise AssertionError("Malformed or unavailable DP accepted.")
    vocabulary = {"degree": ["_I_I"], "quality": ["x"],
                  "inversion": ["0.0", "1.0", "2.0", "3.0"]}
    frames = [{"startTick": 0, "endTick": 48, "key": "C", "onsetProbability": None}]
    logits = {head: torch.zeros(1, len(vocabulary[head])) for head in HEADS}

    def unknown(rn, key):
        raise ValueError("Explicitly unavailable interpretation.")

    result = decode_coherent(frames, logits, vocabulary, parse=unknown)
    assert result["prediction"]["windows"][0]["selected"] is None
    replay = decode_coherent(frames, logits, vocabulary, parse=unknown,
                             overrides={head: logits[head].clone() for head in ("degree", "quality")})
    assert result["prediction"] == replay["prediction"] and result["objective"] == replay["objective"]
    return {"exhaustiveDpCases": cases, "rejections": rejected,
            "controls": ["stable ties", "empty input", "unknown-only state", "identity head overrides"]}
