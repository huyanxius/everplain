#!/usr/bin/env python3
"""Offline test of UI draft identity and generated request semantics, not SwiftUI visual QA."""
import argparse, os, subprocess, tempfile
from pathlib import Path
p=argparse.ArgumentParser(); p.add_argument('--swiftc',required=True); p.add_argument('--core-products',required=True); a=p.parse_args()
root=Path(__file__).resolve().parents[2]; products=Path(a.core_products).resolve()
dependencies = []
if (products / 'Markdown.swiftmodule').exists():
    for include in ['Vendor/swift-markdown/Sources/CAtomic/include', 'Vendor/swift-cmark/src/include', 'Vendor/swift-cmark/extensions/include']:
        dependencies += ['-I', str(root / include)]
    dependencies += [str(products / name) for name in ['Markdown.o', 'CAtomic.o', 'cmark-gfm.o', 'cmark-gfm-extensions.o'] if (products / name).exists()]
env=dict(os.environ); env['CLANG_MODULE_CACHE_PATH']=str(root/'.build/module-cache')
with tempfile.TemporaryDirectory(prefix='everplain-library-draft-') as work:
    executable=str(Path(work)/'check')
    subprocess.run([a.swiftc,'-I',str(products),'-L',str(products),'-lEverplainCore',*dependencies,str(root/'Sources/EverplainMac/LibraryEditorDraft.swift'),str(Path(__file__).with_name('editor-draft.swift')),'-o',executable],check=True,env=env)
    subprocess.run([executable],check=True,env=env)
