#!/usr/bin/env python3
"""Verify copied Web brand inputs and native vector outputs without renderer dependencies."""
import hashlib
import json
from pathlib import Path
root = Path(__file__).resolve().parents[1]
manifest = json.loads((root / 'DesignSources/brand/manifest.json').read_text())
for item in manifest['assets']:
    original = root / 'DesignSources/brand' / item['source']
    native = root / 'Sources/EverplainMac/Resources/BrandAssets' / item['output']
    assert hashlib.sha256(original.read_bytes()).hexdigest() == item['sourceSha256'], original
    assert hashlib.sha256(native.read_bytes()).hexdigest() == item['outputSha256'], native
    if native.suffix == '.pdf': assert native.read_bytes().startswith(b'%PDF-'), native
    if original.suffix == '.png': assert native.read_bytes() == original.read_bytes(), native
assert not any('apple' in item['source'].lower() for item in manifest['assets'])
print(f"Verified {len(manifest['assets'])} original Web brand assets and their native PDF/PNG outputs")
