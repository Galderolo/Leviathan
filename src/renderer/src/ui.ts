import type React from 'react'
import { useStore, type FormField, type MenuItem, type Toast } from './store'

let toastId = 0

export function toast(kind: Toast['kind'], text: string): void {
  const id = ++toastId
  useStore.setState((s) => ({ toasts: [...s.toasts, { id, kind, text }] }))
  setTimeout(() => dismissToast(id), kind === 'error' ? 9000 : 3500)
}

export function dismissToast(id: number): void {
  useStore.setState((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) }))
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function openMenu(at: React.MouseEvent | { x: number; y: number }, items: MenuItem[]): void {
  if ('preventDefault' in at) {
    at.preventDefault()
    at.stopPropagation()
  }
  const x = 'clientX' in at ? at.clientX : at.x
  const y = 'clientY' in at ? at.clientY : at.y
  useStore.setState({ menu: { x, y, items } })
}

/** Opens a menu right below the element that was clicked. */
export function openMenuBelow(e: React.MouseEvent, items: MenuItem[]): void {
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  e.stopPropagation()
  openMenu({ x: rect.left, y: rect.bottom + 4 }, items)
}

export function closeMenu(): void {
  useStore.setState({ menu: null })
}

type DialogOptions = {
  title: string
  message?: string
  fields: FormField[]
  confirmText: string
  danger?: boolean
}

/** Dialogs waiting for the one on screen to close (e.g. a credential prompt during another dialog). */
const pendingDialogs: (() => void)[] = []

export function formDialog(opts: DialogOptions): Promise<Record<string, string> | null> {
  return new Promise((resolve) => {
    const show = () =>
      useStore.setState({
        dialog: {
          ...opts,
          resolve: (values) => {
            useStore.setState({ dialog: null })
            resolve(values)
            pendingDialogs.shift()?.()
          }
        }
      })
    if (useStore.getState().dialog) pendingDialogs.push(show)
    else show()
  })
}

export async function promptText(opts: {
  title: string
  label: string
  value?: string
  placeholder?: string
  confirmText: string
}): Promise<string | null> {
  const values = await formDialog({
    title: opts.title,
    confirmText: opts.confirmText,
    fields: [{ key: 'value', label: opts.label, value: opts.value, placeholder: opts.placeholder }]
  })
  const value = values?.value?.trim()
  return value ? value : null
}

export async function confirmDialog(opts: {
  title: string
  message: string
  confirmText: string
  danger?: boolean
}): Promise<boolean> {
  return (await formDialog({ ...opts, fields: [] })) !== null
}

export async function copyText(text: string, successText: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
    toast('info', successText)
  } catch (err) {
    toast('error', errorMessage(err))
  }
}
