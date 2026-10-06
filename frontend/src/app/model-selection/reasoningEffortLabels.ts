import type { ReasoningEffort } from './modelSelection'

/** One exhaustive display vocabulary for the catalog controls and summary. */
export const effortLabels: Record<ReasoningEffort, readonly [string, string]> = {
  none: ['无', 'None'],
  enabled: ['开启', 'On'],
  minimal: ['极低', 'Minimal'],
  low: ['低', 'Low'],
  medium: ['中', 'Medium'],
  high: ['高', 'High'],
  xhigh: ['很高', 'XHigh'],
  max: ['最高', 'Max'],
}
