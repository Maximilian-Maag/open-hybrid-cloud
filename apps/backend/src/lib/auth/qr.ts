/**
 * QR Code (ISO/IEC 18004) encoder, by hand.
 *
 * Deliberately dependency-free, for the same reason `totp.ts` is: the only thing
 * we ever need to draw is the `otpauth://` enrolment URI, and pulling a rendering
 * library into the API surface for that would cost more than the algorithm does.
 * Every constant below is fixed by the standard, and `qr.test.ts` checks this file
 * both against published values (the Annex I Reed-Solomon worked example, the
 * Table C.1 format strings, the Table D.1 version strings) and by decoding its own
 * output back to the input string. An encoder verified only against its own
 * expectations would be worthless: a wrong-but-consistent one still produces a
 * plausible-looking square that no phone camera would ever read.
 *
 * Byte mode only. Numeric and alphanumeric modes pack denser, but the payload here
 * is a URI full of `:/?&=` and percent-escapes, so neither mode can represent it;
 * supporting them would be extra tables and extra ways to be wrong for no gain.
 * Byte mode also handles non-ASCII naturally, since we simply encode the UTF-8
 * bytes (which is what every scanner assumes in practice, ECI headers or not).
 *
 * Versions 1-20 only. Version 20 holds 858 bytes at level M; our URIs are ~150.
 */

/** Error-correction level. Higher levels survive more damage but hold less data. */
export type EccLevel = 'L' | 'M' | 'Q' | 'H'

/** A square matrix of modules; true = dark. Includes NO quiet zone. */
export type QrMatrix = boolean[][]

export interface EncodeQrOptions {
  /** Defaults to 'M', the level every authenticator-app QR in the wild uses. */
  ecc?: EccLevel
  minVersion?: number
  maxVersion?: number
}

export interface QrSvgOptions {
  /** Side of one module in SVG user units. */
  moduleSize?: number
  /** Width of the mandatory light margin, in modules. The standard requires 4. */
  quietZone?: number
  dark?: string
  light?: string
  /** When given, rendered as an `<svg><title>` so the image has an accessible name. */
  title?: string
}

export interface QrEncodeResult {
  matrix: QrMatrix
  version: number
  ecc: EccLevel
  mask: number
}

export const MIN_VERSION = 1
export const MAX_VERSION = 20

/**
 * Two-bit level indicators from ISO/IEC 18004 Table 12. Note the ordering is not
 * L < M < Q < H: L is 01 and M is 00, so the numbers below are not a ranking.
 */
const ECC_INDICATOR: Record<EccLevel, number> = { L: 1, M: 0, Q: 3, H: 2 }

export const ECC_LEVELS: readonly EccLevel[] = ['L', 'M', 'Q', 'H']

/**
 * Total codewords (data + error correction) per version, indexed by version - 1.
 *
 * This is a derived quantity, not really a free parameter: it is the count of
 * modules left over once the function patterns are drawn, divided by eight and
 * rounded down (the leftover 0-7 bits are the "remainder bits", always light).
 * It is kept as a table because that is how the standard tabulates it, and the
 * test asserts the table against the modules actually left free by
 * `drawFunctionPatterns`, which catches a typo here or a misplaced pattern there.
 */
export const TOTAL_CODEWORDS: readonly number[] = [
  26, 44, 70, 100, 134, 172, 196, 242, 292, 346, 404, 466, 532, 581, 655, 733, 815, 901, 991, 1085,
]

/**
 * Error-correction codewords per block, indexed by [level][version - 1].
 * ISO/IEC 18004 Table 13-22. Pure data: there is no formula behind these.
 */
export const ECC_CODEWORDS_PER_BLOCK: Record<EccLevel, readonly number[]> = {
  L: [7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28],
  M: [10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26],
  Q: [13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30],
  H: [17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28],
}

/**
 * Number of error-correction blocks, indexed by [level][version - 1].
 * ISO/IEC 18004 Table 13-22, alongside the codeword counts above.
 */
