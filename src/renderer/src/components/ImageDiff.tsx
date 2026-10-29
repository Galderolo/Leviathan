import { useEffect, useState } from 'react'
import type { ImagePair, ImageVersion } from '../../../shared/images'
import type { DiffSource } from '../../../shared/types'
import { useT } from '../i18n'
import { formatSize } from '../lfsView'
import { errorMessage } from '../ui'
import { cx } from '../utils'

/**
 * An image change shown as the pictures before and after, instead of "binary file" or the text of a Git LFS
 * pointer. Give it a `key` per file; `version` changes whenever the diff was read again (the file changed), and the
 * pictures are read again without blanking the ones on screen.
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

  if (error) return <div className="empty-state error">{error}</div>
  if (!pair) return <div className="empty-state">{t('graph.loading')}</div>
  const { before, after } = pair
  if (!before && !after) return <div className="empty-state">{t('image.none')}</div>
  const same = !!before?.url && before.url === after?.url
  return (
    <div className={cx('image-diff', labels && 'sides')}>
      {same && <div className="image-same">{t('image.same')}</div>}
      <div className="image-sides">
        {before && !same && (
          <ImageSide
            label={labels?.before ?? t(after ? 'image.before' : 'image.removed')}
            version={before}
            side="before"
          />
        )}
        {after && (
          <ImageSide label={labels?.after ?? t(before ? 'image.after' : 'image.added')} version={after} side="after" />
        )}
      </div>
    </div>
  )
}

function ImageSide({ label, version, side }: { label: string; version: ImageVersion; side: 'before' | 'after' }) {
  const t = useT()
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)
  const [broken, setBroken] = useState(false)
  return (
    <figure className={cx('image-side', side)}>
      <figcaption>
        <span className="image-label">{label}</span>
        <span className="image-meta">
          {size && `${size.width} × ${size.height} · `}
          {version.bytes < 1024 ? `${version.bytes} B` : formatSize(version.bytes)}
        </span>
      </figcaption>
      <div className="image-frame">
        {version.url && !broken ? (
          <img
            src={version.url}
            alt={label}
            onLoad={(e) => setSize({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight })}
            onError={() => setBroken(true)}
          />
        ) : (
          <div className="empty-state">
            {t(broken ? 'image.broken' : version.missing === 'lfs' ? 'image.notDownloaded' : 'image.tooLarge')}
          </div>
        )}
      </div>
    </figure>
  )
}
