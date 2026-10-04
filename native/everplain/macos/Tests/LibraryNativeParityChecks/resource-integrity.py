#!/usr/bin/env python3
"""Verify the pinned graph bundle and source-derived algorithm/style functions."""
from pathlib import Path
import argparse, hashlib, json
p=argparse.ArgumentParser();p.add_argument('--web-source',required=True);a=p.parse_args()
root=Path(__file__).resolve().parents[2]; folder=root/'Sources/EverplainMac/Resources/GraphLayout'
metadata=json.loads((folder/'provenance.json').read_text())
for name,expected in metadata['bundledFilesSHA256'].items():
    assert hashlib.sha256((folder/name).read_bytes()).hexdigest()==expected,name
source=Path(a.web_source);data=source.read_bytes();s=data.decode()
assert hashlib.sha256(data).hexdigest()==metadata['sourceSHA256'],'Authoritative Web source has changed'
def section(start,end):return s[s.index(start):s.index(end,s.index(start))]
elements=section('function graphElements(', '\nfunction layoutOptions(').replace('projection: KnowledgeGraphProjection','projection').replace('focusNodeId?: string','focusNodeId').replace('): ElementDefinition[] {', ') {')
layout=section('function layoutOptions(', '\nfunction fitView(').replace('hasFocus: boolean','hasFocus').replace('hasEdges: boolean','hasEdges').replace('(node: cytoscape.NodeSingular)', '(node)')
fit=section('function fitView(', '\nfunction ').replace('graph: Core','graph').replace('focusNodeId?: string','focusNodeId')
styles=section('const graphStyle =', '\nconst previewGraphStyle =').replace('(): cytoscape.StylesheetJson', '()')
expected='// Extracted from the authoritative Web ObsidianKnowledgeGraph.tsx. Type annotations only removed.\n'+elements+layout+fit+styles
assert (folder/'web-graph-source.js').read_text()==expected,'Extracted function drift'
assert metadata['cytoscapeVersion']=='3.34.0'
print('PASS pinned graph resource hashes and exact Web functions (only TypeScript annotations removed)')
