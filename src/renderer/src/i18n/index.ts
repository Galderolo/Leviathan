import { useCallback } from 'react'
import { useStore } from '../store'
import en from './en'
import es from './es'

export type Lang = 'en' | 'es'
export type TKey = keyof typeof en
export type Vars = Record<string, string | number>

const dictionaries: Record<Lang, Record<TKey, string>> = { en, es }

export const LANGUAGES: { value: Lang; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Español' }
]

export function resolveLang(setting: 'auto' | Lang): Lang {
  if (setting !== 'auto') return setting
  const nav = (navigator.language || 'en').toLowerCase()
  return nav.startsWith('es') ? 'es' : 'en'
}

/**
 * Looks up `key`, preferring `key_one` when `vars.count === 1` and such a
 * variant exists (enough pluralisation for English and Spanish).
 */
export function translate(lang: Lang, key: TKey, vars?: Vars): string {
  const dict = dictionaries[lang] as Record<string, string>
  const singular = vars?.count === 1 ? dict[`${key}_one`] : undefined
  let text = singular ?? dictionaries[lang][key] ?? en[key] ?? key
  if (vars) for (const [k, v] of Object.entries(vars)) text = text.split(`{${k}}`).join(String(v))
  return text
}

/** Translate outside React components. */
export function t(key: TKey, vars?: Vars): string {
  return translate(useStore.getState().lang, key, vars)
}

/** Translate inside components (re-renders when the language changes). */
export function useT(): (key: TKey, vars?: Vars) => string {
  const lang = useStore((s) => s.lang)
  return useCallback((key: TKey, vars?: Vars) => translate(lang, key, vars), [lang])
}
