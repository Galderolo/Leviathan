import { useState } from 'react'
import { DIFF_TOOLS, EDITOR_PRESETS, terminalPresets } from '../../../shared/externalTools'
import { ownSettings } from '../../../shared/repoSettings'
import type { PullMode, RepoSettingKey, Settings } from '../../../shared/types'
import { saveRepoSetting } from '../actions'
import { useT } from '../i18n'
import { useActiveTab, useStore } from '../store'
import { basename } from '../utils'
import { CommandChoice, GENERAL, commandLabel } from './ExternalToolsSettings'

const FETCH_MINUTES = [0, 1, 5, 10, 30]
const PULL_MODES: PullMode[] = ['ff', 'ff-only', 'rebase']

/** A value picked from a list whose first choice follows the general setting (`undefined`). */
function OwnChoice(props: {
  label: string
  /** How the general value reads. */
  general: string
  value: string | undefined
  options: { value: string; label: string }[]
  save: (value: string | undefined) => void
}) {
  const t = useT()
  return (
    <label className="field">
      <span>{props.label}</span>
      <select
        value={props.value ?? GENERAL}
        onChange={(e) => props.save(e.target.value === GENERAL ? undefined : e.target.value)}
      >
        <option value={GENERAL}>{t('repoSettings.general', { value: props.general })}</option>
        {props.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}

/** Commits loaded at a time; left empty, the general number. */
function OwnCommitLimit(props: {
  general: number
  value: number | undefined
  save: (value: number | undefined) => void
}) {
  const t = useT()
  const [text, setText] = useState(props.value === undefined ? '' : String(props.value))
  const save = () => {
    if (!text.trim()) {
      setText('')
      if (props.value !== undefined) props.save(undefined)
      return
    }
    const limit = Math.max(100, Math.min(50000, Number(text) || props.general))
    setText(String(limit))
    if (limit !== props.value) props.save(limit)
  }
  return (
    <label className="field">
      <span>{t('settings.commitLimit')}</span>
      <input
        type="number"
        min={100}
        max={50000}
        step={100}
        value={text}
        placeholder={t('repoSettings.general', { value: String(props.general) })}
        onChange={(e) => setText(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => e.key === 'Enter' && save()}
      />
    </label>
  )
}

/** The settings of the repository in the active tab, each one its own or the general one. */
export function RepoSettingsSection() {
  const t = useT()
  const path = useActiveTab()?.path ?? null
  if (!path) return <div className="dim">{t('repoSettings.none')}</div>
  // What was typed for one repository is not left in the fields of another.
  return <RepoSettingsOf key={path} path={path} />
}

function RepoSettingsOf({ path }: { path: string }) {
  const t = useT()
  const settings = useStore((s) => s.settings)
  const own = ownSettings(settings, path)
  const save = <K extends RepoSettingKey>(key: K, value: Settings[K] | undefined) =>
    void saveRepoSetting(path, key, value)
  const general = (value: string) => t('repoSettings.general', { value })

  const fetchLabel = (m: number) => (m === 0 ? t('settings.autoFetchOff') : t('settings.autoFetchEvery', { count: m }))
  // A number typed in settings.json by hand is kept in the list.
  const minutes =
    own.autoFetchMinutes === undefined || FETCH_MINUTES.includes(own.autoFetchMinutes)
      ? FETCH_MINUTES
      : [...FETCH_MINUTES, own.autoFetchMinutes]
  const pullLabels: Record<PullMode, string> = {
    ff: t('pull.ff'),
    'ff-only': t('pull.ffOnly'),
    rebase: t('pull.rebase')
  }
  const yesNo = [
    { value: 'true', label: t('repoSettings.yes') },
    { value: 'false', label: t('repoSettings.no') }
  ]
  const yesNoLabel = (on: boolean) => (on ? t('repoSettings.yes') : t('repoSettings.no'))
  const asText = (value: boolean | number | undefined) => (value === undefined ? undefined : String(value))
  const terminals = terminalPresets(window.leviathan.platform)

  return (
    <div className="tools-section">
      <div className="ssh-title">{t('repoSettings.title', { name: basename(path) })}</div>
      <div className="dim small">{t('repoSettings.hint')}</div>
      <OwnChoice
        label={t('settings.autoFetch')}
        general={fetchLabel(settings.autoFetchMinutes)}
        value={asText(own.autoFetchMinutes)}
        options={minutes.map((m) => ({ value: String(m), label: fetchLabel(m) }))}
        save={(v) => save('autoFetchMinutes', v === undefined ? undefined : Number(v))}
      />
      <OwnChoice
        label={t('repoSettings.pullMode')}
        general={pullLabels[settings.pullMode]}
        value={own.pullMode}
        options={PULL_MODES.map((m) => ({ value: m, label: pullLabels[m] }))}
        save={(v) => save('pullMode', v as PullMode | undefined)}
      />
      <OwnChoice
        label={t('repoSettings.pushAfterCommit')}
        general={yesNoLabel(settings.pushAfterCommit)}
        value={asText(own.pushAfterCommit)}
        options={yesNo}
        save={(v) => save('pushAfterCommit', v === undefined ? undefined : v === 'true')}
      />
      <OwnCommitLimit general={settings.commitLimit} value={own.commitLimit} save={(v) => save('commitLimit', v)} />
      <OwnChoice
        label={t('settings.avatars')}
        general={yesNoLabel(settings.avatars)}
        value={asText(own.avatars)}
        options={yesNo}
        save={(v) => save('avatars', v === undefined ? undefined : v === 'true')}
      />
      <CommandChoice
        label={t('tools.editor')}
        systemLabel={t('tools.systemDefault')}
        presets={EDITOR_PRESETS}
        value={own.editor}
        example='code --goto "{file}:{line}"'
        hint={t('tools.commandHint')}
        general={general(commandLabel(EDITOR_PRESETS, settings.editor, t('tools.systemDefault')))}
        save={(v) => save('editor', v)}
      />
      <CommandChoice
        label={t('tools.terminal')}
        systemLabel={t('tools.systemTerminal')}
        presets={terminals}
        value={own.terminal}
        example={terminals[0].command}
        hint={t('tools.terminalHint')}
        general={general(commandLabel(terminals, settings.terminal, t('tools.systemTerminal')))}
        save={(v) => save('terminal', v)}
      />
      <OwnChoice
        label={t('tools.diffTool')}
        general={settings.diffTool || t('tools.gitConfigured')}
        value={own.diffTool}
        options={[
          { value: '', label: t('tools.gitConfigured') },
          ...DIFF_TOOLS.map((tool) => ({ value: tool, label: tool }))
        ]}
        save={(v) => save('diffTool', v)}
      />
    </div>
  )
}