export const ECC_BLOCKS: Record<EccLevel, readonly number[]> = {
  L: [1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8],
  M: [1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16],
  Q: [1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20],
  H: [1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25],
}

const assertVersion = (version: number): void => {
  if (!Number.isInteger(version) || version < MIN_VERSION || version > MAX_VERSION) {
    throw new Error(`QR version ${version} is out of the supported range ${MIN_VERSION}-${MAX_VERSION}`)
  }
}

/** Side length in modules. Version 1 is 21x21 and every version adds 4. */
export const matrixSize = (version: number): number => {
  assertVersion(version)
  return 17 + 4 * version
}

/** Data codewords available to the payload, i.e. everything that is not parity. */
export const dataCodewords = (version: number, ecc: EccLevel): number => {
  assertVersion(version)
  const i = version - 1
  return TOTAL_CODEWORDS[i] - ECC_CODEWORDS_PER_BLOCK[ecc][i] * ECC_BLOCKS[ecc][i]
}

/**
 * Bits in the character-count indicator. Byte mode uses 8 bits up to version 9
 * and 16 from version 10 (ISO/IEC 18004 Table 3) — which is why version selection
 * has to recheck capacity per version rather than compare against one number.
 */
const charCountBits = (version: number): number => (version <= 9 ? 8 : 16)

/** Payload bytes that fit in one version at one level, header included. */
export const byteModeCapacity = (version: number, ecc: EccLevel): number =>
  Math.floor((dataCodewords(version, ecc) * 8 - 4 - charCountBits(version)) / 8)

/**
 * Centre coordinates of the alignment patterns, from the standard's construction
 * rule rather than a copied table: the first centre is always 6, the last is
 * always size - 7, and the rest are spaced evenly on an even step.
 *
 * Version 32 is the one version where the even-step rule gives the wrong answer
 * and the standard's table has to be believed instead; it is outside our range,
 * so this stays a formula.
 */
export const alignmentPatternPositions = (version: number): number[] => {
  assertVersion(version)
  if (version === 1) return []
  const count = Math.floor(version / 7) + 2
  const step = Math.ceil((version * 4 + 4) / (count * 2 - 2)) * 2
  const positions = [6]
  for (let pos = version * 4 + 10; positions.length < count; pos -= step) positions.splice(1, 0, pos)
  return positions
}

// --- GF(256) arithmetic -----------------------------------------------------
//
// The field is GF(2^8) modulo the primitive polynomial x^8+x^4+x^3+x^2+1 (0x11D)
// with 2 as the generator, both fixed by ISO/IEC 18004 §8.5.2. Multiplication is
// done through logarithm tables: every non-zero element is 2^k for exactly one k
// in 0..254, so a*b is 2^(log a + log b).

const GF_EXP = new Uint8Array(512)
const GF_LOG = new Uint8Array(256)

for (let i = 0, x = 1; i < 255; i++) {
  GF_EXP[i] = x
  GF_LOG[x] = i
  x <<= 1
  // Reduce back into the field the moment the value overflows a byte.
  if ((x & 0x100) !== 0) x ^= 0x11d
}
// Doubling the exponent table lets `log a + log b` be used unreduced, up to 508.
for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255]

const gfMul = (a: number, b: number): number => (a === 0 || b === 0 ? 0 : GF_EXP[GF_LOG[a] + GF_LOG[b]])

/**
 * Coefficients of the Reed-Solomon generator polynomial of the given degree,
 * (x - 2^0)(x - 2^1)...(x - 2^(degree-1)), highest power first. Index 0 is always
 * 1, so it is dropped by the caller.
 */
const generatorPolynomial = (degree: number): number[] => {
  let poly = [1]
  for (let i = 0; i < degree; i++) {
    // Multiply by (x + 2^i); subtraction and addition are both XOR here.
    const next = new Array<number>(poly.length + 1).fill(0)
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j]
      next[j + 1] ^= gfMul(poly[j], GF_EXP[i])
    }
    poly = next
  }
  return poly
}

