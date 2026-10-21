import { describe, expect, it } from 'vitest'
import { useStore } from '../src/renderer/src/store'
import { formDialog } from '../src/renderer/src/ui'

describe('formDialog', () => {
  it('queues dialogs instead of replacing the one that is open', async () => {
    const first = formDialog({ title: 'one', fields: [], confirmText: 'ok' })
    const second = formDialog({ title: 'two', fields: [], confirmText: 'ok' })
    expect(useStore.getState().dialog?.title).toBe('one')

    useStore.getState().dialog!.resolve({})
    await expect(first).resolves.toEqual({})
    expect(useStore.getState().dialog?.title).toBe('two')

    useStore.getState().dialog!.resolve(null)
    await expect(second).resolves.toBeNull()
    expect(useStore.getState().dialog).toBeNull()
  })
})
