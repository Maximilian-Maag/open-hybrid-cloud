import { describe, it, expect } from 'vitest'
import { detectImageMime, safeImageContentType, MAX_IMAGE_BYTES } from './imageUpload'

const pad = (head: number[], length = 12) =>
  Buffer.concat([Buffer.from(head), Buffer.alloc(Math.max(0, length - head.length))])

describe('detectImageMime', () => {
  it('recognises PNG, JPEG and WebP by their magic bytes', () => {
    expect(detectImageMime(pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('image/png')
    expect(detectImageMime(pad([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg')
    expect(
      detectImageMime(
        Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')]),
      ),
    ).toBe('image/webp')
  })

  it('rejects an HTML document however it is labelled', () => {
    expect(detectImageMime(Buffer.from('<script>alert(1)</script>'))).toBeNull()
  })

  it('rejects SVG — a document that can carry script', () => {
    expect(detectImageMime(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeNull()
  })

  it('rejects a buffer too short to identify', () => {
    expect(detectImageMime(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBeNull()
    expect(detectImageMime(Buffer.alloc(0))).toBeNull()
  })
})

describe('safeImageContentType', () => {
  it('passes an allowed image type through', () => {
    expect(safeImageContentType('image/png')).toBe('image/png')
    expect(safeImageContentType('image/jpeg')).toBe('image/jpeg')
    expect(safeImageContentType('image/webp')).toBe('image/webp')
  })

  it('neutralises anything else, including the legacy null', () => {
    expect(safeImageContentType('text/html')).toBe('application/octet-stream')
    expect(safeImageContentType('image/svg+xml')).toBe('application/octet-stream')
    expect(safeImageContentType(null)).toBe('application/octet-stream')
  })
})

describe('MAX_IMAGE_BYTES', () => {
  it('is the 10 MB the admin guide claims', () => {
    expect(MAX_IMAGE_BYTES).toBe(10 * 1024 * 1024)
  })
})