/**
 * The `eccLen` Reed-Solomon parity codewords for one block of data codewords:
 * the remainder of the data polynomial divided by the generator polynomial.
 *
 * Exported so the test can hold it against the worked example in ISO/IEC 18004
 * Annex I, which is the only external check available for this part.
 */
export const reedSolomonRemainder = (data: readonly number[] | Uint8Array, eccLen: number): number[] => {
  const generator = generatorPolynomial(eccLen)
  const remainder = new Array<number>(eccLen).fill(0)
  for (const byte of data) {
    // Long division, one term at a time: the leading remainder term decides how
    // much of the generator to subtract, then the remainder shifts up.
    const factor = byte ^ remainder[0]
    remainder.shift()
    remainder.push(0)
    for (let i = 0; i < eccLen; i++) remainder[i] ^= gfMul(generator[i + 1], factor)
  }
  return remainder
}

// --- BCH-coded metadata -----------------------------------------------------

/**
 * The 15-bit format information: 5 data bits (2 for the level, 3 for the mask)
 * plus 10 BCH(15,5) parity bits, the lot XORed with 0x5412.
 *
 * The XOR matters: without it, level M with mask 0 would be fifteen zero bits,
 * and a blank region would look like a valid format. The code has minimum
 * distance 7, so a decoder can still recover the format after three bit errors,
 * which is why it is stored twice in the symbol.
 */
export const formatInfoBits = (ecc: EccLevel, mask: number): number => {
  if (!Number.isInteger(mask) || mask < 0 || mask > 7) throw new Error(`invalid mask ${mask}`)
  const data = (ECC_INDICATOR[ecc] << 3) | mask
  let remainder = data
  for (let i = 0; i < 10; i++) {
    remainder = (remainder << 1) ^ (((remainder >>> 9) & 1) * 0x537)
  }
  return (((data << 10) | remainder) ^ 0x5412) & 0x7fff
}

/**
 * The 18-bit version information: 6 data bits plus 12 BCH(18,6) parity bits.
 * Unlike the format information there is no XOR mask, because version 7 (the
 * lowest version that carries this field at all) is already non-zero.
 */
export const versionInfoBits = (version: number): number => {
  assertVersion(version)
  let remainder = version
  for (let i = 0; i < 12; i++) {
    remainder = (remainder << 1) ^ (((remainder >>> 11) & 1) * 0x1f25)
  }
  return ((version << 12) | remainder) & 0x3ffff
}

// --- Data encoding ----------------------------------------------------------

const bitAt = (bytes: readonly number[], index: number): boolean =>
  ((bytes[index >>> 3] >>> (7 - (index & 7))) & 1) !== 0

/**
 * Header + payload + padding, as a whole number of data codewords.
 *
 * The two pad bytes 0xEC and 0x11 are prescribed by §8.4.9. They alternate rather
 * than repeat so that the padding region does not itself look like a run of
 * identical modules that the mask evaluation would then have to fight.
 */
const buildDataCodewords = (bytes: Uint8Array, version: number, ecc: EccLevel): number[] => {
  const capacity = dataCodewords(version, ecc)
  const bits: boolean[] = []
  const pushBits = (value: number, count: number): void => {
    for (let i = count - 1; i >= 0; i--) bits.push(((value >>> i) & 1) !== 0)
  }

  pushBits(0b0100, 4) // byte mode
  pushBits(bytes.length, charCountBits(version))
  for (const byte of bytes) pushBits(byte, 8)

  // Terminator: up to four zero bits, then zeros to the next byte boundary.
  const terminator = Math.min(4, capacity * 8 - bits.length)
  pushBits(0, terminator)
  pushBits(0, (8 - (bits.length % 8)) % 8)

  const codewords: number[] = []
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0
    for (let j = 0; j < 8; j++) byte = (byte << 1) | (bits[i + j] ? 1 : 0)
    codewords.push(byte)
  }
  const firstPad = codewords.length
  while (codewords.length < capacity) {
    codewords.push((codewords.length - firstPad) % 2 === 0 ? 0xec : 0x11)
  }
  return codewords
}

