import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useEntryBoundDialog } from './useEntryBoundDialog'

// The edit form is bound to the entry it was opened for. Without the binding,
// a Cancel on a warning prompt (which deselects the entry) left the form
// armed, and selecting another entry read that entry into the form at once -
// before its own conditional-access warning was answered.
describe('useEntryBoundDialog', () => {
  it('opens for the selected entry and names it', () => {
    const { result } = renderHook(({ id }) => useEntryBoundDialog(id), {
      initialProps: { id: 'a' as string | null },
    })
    expect(result.current.isOpen).toBe(false)
    expect(result.current.entryId).toBeNull()
    act(() => result.current.open())
    expect(result.current.isOpen).toBe(true)
    expect(result.current.entryId).toBe('a')
  })

  it('closes when the selection is cleared, and stays closed for the next entry', () => {
    const { result, rerender } = renderHook(({ id }) => useEntryBoundDialog(id), {
      initialProps: { id: 'a' as string | null },
    })
    act(() => result.current.open())
    rerender({ id: null })
    expect(result.current.isOpen).toBe(false)
    expect(result.current.entryId).toBeNull()
    rerender({ id: 'b' })
    expect(result.current.isOpen).toBe(false)
    expect(result.current.entryId).toBeNull()
  })

  it('never names another entry, not even in the render before the effect closes it', () => {
    const seen: (string | null)[] = []
    const { result, rerender } = renderHook(
      ({ id }) => {
        const dialog = useEntryBoundDialog(id)
        seen.push(dialog.entryId)
        return dialog
      },
      { initialProps: { id: 'a' as string | null } },
    )
    act(() => result.current.open())
    seen.length = 0
    rerender({ id: 'b' })
    expect(seen).not.toContain('b')
    expect(seen).not.toContain('a')
    expect(result.current.isOpen).toBe(false)
  })

  it('opens again for the entry selected now', () => {
    const { result, rerender } = renderHook(({ id }) => useEntryBoundDialog(id), {
      initialProps: { id: 'a' as string | null },
    })
    act(() => result.current.open())
    rerender({ id: 'b' })
    act(() => result.current.open())
    expect(result.current.isOpen).toBe(true)
    expect(result.current.entryId).toBe('b')
  })

  it('closes when asked', () => {
    const { result } = renderHook(() => useEntryBoundDialog('a'))
    act(() => result.current.open())
    act(() => result.current.close())
    expect(result.current.isOpen).toBe(false)
    expect(result.current.entryId).toBeNull()
  })
})
