"""Regression checks for exit-zero reports that contain failed assertions."""
import json
import unittest
from types import SimpleNamespace
from check_offline import assess_result


class EntryChecks(unittest.TestCase):
    def report(self, **changes):
        value = {"network_requests": 0, "source_sha256": "test-source",
                 "results": [{"name": str(i), "passed": True} for i in range(8)]}
        value.update(changes)
        return SimpleNamespace(returncode=0, stdout=json.dumps(value), stderr="")

    def test_exit_zero_does_not_override_failed_case(self):
        rows = [{"passed": True} for _ in range(7)] + [{"passed": False}]
        with self.assertRaises(ValueError):
            assess_result("test_runner.py", self.report(results=rows), "test-source")

    def test_empty_report_and_wrong_source_are_rejected(self):
        for report in (self.report(results=[]), self.report(source_sha256="other-source")):
            with self.assertRaises(ValueError):
                assess_result("test_runner.py", report, "test-source")

    def test_complete_matching_report_passes(self):
        self.assertEqual(assess_result("test_runner.py", self.report(), "test-source"), 8)


if __name__ == "__main__":
    unittest.main()
