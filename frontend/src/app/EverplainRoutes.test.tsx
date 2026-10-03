import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppRoutes } from './App'

vi.mock('@paper-design/shaders-react', () => ({ GrainGradient: () => null, MeshGradient: () => null, NeuroNoise: () => null, PaperTexture: () => null, ShaderMount: () => null, Warp: () => null }))
afterEach(cleanup)
function Location() {
  const location = useLocation()
  return <output aria-label="Current address">{`${location.pathname}${location.search}`}</output>
}
function renderRoute(path: string) {
  render(<MemoryRouter initialEntries={[path]}><QueryClientProvider client={new QueryClient()}><AppRoutes sessionState={{ status: 'anonymous' }} /><Location /></QueryClientProvider></MemoryRouter>)
}
describe('Everplain private library entry', () => {
  it.each(['/library', '/library/knowledge'])('requires an account before opening %s', async (path) => {
    renderRoute(path)
    expect(await screen.findByRole('heading', { name: '登录 Everplain' })).toBeVisible()
    expect(screen.getByRole('status', { name: 'Current address' })).toHaveTextContent(`/login?redirect=${encodeURIComponent(path)}`)
  })
  it.each(['/courses', '/courses/join?code=old-invite', '/knowledge', '/knowledge/graph', '/knowledge/old-entry'])('sends the retired public entry %s to the personal library', async (path) => {
    renderRoute(path)
    expect(await screen.findByRole('heading', { name: '登录 Everplain' })).toBeVisible()
    expect(screen.getByRole('status', { name: 'Current address' })).toHaveTextContent('/login?redirect=%2Flibrary')
  })
})


it('opens the login return address from the public thought composer', async () => {
  renderRoute('/')
  fireEvent.change((await screen.findAllByRole('textbox', { name: '你的想法' }))[0], { target: { value: '整理读书笔记' } })
  fireEvent.click(screen.getAllByRole('button', { name: '开始对话' })[0])
  expect(await screen.findByRole('heading', { name: '登录 Everplain' })).toBeVisible()
  expect(screen.getByRole('status', { name: 'Current address' })).toHaveTextContent('/login?redirect=%2Fagent%3Fprompt%3D%25E6%2595%25B4%25E7%2590%2586%25E8%25AF%25BB%25E4%25B9%25A6%25E7%25AC%2594%25E8%25AE%25B0')
})

it('preserves a prepared research question through login', async () => {
  renderRoute('/agent?prompt=compare%20my%20notes')
  expect(await screen.findByRole('heading', { name: '登录 Everplain' })).toBeVisible()
  expect(screen.getByRole('status', { name: 'Current address' })).toHaveTextContent('/login?redirect=%2Fagent%3Fprompt%3Dcompare%2520my%2520notes')
})
