export type Classification = 'important' | 'async' | 'passive'

export interface RuleResult {
  matched: boolean
  classification?: Classification
  confidence?: number
  reason?: string
}
