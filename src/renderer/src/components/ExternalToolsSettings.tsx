import { useEffect, useState } from 'react'
import { DIFF_TOOLS, EDITOR_PRESETS, terminalPresets } from '../../../shared/externalTools'
import { installCommandLine, saveSettings } from '../actions'
import { useT } from '../i18n'
import { useStore } from '../store'
import { copyText } from '../ui'

const api = window.leviathan

/** The choice that follows the general setting, in a repository's own settings. */
export const GENERAL = '*general'

type Preset = { id: string; label: string; command: string }

/** How a command reads in a list: its preset's name, the command itself, or what an empty one does. */
export function commandLabel(presets: Preset[], command: string, systemLabel: string): string {
  return command ? (presets.find((p) => p.command === command)?.label ?? command) : systemLabel
}

/** A program picked among presets or typed as a command, with a system default; each change is saved at once. */
export function CommandChoice(props: {
  label: string
  /** What an empty command does. */
  systemLabel: string
  presets: Preset[]
  /** `undefined`: the general one (with `general`). */
  value: string | undefined
  /** The command to start from when "Other (command)" is picked with nothing typed yet. */
  example: string
  hint: string
  /** For a repository's own settings: how following the general setting reads. */
  general?: string
  save: (command: string | undefined) => void
}) {
  const t = useT()
  const preset = props.presets.find((p) => p.command === props.value)
  const [choice, setChoice] = useState(
    props.value === undefined ? GENERAL : props.value ? (preset?.id ?? 'custom') : ''
  )
  const [command, setCommand] = useState(props.value ?? '')

  const pick = (id: string) => {
    setChoice(id)
    if (id === GENERAL) return props.save(undefined)
    const next = id === 'custom' ? command || props.example : (props.presets.find((p) => p.id === id)?.command ?? '')
    setCommand(next)
    props.save(next)
  }

  return (
    <>
      <label className="field">
        <span>{props.label}</span>
        <select value={choice} onChange={(e) => pick(e.target.value)}>
          {props.general !== undefined && <option value={GENERAL}>{props.general}</option>}
          <option value="">{props.systemLabel}</option>
          {props.presets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
          <option value="custom">{t('tools.custom')}</option>
        </select>
      </label>
      {choice === 'custom' && (
        <label className="field">
          <span className="dim small">{props.hint}</span>
          <input
            value={command}
            spellCheck={false}
            onChange={(e) => setCommand(e.target.value)}
            onBlur={() => props.save(command.trim())}
          />
        </label>
      )}
    </>
  )
}

/** Editor, terminal, diff/merge tool and the `leviathan` command; each change is saved at once. */
export function ExternalToolsSettings() {
  const t = useT()
  const settings = useStore((s) => s.settings)
  const terminals = terminalPresets(api.platform)
  const [cli, setCli] = useState<{ windows: boolean; packaged: boolean; command: string | null } | null>(null)

  useEffect(() => {
    void api.commandLineInfo().then(setCli, () => setCli(null))
  }, [])

  return (
    <div className="tools-section">
      <div className="ssh-title">{t('tools.title')}</div>
      <CommandChoice
        label={t('tools.editor')}
        systemLabel={t('tools.systemDefault')}
        presets={EDITOR_PRESETS}
        value={settings.editor}
        example='code --goto "{file}:{line}"'
        hint={t('tools.commandHint')}
        save={(editor) => void saveSettings({ editor: editor ?? '' })}
      />
      <CommandChoice
        label={t('tools.terminal')}
        systemLabel={t('tools.systemTerminal')}
        presets={terminals}
        value={settings.terminal}
        example={terminals[0].command}
        hint={t('tools.terminalHint')}
        save={(terminal) => void saveSettings({ terminal: terminal ?? '' })}
      />
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