/** How the data codewords split into blocks, shortest blocks first. */
export interface BlockLayout {
  /** Data codewords in each block, in order. */
  dataLengths: number[]
  /** Parity codewords per block; the same for every block in a symbol. */
  eccLength: number
}

/**
 * Block layout for a version and level.
 *
 * The standard tabulates this as "n blocks of a, m blocks of a+1"; it is
 * equivalent (and harder to typo) to say that `total` codewords divide as evenly
 * as possible between `blocks` blocks, with the longer blocks last.
 */
export const blockLayout = (version: number, ecc: EccLevel): BlockLayout => {
  const i = version - 1
  const total = TOTAL_CODEWORDS[i]
  const eccLength = ECC_CODEWORDS_PER_BLOCK[ecc][i]
  const blocks = ECC_BLOCKS[ecc][i]
  const shortLength = Math.floor(total / blocks) - eccLength
  const longBlocks = total % blocks
  const dataLengths: number[] = []
  for (let b = 0; b < blocks; b++) dataLengths.push(b < blocks - longBlocks ? shortLength : shortLength + 1)
  return { dataLengths, eccLength }
}

/**
 * Split the data into blocks, compute each block's parity, then interleave.
 *
 * Interleaving is the whole point of the block structure. Reed-Solomon can only
 * repair a bounded number of bad codewords per block, so a coffee ring covering
 * one corner of a large symbol would exceed one block's budget if blocks were
 * stored contiguously. Taking one codeword from each block in turn spreads any
 * localised damage evenly across every block instead, so each has to repair only
 * its share.
 */
const interleave = (data: readonly number[], version: number, ecc: EccLevel): number[] => {
  const { dataLengths, eccLength } = blockLayout(version, ecc)
  const dataBlocks: number[][] = []
  const eccBlocks: number[][] = []
  let offset = 0
  for (const length of dataLengths) {
    const block = data.slice(offset, offset + length)
    offset += length
    dataBlocks.push(block)
    eccBlocks.push(reedSolomonRemainder(block, eccLength))
  }

  const result: number[] = []
  const longest = Math.max(...dataLengths)
  for (let i = 0; i < longest; i++) {
    // Short blocks simply have nothing to contribute on the last pass.
    for (const block of dataBlocks) if (i < block.length) result.push(block[i])
  }
  for (let i = 0; i < eccLength; i++) {
    for (const block of eccBlocks) result.push(block[i])
  }
  return result
}

// --- Symbol construction ----------------------------------------------------

const makeGrid = (size: number): boolean[][] =>
  Array.from({ length: size }, () => new Array<boolean>(size).fill(false))

interface Canvas {
  matrix: boolean[][]
  /** True where a function pattern or a metadata field lives, so data must not. */
  reserved: boolean[][]
  size: number
}

/**
 * Everything whose position is fixed by the version rather than by the data:
 * the three finder patterns and their separators, the two timing patterns, the
 * alignment patterns, the dark module, and the reserved metadata regions.
 */
