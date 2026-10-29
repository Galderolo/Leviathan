import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Lock, X } from 'lucide-react'
import type { LfsLock } from '../../../shared/lfs'
import type { FileStatus } from '../../../shared/types'
import { useT } from '../i18n'
import { useStore } from '../store'
import { closeMenu, dismissToast } from '../ui'
import { cx, hashColor, initials } from '../utils'

/** The author's picture when Settings shows avatars and one was found; their initials otherwise. */
export function Avatar({ name, email, size = 22 }: { name: string; email: string; size?: number }) {
  const picture = useStore((s) => s.avatars[email.trim().toLowerCase()])
  const title = `${name} <${email}>`
  if (picture) {
    return <img className="avatar" src={picture} width={size} height={size} alt="" title={title} draggable={false} />
  }
  return (
    <span
      className="avatar"
      style={{ width: size, height: size, fontSize: size * 0.4, background: hashColor(email || name) }}
      title={title}
    >
      {initials(name)}
    </span>
  )
}

const STATUS_CLASS: Record<FileStatus, string> = {
  A: 'added',
  '?': 'added',
  M: 'modified',
  D: 'deleted',
  R: 'renamed',
  C: 'renamed',
  U: 'conflict'
}

export function StatusBadge({ status }: { status: FileStatus }) {
  const label = status === '?' ? '+' : status === 'A' ? '+' : status === 'D' ? '−' : status === 'M' ? '•' : status
  return <span className={cx('status-badge', STATUS_CLASS[status])}>{label}</span>
}

export function LockIcon({ lock }: { lock: LfsLock }) {
  const t = useT()
  const owner = lock.mine ? t('lfs.lockedByYou') : t('lfs.lockedBy', { owner: lock.owner })
  return (
    <span className={cx('lock-icon', lock.mine ? 'mine' : lock.mine === false ? 'theirs' : 'unknown')} title={owner}>
      <Lock size={12} />
    </span>
  )
}

export function ContextMenu() {
  const menu = useStore((s) => s.menu)
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)

  useLayoutEffect(() => {
    if (!menu || !ref.current) {
      setPos(null)
      return
    }
    const rect = ref.current.getBoundingClientRect()
    const x = Math.min(menu.x, window.innerWidth - rect.width - 6)
    const y = Math.min(menu.y, window.innerHeight - rect.height - 6)
    setPos({ x: Math.max(4, x), y: Math.max(4, y) })
  }, [menu])

  useEffect(() => {
    if (!menu) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeMenu()
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) closeMenu()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('blur', closeMenu)
    window.addEventListener('resize', closeMenu)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('blur', closeMenu)
      window.removeEventListener('resize', closeMenu)
    }
  }, [menu])

  if (!menu) return null
  return (
    <div
      ref={ref}
      className="context-menu"
      style={{ left: pos?.x ?? menu.x, top: pos?.y ?? menu.y, visibility: pos ? 'visible' : 'hidden' }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {menu.items.map((item, i) =>
        'separator' in item ? (
          <div key={i} className="menu-separator" />
        ) : (
          <button
            key={i}
            className={cx('menu-item', item.danger && 'danger')}
            disabled={item.disabled}
            onClick={() => {
              closeMenu()
              item.onClick()
            }}
          >
            <span>{item.label}</span>
            {item.hint && <span className="menu-hint">{item.hint}</span>}
          </button>
        )
      )}
    </div>
  )
}

/** A checklist's value, one picked value per line, with `value` checked or not. */
function toggleLine(lines: string, value: string, checked: boolean): string {
  const rest = lines.split('\n').filter((line) => line && line !== value)
  return (checked ? [...rest, value] : rest).join('\n')
}

