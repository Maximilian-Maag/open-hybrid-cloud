'use client'

import { useEffect, useRef, useState } from 'react'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? ''

/**
 * The product's picture, with the placeholder as a fallback.
 *
 * A client component only because the image endpoint answers 404 when the product
 * has none: that is a load error the browser reports, not something the server
 * render can know without fetching the bytes it would then throw away.
 */
export function ProductImage({ productId, name }: { productId: number; name: string }) {
  const [failed, setFailed] = useState(false)
  const imgRef = useRef<HTMLImageElement>(null)

  // onError alone is not enough: the browser starts loading while parsing the
  // server-rendered HTML, so an image that 404s before hydration fires its error
  // event with no handler attached and the broken-image icon stays. A finished
  // load with no intrinsic width is that same failure, observed after the fact.
  useEffect(() => {
    const img = imgRef.current
    if (img?.complete && img.naturalWidth === 0) setFailed(true)
  }, [])

  if (failed) {
    return (
      <div
        className="flex h-full w-full items-center justify-center rounded-lg"
        style={{ backgroundColor: 'color-mix(in srgb, var(--bp) 8%, white)' }}
      >
        <svg
          className="h-24 w-24 opacity-25"
          style={{ color: 'var(--bp-text)' }}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2" />
        </svg>
      </div>
    )
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={imgRef}
      src={`${API_URL}/api/catalog/${productId}/image`}
      alt={name}
      className="h-full w-full rounded-lg object-contain"
      onError={() => setFailed(true)}
    />
  )
}