const drawFunctionPatterns = (version: number): Canvas => {
  const size = matrixSize(version)
  const matrix = makeGrid(size)
  const reserved = makeGrid(size)
  const set = (x: number, y: number, dark: boolean): void => {
    matrix[y][x] = dark
    reserved[y][x] = true
  }

  // Timing patterns: an alternating line along row 6 and column 6, which gives a
  // decoder the module pitch so it can find the grid on a photographed symbol.
  for (let i = 0; i < size; i++) {
    set(6, i, i % 2 === 0)
    set(i, 6, i % 2 === 0)
  }

  // Finder patterns with their separators, as one 9x9 stamp per corner: by
  // Chebyshev distance from the centre, 0-1 is the dark core, 2 the light ring,
  // 3 the dark ring, 4 the light separator.
  const centres: readonly (readonly [number, number])[] = [
    [3, 3],
    [size - 4, 3],
    [3, size - 4],
  ]
  for (const [cx, cy] of centres) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx
        const y = cy + dy
        if (x < 0 || y < 0 || x >= size || y >= size) continue
        const distance = Math.max(Math.abs(dx), Math.abs(dy))
        set(x, y, distance !== 2 && distance !== 4)
      }
    }
  }

  // Alignment patterns: 5x5, at every pairing of the centre coordinates except
  // the three corners, where a finder pattern is already sitting.
  const positions = alignmentPatternPositions(version)
  const last = positions.length - 1
  for (let i = 0; i <= last; i++) {
    for (let j = 0; j <= last; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) continue
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          set(positions[i] + dx, positions[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1)
        }
      }
    }
  }

  // Reserve both copies of the format information. The values depend on the mask,
  // which is not known until the data is placed, so only the space is claimed here.
  for (let i = 0; i <= 8; i++) {
    reserved[8][i] = true
    reserved[i][8] = true
  }
  for (let i = 0; i < 8; i++) {
    reserved[8][size - 1 - i] = true
    reserved[size - 1 - i][8] = true
  }

  // The dark module. Always dark, no meaning; it just breaks the symmetry that
  // would otherwise let a symbol be misread upside down.
  set(8, size - 8, true)

  if (version >= 7) {
    const bits = versionInfoBits(version)
    for (let i = 0; i < 18; i++) {
      const dark = ((bits >>> i) & 1) !== 0
      const a = size - 11 + (i % 3)
      const b = Math.floor(i / 3)
      // Two copies, one beside each of the far finder patterns.
      set(a, b, dark)
      set(b, a, dark)
    }
  }

  return { matrix, reserved, size }
}

/**
 * Lay the interleaved codewords into the free modules.
 *
 * The path is two modules wide and runs bottom-to-top then top-to-bottom in
 * alternating column pairs, right to left, stepping over the vertical timing
 * pattern in column 6 and over every reserved module. Any modules left after the
 * codewords run out are the remainder bits, which stay light.
 */
const placeCodewords = (canvas: Canvas, codewords: readonly number[]): void => {
  const { matrix, reserved, size } = canvas
  const totalBits = codewords.length * 8
  let bit = 0
  for (let right = size - 1; right >= 1; right -= 2) {
    // Column 6 is the timing pattern, so the pair that would include it shifts.
    if (right === 6) right = 5
    for (let vertical = 0; vertical < size; vertical++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j
        const upward = ((right + 1) & 2) === 0
        const y = upward ? size - 1 - vertical : vertical
        if (!reserved[y][x] && bit < totalBits) {
          matrix[y][x] = bitAt(codewords, bit)
          bit++
        }
      }
    }
  }
}

/**
 * The eight data mask predicates of ISO/IEC 18004 Table 10. True means the module
 * at (x, y) is inverted.
 */
export const maskPredicate = (mask: number, x: number, y: number): boolean => {
  switch (mask) {
    case 0:
      return (x + y) % 2 === 0
    case 1:
      return y % 2 === 0
    case 2:
      return x % 3 === 0
    case 3:
      return (x + y) % 3 === 0
    case 4:
      return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0
    case 5:
      return ((x * y) % 2) + ((x * y) % 3) === 0
    case 6:
      return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0
    case 7:
      return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0
    default:
      throw new Error(`invalid mask ${mask}`)
  }
}

/** XOR the mask over the data modules. Its own inverse, so it doubles as undo. */
const applyMask = (canvas: Canvas, mask: number): void => {
  const { matrix, reserved, size } = canvas
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!reserved[y][x] && maskPredicate(mask, x, y)) matrix[y][x] = !matrix[y][x]
    }
  }
}

