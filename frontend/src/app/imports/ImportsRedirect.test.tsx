import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { afterEach, expect, it } from 'vitest'
import { ImportsRedirect } from './ImportsRedirect'

afterEach(cleanup)
function Address() { const location = useLocation(); return <output aria-label="地址">{location.pathname + location.search}</output> }
it.each([
  ['/imports', '/library?add=extension'],
  ['/imports?batch=abc-123', '/library?add=records&batch=abc-123'],
  ['/imports?batch=%3Cunsafe%3E', '/library?add=records&batch=%3Cunsafe%3E'],
])('preserves import receipt navigation from %s', async (source, target) => {
  render(<MemoryRouter initialEntries={[source]}><Routes><Route path="/imports" element={<ImportsRedirect />} /><Route path="/library" element={<Address />} /></Routes></MemoryRouter>)
  expect(await screen.findByRole('status', { name: '地址' })).toHaveTextContent(target)
})
