#!/usr/bin/env python3
"""Execute production AppStore navigation logic with offline platform/child-store shims.
This validates real generated contract calls and specific synchronous race guards;
it does not compile SwiftUI/AppKit and is not a macOS build or UI acceptance.
"""
import argparse
import os
from pathlib import Path
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
source = (root / 'Sources/EverplainMac/AppStore.swift').read_text()
source = source.replace('#if os(macOS)\n', '', 1).rsplit('#endif', 1)[0]
source = source.replace('import SwiftUI\n', 'import Foundation\n').replace('import AppKit\n', '').replace('import UniformTypeIdentifiers\n', '')
# Keep the test extension in the same file to observe private request state.
source += '\n' + (here / 'Harness.swift').read_text()
with tempfile.TemporaryDirectory(prefix='everplain-appstore-check-') as temp:
    work = Path(temp)
    target = work / 'AppStore.swift'
    target.write_text(source)
    env = dict(os.environ)
    env['CLANG_MODULE_CACHE_PATH'] = str(root / '.build/account-module-cache')
    subprocess.run([a.swiftc, '-parse-as-library', '-I', str(products), '-L', str(products), '-lEverplainCore', *dependencies, str(here / 'Stubs.swift'), str(target), '-o', str(work / 'check')], check=True, env=env)
    subprocess.run([str(work / 'check')], check=True, env=env, timeout=30)
