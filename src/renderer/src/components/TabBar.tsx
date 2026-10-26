import { useState } from 'react'
import type React from 'react'
import { FolderGit2, Plus, Sparkles, X } from 'lucide-react'
import { closeTab, newTab, reorderTab, setActiveTab } from '../actions'
import { useT } from '../i18n'
import { useStore } from '../store'
import { basename, cx } from '../utils'

export function TabBar() {
  const tabs = useStore((s) => s.tabs)
  const activeTab = useStore((s) => s.activeTab)
  const t = useT()
  // Tab being dragged, and the gap between tabs it would land in.
  const [dragging, setDragging] = useState<string | null>(null)
  const [gap, setGap] = useState<number | null>(null)

  const endDrag = () => {
    setDragging(null)
    setGap(null)
  }
  /** Gap under the pointer: before the tab when over its left half, after it over the right half. */
  const gapAt = (e: React.DragEvent): number => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('.tab')
    if (!el) return tabs.length
    const rect = el.getBoundingClientRect()
    const index = Number(el.dataset.index)
    return e.clientX > rect.left + rect.width / 2 ? index + 1 : index
  }
  const from = tabs.findIndex((tab) => tab.id === dragging)
  // No marker where the drop would leave the tab in place.
  const marker = gap !== null && from !== -1 && gap !== from && gap !== from + 1 ? gap : null

  return (
    <div className="tabbar">
      <div className="brand" title="Leviathan">
        <img src="./leviathan.png" alt="" width={18} height={18} />
      </div>
      <div
        className="tabs"
        onDragOver={(e) => {
          if (dragging === null) return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'
          const next = gapAt(e)
          if (next !== gap) setGap(next)
        }}
        onDrop={(e) => {
          if (dragging === null) return
          e.preventDefault()
          reorderTab(dragging, gapAt(e))
          endDrag()
        }}
      >
        {tabs.map((tab, index) => (
          <div
            key={tab.id}
            data-index={index}
            className={cx(
              'tab',
              tab.id === activeTab && 'active',
              tab.id === dragging && 'dragging',
              marker === index && 'drop-before',
              marker === tabs.length && index === tabs.length - 1 && 'drop-after'
            )}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = 'move'
              e.dataTransfer.setData('text/plain', tab.path ?? '')
              setDragging(tab.id)
            }}
            onDragEnd={endDrag}
            onMouseDown={(e) => {
              if (e.button === 1) {
                e.preventDefault()
                closeTab(tab.id)
              } else if (e.button === 0) setActiveTab(tab.id)
            }}
            title={tab.path ?? t('tab.newTab')}
          >
            {tab.path ? <FolderGit2 size={14} /> : <Sparkles size={14} />}
            <span className="tab-title">{tab.path ? basename(tab.path) : t('tab.newTab')}</span>
            <button
              className="tab-close"
              title={t('tab.close')}
              draggable={false}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => closeTab(tab.id)}
            >
              <X size={12} />
            </button>
          </div>
        ))}
        <button className="tab-new" title={`${t('tab.newTab')} (Ctrl+T)`} onClick={newTab}>
          <Plus size={16} />
        </button>
      </div>
    </div>
  )
}
