import { Navigate, useLocation } from 'react-router'

export function ImportsRedirect() {
  const { search } = useLocation()
  const batch = new URLSearchParams(search).get('batch')
  const query = new URLSearchParams({ add: batch ? 'records' : 'extension' })
  if (batch) query.set('batch', batch)
  return <Navigate replace to={`/library?${query}`} />
}
