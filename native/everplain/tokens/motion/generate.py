#!/usr/bin/env python3
"""Generate native Liquid geometry and motion constants from pinned Web sources.

Python standard library only; no DOM, browser, packages, or network required.
Run with --check to verify checked-in artifacts without changing them.
"""
from __future__ import annotations

import argparse
import ast
import bisect
import hashlib
import json
import math
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parent
ASSETS = ROOT.parent / "assets" / "avatars.json"
CENTER = (60.0, 62.0)
DENSE_COUNT = 1440
POINT_COUNT = 120
COARSE_STEPS = 4096
FINE_STEPS = 8192
TOLERANCE = 1e-3


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


class Segment:
    def __init__(self, start, command):
        self.start, self.command = start, command

    def point(self, t):
        c, (x0, y0) = self.command, self.start
        op, u = c["op"], 1 - t
        if t == 0:
            return self.start
        if t == 1:
            return c["x"], c["y"]
        if op == "L":
            return x0 + (c["x"] - x0) * t, y0 + (c["y"] - y0) * t
        if op == "Q":
            return (u*u*x0 + 2*u*t*c["x1"] + t*t*c["x"],
                    u*u*y0 + 2*u*t*c["y1"] + t*t*c["y"])
        if op == "C":
            return (u**3*x0 + 3*u*u*t*c["x1"] + 3*u*t*t*c["x2"] + t**3*c["x"],
                    u**3*y0 + 3*u*u*t*c["y1"] + 3*u*t*t*c["y2"] + t**3*c["y"])
        if op == "A":
            angle = math.radians(c["startAngleDegrees"] + t * c["sweepAngleDegrees"])
            rotation = math.radians(c["rotation"])
            x, y = c["rx"] * math.cos(angle), c["ry"] * math.sin(angle)
            return (c["cx"] + x*math.cos(rotation) - y*math.sin(rotation),
                    c["cy"] + x*math.sin(rotation) + y*math.cos(rotation))
        raise ValueError(f"Unsupported segment: {op}")

    def prepare_lengths(self, steps):
        self.steps = 1 if self.command["op"] == "L" else steps
        self.lengths = [0.0]
        previous = self.point(0)
        for i in range(1, self.steps + 1):
            point = self.point(i / self.steps)
            self.lengths.append(self.lengths[-1] + math.dist(previous, point))
            previous = point
        self.length = self.lengths[-1]

    def point_at_length(self, distance):
        i = max(1, min(self.steps, bisect.bisect_left(self.lengths, distance)))
        lo, hi = self.lengths[i - 1], self.lengths[i]
        fraction = (distance - lo) / (hi - lo) if hi > lo else 0
        # Evaluate the original curve at the inverted parameter, not the chord.
        return self.point((i - 1 + fraction) / self.steps)


def segments_from_commands(commands):
    segments, current, first = [], None, None
    for command in commands:
        op = command["op"]
        if op == "M":
            if first is not None:
                raise ValueError("Liquid expects one closed contour")
            current = first = (command["x"], command["y"])
            continue
        if current is None:
            raise ValueError("Path must begin with M")
        if op == "Z":
            command = {"op": "L", "x": first[0], "y": first[1]}
        if command["op"] not in ("L", "Q", "C", "A"):
            raise ValueError(f"Unsupported command: {op}")
        end = (command["x"], command["y"])
        if command["op"] != "L" or current != end:
            segments.append(Segment(current, command))
        current = end
    if commands[-1]["op"] != "Z":
        raise ValueError("Liquid path must be closed")
    return segments


