import type { LeviathanApi } from '../shared/api'

declare global {
  interface Window {
    leviathan: LeviathanApi
  }
}

export {}
