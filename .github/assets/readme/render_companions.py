"""Rebuild the README banner from the existing Everplain vector illustrations."""

import json
import subprocess
import xml.etree.ElementTree as ET
from pathlib import Path

output = Path(__file__).resolve().parent
repo = output.parents[2]
node_script = r"""
import fs from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import path from 'node:path';
const root = path.join(process.argv[1], 'frontend/src/modules/user-avatar');
const moduleUrl = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
const data = moduleUrl(stripTypeScriptTypes(fs.readFileSync(path.join(root, 'avatar-data.ts'), 'utf8')));
const layers = moduleUrl(stripTypeScriptTypes(fs.readFileSync(path.join(root, 'avatar-layers.ts'), 'utf8')).replace("'./avatar-data'", JSON.stringify(data)));
const { PEOPLE } = await import(data);
const { renderAvatarLayers } = await import(layers);
process.stdout.write(JSON.stringify(PEOPLE.map(person => ({person, layers: renderAvatarLayers(person, 'hero-' + person.id + '-', false)}))));
"""
result = subprocess.run(
    [
        "node",
        "--disable-warning=ExperimentalWarning",
        "--input-type=module",
        "-e",
        node_script,
        str(repo),
    ],
    check=True,
    capture_output=True,
    text=True,
)
records = {item["person"]["id"]: item for item in json.loads(result.stdout)}
people = {key: item["person"] for key, item in records.items()}
base = {
    "hair": "#e6d8c5",
    "hair-back": "#d9c7b0",
    "hair-shade": "#d6c3aa",
    "hand-shade": "#f0dccb",
    "fold": "#56617a",
    "cuff": "#efe8dd",
    "rib": "#d9cfc1",
    "finger": "#dcbfa9",
    "eye": "#2b221e",
    "blush": "#f5c3ba",
    "petal": "#c98a63",
    "flower-heart": "#f0c9a6",
    "ribbon": "#b97f5d",
    "star": "#fff4e6",
}
placements = [
    ("sand", 18, 54, 0.83),
    ("mo", 197, 25, 0.97),
    ("xiaoping", 409, 0, 1.11),
    ("hime", 640, 18, 1.04),
    ("cat", 865, 38, 0.92),
]
parts = []
for person_id, x, y, scale in placements:
    p = people[person_id]
    u = f"hero-{person_id}-"
    colors = base | {
        "hair": p["hair"],
        "hair-back": p["hairBack"],
        "hair-shade": p["hairShade"],
        "fold": p["fold"],
    }
    body = records[person_id]["layers"]
    body = body.replace("var(--hat)", p.get("hat", "#000")).replace(
        "var(--hat-band)", p.get("hatBand", "#000")
    )
    body = body.replace("undefined", "")
    el = ET.fromstring("<g>" + body + "</g>")
    for node in el.iter():
        if node.text and not node.text.strip():
            node.text = None
        if node.tail and not node.tail.strip():
            node.tail = None
        classes = node.get("class", "").split()
        node.attrib.pop("style", None)
        for cl in classes:
            k = cl.removeprefix("cp-")
            if k in colors:
                node.set("fill", colors[k])
        if "cp-face-shade" in classes:
            node.set("fill", colors["hand-shade"])
            node.set("opacity", ".3")
            node.set("filter", f"url(#{u}soft-edge)")
        if "cp-blush" in classes:
            node.set("opacity", str(p.get("blush", 0.85)))
            node.set("filter", f"url(#{u}soft-edge)")
        if "cp-happy" in classes:
            node.set("display", "none")
        if "cp-fold" in classes:
            node.set("fill", "none")
            node.set("stroke", colors["fold"])
            node.set("stroke-width", "1.4")
            node.set("stroke-linecap", "round")
            node.set("opacity", ".45")
        if "cp-rib" in classes:
            node.set("fill", "none")
            node.set("stroke", colors["rib"])
            node.set("stroke-width", "1")
            node.set("stroke-linecap", "round")
        if "cp-finger" in classes:
            node.set("fill", "none")
            node.set("stroke", colors["finger"])
            node.set("stroke-width", "1.2")
            node.set("stroke-linecap", "round")
        if "cp-chin-shadow" in classes:
            node.set("fill", colors["fold"])
            node.set("opacity", ".3")
            node.set("filter", f"url(#{u}soft)")
        if any(cl in classes for cl in ["fx-spark", "fx-note", "fx-leaf", "fx-petal"]):
            node.set("display", "none")
        node.attrib.pop("class", None)
    el.set("transform", f"translate({x} {y}) scale({scale})")
    parts.append(ET.tostring(el, encoding="unicode"))
svg = (
    '<svg xmlns="http://www.w3.org/2000/svg" width="1120" height="286" viewBox="0 -16 1120 286" role="img" aria-labelledby="title desc"><title id="title">Everplain, in good company</title><desc id="desc">Five original Everplain user appearances: sand, mo, xiaoping, hime and cat. Original vector layers, transparent background.</desc>'
    + "".join(parts)
    + "</svg>"
)
(output / "everplain-companions.svg").write_text(svg + "\n", encoding="utf-8")
print("Rebuilt .github/assets/readme/everplain-companions.svg")
