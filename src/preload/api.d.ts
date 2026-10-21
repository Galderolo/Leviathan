import type { CalamarApi } from '../shared/api'

declare global {
  interface Window {
    calamar: CalamarApi
  }
}

export {}
