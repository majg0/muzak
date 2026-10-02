"""Offline quality-readout adaptation over externally audited RNBert captures.

No paths, corpus selection, checkpoint loading, or reference evaluation live here.
Features must be the frozen quality head's dense+tanh output, collated and mean
pooled at source atomic intervals. Keep original degree, inversion and function
predictions separate. This module changes only the known quality output rows.
"""
from contextlib import contextmanager
from dataclasses import dataclass
from math import lcm
from typing import Callable, Mapping, Sequence

import numpy as np
import torch
from musicbert_hf.decoding_helpers import get_degree, get_inversion, get_quality


PROTOCOL = {
    "steps": 200, "learningRate": .001, "l2Sum": .01,
    "optimizer": "Adam", "seed": 0, "threads": 4,
    "initialization": "Zero delta to frozen quality output logits; no normalization.",
    "loss": "Duration-weighted exact realized-core marginal over the full degree/quality vocabulary.",
    "unknown": "Unsupported outcomes remain in probability normalization; membership contribution is .5.",
}


@dataclass(frozen=True)
class QualityCapture:
    frames: Sequence[Mapping]
    ppq: int
    quality_features: torch.Tensor
    degree_logits: torch.Tensor
    quality_logits: torch.Tensor
    vocabularies: Mapping[str, Sequence[str]]


@dataclass(frozen=True)
class CoreReference:
    start_tick: int
    end_tick: int
    core_pitch_classes: Sequence[int] | None


@dataclass(frozen=True)
class QualityTrainingExample:
    capture: QualityCapture
    references: Sequence[CoreReference]
    reference_ppq: int
    semitone_shift: int = 0


@dataclass(frozen=True)
class QualityFit:
    delta_weight: torch.Tensor
    delta_bias: torch.Tensor
    vocabularies: Mapping[str, tuple[str, ...]]
    timebase: int
    accounting: list[dict]
    loss_trace: list[dict]


def _integer(value, name, minimum=0):
    if isinstance(value, bool) or not isinstance(value, int) or value < minimum:
        raise ValueError(f"{name} must be an integer >= {minimum}.")
    return value


def _vocabularies(vocabularies):
    result = {name: tuple(vocabularies[name]) for name in ("degree", "quality")}
    for values in result.values():
        if not values or len(values) != len(set(values)) or any(not isinstance(v, str) or not v for v in values):
            raise ValueError("Vocabularies must contain unique ordered tokens.")
        if any(v in ("<s>", "</s>", "<pad>", "<unk>", "<mask>") for v in values):
            raise ValueError("Captures must exclude special output rows explicitly.")
    return result


def _tensor(value, shape, name):
    if value.device.type != "cpu" or value.dtype != torch.float32 or tuple(value.shape) != shape:
        raise ValueError(f"{name} must be a CPU float32 tensor of shape {shape}.")
    if not torch.isfinite(value).all():
        raise ValueError(f"{name} must be finite.")
    if value.requires_grad:
        raise ValueError(f"{name} must be a detached frozen capture or parameter.")


def validate_capture(capture, readout_weight=None, readout_bias=None):
    """Validate geometry/columns; optionally replay the frozen known-row map."""
    _integer(capture.ppq, "PPQ", 1)
    vocab = _vocabularies(capture.vocabularies)
    n, q, d = len(capture.frames), len(vocab["quality"]), len(vocab["degree"])
    _tensor(capture.quality_features, (n, 1024), "quality_features")
    _tensor(capture.quality_logits, (n, q), "quality_logits")
    _tensor(capture.degree_logits, (n, d), "degree_logits")
    previous = 0
    for f in capture.frames:
        start = _integer(f["startTick"], "Frame start")
        end = _integer(f["endTick"], "Frame end")
        if start < previous or end <= start or not isinstance(f.get("key"), (str, type(None))):
            raise ValueError("Frames must be ordered, disjoint positive spans with a predicted key or None.")
        previous = end
    if (readout_weight is None) != (readout_bias is None):
        raise ValueError("Both frozen readout tensors are required for replay.")
    maximum = None
    if readout_weight is not None:
        _tensor(readout_weight, (q, 1024), "readout_weight")
        _tensor(readout_bias, (q,), "readout_bias")
        replay = capture.quality_features @ readout_weight.T + readout_bias
        if not torch.allclose(replay, capture.quality_logits, atol=1e-5, rtol=3e-5):
            raise ValueError("Frozen quality readout does not reproduce captured logits.")
        if n and not torch.equal(replay.argmax(1), capture.quality_logits.argmax(1)):
            raise ValueError("Frozen quality readout changes the captured argmax.")
        maximum = float((replay-capture.quality_logits).abs().max()) if n else 0.
    return {"frames": n, "readoutReplayMaxAbs": maximum}


