"""Summarize and rank candidate light curves from CSV files."""

import argparse
import csv
import json
import math
from statistics import median
from typing import Mapping, Sequence


def summarize_light_curve(rows: Sequence[Mapping[str, str]]) -> dict[str, object]:
    """Return basic features for rows containing mjd, band, and mag columns."""
    if not rows:
        raise ValueError("Light curve must contain at least one observation")

    observations: list[tuple[float, str, float]] = []
    for row_number, row in enumerate(rows, start=2):
        try:
            mjd_value = row["mjd"]
            band_value = row["band"]
            mag_value = row["mag"]
            if not all(isinstance(value, str) for value in (mjd_value, band_value, mag_value)):
                raise TypeError("CSV values must be text")
            mjd = float(mjd_value.strip())
            band = band_value.strip().lower()
            mag = float(mag_value.strip())
        except (KeyError, TypeError, ValueError) as error:
            raise ValueError(f"Invalid or missing value on CSV row {row_number}") from error

        if not math.isfinite(mjd) or not math.isfinite(mag) or not band:
            raise ValueError(f"Invalid or missing value on CSV row {row_number}")
        observations.append((mjd, band, mag))

    times = [observation[0] for observation in observations]
    magnitudes = [observation[2] for observation in observations]
    return {
        "observation_count": len(observations),
        "duration_days": max(times) - min(times),
        "bands": sorted({observation[1] for observation in observations}),
        "median_magnitude": median(magnitudes),
        "amplitude_magnitude": max(magnitudes) - min(magnitudes),
    }


def score_supernova_shape(rows: Sequence[Mapping[str, str]]) -> dict[str, object]:
    """Score whether one band's sampled light curve shows a rise and a decline.

    This is an unvalidated shape heuristic, not a supernova probability.
    """
    summarize_light_curve(rows)  # Reuse the input validation and empty-curve check.

    epochs_by_band: dict[str, dict[float, list[float]]] = {}
    for row in rows:
        mjd = float(row["mjd"].strip())
        band = row["band"].strip().lower()
        mag = float(row["mag"].strip())
        epochs_by_band.setdefault(band, {}).setdefault(mjd, []).append(mag)

    band, epoch_measurements = min(
        epochs_by_band.items(),
        key=lambda item: (-len(item[1]), item[0]),
    )
    epochs = [
        (mjd, median(magnitudes))
        for mjd, magnitudes in sorted(epoch_measurements.items())
    ]
    peak_index = min(range(len(epochs)), key=lambda index: epochs[index][1])
    before_peak = epochs[:peak_index]
    after_peak = epochs[peak_index + 1 :]

    result: dict[str, object] = {
        "band": band,
        "epoch_count": len(epochs),
        "shape_score": None,
        "status": "insufficient_data",
        "explanation": "Need at least two distinct epochs before and after the brightest point in one band.",
    }
    if len(before_peak) < 2 or len(after_peak) < 2:
        return result

    def slope(points: Sequence[tuple[float, float]]) -> float:
        mean_time = sum(point[0] for point in points) / len(points)
        mean_mag = sum(point[1] for point in points) / len(points)
        numerator = sum(
            (time - mean_time) * (mag - mean_mag) for time, mag in points
        )
        denominator = sum((time - mean_time) ** 2 for time, _ in points)
        return numerator / denominator

    rise_rate = slope(before_peak + [epochs[peak_index]])
    decline_rate = slope([epochs[peak_index]] + after_peak)
    score = 50 * int(rise_rate < 0) + 50 * int(decline_rate > 0)
    result.update(
        {
            "shape_score": score,
            "status": "scored",
            "peak_mjd": epochs[peak_index][0],
            "rise_rate_mag_per_day": rise_rate,
            "decline_rate_mag_per_day": decline_rate,
            "explanation": (
                "Both a pre-peak brightening trend and a post-peak fading trend are present."
                if score == 100
                else "The sampled curve does not show both the expected rise and decline trends."
            ),
        }
    )
    return result


def read_csv(csv_file_path: str) -> list[dict[str, str]]:
    with open(csv_file_path, newline="", encoding="utf-8") as csv_file:
        return list(csv.DictReader(csv_file))


