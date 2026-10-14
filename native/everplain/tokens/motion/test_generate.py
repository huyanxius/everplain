"""Analytical geometry anchors, source integrity, and numerical convergence."""
import json
import math
import unittest

import generate


class GeometryTests(unittest.TestCase):
    def test_circle_analytical_radius_and_perimeter(self):
        assets = json.loads(generate.ASSETS.read_text())
        circle = next(p for p in assets["presets"] if p["id"] == "cheng")
        radii, length = generate.sample_outline(circle["commands"], 8192)
        self.assertEqual(len(radii), 120)
        self.assertLess(max(abs(r - 32) for r in radii), 1e-10)
        self.assertLess(abs(length - 64 * math.pi), 2e-6)
        # Index zero starts at the top; quarter-turns are right, bottom, left.
        for index, expected in ((0, (60, 30)), (30, (92, 62)), (60, (60, 94)), (90, (28, 62))):
            angle = -math.pi / 2 + index * 2 * math.pi / 120
            actual = (60 + math.cos(angle)*radii[index], 62 + math.sin(angle)*radii[index])
            self.assertLess(math.dist(actual, expected), 1e-10)

    def test_closed_line_square_analytical_cardinal_radii(self):
        commands = [{"op": "M", "x": 30, "y": 32},
                    {"op": "L", "x": 90, "y": 32},
                    {"op": "L", "x": 90, "y": 92},
                    {"op": "L", "x": 30, "y": 92}, {"op": "Z"}]
        radii, length = generate.sample_outline(commands, 4096)
        self.assertEqual(length, 240)
        for index in (0, 30, 60, 90):
            self.assertAlmostEqual(radii[index], 30, places=10)
        for index in (15, 45, 75, 105):
            self.assertAlmostEqual(radii[index], 30 * math.sqrt(2), places=10)

    def test_rotated_elliptical_arc_analytical_anchor(self):
        segment = generate.Segment((10, 25), {
            "op": "A", "cx": 10, "cy": 20, "rx": 5, "ry": 3,
            "rotation": 90, "startAngleDegrees": 0, "sweepAngleDegrees": 180,
            "x": 10, "y": 15,
        })
        self.assertLess(math.dist(segment.point(.5), (7, 20)), 1e-12)

    def test_delivered_contours_have_further_convergence(self):
        assets = json.loads(generate.ASSETS.read_text())
        delivered = json.loads((generate.ROOT / "liquid-outlines.json").read_text())
        self.assertEqual(len(delivered["radiiById"]), 7)
        for preset in assets["presets"]:
            finer, _ = generate.sample_outline(preset["commands"], 16384)
            radii = delivered["radiiById"][preset["id"]]
            self.assertEqual(len(radii), 120)
            self.assertLess(max(abs(a-b) for a, b in zip(finer, radii)), 1e-3)

    def test_source_hashes_and_flight_overshoot(self):
        sources, hashes, _ = generate.load_sources()
        parameters = generate.motion_parameters(sources, hashes)
        samples = parameters["sendFlight"]["springSamples"]
        self.assertEqual(len(samples), 57)
        self.assertEqual(samples[0], 0)
        self.assertEqual(samples[-1], 1)
        # Independent analytic first-peak height of the underdamped step.
        peak = 1 + math.exp(-.7 * math.pi / math.sqrt(1-.7**2))
        self.assertLessEqual(max(samples), peak)
        self.assertLess(peak - max(samples), .0002)
        self.assertEqual(parameters["liquid"]["order"], ["cheng", "you", "ruo", "heng", "shi", "qi", "nian"])
        self.assertEqual(parameters["stream"]["batchMs"], 48)


if __name__ == "__main__":
    unittest.main()
