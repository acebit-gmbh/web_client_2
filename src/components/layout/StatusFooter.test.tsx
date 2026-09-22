import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import '@/i18n'
import { StatusFooter } from './StatusFooter'
// Read as text rather than imported as a module: the app's tsconfig covers
// `src` only and carries no node types, so neither a JSON import nor fs works
// here. `?raw` is Vite's own and is typed by vite/client.
import packageJson from '../../../package.json?raw'

/**
 * The footer is where a user reads the version out during a support call, and
 * it used to hold a hand-typed copy of the number - the kind of copy that is
 * still on the old version after a release. It now comes from package.json
 * through the `define` in both configs, and this is what keeps it there.
 */
describe('StatusFooter', () => {
  it('shows the version from package.json, not a copy of it', () => {
    const { version } = JSON.parse(packageJson) as { version: string }

    render(<StatusFooter />)

    expect(screen.getByText(`v${version}`)).toBeInTheDocument()
    // A real version, not an empty define quietly substituting nothing.
    expect(version).toMatch(/^\d+\.\d+\.\d+/)
  })
})
