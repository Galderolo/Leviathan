import { useEffect, useState } from 'react'
import { DIFF_TOOLS, EDITOR_PRESETS } from '../../../shared/externalTools'
import { installCommandLine, saveSettings } from '../actions'
import { useT } from '../i18n'
import { useStore } from '../store'
import { copyText } from '../ui'

const api = window.leviathan

/** Editor, diff/merge tool and the `leviathan` command; each change is saved at once. */
export function ExternalToolsSettings() {
  const t = useT()
  const settings = useStore((s) => s.settings)
  const preset = EDITOR_PRESETS.find((p) => p.command === settings.editor)
  const [choice, setChoice] = useState(settings.editor ? (preset?.id ?? 'custom') : '')
  const [command, setCommand] = useState(settings.editor)
  const [cli, setCli] = useState<{ windows: boolean; packaged: boolean; command: string | null } | null>(null)

  useEffect(() => {
    void api.commandLineInfo().then(setCli, () => setCli(null))
  }, [])

  const pick = (id: string) => {
    setChoice(id)
    const next =
      id === 'custom'
        ? command || 'code --goto "{file}:{line}"'
        : (EDITOR_PRESETS.find((p) => p.id === id)?.command ?? '')
    setCommand(next)
    void saveSettings({ editor: next })
  }

  return (
    <div className="tools-section">
      <div className="ssh-title">{t('tools.title')}</div>
      <label className="field">
        <span>{t('tools.editor')}</span>
        <select value={choice} onChange={(e) => pick(e.target.value)}>
          <option value="">{t('tools.systemDefault')}</option>
          {EDITOR_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
          <option value="custom">{t('tools.custom')}</option>
        </select>
      </label>
      {choice === 'custom' && (
        <label className="field">
          <span className="dim small">{t('tools.commandHint')}</span>
          <input
            value={command}
            spellCheck={false}
            onChange={(e) => setCommand(e.target.value)}
            onBlur={() => void saveSettings({ editor: command.trim() })}
          />
        </label>
      )}
      <label className="field">
        <span>{t('tools.diffTool')}</span>
        <select value={settings.diffTool} onChange={(e) => void saveSettings({ diffTool: e.target.value })}>
          <option value="">{t('tools.gitConfigured')}</option>
          {DIFF_TOOLS.map((tool) => (
            <option key={tool} value={tool}>
              {tool}
            </option>
          ))}
        </select>
      </label>
      <div className="field">
        <span>{t('tools.commandLine')}</span>
        {cli?.windows ? (
          <div className="input-row">
            <button
              type="button"
              className="btn small"
              disabled={!cli.packaged}
              onClick={() => void installCommandLine()}
            >
              {t('tools.installCommand')}
            </button>
            <span className="dim small">{cli.packaged ? t('tools.installHint') : t('tools.installedBuildsOnly')}</span>
          </div>
        ) : cli?.command ? (
          <div className="input-row">
            <code className="cli-command">{cli.command}</code>
            <button type="button" className="btn small" onClick={() => void copyText(cli.command!, t('toast.copied'))}>
              {t('ssh.copy')}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}
