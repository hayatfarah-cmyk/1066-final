"""Summarize one object's light curve from a CSV file."""

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
            mjd = float(row["mjd"])
            band = row["band"].strip()
            mag = float(row["mag"])
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


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("csv_file", help="CSV with mjd, band, and mag columns")
    args = parser.parse_args()

    with open(args.csv_file, newline="", encoding="utf-8") as csv_file:
        rows = list(csv.DictReader(csv_file))
    print(json.dumps(summarize_light_curve(rows), indent=2))


if __name__ == "__main__":
    main()