def sample_outline(commands, steps):
    segments = segments_from_commands(commands)
    lengths = [0.0]
    for segment in segments:
        segment.prepare_lengths(steps)
        lengths.append(lengths[-1] + segment.length)
    total = lengths[-1]
    if total <= 0:
        raise ValueError("Empty contour")
    dense = []
    for i in range(DENSE_COUNT):
        distance = total * i / DENSE_COUNT
        index = min(len(segments) - 1, bisect.bisect_right(lengths, distance) - 1)
        x, y = segments[index].point_at_length(distance - lengths[index])
        dense.append((math.atan2(y - CENTER[1], x - CENTER[0]), math.hypot(x - CENTER[0], y - CENTER[1])))
    # Python's stable sort preserves source order for equal angles, as JS does.
    dense.sort(key=lambda item: item[0])
    angles = [sample[0] for sample in dense]
    radii = []
    for j in range(POINT_COUNT):
        angle = -math.pi / 2 + j * 2 * math.pi / POINT_COUNT
        if angle > math.pi:
            angle -= 2 * math.pi
        k = bisect.bisect_left(angles, angle)
        # JS findIndex returns -1 after the last angle; preserve the deliberate
        # source k <= 0 branch instead of adding a circular-wrap interpolation.
        if k == len(dense) or k <= 0:
            radius = dense[0][1]
        else:
            lo, hi = dense[k - 1], dense[k]
            radius = lo[1] + (hi[1] - lo[1]) * (angle - lo[0]) / (hi[0] - lo[0] or 1)
        radii.append(radius)
    return radii, total


def required(pattern, source):
    match = re.search(pattern, source)
    if match is None:
        raise ValueError(f"Web source changed; review generator pattern: {pattern}")
    return match


def load_sources():
    manifest = json.loads((ROOT / "source-manifest.json").read_text())
    sources, hashes = {}, {}
    for entry in manifest["files"]:
        path = ROOT / "source" / entry["source"]
        actual = digest(path)
        if actual != entry["sha256"]:
            raise ValueError(f"Pinned source changed: {entry['source']}")
        sources[entry["source"]] = path.read_text()
        hashes[entry["source"]] = actual
    assets = json.loads(ASSETS.read_text())
    if assets["source_sha256"] != hashes["modules/agent-avatar/avatars.tsx"]:
        raise ValueError("Avatar commands do not match pinned Web avatar source")
    hashes["../assets/avatars.json"] = digest(ASSETS)
    return sources, hashes, assets


