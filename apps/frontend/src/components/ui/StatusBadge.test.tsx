import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StatusBadge } from './StatusBadge'
import { t } from '@/lib/i18n'

describe('StatusBadge', () => {
  it('renders the English label by default', () => {
    render(<StatusBadge status="active" />)
    expect(screen.getByText('Active')).toBeInTheDocument()
  })

  it('renders a localized label for the given lang', () => {
    render(<StatusBadge status="active" lang="de" />)
    expect(screen.getByText(t('statusActive', 'de'))).toBeInTheDocument()
    // Sanity: the German label differs from the English default is not required
    // (de "Aktiv"), but it must match the translation table.
    expect(screen.getByText('Aktiv')).toBeInTheDocument()
  })

  it('localizes each order status', () => {
    const cases: Array<[Parameters<typeof StatusBadge>[0]['status'], string]> = [
      ['pending', 'statusPending'],
      ['provisioning', 'statusProvisioning'],
      ['completed', 'statusCompleted'],
      ['failed', 'statusFailed'],
      ['rejected', 'statusRejected'],
      ['decommissioned', 'statusDecommissioned'],
    ]
    for (const [status, key] of cases) {
      const { unmount } = render(<StatusBadge status={status} lang="fr" />)
      expect(screen.getByText(t(key as never, 'fr'))).toBeInTheDocument()
      unmount()
    }
  })

  it('reuses the existing decommissioning key', () => {
    render(<StatusBadge status="decommissioning" lang="es" />)
    expect(screen.getByText(t('decommissioning', 'es'))).toBeInTheDocument()
  })
})
