import { expect, it } from 'vitest'
import { revisionDiff } from './revisionDiff'
it.each([['原文😀尾','原文😎尾'],['','新稿'],['不变','不变'],['删掉',''],['---\na: b\n---\n','---\na: c\n---\n']])('keeps exact before and after text %s', (before, after) => { const diff = revisionDiff(before, after); expect(diff.prefix + diff.deleted + diff.suffix).toBe(before); expect(diff.prefix + diff.inserted + diff.suffix).toBe(after); expect(diff.deleted).not.toMatch(/[\uD800-\uDBFF]$/) })