def evaluate_rankings(
    rows: Sequence[Mapping[str, str]],
    test_fraction: float = 0.3,
    precision_at: int = 10,
) -> dict[str, object]:
    """Compare shape and broker rankings on the latest chronological holdout."""
    if not 0 < test_fraction < 1:
        raise ValueError("test_fraction must be between 0 and 1")
    if precision_at < 1:
        raise ValueError("precision_at must be at least 1")
    if len(rows) < 3:
        raise ValueError("At least three labeled candidates are required")

    candidates: list[dict[str, object]] = []
    seen_ids: set[str] = set()
    for row_number, row in enumerate(rows, start=2):
        try:
            candidate_id = row["candidate_id"].strip()
            discovery_mjd = float(row["discovery_mjd"].strip())
            label_value = row["is_supernova"].strip().lower()
            shape_score = float(row["shape_score"].strip())
            broker_score = float(row["broker_anomaly_score"].strip())
        except (KeyError, AttributeError, TypeError, ValueError) as error:
            raise ValueError(
                f"Invalid or missing value on evaluation CSV row {row_number}"
            ) from error

        if (
            not candidate_id
            or candidate_id in seen_ids
            or label_value not in {"0", "1", "false", "true"}
            or not all(
                math.isfinite(value)
                for value in (discovery_mjd, shape_score, broker_score)
            )
        ):
            raise ValueError(f"Invalid or duplicate candidate on CSV row {row_number}")
        seen_ids.add(candidate_id)
        candidates.append(
            {
                "candidate_id": candidate_id,
                "discovery_mjd": discovery_mjd,
                "is_supernova": label_value in {"1", "true"},
                "shape_score": shape_score,
                "broker_anomaly_score": broker_score,
            }
        )

    ordered_dates = sorted(candidate["discovery_mjd"] for candidate in candidates)
    train_count = min(
        len(candidates) - 1,
        max(1, math.floor(len(candidates) * (1 - test_fraction))),
    )
    cutoff_mjd = ordered_dates[train_count]
    holdout = [
        candidate
        for candidate in candidates
        if candidate["discovery_mjd"] >= cutoff_mjd
    ]
    positives = sum(bool(candidate["is_supernova"]) for candidate in holdout)
    if positives == 0 or positives == len(holdout):
        raise ValueError(
            "Chronological holdout must contain both supernova and non-supernova labels"
        )

    def ranking_metrics(score_field: str) -> dict[str, float]:
        ranked = sorted(
            holdout,
            key=lambda candidate: (
                -float(candidate[score_field]),
                str(candidate["candidate_id"]),
            ),
        )
        top_k = ranked[: min(precision_at, len(ranked))]
        precision = sum(bool(candidate["is_supernova"]) for candidate in top_k) / len(
            top_k
        )
        relevant_seen = 0
        precision_sum = 0.0
        for rank, candidate in enumerate(ranked, start=1):
            if candidate["is_supernova"]:
                relevant_seen += 1
                precision_sum += relevant_seen / rank
        average_precision = precision_sum / positives
        return {
            f"precision_at_{precision_at}": precision,
            "average_precision": average_precision,
        }

    return {
        "split": "chronological",
        "holdout_start_mjd": cutoff_mjd,
        "candidate_count": len(candidates),
        "holdout_candidate_count": len(holdout),
        "holdout_supernova_count": positives,
        "metrics": {
            "shape_heuristic": ranking_metrics("shape_score"),
            "broker_anomaly_score": ranking_metrics("broker_anomaly_score"),
        },
        "limitations": (
            "Metrics are valid only if labels are independently curated and each "
            "score was computed using information available at the candidate's "
            "evaluation time. They are not meaningful for synthetic data."
        ),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "csv_files",
        nargs="*",
        help="CSV file(s) with mjd, band, and mag columns",
    )
    parser.add_argument(
        "--rank-supernova-shape",
        action="store_true",
        help="rank files by an unvalidated rise-and-decline shape heuristic",
    )
    parser.add_argument(
        "--evaluate-rankings",
        metavar="CSV",
        help=(
            "compare shape_score and broker_anomaly_score on a chronological "
            "labeled holdout CSV"
        ),
    )
    parser.add_argument(
        "--test-fraction",
        type=float,
        default=0.3,
        help="fraction of chronologically latest candidates used for evaluation (default: 0.3)",
    )
    parser.add_argument(
        "--precision-at",
        type=int,
        default=10,
        help="K for precision@K (default: 10)",
    )
    args = parser.parse_args()

    if args.evaluate_rankings:
        if args.rank_supernova_shape or args.csv_files:
            parser.error("--evaluate-rankings cannot be combined with light-curve files")
        try:
            result = evaluate_rankings(
                read_csv(args.evaluate_rankings),
                test_fraction=args.test_fraction,
                precision_at=args.precision_at,
            )
        except ValueError as error:
            parser.error(str(error))
        print(json.dumps(result, indent=2))
        return

    if args.rank_supernova_shape:
        if not args.csv_files:
            parser.error("provide at least one light-curve CSV file")
        candidates = [
            {
                "candidate": csv_file.rsplit("/", 1)[-1].rsplit(".", 1)[0],
                **score_supernova_shape(read_csv(csv_file)),
            }
            for csv_file in args.csv_files
        ]
        candidates.sort(
            key=lambda candidate: (
                candidate["shape_score"] is None,
                -(candidate["shape_score"] or 0),
                candidate["candidate"],
            )
        )
        print(json.dumps(candidates, indent=2))
        return

    if len(args.csv_files) != 1:
        parser.error("provide one CSV file unless --rank-supernova-shape is used")
    print(json.dumps(summarize_light_curve(read_csv(args.csv_files[0])), indent=2))


if __name__ == "__main__":
    main()
