import type React from 'react'
import type { GitRef } from '../../../shared/types'
import { REF_MIME } from '../dragDrop'
import { t } from '../i18n'
import { dropMenu } from '../menus'
import { getRepo } from '../store'
import { openMenu, toast } from '../ui'

/** Props that make an element a draggable branch/tag. */
export function refDragProps(ref: GitRef) {
  return {
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      e.dataTransfer.setData(REF_MIME, ref.fullName)
      e.dataTransfer.effectAllowed = 'move'
    }
  }
}

/** Props that let another ref be dropped on `ref` to merge or rebase. */
export function refDropProps(path: string, ref: GitRef) {
  const accepts = (e: React.DragEvent) => e.dataTransfer.types.includes(REF_MIME)
  return {
    onDragOver: (e: React.DragEvent) => {
      if (!accepts(e)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      e.currentTarget.classList.add('drop-over')
    },
    onDragLeave: (e: React.DragEvent) => e.currentTarget.classList.remove('drop-over'),
    onDrop: (e: React.DragEvent) => {
      e.currentTarget.classList.remove('drop-over')
      if (!accepts(e)) return
      e.preventDefault()
      const source = getRepo(path)?.state?.refs.find((r) => r.fullName === e.dataTransfer.getData(REF_MIME))
      if (!source) return
      const items = dropMenu(path, source, ref)
      if (items.length) openMenu({ x: e.clientX, y: e.clientY }, items)
      else toast('info', t('toast.nothingToDrop'))
    }
  }
}
