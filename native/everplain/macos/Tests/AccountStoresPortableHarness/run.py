#!/usr/bin/env python3
"""Run actual account/memory store lifecycle logic with offline transport/platform shims.
This does not compile SwiftUI or AppKit and is not a native macOS build claim.
"""
import argparse
from pathlib import Path
import os
import subprocess
import tempfile
p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--swiftc', required=True)
p.add_argument('--core-products', required=True)
a = p.parse_args()
root = Path(__file__).resolve().parents[2]
here = Path(__file__).resolve().parent
products = Path(a.core_products).resolve()
dependencies = []
if (products / 'Markdown.swiftmodule').exists():
    for include in ['Vendor/swift-markdown/Sources/CAtomic/include', 'Vendor/swift-cmark/src/include', 'Vendor/swift-cmark/extensions/include']:
        dependencies += ['-I', str(root / include)]
    dependencies += [str(products / name) for name in ['Markdown.o', 'CAtomic.o', 'cmark-gfm.o', 'cmark-gfm-extensions.o'] if (products / name).exists()]
with tempfile.TemporaryDirectory(prefix='everplain-account-check-') as temporary:
    work = Path(temporary)
    sources = []
    for name in ['AccountManagementStore', 'MemoryStore']:
        source = (root / f'Sources/EverplainMac/{name}.swift').read_text()
        source = source.replace('#if os(macOS)\n', '', 1).replace('import SwiftUI\n', 'import Foundation\n').rsplit('#endif', 1)[0]
        target = work / f'{name}.swift'
        target.write_text(source)
        sources.append(str(target))
    env = dict(os.environ)
    env['CLANG_MODULE_CACHE_PATH'] = str(root / '.build/account-module-cache')
    subprocess.run([a.swiftc, '-I', str(products), '-L', str(products), '-lEverplainCore', *dependencies, str(here / 'Stubs.swift'), *sources, str(here / 'Harness.swift'), '-o', str(work / 'check')], check=True, env=env)
    subprocess.run([str(work / 'check')], check=True, env=env, timeout=30)
