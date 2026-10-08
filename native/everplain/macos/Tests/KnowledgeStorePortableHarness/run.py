#!/usr/bin/env python3
"""Execute production KnowledgeStore logic with platform/transport stubs on Linux.
This is additional owner/stale-response verification, not macOS or SwiftUI validation.
Build the EverplainCore target with a Linux Swift toolchain first. No network is used.
"""
import argparse
from pathlib import Path
import os
import subprocess
import tempfile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--swiftc', required=True)
parser.add_argument('--core-products', required=True, help='Directory containing libEverplainCore.a and EverplainCore.swiftmodule')
parser.add_argument('--extra-source', action='append', default=[], help='Additional production source when checking against an older core build')
args = parser.parse_args()
root = Path(__file__).resolve().parents[2]
here = Path(__file__).resolve().parent
products = Path(args.core_products).resolve()
source = (root / 'Sources/EverplainMac/KnowledgeStore.swift').read_text()
source = source.replace('#if os(macOS)\n', '', 1).replace('import SwiftUI\n', '').replace('import UniformTypeIdentifiers\n', '').rsplit('#endif', 1)[0]
with tempfile.TemporaryDirectory(prefix='everplain-knowledge-check-') as temporary:
    work = Path(temporary)
    (work / 'KnowledgeStore.swift').write_text(source)
    environment = dict(os.environ)
    environment['CLANG_MODULE_CACHE_PATH'] = str(root / '.build/module-cache')
    dependencies = []
    if (products / 'Markdown.swiftmodule').exists():
        for include in ['Vendor/swift-markdown/Sources/CAtomic/include', 'Vendor/swift-cmark/src/include', 'Vendor/swift-cmark/extensions/include']:
            dependencies += ['-I', str(root / include)]
        dependencies += [str(products / name) for name in ['Markdown.o', 'CAtomic.o', 'cmark-gfm.o', 'cmark-gfm-extensions.o'] if (products / name).exists()]
    command = [args.swiftc, '-I', str(products), '-L', str(products), '-lEverplainCore', *dependencies, *args.extra_source, str(here / 'Stubs.swift'), str(work / 'KnowledgeStore.swift'), str(here / 'Harness.swift'), '-o', str(work / 'check')]
    subprocess.run(command, check=True, env=environment)
    subprocess.run([str(work / 'check')], check=True, env=environment, timeout=30)
