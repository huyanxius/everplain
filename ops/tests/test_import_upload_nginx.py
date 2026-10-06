"""Static regression for bounded, endpoint-specific import proxy configuration."""

import re
import unittest
from pathlib import Path


class ImportUploadNginxTests(unittest.TestCase):
    def test_import_limit_is_bounded_and_other_api_proxy_settings_are_preserved(self):
        config = (Path(__file__).resolve().parents[1] / "nginx.conf").read_text()
        upload = re.search(r"location = /api/imports \{(.*?)\n    \}", config, re.S)
        general = re.search(r"location /api/ \{(.*?)\n    \}", config, re.S)
        self.assertIsNotNone(upload)
        self.assertIsNotNone(general)
        upload_lines = [line.strip() for line in upload[1].splitlines() if line.strip()]
        general_lines = [line.strip() for line in general[1].splitlines() if line.strip()]
        self.assertEqual(upload_lines.pop(0), "client_max_body_size 68m;")
        self.assertEqual(upload_lines, general_lines)
        self.assertIn("client_max_body_size 21m;", config[:upload.start()])
        self.assertEqual(config.count("client_max_body_size"), 2)


if __name__ == "__main__":
    unittest.main()