const drawFormatBits = (canvas: Canvas, ecc: EccLevel, mask: number): void => {
  const { matrix, size } = canvas
  const bits = formatInfoBits(ecc, mask)
  const at = (i: number): boolean => ((bits >>> i) & 1) !== 0

  // First copy, wrapped around the top-left finder, least significant bit first.
  for (let i = 0; i <= 5; i++) matrix[i][8] = at(i)
  matrix[7][8] = at(6)
  matrix[8][8] = at(7)
  matrix[8][7] = at(8)
  for (let i = 9; i < 15; i++) matrix[8][14 - i] = at(i)

  // Second copy, split between the other two finders so that losing a corner
  // does not lose the format information with it.
  for (let i = 0; i < 8; i++) matrix[8][size - 1 - i] = at(i)
  for (let i = 8; i < 15; i++) matrix[size - 15 + i][8] = at(i)
}

// --- Mask selection ---------------------------------------------------------

const PENALTY_ADJACENT = 3 // rule 1: base cost of a run of five
const PENALTY_BLOCK = 3 // rule 2: cost of a 2x2 block of one colour
const PENALTY_FINDER_LIKE = 40 // rule 3: cost of a false finder pattern
const PENALTY_IMBALANCE = 10 // rule 4: cost per 5% away from an even split

/**
 * The four penalty rules of ISO/IEC 18004 §8.8.2, summed. Lower is better.
 *
 * The rules exist because masking is not about aesthetics: a decoder locates the
 * symbol by looking for finder patterns and follows the grid by the module pitch,
 * so a data region that happens to contain long uniform runs, large solid blocks
 * or sequences that look like a finder pattern actively misleads it. Rule 4
 * pushes the overall dark fraction towards 50% so that a camera's thresholding
 * has the best chance of separating the two colours.
 *
 * Exported so the test can confirm the encoder really picked the cheapest mask.
 */
export const penaltyScore = (matrix: QrMatrix): number => {
  const size = matrix.length
  let score = 0

  // Rules 1 and 2, over rows and then columns.
  for (const horizontal of [true, false]) {
    for (let a = 0; a < size; a++) {
      let runColour = false
      let runLength = 0
      for (let b = 0; b < size; b++) {
        const dark = horizontal ? matrix[a][b] : matrix[b][a]
        if (dark === runColour) {
          runLength++
          if (runLength === 5) score += PENALTY_ADJACENT
          else if (runLength > 5) score += 1
        } else {
          runColour = dark
          runLength = 1
        }
      }
    }
  }
  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const dark = matrix[y][x]
      if (dark === matrix[y][x + 1] && dark === matrix[y + 1][x] && dark === matrix[y + 1][x + 1]) {
        score += PENALTY_BLOCK
      }
    }
  }

  // Rule 3: the 1:1:3:1:1 finder ratio with a four-module light run on either
  // side, scanned over rows and columns. The window is allowed to overhang the
  // edges by four modules and anything outside reads as light, because what is
  // out there is the quiet zone.
  const before = [false, false, false, false, true, false, true, true, true, false, true]
  const after = [true, false, true, true, true, false, true, false, false, false, false]
  const moduleAt = (horizontal: boolean, a: number, b: number): boolean =>
    b >= 0 && b < size && (horizontal ? matrix[a][b] : matrix[b][a])
  for (const horizontal of [true, false]) {
    for (let a = 0; a < size; a++) {
      for (let start = -4; start <= size - 7; start++) {
        let matchesBefore = true
        let matchesAfter = true
        for (let i = 0; i < 11; i++) {
          const dark = moduleAt(horizontal, a, start + i)
          if (dark !== before[i]) matchesBefore = false
          if (dark !== after[i]) matchesAfter = false
          if (!matchesBefore && !matchesAfter) break
        }
        if (matchesBefore) score += PENALTY_FINDER_LIKE
        if (matchesAfter) score += PENALTY_FINDER_LIKE
      }
    }
  }

  // Rule 4, in integers: the smallest k >= 0 with (50 - 5(k+1))% < dark/total <
  // (50 + 5(k+1))%. The side length is odd, so the ratio is never exactly a half
  // and the ceiling below never lands on zero.
  let dark = 0
  for (const row of matrix) for (const cell of row) if (cell) dark++
  const total = size * size
  const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1
  score += k * PENALTY_IMBALANCE

  return score
}

