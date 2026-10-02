"""CPU synthetic controls; no corpus, model weights, network, or artifact I/O.

Run with the isolated research Python: ``python scripts/research/test_rnbert.py``.
"""
from dataclasses import replace
import sys
import unittest

import numpy as np
import torch

import rnbert_decode as decoder
import rnbert_readout as readout


def synthetic_parse(rn, key):
    """Two explicit sonorities, with degree aliases and an unknown quality."""
    if key is None or "x" in rn:
        raise ValueError("Explicit unknown synthetic outcome")
    shift = 2 if key == "D" else 0
    return {"core": [(p + shift) % 12 for p in (0, 3 if "m" in rn else 4, 7)]}


class ResearchControls(unittest.TestCase):
    def setUp(self):
        self.vocab = {"degree": ["_I_I", "_V_I"], "quality": ["M", "m"]}
        features = torch.zeros(1, 1024)
        features[0, :2] = torch.tensor([.5, -.25])
        self.capture = readout.QualityCapture(
            [{"startTick": 0, "endTick": 8, "key": "C"}], 4,
            features, torch.tensor([[.2, -.3]]), torch.zeros(1, 2), self.vocab)
        self.weight, self.bias = torch.zeros(2, 1024), torch.zeros(2)
        self.semantics = readout.RealizationVocabulary(self.vocab, synthetic_parse)
        self.references = [readout.CoreReference(0, 9, (0, 4, 7)),
                           readout.CoreReference(9, 12, (0, 3, 7))]

    def fit(self, capture=None, references=None, ppq=6, shift=0):
        example = readout.QualityTrainingExample(
            self.capture if capture is None else capture,
            self.references if references is None else references, ppq, shift)
        return readout.fit_quality_readout(
            [example], semantics=self.semantics, readout_weight=self.weight, readout_bias=self.bias)

    def test_exact_decoder_against_exhaustive_search(self):
        result = decoder.self_test()
        self.assertEqual(result["exhaustiveDpCases"], 200)
        self.assertEqual(result["rejections"], 3)

    def test_alias_probability_and_unknown_mass_are_retained(self):
        result = readout.membership_marginals(self.capture, self.capture.quality_logits, semantics=self.semantics)
        np.testing.assert_allclose(result["absoluteMembership"][0], [1, 0, 0, .5, .5, 0, 0, 1, 0, 0, 0, 0])
        np.testing.assert_allclose(result["unknownMass"], 0)
        missing = replace(self.capture, frames=[{"startTick": 0, "endTick": 8, "key": None}])
        result = readout.membership_marginals(missing, missing.quality_logits, semantics=self.semantics)
        np.testing.assert_allclose(result["absoluteMembership"], .5)
        np.testing.assert_allclose(result["unknownMass"], 1)
        mixed = replace(self.capture, vocabularies={**self.vocab, "quality": ["M", "x"]})
        semantics = readout.RealizationVocabulary(mixed.vocabularies, synthetic_parse)
        result = readout.membership_marginals(mixed, mixed.quality_logits, semantics=semantics)
        np.testing.assert_allclose(result["absoluteMembership"][0], [.75, .25, .25, .25, .75, .25, .25, .75, .25, .25, .25, .25])
        np.testing.assert_allclose(result["unknownMass"], .5)

    def test_exact_timebase_and_transposition_preserve_fit(self):
        fit = self.fit()
        self.assertEqual(fit.timebase, 12)
        self.assertEqual(fit.accounting[0]["representedObservedTicks"], 24)
        self.assertGreater(fit.delta_bias[0], fit.delta_bias[1])  # Major occupies 3/4 of the training duration.
        scaled = replace(self.capture, ppq=8, frames=[{"startTick": 0, "endTick": 16, "key": "C"}])
        references = [replace(r, start_tick=r.start_tick * 2, end_tick=r.end_tick * 2) for r in self.references]
        shifted = replace(self.capture, frames=[{"startTick": 0, "endTick": 8, "key": "D"}])
        for other in (self.fit(scaled, references, 12), self.fit(shifted, shift=2)):
            self.assertTrue(torch.equal(fit.delta_weight, other.delta_weight))
            self.assertTrue(torch.equal(fit.delta_bias, other.delta_bias))
            self.assertEqual(fit.loss_trace, other.loss_trace)

    def test_frozen_head_inputs_and_runtime_state_stay_unchanged(self):
        tensors = (self.capture.quality_features, self.capture.degree_logits,
                   self.capture.quality_logits, self.weight, self.bias)
        originals = [value.clone() for value in tensors]
        rng, threads = torch.get_rng_state().clone(), torch.get_num_threads()
        deterministic = torch.are_deterministic_algorithms_enabled()
        fit = self.fit()
        override = readout.apply_quality_readout(self.capture, fit)
        self.assertFalse(torch.equal(override, self.capture.quality_logits))
        self.assertTrue(all(torch.equal(a, b) for a, b in zip(tensors, originals)))
        self.assertTrue(torch.equal(rng, torch.get_rng_state()))
        self.assertEqual(threads, torch.get_num_threads())
        self.assertEqual(deterministic, torch.are_deterministic_algorithms_enabled())
        with self.assertRaisesRegex(ValueError, "reproduce"):
            readout.validate_capture(self.capture, self.weight, torch.ones(2))
        with self.assertRaisesRegex(ValueError, "vocabulary"):
            readout.apply_quality_readout(replace(self.capture, vocabularies={**self.vocab, "quality": ["m", "M"]}), fit)

    def test_invalid_geometry_and_overlapping_references_reject(self):
        with self.assertRaises(ValueError):
            readout.validate_capture(replace(self.capture, frames=[{"startTick": 3, "endTick": 3, "key": "C"}]))
        with self.assertRaises(ValueError):
            self.fit(references=[readout.CoreReference(0, 3, (0, 4, 7)),
                                 readout.CoreReference(2, 4, (0, 3, 7))], ppq=4)
        with self.assertRaisesRegex(ValueError, "detached"):
            readout.validate_capture(replace(self.capture, quality_features=self.capture.quality_features.clone().requires_grad_()))

    def test_unsupported_reference_mass_is_separate(self):
        fit = self.fit(references=[readout.CoreReference(0, 4, None),
                                   readout.CoreReference(4, 8, (0, 4, 7))], ppq=4)
        accounting = fit.accounting[0]
        self.assertEqual(accounting["unsupportedReferenceTicks"], 4)
        self.assertEqual(accounting["referenceTicks"], 4)
        self.assertEqual(accounting["representedObservedTicks"], 4)
        self.assertEqual(accounting["unobservedTicks"], 0)


def run_tests(verbosity=1):
    suite = unittest.defaultTestLoader.loadTestsFromModule(sys.modules[__name__])
    result = unittest.TextTestRunner(verbosity=verbosity).run(suite)
    if not result.wasSuccessful():
        raise RuntimeError("Synthetic research controls failed.")
    return result.testsRun


if __name__ == "__main__":
    run_tests(verbosity=2)