def motion_parameters(sources, hashes):
    liquid = sources["modules/agent-avatar/AgentLiquid.tsx"]
    flight = sources["app/conversation-view/sendFlight.ts"]
    stream = sources["app/agent/useStreamPacer.ts"]
    order = ast.literal_eval(required(r"LIQUID_ORDER[^=]*= (\[[^\]]+\])", liquid)[1])
    speed, hold_base, flow_base = map(float, required(r"LIQUID_SPEED = ([\d.]+), LIQUID_HOLD = ([\d.]+) / LIQUID_SPEED, LIQUID_FLOW = ([\d.]+) / LIQUID_SPEED", liquid).groups())
    flight_ms, sample_intervals = map(int, required(r"FLIGHT_MS = (\d+), SAMPLES = (\d+)", flight).groups())
    spring_pattern = r"const zeta = ([\d.]+), w = 2 \* Math.PI / ([\d.]+), wd = w \* Math.sqrt\(1 - zeta \*\* 2\)"
    zeta, period = map(float, required(spring_pattern, flight).groups())
    if (zeta, period) != tuple(map(float, required(spring_pattern, liquid).groups())):
        raise ValueError("Flight and Liquid spring definitions diverged")
    batch_ms, light_ms = map(int, required(r"BATCH_MS = (\d+), LIGHT_MS = (\d+)", stream).groups())
    # These formulas are ported exactly. Fail rather than silently use stale
    # constants if their relevant source statements change.
    for source, snippets in ((liquid, [
        "const LIQUID_POINTS = 120", "length: 1440", "q.y - 62, q.x - 60",
        "const w = Math.min(1, Math.max(0, p))",
        "const amp = .5 + 2.6 * Math.sin(Math.PI * Math.min(1, (local - LIQUID_HOLD) / LIQUID_FLOW)) * (local > LIQUID_HOLD ? 1 : 0)",
        ".6 * Math.sin(3 * ang + tw * 2.1) + .4 * Math.sin(5 * ang - tw * 1.7)",
        "(.55 + .45 * v).toFixed(3)",
    ]), (flight, [
        "i === SAMPLES ? 1 : spring(i / SAMPLES * FLIGHT_MS / 1000)",
        "pinch = .035 * Math.exp(-(((t - .06) / .05) ** 2))",
        "(1 + .055 * n - pinch).toFixed(4)", "(1 - .04 * n - pinch).toFixed(4)",
        "FLIGHT_MS * .62", "FLIGHT_MS * .4", "duration: 320",
    ]), (stream, [
        "Math.max(1, Math.ceil(Math.min(420, 36 + backlog * 2.4) * BATCH_MS / 1000))",
    ])):
        for snippet in snippets:
            if snippet not in source:
                raise ValueError(f"Web formula changed; review generator: {snippet}")
    w = 2 * math.pi / period
    wd = w * math.sqrt(1 - zeta**2)
    def spring(t):
        return 1 - math.exp(-zeta * w * t) * (math.cos(wd * t) + zeta * w / wd * math.sin(wd * t))
    samples = [1.0 if i == sample_intervals else spring(i / sample_intervals * flight_ms / 1000) for i in range(sample_intervals + 1)]
    velocities = [samples[min(sample_intervals, i + 1)] - samples[max(0, i - 1)] for i in range(sample_intervals + 1)]
    peak = max(velocities)
    stretch = []
    for i, velocity in enumerate(velocities):
        t, n = i / sample_intervals, velocity / peak
        pinch = .035 * math.exp(-((t - .06) / .05)**2)
        stretch.append({"offset": t, "scaleX": float(f"{1 + .055*n - pinch:.4f}"), "scaleY": float(f"{1 - .04*n - pinch:.4f}")})
    return {
        "schemaVersion": 1,
        "sourceSha256": hashes,
        "spring": {"dampingRatio": zeta, "naturalPeriodSeconds": period, "formula": "1-exp(-zeta*w*t)*(cos(wd*t)+zeta*w/wd*sin(wd*t)); w=2*pi/period; wd=w*sqrt(1-zeta*zeta)"},
        "liquid": {
            "points": POINT_COUNT, "denseSamples": DENSE_COUNT, "center": list(CENTER), "order": order,
            "defaultLead": "cheng", "defaultSize": 76, "leadOrder": "[validLead, ...order excluding validLead]",
            "speed": speed, "holdSeconds": hold_base / speed, "flowSeconds": flow_base / speed,
            "periodSeconds": (hold_base + flow_base) / speed,
            "morphProgress": "local > hold ? spring((local-hold)*speed) : 0",
            "geometryProgressClamped": False, "colorDecorNoseProgressClamped": True,
            "idleWaveAmplitude": .5, "morphWaveAmplitude": 2.6,
            "waveHarmonics": [{"weight": .6, "angularFrequency": 3, "timeFrequency": 2.1}, {"weight": .4, "angularFrequency": 5, "timeFrequency": -1.7}],
            "waveTime": "elapsedSeconds*speed", "morphWaveEnvelope": "sin(pi*min(1,(local-hold)/flow))*(local>hold?1:0)",
            "colorSpace": "oklab", "colorFirstWeightPercentDecimalPlaces": 1,
            "lookDecimalPlaces": 2, "decorDecimalPlaces": 3, "decorScaleBase": .55, "decorScaleWeight": .45, "noseInkOpacity": .86,
            "closedSmoothPath": {"type": "closed Catmull-Rom to cubic Bezier", "controlPointDivisor": 6, "coordinateDecimalPlaces": 2},
            "reducedMotion": "Render frame at elapsedSeconds=0 once, including idle wave; do not start animation loop",
        },
        "sendFlight": {
            "durationMs": flight_ms, "sampleIntervals": sample_intervals, "sampleCount": len(samples),
            "springSamples": samples, "cssLinearSamples": [float(f"{v:.4f}") for v in samples], "finalSampleForcedToOne": True,
            "fallbackCubicBezier": [.34, 1.3, .64, 1],
            "verticalDurationMs": flight_ms * .62, "verticalCubicBezier": [.22, 1, .36, 1],
            "backgroundDurationMs": flight_ms * .4, "backgroundCubicBezier": [.4, 0, .2, 1],
            "stretchFrames": stretch, "stretchEasing": "linear",
            "launchMaxAgeMs": 2000, "defaultLaunchPadding": {"left": 8, "top": 8},
            "defaultTargetPadding": {"left": 20, "top": 12},
            "reducedMotion": "Reveal real bubble immediately; skip decorative flight",
        },
        "composerSettle": {"durationMs": 320, "cubicBezier": [.16, 1, .3, 1], "minimumHeightDifference": 1},
        "stream": {
            "batchMs": batch_ms, "lightMs": light_ms, "baseCharactersPerSecond": 36, "backlogRateFactor": 2.4, "maximumCharactersPerSecond": 420,
            "batchSize": "max(1,ceil(min(420,36+UTF16Backlog*2.4)*batchMs/1000))",
            "indexUnits": "UTF-16 code units", "preserveSurrogatePairs": True,
            "characterRevealTimestamp": "now-batchMs+codePointIndex*batchMs/codePointCount",
            "reducedMotion": "Show complete answer and clear reveal timestamps",
        },
    }


