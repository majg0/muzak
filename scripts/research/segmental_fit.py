"""Offline calibration of the Rust segmental model's four sufficient statistics.

The caller supplies an admitted training-only native objective. This module owns
only optimization: no corpus selection, musical scoring, labels, or file I/O.
"""
from dataclasses import asdict, dataclass
import math
from typing import Callable, Sequence

import torch


PARAMETERS = ("matchedQuarterDuration", "extraneousQuarterDuration", "cardinality", "cutCost")


@dataclass(frozen=True)
class FitOptions:
    max_iterations: int = 100
    max_evaluations: int = 150
    tolerance_grad: float = 1e-7
    tolerance_change: float = 1e-12
    l2_sum: float = .01

    def validate(self):
        for value in (self.max_iterations, self.max_evaluations):
            if type(value) is not int or value < 1:
                raise ValueError("Optimizer budgets must be positive integers.")
        for value in (self.tolerance_grad, self.tolerance_change, self.l2_sum):
            if not math.isfinite(value) or value < 0:
                raise ValueError("Optimizer tolerances and regularization must be finite and nonnegative.")


def fit(solve: Callable[[list[float]], Sequence[dict]], admitted_quarters: float,
        options: FitOptions = FitOptions()) -> dict:
    """Fit one zero-initialized model; solve returns ordered native loss/gradient rows.

    Each row is the full minus compatible path log partition and its gradient.
    Normalize by admitted training duration, not the number of source cells or
    segments. Missing supervision must remain unconstrained in the native input.
    Zero is a neutral segmental prior, not a bypass of an existing predictor.
    """
    options.validate()
    if not math.isfinite(admitted_quarters) or admitted_quarters <= 0:
        raise ValueError("Admitted duration must be finite and positive.")
    parameters = torch.zeros(len(PARAMETERS), dtype=torch.float64, requires_grad=True)
    identities = None

    def evaluate():
        nonlocal identities
        rows = list(solve(parameters.detach().tolist()))
        current = tuple(row["id"] for row in rows)
        if not current or len(set(current)) != len(current):
            raise ValueError("Native queries must have unique identities.")
        if identities is None:
            identities = current
        elif current != identities:
            raise ValueError("Native query order/identity changed during optimization.")
        for row in rows:
            if (not math.isfinite(row["loss"]) or row["loss"] < -1e-8
                    or len(row["gradient"]) != len(PARAMETERS)
                    or not all(map(math.isfinite, row["gradient"]))):
                raise ValueError(f"Invalid native objective for {row['id']}.")
        loss = math.fsum(row["loss"] for row in rows) / admitted_quarters
        gradient = torch.tensor([
            math.fsum(row["gradient"][j] for row in rows) / admitted_quarters
            for j in range(len(PARAMETERS))
        ], dtype=torch.float64)
        loss += .5 * options.l2_sum * float(parameters.detach().square().sum())
        gradient += options.l2_sum * parameters.detach()
        if not math.isfinite(loss) or not torch.isfinite(gradient).all():
            raise ValueError("Nonfinite normalized objective or gradient.")
        return loss, gradient, rows

    initial, initial_gradient, initial_rows = evaluate()
    optimizer = torch.optim.LBFGS(
        [parameters], max_iter=options.max_iterations, max_eval=options.max_evaluations,
        tolerance_grad=options.tolerance_grad, tolerance_change=options.tolerance_change,
        line_search_fn="strong_wolfe")
    calls = 0

    def closure():
        nonlocal calls
        if calls >= options.max_evaluations:
            raise RuntimeError("Optimizer evaluation budget exhausted; no selected model.")
        value, gradient, _ = evaluate()
        parameters.grad = gradient
        calls += 1
        return torch.tensor(value, dtype=torch.float64)

    optimizer.step(closure)
    final, gradient, final_rows = evaluate()
    if not torch.isfinite(parameters).all():
        raise ValueError("Nonfinite selected model.")
    state = optimizer.state[parameters]
    norm = float(gradient.abs().max())
    return {
        "parameters": parameters.detach().tolist(), "parameterNames": list(PARAMETERS),
        "options": asdict(options), "initialObjective": initial,
        "initialGradient": initial_gradient.tolist(), "finalObjective": final,
        "gradient": gradient.tolist(), "gradientInfNorm": norm,
        "gradientToleranceMet": norm <= options.tolerance_grad,
        "optimizer": {"iterations": state["n_iter"], "functionEvaluations": state["func_evals"],
                      "closureCalls": calls},
        "initialQueries": initial_rows, "finalQueries": final_rows,
    }
