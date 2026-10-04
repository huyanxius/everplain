import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
const source = readFileSync(resolve(process.cwd(), 'src/app/application-frame/application-frame.css'), 'utf8')
import { cleanup, render } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { ApplicationFrame, type ApplicationFrameProps } from './ApplicationFrame'

// jsdom has no layout/animation engine. Check final cascade/DOM semantics only;
// Strip geometry declarations that jsdom cannot resolve; preserve the actual non-layout cascade.
// The native timeline runner owns geometry, clipping, reversal and endpoint fidelity.
function desktopRules() {
  const output: string[] = []; let include = true
  for (const line of source.split('\n')) {
    if (line.startsWith('@media')) { include = line.includes('min-width: 761px'); continue }
    if (line.trim() === '}') { include = true; continue }
    if (include) output.push(line)
  }
  return output.join('\n').replace(/\{([^{}]*)\}/g, (_rule, body: string) => '{' + body.split(';').filter(declaration => /^\s*(display|flex-direction|justify-content|opacity|visibility|overflow(?:-[xy])?|transition(?:-[a-z-]+)?):/.test(declaration)).join(';') + '}')
}
const props: ApplicationFrameProps = {
  collapsed: false, drawerOpen: false, narrow: false, immersive: false, workspace: false, wide: false, sidebarRef: null,
  brand: <a className="application-brand"><span className="application-brand__mark"/><strong>Everplain</strong></a>,
  toggle: <button className="qx-btn qx-btn--icon">Toggle</button>, newConversation: null,
  navigation: <nav><a className="qx-item"><svg className="application-nav-icon"/><span className="application-navigation__label">Navigation label</span></a></nav>, secondaryNavigation: null,
  history: <div><input aria-label="History draft" defaultValue="unchanged"/></div>,
  account: <div className="application-account"><div className="application-account-menu"><button className="application-account__identity"><span className="agent-avatar"/><span className="application-account__name">Agent</span></button></div><button className="qx-btn qx-btn--icon">Notification</button></div>,
  notifications: null, mobileHeader: null, notice: null, skipLabel: 'Skip', sidebarLabel: 'Sidebar', dismissLabel: 'Dismiss', onDismiss() {}, children: <textarea defaultValue="Main draft"/>,
}
let stylesheet: HTMLStyleElement | undefined
afterEach(() => { cleanup(); stylesheet?.remove() })
function setup() { stylesheet=document.createElement('style'); stylesheet.textContent=desktopRules();document.head.append(stylesheet) }

it('keeps classic text/history mounted and switches no flex row/column or centering at collapse', () => {
  setup();const view=render(<ApplicationFrame {...props}/>);const sidebar=view.container.querySelector('.application-sidebar')!;
  const history=sidebar.querySelector('.application-sidebar__history')!,input=history.querySelector('input')!,label=sidebar.querySelector('.application-navigation__label')!;
  const before = ['.application-sidebar__top','.application-account','.qx-item'].map(selector => getComputedStyle(sidebar.querySelector(selector)!).display)
  view.rerender(<ApplicationFrame {...props} collapsed/>);
  expect(['.application-sidebar__top','.application-account','.qx-item'].map(selector => getComputedStyle(sidebar.querySelector(selector)!).display)).toEqual(before)
  expect(getComputedStyle(sidebar.querySelector('.qx-item')!).justifyContent).toBe('flex-start')
  expect(getComputedStyle(label).display).toBe('block')
  expect(getComputedStyle(history).display).toBe('block')
  expect(history).toHaveAttribute('inert');expect(history).toHaveAttribute('aria-hidden','true')
  expect(history.querySelector('input')).toBe(input);expect(input).toHaveValue('unchanged')
  expect(getComputedStyle(sidebar).overflow).not.toBe('hidden')
  expect(getComputedStyle(sidebar.querySelector('.application-sidebar__bottom')!).overflow).not.toBe('hidden')
  view.rerender(<ApplicationFrame {...props}/>);
  expect(history.querySelector('input')).toBe(input);expect(history).not.toHaveAttribute('inert')
})

it('uses one split-record geometry/fade duration in both directions', () => {
  setup();const view=render(<ApplicationFrame {...props} collapsed splitRail recordsOpen recordsLabel="Records"/>);
  const records=view.container.querySelector('.application-records')!;
  expect(getComputedStyle(records.querySelector('.application-sidebar__history')!).display).toBe('block')
  const openTransition=getComputedStyle(records).transition
  view.rerender(<ApplicationFrame {...props} collapsed splitRail recordsOpen={false} recordsLabel="Records"/>);
  const closingTransition=getComputedStyle(records).transition
  expect(openTransition).toContain('calc(var(--qx-motion-base) * 1.25)')
  expect(closingTransition).toContain('opacity calc(var(--qx-motion-base) * 1.25)')
  expect(closingTransition).not.toContain('--qx-motion-fast')
})
