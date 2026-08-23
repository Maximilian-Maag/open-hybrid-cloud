/**
 * What an uploaded image is allowed to be, and how that is decided.
 *
 * Shared by the product picture and the branding logo. Both are stored in the
 * database and served straight back to a browser from the backend origin — the
 * logo from an *unauthenticated* GET — so the type must be decided by the bytes
 * and not by what the uploader claimed (issue #143).
 */

/**
 * Image types an upload may have.
 *
 * SVG is deliberately absent: it is a document that can carry script, and these
 * files are served back to browsers. PNG, JPEG and WebP cover what an operator
 * would upload.
 */
export const ALLOWED_IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/webp'] as const

export type AllowedImageMime = (typeof ALLOWED_IMAGE_MIMES)[number]

/** 10 MB — the limit the admin guide has always claimed and nothing enforced. */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024

/**
 * Magic bytes per accepted type.
 *
 * The declared Content-Type of an upload is attacker-controlled, so it decides
 * nothing on its own: what gets stored is the type the bytes actually are.
 */
const MAGIC: { mime: AllowedImageMime; test: (b: Buffer) => boolean }[] = [
  { mime: 'image/png', test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: 'image/jpeg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    mime: 'image/webp',
    test: (b) => b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP',
  },
]

/** The type these bytes really are, or null if it is not one we accept. */
export const detectImageMime = (buffer: Buffer): AllowedImageMime | null =>
  MAGIC.find((candidate) => buffer.length >= 12 && candidate.test(buffer))?.mime ?? null

/**
 * A stored MIME type that is safe to echo as a `Content-Type`.
 *
 * Rows written before the upload path sniffed the bytes can hold anything the
 * uploader sent, `text/html` included, so the read path has to clamp too —
 * validating new writes does nothing for what is already in the table. Unknown
 * types are served as an opaque download rather than rendered.
 */
export const safeImageContentType = (stored: string | null): string =>
  (ALLOWED_IMAGE_MIMES as readonly string[]).includes(stored ?? '')
    ? (stored as string)
    : 'application/octet-stream'
