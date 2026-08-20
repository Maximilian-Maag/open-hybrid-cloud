import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ProductImage } from './ProductImage'

describe('ProductImage', () => {
  it('uses the description it was given as the alt text', () => {
    render(<ProductImage productId={5} name="Dashboard showing traffic graphs" />)
    expect(screen.getByRole('img', { name: 'Dashboard showing traffic graphs' })).toBeInTheDocument()
  })

  it('treats an empty description as decorative', () => {
    // Correct only where the same information is already in text beside it — a
    // cart row names the product the thumbnail belongs to.
    render(<ProductImage productId={5} name="" />)
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(document.querySelector('img')).toHaveAttribute('alt', '')
  })

  it('requests the product image endpoint', () => {
    render(<ProductImage productId={42} name="x" />)
    expect(document.querySelector('img')?.getAttribute('src')).toContain('/api/catalog/42/image')
  })

  it('busts the cache when a version is given', () => {
    // The endpoint sets max-age=3600, so a replaced image needs a changed URL.
    render(<ProductImage productId={42} name="x" version={3} />)
    expect(document.querySelector('img')?.getAttribute('src')).toContain('?v=3')
  })
})
