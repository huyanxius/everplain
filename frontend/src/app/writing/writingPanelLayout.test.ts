import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
const writingStyles = readFileSync('src/app/writing/writing.css', 'utf8')

describe('narrow writing Agent composer', () => {
  it('uses panel width rather than the desktop viewport to place the input above its controls', () => {
    expect(writingStyles).toMatch(/container:\s*writing-agent-panel\s*\/\s*inline-size/)
    expect(writingStyles).toMatch(/@container writing-agent-panel \(max-width: 480px\)/)
    expect(writingStyles).toMatch(/\.writing-agent \.conversation-composer__row > textarea\s*\{[^}]*grid-column:\s*1 \/ -1;[^}]*grid-row:\s*1/)
    expect(writingStyles).toMatch(/\.writing-agent \.conversation-composer__model\s*\{[^}]*grid-column:\s*2;[^}]*grid-row:\s*2;[^}]*max-width:\s*100%/)
    expect(writingStyles).toMatch(/\.writing-agent \.conversation-composer__send\s*\{[^}]*grid-column:\s*3;[^}]*grid-row:\s*2/)
  })
  it('keeps the model control and padded textarea inside the available width', () => {
    expect(writingStyles).toMatch(/\.writing-agent \.model-selection-settings__summary\s*\{[^}]*max-width:\s*100%/)
    expect(writingStyles).toMatch(/\.writing-agent \.conversation-composer__row > textarea\s*\{[^}]*box-sizing:\s*border-box/)
  })
})
