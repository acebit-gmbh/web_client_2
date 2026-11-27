import { describe, it, expect, beforeAll } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import i18n from '@/i18n'
import { PasswordDetail } from './PasswordDetail'
import { LicenseDetail } from './LicenseDetail'
import { IdentityDetail } from './IdentityDetail'
import { EntryTypeRouter } from '../EntryTypeRouter'
import type { CustomField, EntryDetail } from '@/api/types'

/*
  The detail views of an entry. A custom field the server stores as a secret
  (its `secret` is true: a field of type password or protected) is masked
  until the user reveals it, as the entry's password is; a boolean field reads
  in the user's words; a licence's purchase date and an identity's date of
  birth are shown as that calendar day, not as the ISO text the server sends.
  An entry of every other type shows the custom fields it holds of its own
  (Server 20.0.0 sends them, for example from an import) after its type's
  values, masked as on a password entry.
*/

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

function entry(extra: Partial<EntryDetail> = {}): EntryDetail {
  return {
    path: [],
    type: 'password',
    id: 'e1',
    name: 'Mail',
    has_second_pass: false,
    updated_at: '2026-01-01T00:00:00Z',
    ...extra,
  } as EntryDetail
}

function field(name: string, type: string, value: string, secret: boolean): CustomField {
  return { name, value, input_id: '', id: `c.${name}`, type, secret }
}

describe('custom fields in the detail view', () => {
  it('masks a field the server stores as a secret until it is revealed', () => {
    render(
      <PasswordDetail
        entry={entry({
          custom_fields: [
            field('Recovery PIN', 'password', 'pin-8812-secret', true),
            field('Customer number', 'text', 'K-1002', false),
          ],
        })}
      />,
    )
    expect(screen.queryByText('pin-8812-secret')).not.toBeInTheDocument()
    expect(screen.getByText('K-1002')).toBeInTheDocument()
    const reveal = screen.getAllByRole('button', { name: 'Reveal value' })
    expect(reveal).toHaveLength(1)
    fireEvent.click(reveal[0])
    expect(screen.getByText('pin-8812-secret')).toBeInTheDocument()
  })

  it("shows a boolean field in the user's words", () => {
    render(
      <PasswordDetail
        entry={entry({
          custom_fields: [
            field('Auto renewal', 'boolean', 'true', false),
            field('Paper invoice', 'boolean', 'false', false),
          ],
        })}
      />,
    )
    expect(screen.getByText('Yes')).toBeInTheDocument()
    expect(screen.getByText('No')).toBeInTheDocument()
    expect(screen.queryByText('true')).not.toBeInTheDocument()
    expect(screen.queryByText('false')).not.toBeInTheDocument()
  })
})

describe('custom fields of an entry of another type', () => {
  it("shows a credit card's own custom fields after its values, a secret one masked until revealed", () => {
    render(
      <EntryTypeRouter
        entry={entry({
          type: 'credit_card',
          credit_card: { holder: 'A. Holder' },
          custom_fields: [
            field('Backup PIN', 'protected', 'pin-5555-secret', true),
            field('Note', 'text', 'imported note', false),
          ],
        })}
      />,
    )
    expect(screen.getByText('A. Holder')).toBeInTheDocument()
    expect(screen.getByText('Custom Fields')).toBeInTheDocument()
    expect(screen.getByText('imported note')).toBeInTheDocument()
    expect(screen.queryByText('pin-5555-secret')).not.toBeInTheDocument()
    const reveal = screen.getAllByRole('button', { name: 'Reveal value' })
    expect(reveal).toHaveLength(1)
    fireEvent.click(reveal[0])
    expect(screen.getByText('pin-5555-secret')).toBeInTheDocument()
  })

  it.each<[EntryDetail['type'], Partial<EntryDetail>]>([
    ['license', { license: { product: 'Office' } }],
    ['identity', { identity: { first_name: 'Anna' } }],
    ['information', { information: { text: 'Some text' } }],
    ['banking', { banking: { bank_name: 'Bank' } }],
    ['rdp', { rdp: { host: 'rdp.example.com' } }],
    ['putty', { putty: { host: 'ssh.example.com' } }],
    ['teamviewer', { teamviewer: { partner_id: '123456789' } }],
    ['passkey', { passkey: { rp_id: 'example.com' } }],
  ])('type %s: the entry shows the custom fields of its own', (type, values) => {
    render(
      <EntryTypeRouter
        entry={entry({
          type,
          ...values,
          custom_fields: [field('Extra', 'text', `extra-${type}`, false)],
        })}
      />,
    )
    expect(screen.getByText(`extra-${type}`)).toBeInTheDocument()
  })

  it('shows an entry without custom fields of its own as its type alone shows it', () => {
    const licence = entry({ type: 'license', license: { product: 'Office' }, custom_fields: [] })
    const { container: routed } = render(<EntryTypeRouter entry={licence} />)
    const { container: alone } = render(<LicenseDetail entry={licence} />)
    expect(routed.innerHTML).toBe(alone.innerHTML)
  })

  it('adds nothing where the type shows nothing and there are no custom fields', () => {
    const { container } = render(<EntryTypeRouter entry={entry({ type: 'credit_card' })} />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('calendar days in the detail view', () => {
  it("shows a licence's purchase date as its day", () => {
    render(
      <LicenseDetail
        entry={entry({
          type: 'license',
          license: { product: 'Office', purchase_date: '2025-01-15T00:00:00.000Z' },
        })}
      />,
    )
    expect(screen.getByText('Jan 15, 2025')).toBeInTheDocument()
    expect(screen.queryByText('2025-01-15T00:00:00.000Z')).not.toBeInTheDocument()
  })

  it("shows an identity's date of birth as its day, and a text that names no day as it came", () => {
    const { unmount } = render(
      <IdentityDetail
        entry={entry({
          type: 'identity',
          identity: { first_name: 'Anna', birth_date: '1990-12-31T00:00:00.000Z' },
        })}
      />,
    )
    expect(screen.getByText('Dec 31, 1990')).toBeInTheDocument()
    unmount()
    render(
      <IdentityDetail
        entry={entry({ type: 'identity', identity: { first_name: 'Anna', birth_date: 'unknown' } })}
      />,
    )
    expect(screen.getByText('unknown')).toBeInTheDocument()
  })
})
