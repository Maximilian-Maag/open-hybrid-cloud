import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { LangProvider, useServerLang } from './LangProvider'

/**
 * This is how a client component learns what the SERVER decided the language
 * was — it reads the cookie *and* Accept-Language, which `navigator.language`
 * cannot reproduce. The context must return null outside a provider, because
 * `useLang` distinguishes "the server said English" from "nobody said anything"
 * and only falls through to the browser in the second case.
 */

function Probe() {
  const lang = useServerLang()
  return <span data-testid="lang">{lang === null ? 'NULL' : lang}</span>
}

describe('LangProvider', () => {
  it('hands the server-resolved language to descendants', () => {
    render(<LangProvider lang="de"><Probe /></LangProvider>)
    expect(screen.getByTestId('lang')).toHaveTextContent('de')
  })

  it('returns null outside a provider rather than guessing English', () => {
    // The login page renders no provider. If this returned "en", useLang would
    // treat it as a server decision and never consult navigator.language.
    render(<Probe />)
    expect(screen.getByTestId('lang')).toHaveTextContent('NULL')
  })

  it('lets a nested provider override an outer one', () => {
    render(
      <LangProvider lang="de">
        <LangProvider lang="fr"><Probe /></LangProvider>
      </LangProvider>,
    )
    expect(screen.getByTestId('lang')).toHaveTextContent('fr')
  })

  it('renders its children', () => {
    render(<LangProvider lang="en"><p>page body</p></LangProvider>)
    expect(screen.getByText('page body')).toBeInTheDocument()
  })
})