def generate():
    sources, hashes, assets = load_sources()
    parameters = motion_parameters(sources, hashes)
    presets = {preset["id"]: preset for preset in assets["presets"]}
    outlines, convergence = [], []
    for identity in parameters["liquid"]["order"]:
        preset = presets[identity]
        coarse, coarse_length = sample_outline(preset["commands"], COARSE_STEPS)
        fine, fine_length = sample_outline(preset["commands"], FINE_STEPS)
        delta = max(abs(a-b) for a, b in zip(coarse, fine))
        if delta >= TOLERANCE:
            raise ValueError(f"{identity} convergence {delta} exceeds {TOLERANCE}")
        if len(fine) != POINT_COUNT or not all(math.isfinite(r) and r > 0 for r in fine):
            raise ValueError(f"Invalid {identity} radii")
        outlines.append({"id": identity, "radii": fine})
        convergence.append({"id": identity, "maxRadiusDelta": delta, "coarseLength": coarse_length, "fineLength": fine_length, "lengthDelta": abs(coarse_length-fine_length)})
    circle_error = max(abs(r-32) for outline in outlines if outline["id"] == "cheng" for r in outline["radii"])
    if circle_error >= 1e-10:
        raise ValueError(f"Circle radius anchor failed: {circle_error}")
    geometry = {
        "schemaVersion": 1, "sourceSha256": hashes,
        "center": list(CENTER), "points": POINT_COUNT, "denseSamples": DENSE_COUNT,
        "startAngleRadians": -math.pi / 2, "angleStepRadians": 2 * math.pi / POINT_COUNT,
        "order": parameters["liquid"]["order"],
        "method": "Original M/L/C/Q/A/Z geometry; fixed parameter subdivisions and cumulative chord lengths; linearly invert arclength then evaluate original curve; 1440 equally spaced arclength samples excluding endpoint; stable atan2 sort; source 120-radius interpolation including k<=0=>dense[0].r",
        "numericQualification": {
            "units": "SVG viewBox source units (120 by 120)", "coarseSubstepsPerCurve": COARSE_STEPS,
            "fineSubstepsPerCurve": FINE_STEPS, "targetMaximumRadiusDelta": TOLERANCE,
            "observedMaximumRadiusDelta": max(item["maxRadiusDelta"] for item in convergence),
            "circleRadius32MaximumError": circle_error, "perOutline": convergence,
            "interpretation": "Convergence measurement between two local numerical resolutions, not a rigorous absolute error bound. Browser getTotalLength/getPointAtLength was not measured; bit-identical browser floating-point or raster parity is not claimed.",
        },
        "outlines": outlines,
        "radiiById": {outline["id"]: outline["radii"] for outline in outlines},
    }
    return {"liquid-outlines.json": geometry, "motion-parameters.json": parameters}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="verify generated files without writing")
    args = parser.parse_args()
    generated = generate()
    for name, artifact in generated.items():
        serialized = json.dumps(artifact, ensure_ascii=False, indent=2, allow_nan=False) + "\n"
        path = ROOT / name
        if args.check:
            if not path.exists() or path.read_text() != serialized:
                raise SystemExit(f"Stale artifact: {path}")
        else:
            path.write_text(serialized)
    qualification = generated["liquid-outlines.json"]["numericQualification"]
    print(json.dumps({"mode": "verified" if args.check else "generated", "outlines": 7, "radiiPerOutline": POINT_COUNT, "maximumRadiusDelta": qualification["observedMaximumRadiusDelta"], "circleRadius32MaximumError": qualification["circleRadius32MaximumError"], "flightSampleCount": len(generated["motion-parameters.json"]["sendFlight"]["springSamples"])}))


if __name__ == "__main__":
    main()