class RealizationVocabulary:
    """Cached full Cartesian semantics using the maintained mapper, never labels.

    ``parse`` is rnbert.mapper()[0]: (display_roman, predicted_key) -> {core: PCs}.
    Exceptions are explicit unsupported outcomes, counted by reason. No mass is
    dropped and no chord root is inferred from these surface membership tables.
    """
    def __init__(self, vocabularies, parse: Callable):
        if not callable(parse):
            raise ValueError("A verified semantic mapper is required.")
        self.vocabularies = _vocabularies(vocabularies)
        self.parse = parse
        self.tables = {}

    def matrix(self, key):
        if key not in self.tables:
            degrees, qualities = self.vocabularies["degree"], self.vocabularies["quality"]
            values = np.zeros((len(degrees)*len(qualities), 12), dtype=np.float64)
            unknown = np.zeros(len(values), dtype=np.float64)
            reasons = {}
            for d, degree in enumerate(degrees):
                for q, quality in enumerate(qualities):
                    index = d*len(qualities)+q
                    try:
                        if key is None:
                            raise ValueError("Missing predicted key")
                        primary, secondary = get_degree(degree)
                        rn = primary+get_quality(quality)+get_inversion("0.0", quality)+secondary
                        core = self.parse(rn, key)["core"]
                        if not core or len(set(core)) != len(core) or any(type(p) is not int or not 0 <= p < 12 for p in core):
                            raise ValueError("Mapper core must be a nonempty unique 12TET pitch-class collection")
                        values[index, core] = 1
                    except Exception as error:
                        reason = f"{type(error).__name__}: {error}"
                        reasons[reason] = reasons.get(reason, 0)+1
                        unknown[index] = 1
                        values[index] = .5
            values.setflags(write=False); unknown.setflags(write=False)
            self.tables[key] = values, unknown, reasons
        return self.tables[key]


@contextmanager
def _fixed_cpu():
    threads = torch.get_num_threads()
    deterministic = torch.are_deterministic_algorithms_enabled()
    warn_only = torch.is_deterministic_algorithms_warn_only_enabled()
    try:
        torch.set_num_threads(PROTOCOL["threads"])
        torch.use_deterministic_algorithms(True)
        with torch.random.fork_rng(devices=[]):
            torch.random.default_generator.manual_seed(PROTOCOL["seed"])
            yield
    finally:
        torch.use_deterministic_algorithms(deterministic, warn_only=warn_only)
        torch.set_num_threads(threads)


