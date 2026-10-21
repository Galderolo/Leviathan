import { FolderGit2, Plus, Sparkles, X } from 'lucide-react'
import { closeTab, newTab, setActiveTab } from '../actions'
import { useT } from '../i18n'
import { useStore } from '../store'
import { basename, cx } from '../utils'

export function TabBar() {
  const tabs = useStore((s) => s.tabs)
  const activeTab = useStore((s) => s.activeTab)
  const t = useT()

  return (
    <div className="tabbar">
      <div className="brand" title="Calamar">
        <img src="./calamar.svg" alt="" width={18} height={18} />
      </div>
      <div className="tabs">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={cx('tab', tab.id === activeTab && 'active')}
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