// --- Public API -------------------------------------------------------------

/** Encode `text` (UTF-8, byte mode) into the smallest QR version that fits. */
export function encodeQr(text: string, options: EncodeQrOptions = {}): QrEncodeResult {
  const ecc = options.ecc ?? 'M'
  const minVersion = options.minVersion ?? MIN_VERSION
  const maxVersion = options.maxVersion ?? MAX_VERSION
  assertVersion(minVersion)
  assertVersion(maxVersion)
  if (minVersion > maxVersion) throw new Error(`minVersion ${minVersion} exceeds maxVersion ${maxVersion}`)

  const bytes = new TextEncoder().encode(text)
  let version = 0
  for (let candidate = minVersion; candidate <= maxVersion; candidate++) {
    if (bytes.length <= byteModeCapacity(candidate, ecc)) {
      version = candidate
      break
    }
  }
  if (version === 0) {
    throw new Error(
      `${bytes.length} bytes do not fit in a version ${maxVersion} level ${ecc} symbol ` +
        `(capacity ${byteModeCapacity(maxVersion, ecc)} bytes)`,
    )
  }

  const canvas = drawFunctionPatterns(version)
  placeCodewords(canvas, interleave(buildDataCodewords(bytes, version, ecc), version, ecc))

  // Try every mask and keep the cheapest, ties going to the lowest index. The
  // format information has to be written each time, because rule 3 can see it.
  let mask = 0
  let best = Number.POSITIVE_INFINITY
  for (let candidate = 0; candidate < 8; candidate++) {
    applyMask(canvas, candidate)
    drawFormatBits(canvas, ecc, candidate)
    const score = penaltyScore(canvas.matrix)
    if (score < best) {
      best = score
      mask = candidate
    }
    applyMask(canvas, candidate)
  }
  applyMask(canvas, mask)
  drawFormatBits(canvas, ecc, mask)

  return { matrix: canvas.matrix, version, ecc, mask }
}

const escapeXml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

/** Render a matrix as a standalone, self-contained SVG string (no external refs). */
export function qrSvg(matrix: QrMatrix, options: QrSvgOptions = {}): string {
  const moduleSize = options.moduleSize ?? 4
  const quietZone = options.quietZone ?? 4
  const dark = options.dark ?? '#000000'
  const light = options.light ?? '#ffffff'
  const size = matrix.length
  const side = (size + 2 * quietZone) * moduleSize

  // One path for every dark module would be enormous, so horizontal runs are
  // merged into single rectangles. Coordinates stay in module units and the
  // group transform does the scaling, which keeps the path short and exact.
  const runs: string[] = []
  for (let y = 0; y < size; y++) {
    let x = 0
    while (x < size) {
      if (!matrix[y][x]) {
        x++
        continue
      }
      let length = 1
      while (x + length < size && matrix[y][x + length]) length++
      runs.push(`M${x} ${y}h${length}v1h-${length}z`)
      x += length
    }
  }

  const titleMarkup = options.title === undefined ? '' : `<title>${escapeXml(options.title)}</title>`
  const label = options.title === undefined ? '' : ' role="img"'
  const translate = quietZone * moduleSize

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${side}" height="${side}" ` +
    `viewBox="0 0 ${side} ${side}" shape-rendering="crispEdges"${label}>` +
    titleMarkup +
    `<rect width="${side}" height="${side}" fill="${light}"/>` +
    `<g transform="translate(${translate} ${translate}) scale(${moduleSize})">` +
    `<path fill="${dark}" d="${runs.join('')}"/>` +
    `</g></svg>`
  )
}

/** Convenience: encodeQr + qrSvg in one call. */
export function qrSvgFor(text: string, options: EncodeQrOptions & QrSvgOptions = {}): string {
  return qrSvg(encodeQr(text, options).matrix, options)
}
