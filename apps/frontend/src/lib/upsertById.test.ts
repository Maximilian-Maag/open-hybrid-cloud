import { describe, it, expect } from 'vitest'
import { upsertById } from './upsertById'

type Row = { id: number; name: string }

describe('upsertById', () => {
  it('appends a record the list does not have yet', () => {
    const list: Row[] = [{ id: 1, name: 'Gateway VM' }]
    expect(upsertById(list, { id: 2, name: 'E2E Test Stack' })).toEqual([
      { id: 1, name: 'Gateway VM' },
      { id: 2, name: 'E2E Test Stack' },
    ])
  })

  it('adds the first record to an empty list', () => {
    expect(upsertById([] as Row[], { id: 1, name: 'Gateway VM' })).toEqual([{ id: 1, name: 'Gateway VM' }])
  })

  /*
   * The bug this exists for (#384): a create whose record the list already
   * carries, because a mount fetch was served after the insert committed and
   * replaced the list before the POST's own `.then` ran.
   */
  it('does not add a second copy when the record is already there', () => {
    const list: Row[] = [{ id: 1, name: 'Gateway VM' }, { id: 2, name: 'E2E Test Stack' }]
    expect(upsertById(list, { id: 2, name: 'E2E Test Stack' })).toHaveLength(2)
  })

  it('replaces the existing record, so an edit is what the list shows', () => {
    const list: Row[] = [{ id: 1, name: 'Gateway VM' }, { id: 2, name: 'old' }]
    expect(upsertById(list, { id: 2, name: 'renamed' })).toEqual([
      { id: 1, name: 'Gateway VM' },
      { id: 2, name: 'renamed' },
    ])
  })

  it('replaces in place rather than moving the record to the end', () => {
    const list: Row[] = [{ id: 1, name: 'a' }, { id: 2, name: 'b' }, { id: 3, name: 'c' }]
    expect(upsertById(list, { id: 1, name: 'A' }).map((r) => r.id)).toEqual([1, 2, 3])
  })

  it('leaves the caller list alone', () => {
    const list: Row[] = [{ id: 1, name: 'Gateway VM' }]
    upsertById(list, { id: 2, name: 'E2E Test Stack' })
    upsertById(list, { id: 1, name: 'renamed' })
    expect(list).toEqual([{ id: 1, name: 'Gateway VM' }])
  })
})
