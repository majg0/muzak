"""Calibrate two frozen core distributions; no music, corpus, or label loading.

Feature rows are admitted externally. A sigmoid chooses the mixture weight,
not the probability that an executable relationship is musically correct.
"""
import torch

from segmental_fit import FitOptions


def mix(base, relation, features, parameters):
    """Preserve identical expert columns and tiny positive baseline mass."""
    z = (features @ parameters[:-1] + parameters[-1])[:, None]
    value = (-z).sigmoid() * base + z.sigmoid() * relation
    return torch.where(base == relation, base, value)


def objective(parameters, features, base_target, relation_target, weights, l2_sum):
    z = features @ parameters[:-1] + parameters[-1]
    logp = torch.logaddexp(torch.nn.functional.logsigmoid(-z) + base_target.log(),
                         torch.nn.functional.logsigmoid(z) + relation_target.log())
    return -(weights * logp).sum() + .5 * l2_sum * parameters.square().sum()


def fit(features, base_target, relation_target, weights, options: FitOptions = FitOptions()):
    """One fixed fit over representable training overlaps, starting at .5/.5.

    Both-zero targets are inadmissible here. The caller must account for them
    separately; excluding a row from calibration never changes strict evaluation.
    """
    options.validate()
    if (features.ndim != 2 or features.shape[0] == 0
            or base_target.shape != relation_target.shape or base_target.shape != weights.shape
            or weights.shape != features.shape[:1]):
        raise ValueError("Training feature/target/weight shapes differ.")
    if any(t.dtype != torch.float64 or t.device.type != "cpu" or t.requires_grad
           or not torch.isfinite(t).all() for t in (features, base_target, relation_target, weights)):
        raise ValueError("Training inputs must be detached finite CPU float64 tensors.")
    if ((weights <= 0).any() or (base_target < 0).any() or (relation_target < 0).any()
            or (base_target > 1).any() or (relation_target > 1).any()
            or ((base_target + relation_target) <= 0).any()):
        raise ValueError("Invalid probabilities, duration weights, or unrepresentable target.")
    weights = weights / weights.sum()
    parameters = torch.nn.Parameter(torch.zeros(features.shape[1] + 1, dtype=torch.float64))
    optimizer = torch.optim.LBFGS(
        [parameters], max_iter=options.max_iterations, max_eval=options.max_evaluations,
        tolerance_grad=options.tolerance_grad, tolerance_change=options.tolerance_change,
        line_search_fn="strong_wolfe")
    trace = []

    def closure():
        if len(trace) >= options.max_evaluations:
            raise RuntimeError("Optimizer evaluation budget exhausted; no selected model.")
        optimizer.zero_grad()
        loss = objective(parameters, features, base_target, relation_target, weights, options.l2_sum)
        if not torch.isfinite(loss):
            raise ValueError("Nonfinite surface likelihood.")
        loss.backward()
        if not torch.isfinite(parameters.grad).all():
            raise ValueError("Nonfinite surface gradient.")
        trace.append({"objective": float(loss.detach()),
                      "gradientInfNorm": float(parameters.grad.abs().max())})
        return loss

    optimizer.step(closure)
    closure()
    return parameters.detach(), {
        "trace": trace, "iterations": optimizer.state[parameters]["n_iter"],
        "gradientToleranceMet": trace[-1]["gradientInfNorm"] <= options.tolerance_grad,
    }
