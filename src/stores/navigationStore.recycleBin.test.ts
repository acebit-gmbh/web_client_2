import { describe, it, expect, beforeEach } from 'vitest'
import { useNavigationStore } from './navigationStore'

/**
 * The recycle bin is a view mode, not a place: there is no URL for it, so the
 * only thing that can close it is a navigation. These pin that every navigation
 * does - a bin left open while the user clicks a folder would keep showing the
 * bin under a folder's breadcrumb.
 */

const state = () => useNavigationStore.getState()

beforeEach(() => {
  state().reset()
})

describe('navigationStore recycle bin', () => {
  it('starts closed', () => {
    expect(state().recycleBinOpen).toBe(false)
  })

  it('closes when a folder is chosen', () => {
    state().setDatabase('db')
    state().openRecycleBin()
    expect(state().recycleBinOpen).toBe(true)

    state().setFolder('f1', 'Folder')
    expect(state().recycleBinOpen).toBe(false)
  })

  it('closes when the database changes', () => {
    state().openRecycleBin()
    state().setDatabase('other')
    expect(state().recycleBinOpen).toBe(false)
  })

  it('closes on reset', () => {
    state().openRecycleBin()
    state().reset()
    expect(state().recycleBinOpen).toBe(false)
  })

  it('leaves the open entry alone, which stays readable beside the bin', () => {
    state().setDatabase('db')
    state().selectEntry('e1')
    state().openRecycleBin()

    expect(state().recycleBinOpen).toBe(true)
    expect(state().selectedEntryId).toBe('e1')
  })
})
