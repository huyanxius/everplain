#!/usr/bin/env python3
"""Verify pinned, offline citation/export resources; no network, model or user data."""
import hashlib,json
from pathlib import Path
root=Path(__file__).resolve().parents[1]
folder=root/'Sources/EverplainMac/Resources/ResearchExport'
manifest=json.loads((folder/'resources-manifest.json').read_text())
for filename,digest in manifest['sha256'].items():
    assert hashlib.sha256((folder/filename).read_bytes()).hexdigest()==digest,filename
print('Verified source-pinned citation processor, three CSL styles, two locales and license texts')
