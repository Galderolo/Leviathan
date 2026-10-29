import { useEffect, useState } from 'react'
import { Columns2, Layers, SquareSplitHorizontal } from 'lucide-react'
import type { ImagePair, ImageVersion } from '../../../shared/images'
import type { DiffSource } from '../../../shared/types'
import { useT } from '../i18n'
import { formatSize } from '../lfsView'
import { errorMessage } from '../ui'
import { cx } from '../utils'

/** How two images of the same size are compared: side by side, a divider swiped across, or one over the other. */
type Mode = 'sides' | 'swipe' | 'onion'
type Size = { width: number; height: number }

const MODE_KEY = 'leviathan.imageCompare'

function savedMode(): Mode {
  try {
    const mode = localStorage.getItem(MODE_KEY)
    return mode === 'swipe' || mode === 'onion' ? mode : 'sides'
  } catch {
    return 'sides'
  }
}

function saveMode(mode: Mode): void {
  try {
    localStorage.setItem(MODE_KEY, mode)
  } catch {
    // not critical: the next diff starts side by side
  }
}

const bytesText = (bytes: number) => (bytes < 1024 ? `${bytes} B` : formatSize(bytes))

/**
 * An image change shown as the pictures before and after, instead of "binary file" or the text of a Git LFS
 * pointer; two of the same size can also be compared with a divider or one over the other. Give it a `key` per
 * file; `version` changes whenever the diff was read again (the file changed), and the pictures are read again
 * without blanking the ones on screen.
 */
export function ImageDiff({
  repo,
  source,
  version,
  labels
}: {
  repo: string
  source: DiffSource
  version: unknown
  /** In place of before / after (a conflict's two sides). */
  labels?: { before: string; after: string }
}) {
  const t = useT()
  const [pair, setPair] = useState<ImagePair | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<Mode>(savedMode)
  // Each picture's size in pixels, by its data URL, once the window has read it.
  const [sizes, setSizes] = useState<Record<string, Size>>({})

  useEffect(() => {
    let live = true
    window.leviathan.getImages(repo, source).then(
      (next) => {
        if (!live) return
        setPair(next)
        setError(null)
      },
      (err) => live && setError(errorMessage(err))
    )
    return () => {
      live = false
    }
    // The source is a new object with each diff read: `version` says when to read again.
  }, [repo, version])

  useEffect(() => {
    let live = true
    for (const url of [pair?.before?.url, pair?.after?.url]) {
      if (!url) continue
      const image = new Image()
      image.onload = () =>
        live && setSizes((s) => ({ ...s, [url]: { width: image.naturalWidth, height: image.naturalHeight } }))
      image.src = url
    }
    return () => {
      live = false
    }
  }, [pair])

  if (error) return <div className="empty-state error">{error}</div>
  if (!pair) return <div className="empty-state">{t('graph.loading')}</div>
  const { before, after } = pair
  if (!before && !after) return <div className="empty-state">{t('image.none')}</div>
  const same = !!before?.url && before.url === after?.url
  const beforeLabel = labels?.before ?? t(after ? 'image.before' : 'image.removed')
  const afterLabel = labels?.after ?? t(before ? 'image.after' : 'image.added')
  const beforeSize = before?.url ? sizes[before.url] : undefined
  const afterSize = after?.url ? sizes[after.url] : undefined
  const comparable =
    !same &&
    !!beforeSize &&
    !!afterSize &&
    beforeSize.width === afterSize.width &&
    beforeSize.height === afterSize.height
  const shown = comparable ? mode : 'sides'
  const pick = (next: Mode) => {
    setMode(next)
    saveMode(next)
  }

  return (
    <div className={cx('image-diff', labels && 'sides')}>
      {same && <div className="image-same">{t('image.same')}</div>}
      {comparable && (
        <span className="layout-toggle image-modes">
          <button
            className={cx('icon-btn', shown === 'sides' && 'on')}
            title={t('image.sides')}
            onClick={() => pick('sides')}
          >
            <Columns2 size={15} />
          </button>
          <button
            className={cx('icon-btn', shown === 'swipe' && 'on')}
            title={t('image.swipe')}
            onClick={() => pick('swipe')}
          >
            <SquareSplitHorizontal size={15} />
          </button>
          <button
            className={cx('icon-btn', shown === 'onion' && 'on')}
            title={t('image.onion')}
            onClick={() => pick('onion')}
          >
            <Layers size={15} />
          </button>
        </span>
      )}
      {shown === 'sides' ? (
        <div className="image-sides">
          {before && !same && <ImageSide label={beforeLabel} version={before} size={beforeSize} side="before" />}
          {after && <ImageSide label={afterLabel} version={after} size={afterSize} side="after" />}
        </div>
      ) : (
        <ImageCompare
          mode={shown}
          before={{ label: beforeLabel, version: before!, url: before!.url! }}
          after={{ label: afterLabel, version: after!, url: after!.url! }}
          size={beforeSize!}
        />
      )}
    </div>
  )
}

