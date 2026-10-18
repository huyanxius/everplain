#!/usr/bin/env python3
"""Copy generated inputs exactly; --check exits nonzero on drift. No source of truth lives here."""
from pathlib import Path
import argparse, hashlib, shutil, sys
root=Path(__file__).resolve().parents[1]
shared=root.parent
pairs=[(shared/'contracts/generated/EverplainContracts.swift',root/'Sources/EverplainCore/Generated/EverplainContracts.swift'),
       (shared/'tokens/generated/EverplainTokens.swift',root/'Sources/EverplainCore/Generated/EverplainTokens.swift')]
pairs += [(shared/f'shared-tests/fixtures/{name}.json', root/f'Tests/EverplainCoreTests/Fixtures/{name}.json') for name in ['codec','codec-core','sse','research-events','state-cases']]
p=argparse.ArgumentParser();p.add_argument('--check',action='store_true');args=p.parse_args()
failed=False
for source,dest in pairs:
    if not source.is_file(): print(f'Missing shared source: {source}',file=sys.stderr);failed=True;continue
    if args.check:
        if not dest.is_file() or source.read_bytes()!=dest.read_bytes(): print(f'Drift: {dest}',file=sys.stderr);failed=True
    else: dest.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(source,dest)
    print(f'{dest.relative_to(root)} sha256={hashlib.sha256(source.read_bytes()).hexdigest()}')
sys.exit(1 if failed else 0)