def fit_quality_readout(examples, *, semantics, readout_weight, readout_bias):
    """Fit one shared correction; examples contain training references only.

    Corpus/split/hash admission belongs to the caller. Unsupported references and
    unrepresentable cores are separately counted; this is not an evaluation mask.
    Reference and capture PPQs may differ, but all overlap arithmetic is exact.
    """
    examples = tuple(examples)
    if not examples:
        raise ValueError("At least one training example is required.")
    ppqs = []
    for example in examples:
        ppqs.extend((_integer(example.capture.ppq, "Capture PPQ", 1), _integer(example.reference_ppq, "Reference PPQ", 1)))
        if type(example.semitone_shift) is not int:
            raise ValueError("Transposition must be an integer semitone shift.")
    timebase = lcm(*ppqs)
    if timebase > 2**53-1:
        raise ValueError("Common exact training timebase exceeds the safe coordinate range.")
    with _fixed_cpu():
        features, initial, coefficients, weights, accounting = [], [], [], [], []
        for example in examples:
            capture = example.capture
            if _vocabularies(capture.vocabularies) != semantics.vocabularies:
                raise ValueError("All captures must use the same ordered vocabulary.")
            replay = validate_capture(capture, readout_weight, readout_bias)
            degree = capture.degree_logits.double().softmax(-1).numpy()
            frame_scale, reference_scale = timebase//capture.ppq, timebase//example.reference_ppq
            stats = dict(referenceTicks=0, unsupportedReferenceTicks=0, representedObservedTicks=0,
                         unrepresentableObservedTicks=0, zeroFrozenProbabilityTicks=0, **replay)
            previous = 0
            for ref in example.references:
                start = _integer(ref.start_tick, "Reference start")*reference_scale
                end = _integer(ref.end_tick, "Reference end")*reference_scale
                if start < previous or end <= start:
                    raise ValueError("Reference spans must be ordered, disjoint and positive.")
                previous = end
                if ref.core_pitch_classes is None:
                    stats["unsupportedReferenceTicks"] += end-start
                    continue
                core = tuple(ref.core_pitch_classes)
                if not core or len(set(core)) != len(core) or any(type(p) is not int or not 0 <= p < 12 for p in core):
                    raise ValueError("Reference core must contain unique 12TET pitch classes.")
                stats["referenceTicks"] += end-start
                target = np.zeros(12)
                target[[(p+example.semitone_shift)%12 for p in core]] = 1
                for i, frame in enumerate(capture.frames):
                    ticks = max(0, min(end, frame["endTick"]*frame_scale)-max(start, frame["startTick"]*frame_scale))
                    if not ticks:
                        continue
                    values, unknown, _ = semantics.matrix(frame["key"])
                    match = (np.all(values == target, axis=1) & (unknown == 0)).reshape(len(semantics.vocabularies["degree"]), -1)
                    if not match.any():
                        stats["unrepresentableObservedTicks"] += ticks
                        continue
                    coefficient = degree[i] @ match
                    if coefficient.sum() == 0:
                        stats["zeroFrozenProbabilityTicks"] += ticks
                        continue
                    stats["representedObservedTicks"] += ticks
                    features.append(capture.quality_features[i]); initial.append(capture.quality_logits[i])
                    coefficients.append(coefficient); weights.append(ticks)
            stats["unobservedTicks"] = stats["referenceTicks"]-stats["representedObservedTicks"]-stats["unrepresentableObservedTicks"]-stats["zeroFrozenProbabilityTicks"]
            accounting.append(stats)
        if not weights:
            raise ValueError("No representable, observed training duration remains.")
        x, initial = torch.stack(features), torch.stack(initial)
        coefficients = np.array(coefficients)
        with np.errstate(divide="ignore"):
            log_coefficient = torch.tensor(np.log(coefficients), dtype=torch.float32)
        mass = torch.tensor(weights, dtype=torch.float32); mass /= mass.sum()
        if not torch.isfinite(mass).all() or mass.sum() <= 0:
            raise ValueError("Training duration exceeds numerical weight capacity.")
        count = len(semantics.vocabularies["quality"])
        delta_weight = torch.nn.Parameter(torch.zeros(count, 1024))
        delta_bias = torch.nn.Parameter(torch.zeros(count))
        optimizer = torch.optim.Adam([delta_weight, delta_bias], lr=PROTOCOL["learningRate"])
        trace = []
        for step in range(PROTOCOL["steps"]):
            optimizer.zero_grad()
            z = initial+x@delta_weight.T+delta_bias
            nll = ((torch.logsumexp(z, 1)-torch.logsumexp(z+log_coefficient, 1))*mass).sum()
            loss = nll+.5*PROTOCOL["l2Sum"]*(delta_weight.square().sum()+delta_bias.square().sum())
            if not torch.isfinite(loss):
                raise ValueError("Quality-readout objective became nonfinite.")
            loss.backward(); optimizer.step()
            if step in (0, 49, 99, 199):
                trace.append({"step": step+1, "marginalNll": float(nll.detach()), "loss": float(loss.detach())})
        return QualityFit(delta_weight.detach(), delta_bias.detach(), dict(semantics.vocabularies), timebase, accounting, trace)


def apply_quality_readout(capture, fit):
    """Return a quality-only override for rnbert_decode.decode_coherent."""
    with _fixed_cpu(), torch.no_grad():
        validate_capture(capture)
        if _vocabularies(capture.vocabularies) != fit.vocabularies:
            raise ValueError("Correction vocabulary differs from the capture column order.")
        q = len(fit.vocabularies["quality"])
        _tensor(fit.delta_weight, (q, 1024), "delta_weight"); _tensor(fit.delta_bias, (q,), "delta_bias")
        return capture.quality_logits+capture.quality_features@fit.delta_weight.T+fit.delta_bias


def membership_marginals(capture, quality_logits, *, semantics):
    """Full independent-head surface marginals; retain unsupported mass explicitly."""
    validate_capture(capture)
    if _vocabularies(capture.vocabularies) != semantics.vocabularies:
        raise ValueError("Semantic vocabulary differs from capture columns.")
    _tensor(quality_logits, tuple(capture.quality_logits.shape), "quality override")
    degree = capture.degree_logits.double().softmax(-1).numpy()
    quality = quality_logits.double().softmax(-1).numpy()
    absolute = np.empty((len(capture.frames), 12)); unknown_mass = np.empty(len(capture.frames))
    for key in dict.fromkeys(f["key"] for f in capture.frames):
        indices = np.array([i for i, f in enumerate(capture.frames) if f["key"] == key])
        values, unknown, _ = semantics.matrix(key)
        joint = (degree[indices, :, None]*quality[indices, None, :]).reshape(len(indices), -1)
        if not np.allclose(joint.sum(1), 1, atol=1e-12):
            raise ValueError("Head probability mass is not normalized.")
        absolute[indices] = joint@values; unknown_mass[indices] = joint@unknown
    return {"absoluteMembership": absolute, "unknownMass": unknown_mass}