export function Dialog() {
  const dialog = useStore((s) => s.dialog)
  const t = useT()
  const [values, setValues] = useState<Record<string, string>>({})
  const firstInput = useRef<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null>(null)
  const confirmBtn = useRef<HTMLButtonElement>(null)

  // Before the dialog is painted: a value typed at once must not be overwritten by the first values.
  useLayoutEffect(() => {
    if (!dialog) return
    setValues(Object.fromEntries(dialog.fields.map((f) => [f.key, f.value ?? ''])))
    setTimeout(() => {
      if (firstInput.current) {
        firstInput.current.focus()
        if (firstInput.current instanceof HTMLInputElement) firstInput.current.select()
      } else confirmBtn.current?.focus()
    }, 0)
  }, [dialog])

  if (!dialog) return null
  const primary = dialog.choices && (dialog.choices.find((c) => c.primary) ?? dialog.choices[0])
  const submit = (choice = primary?.key) => dialog.resolve(choice ? { ...values, choice } : values)
  const cancel = () => dialog.resolve(null)
  // Added to the latest values, not to those of the render the handler came from: quick typing loses nothing.
  const setField = (key: string, value: string) => setValues((v) => ({ ...v, [key]: value }))

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && cancel()}>
      <form
        className={cx('modal', dialog.choices && 'choice-modal')}
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') cancel()
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit()
        }}
      >
        <div className="modal-title">{dialog.title}</div>
        {dialog.message && <p className="modal-message">{dialog.message}</p>}
        {dialog.list && (
          <ul className="modal-list">
            {dialog.list.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        )}
        {dialog.note && <p className="modal-message">{dialog.note}</p>}
        {dialog.fields.map((field, i) =>
          field.type === 'checklist' ? (
            <div key={field.key} className="field">
              <span>{field.label}</span>
              <div className="checklist">
                {field.options?.map((o) => (
                  <label key={o.value} className="checklist-row">
                    <input
                      type="checkbox"
                      checked={(values[field.key] ?? '').split('\n').includes(o.value)}
                      onChange={(e) => {
                        const checked = e.target.checked
                        setValues((v) => ({ ...v, [field.key]: toggleLine(v[field.key] ?? '', o.value, checked) }))
                      }}
                    />
                    <span className="checklist-label">{o.label}</span>
                    {o.note && <span className="checklist-note">{o.note}</span>}
                  </label>
                ))}
              </div>
            </div>
          ) : (
            <label key={field.key} className="field">
              <span>{field.label}</span>
              {field.type === 'select' ? (
                <select
                  ref={i === 0 ? (el) => void (firstInput.current = el) : undefined}
                  value={values[field.key] ?? ''}
                  onChange={(e) => setField(field.key, e.target.value)}
                >
                  {field.options?.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              ) : field.multiline ? (
                <textarea
                  ref={i === 0 ? (el) => void (firstInput.current = el) : undefined}
                  rows={4}
                  value={values[field.key] ?? ''}
                  placeholder={field.placeholder}
                  onChange={(e) => setField(field.key, e.target.value)}
                />
              ) : (
                <input
                  ref={i === 0 ? (el) => void (firstInput.current = el) : undefined}
                  type={field.type === 'number' || field.type === 'password' ? field.type : 'text'}
                  value={values[field.key] ?? ''}
                  placeholder={field.placeholder}
                  spellCheck={false}
                  onChange={(e) => setField(field.key, e.target.value)}
                />
              )}
            </label>
          )
        )}
        <div className="modal-actions">
          <button type="button" className="btn" onClick={cancel}>
            {t('common.cancel')}
          </button>
          {dialog.choices ? (
            dialog.choices.map((choice) =>
              choice === primary ? (
                <button key={choice.key} ref={confirmBtn} type="submit" className="btn btn-primary">
                  {choice.label}
                </button>
              ) : (
                <button
                  key={choice.key}
                  type="button"
                  className={cx('btn', choice.danger && 'btn-danger')}
                  onClick={() => submit(choice.key)}
                >
                  {choice.label}
                </button>
              )
            )
          ) : (
            <button ref={confirmBtn} type="submit" className={cx('btn', dialog.danger ? 'btn-danger' : 'btn-primary')}>
              {dialog.confirmText}
            </button>
          )}
        </div>
      </form>
    </div>
  )
}

export function Toasts() {
  const toasts = useStore((s) => s.toasts)
  return (
    <div className="toasts">
      {toasts.map((toast) => (
        <div key={toast.id} className={cx('toast', toast.kind)}>
          <pre>{toast.text}</pre>
          <button className="icon-btn" onClick={() => dismissToast(toast.id)}>
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  )
}

/**
 * Vertical drag handle that resizes a panel of width `value`.
 * `invert` is for panels on the right side (dragging left makes them wider).
 */
export function Resizer(props: {
  value: number
  min: number
  max: number
  invert?: boolean
  onChange: (value: number) => void
  onCommit: (value: number) => void
}) {
  return (
    <div
      className="resizer"
      onMouseDown={(e) => {
        e.preventDefault()
        // The left button only: a right click is not a drag.
        if (e.button !== 0) return
        const startX = e.clientX
        // From the width shown: a narrow window may show the panel narrower than its saved width.
        const panel = props.invert ? e.currentTarget.nextElementSibling : e.currentTarget.previousElementSibling
        const start = Math.round(panel?.getBoundingClientRect().width ?? props.value)
        let latest = start
        const move = (ev: MouseEvent) => {
          const delta = (ev.clientX - startX) * (props.invert ? -1 : 1)
          latest = Math.max(props.min, Math.min(props.max, start + delta))
          props.onChange(latest)
        }
        const up = () => {
          window.removeEventListener('mousemove', move)
          window.removeEventListener('mouseup', up)
          document.body.classList.remove('resizing')
          props.onCommit(latest)
        }
        document.body.classList.add('resizing')
        window.addEventListener('mousemove', move)
        window.addEventListener('mouseup', up)
      }}
    />
  )
}

export function Spinner({ size = 14 }: { size?: number }) {
  return <span className="spinner" style={{ width: size, height: size }} />
}
