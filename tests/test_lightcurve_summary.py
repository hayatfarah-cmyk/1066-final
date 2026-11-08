import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from prototype.lightcurve_summary import summarize_light_curve


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


if __name__ == "__main__":
    unittest.main()