/** Two pictures of the same size, one over the other: cut by a divider (`swipe`) or seen through (`onion`). */
function ImageCompare({
  mode,
  before,
  after,
  size
}: {
  mode: 'swipe' | 'onion'
  before: { label: string; version: ImageVersion; url: string }
  after: { label: string; version: ImageVersion; url: string }
  size: Size
}) {
  const t = useT()
  // Where the divider is, or how much of the second picture shows, in percent.
  const [amount, setAmount] = useState(50)
  const meta = `${size.width} × ${size.height}`
  return (
    <div className="image-compare">
      <div className="image-compare-captions">
        <span className="image-side before">
          <span className="image-label">{before.label}</span>{' '}
          <span className="image-meta">
            {meta} · {bytesText(before.version.bytes)}
          </span>
        </span>
        <span className="image-side after">
          <span className="image-label">{after.label}</span>{' '}
          <span className="image-meta">
            {meta} · {bytesText(after.version.bytes)}
          </span>
        </span>
      </div>
      <div className="image-frame">
        <div
          className="image-stack"
          style={{ width: `min(100%, ${size.width}px)`, aspectRatio: `${size.width} / ${size.height}` }}
        >
          <img src={before.url} alt={before.label} />
          <img
            src={after.url}
            alt={after.label}
            style={mode === 'swipe' ? { clipPath: `inset(0 0 0 ${amount}%)` } : { opacity: amount / 100 }}
          />
          {mode === 'swipe' && <div className="image-divider" style={{ left: `${amount}%` }} />}
        </div>
      </div>
      <input
        className="image-amount"
        type="range"
        min={0}
        max={100}
        value={amount}
        aria-label={t(mode === 'swipe' ? 'image.swipe' : 'image.onion')}
        onChange={(e) => setAmount(Number(e.target.value))}
      />
    </div>
  )
}

function ImageSide({
  label,
  version,
  size,
  side
}: {
  label: string
  version: ImageVersion
  size: Size | undefined
  side: 'before' | 'after'
}) {
  const t = useT()
  const [broken, setBroken] = useState(false)
  return (
    <figure className={cx('image-side', side)}>
      <figcaption>
        <span className="image-label">{label}</span>
        <span className="image-meta">
          {size && `${size.width} × ${size.height} · `}
          {bytesText(version.bytes)}
        </span>
      </figcaption>
      <div className="image-frame">
        {version.url && !broken ? (
          <img src={version.url} alt={label} onError={() => setBroken(true)} />
        ) : (
          <div className="empty-state">
            {t(
              broken || version.missing === 'unreadable'
                ? 'image.broken'
                : version.missing === 'lfs'
                  ? 'image.notDownloaded'
                  : 'image.tooLarge'
            )}
          </div>
        )}
      </div>
    </figure>
  )
}
