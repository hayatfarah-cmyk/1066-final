import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from prototype.lightcurve_summary import (
    evaluate_rankings,
    score_supernova_shape,
    summarize_light_curve,
)


class SummarizeLightCurveTests(unittest.TestCase):
    def test_command_line_reads_csv_and_prints_json(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            csv_path = Path(temporary_directory) / "light_curve.csv"
            csv_path.write_text(
                "mjd,band,mag\n60000,g,20\n60002,g,18\n",
                encoding="utf-8",
            )
            result = subprocess.run(
                [sys.executable, "prototype/lightcurve_summary.py", str(csv_path)],
                capture_output=True,
                check=True,
                text=True,
            )

        self.assertEqual(
            json.loads(result.stdout),
            {
                "observation_count": 2,
                "duration_days": 2.0,
                "bands": ["g"],
                "median_magnitude": 19.0,
                "amplitude_magnitude": 2.0,
            },
        )

    def test_calculates_features_for_valid_observations(self):
        rows = [
            {"mjd": "60002", "band": "g", "mag": "19.0"},
            {"mjd": "60000", "band": "r", "mag": "20.0"},
            {"mjd": "60001", "band": "g", "mag": "18.0"},
        ]

        self.assertEqual(
            summarize_light_curve(rows),
            {
                "observation_count": 3,
                "duration_days": 2.0,
                "bands": ["g", "r"],
                "median_magnitude": 19.0,
                "amplitude_magnitude": 2.0,
            },
        )

    def test_rejects_empty_light_curve(self):
        with self.assertRaisesRegex(ValueError, "at least one observation"):
            summarize_light_curve([])

    def test_rejects_invalid_measurement_with_row_number(self):
        rows = [{"mjd": "60000", "band": "g", "mag": "not-a-number"}]

        with self.assertRaisesRegex(ValueError, "CSV row 2"):
            summarize_light_curve(rows)

    def test_scores_rising_and_fading_curve(self):
        rows = [
            {"mjd": str(60000 + day), "band": "g", "mag": magnitude}
            for day, magnitude in enumerate(["20.0", "19.2", "18.5", "18.0", "18.3", "18.8", "19.4"])
        ]

        result = score_supernova_shape(rows)

        self.assertEqual(result["shape_score"], 100)
        self.assertEqual(result["status"], "scored")
        self.assertEqual(result["peak_mjd"], 60003.0)
        self.assertLess(result["rise_rate_mag_per_day"], 0)
        self.assertGreater(result["decline_rate_mag_per_day"], 0)

    def test_marks_curve_without_coverage_as_insufficient(self):
        rows = [
            {"mjd": "60000", "band": "g", "mag": "20.0"},
            {"mjd": "60001", "band": "g", "mag": "19.0"},
            {"mjd": "60002", "band": "g", "mag": "18.0"},
        ]

        result = score_supernova_shape(rows)

        self.assertIsNone(result["shape_score"])
        self.assertEqual(result["status"], "insufficient_data")

    def test_rank_command_orders_candidates_by_shape_score(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            rising_and_fading_path = Path(temporary_directory) / "sn_like.csv"
            rising_and_fading_path.write_text(
                "mjd,band,mag\n"
                "60000,g,20.0\n60001,g,19.2\n60002,g,18.5\n"
                "60003,g,18.0\n60004,g,18.3\n60005,g,18.8\n60006,g,19.4\n",
                encoding="utf-8",
            )
            short_curve_path = Path(temporary_directory) / "short.csv"
            short_curve_path.write_text(
                "mjd,band,mag\n60000,g,20\n60001,g,19\n60002,g,18\n",
                encoding="utf-8",
            )

            result = subprocess.run(
                [
                    sys.executable,
                    "prototype/lightcurve_summary.py",
                    "--rank-supernova-shape",
                    str(short_curve_path),
                    str(rising_and_fading_path),
                ],
                capture_output=True,
                check=True,
                text=True,
            )

        ranked = json.loads(result.stdout)
        self.assertEqual([item["candidate"] for item in ranked], ["sn_like", "short"])
        self.assertEqual(ranked[0]["shape_score"], 100)
        self.assertIsNone(ranked[1]["shape_score"])

    def test_evaluates_both_rankings_on_latest_date_holdout(self):
        rows = [
            {
                "candidate_id": f"candidate-{index}",
                "discovery_mjd": str(60000 + index),
                "is_supernova": str(index in {0, 3, 7, 9}).lower(),
                "shape_score": str(index),
                "broker_anomaly_score": str(10 - index),
            }
            for index in range(10)
        ]

        result = evaluate_rankings(rows, test_fraction=0.3, precision_at=2)

        self.assertEqual(result["holdout_start_mjd"], 60007)
        self.assertEqual(result["holdout_candidate_count"], 3)
        self.assertEqual(result["holdout_supernova_count"], 2)
        metrics = result["metrics"]
        self.assertEqual(metrics["shape_heuristic"]["precision_at_2"], 0.5)
        self.assertAlmostEqual(
            metrics["shape_heuristic"]["average_precision"], 0.8333333333
        )
        self.assertEqual(metrics["broker_anomaly_score"]["precision_at_2"], 0.5)
        self.assertAlmostEqual(
            metrics["broker_anomaly_score"]["average_precision"], 0.8333333333
        )

    def test_evaluation_requires_both_classes_in_holdout(self):
        rows = [
            {
                "candidate_id": f"candidate-{index}",
                "discovery_mjd": str(60000 + index),
                "is_supernova": "false",
                "shape_score": "50",
                "broker_anomaly_score": "0.5",
            }
            for index in range(5)
        ]

        with self.assertRaisesRegex(ValueError, "both supernova and non-supernova"):
            evaluate_rankings(rows)

    def test_evaluation_command_prints_metrics(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            csv_path = Path(temporary_directory) / "labels.csv"
            csv_path.write_text(
                "candidate_id,discovery_mjd,is_supernova,shape_score,broker_anomaly_score\n"
                "a,1,false,0,0.9\n"
                "b,2,true,100,0.8\n"
                "c,3,false,0,0.7\n"
                "d,4,true,100,0.6\n"
                "e,5,false,0,0.5\n"
                "f,6,true,100,0.4\n",
                encoding="utf-8",
            )

            result = subprocess.run(
                [
                    sys.executable,
                    "prototype/lightcurve_summary.py",
                    "--evaluate-rankings",
                    str(csv_path),
                    "--precision-at",
                    "1",
                ],
                capture_output=True,
                check=True,
                text=True,
            )

        report = json.loads(result.stdout)
        self.assertEqual(report["split"], "chronological")
        self.assertEqual(report["holdout_candidate_count"], 2)
        self.assertIn("broker_anomaly_score", report["metrics"])


if __name__ == "__main__":
    unittest.main()
