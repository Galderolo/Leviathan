/** The images the app shows instead of a diff, by extension: those a browser can draw. */
const IMAGE_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  avif: 'image/avif'
}

/** Larger images are not sent to the window (each is read whole and passed as a data URL). */
export const IMAGE_PREVIEW_MAX = 20 * 1024 * 1024

/** The media type of an image the app can show, by the file's extension; null for any other file. */
export function imageType(path: string): string | null {
  const dot = path.lastIndexOf('.')
  if (dot < 0 || dot < path.lastIndexOf('/')) return null
  return IMAGE_TYPES[path.slice(dot + 1).toLowerCase()] ?? null
}

/** One side of an image change. */
export interface ImageVersion {
  /** The image as a data URL; null when it cannot be shown (`missing` says why). */
  url: string | null
  /** Its size in bytes (the real file's, for a file in Git LFS). */
  bytes: number
  /** A Git LFS file whose content is not downloaded here, or an image over `IMAGE_PREVIEW_MAX`. */
  missing?: 'lfs' | 'large'
}

/** An image before and after a change: null on the side where the file does not exist. */
export interface ImagePair {
  before: ImageVersion | null
  after: ImageVersion | null
}

/** The object a Git LFS pointer stands for, or null when `text` is not a pointer. */
export function parseLfsPointer(text: string): { oid: string; size: number } | null {
  if (!text.startsWith('version https://git-lfs.github.com/spec/')) return null
  const oid = /^oid sha256:([0-9a-f]{64})$/m.exec(text)?.[1]
  const size = /^size (\d+)$/m.exec(text)?.[1]
  return oid && size ? { oid, size: Number(size) } : null
}
