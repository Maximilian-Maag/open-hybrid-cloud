import { describe, it, expect } from 'vitest'
import {
  ECC_BLOCKS,
  ECC_CODEWORDS_PER_BLOCK,
  ECC_LEVELS,
  MAX_VERSION,
  TOTAL_CODEWORDS,
  alignmentPatternPositions,
  byteModeCapacity,
  dataCodewords,
  encodeQr,
  formatInfoBits,
  matrixSize,
  penaltyScore,
  qrSvg,
  qrSvgFor,
  reedSolomonRemainder,
  versionInfoBits,
  type EccLevel,
  type QrMatrix,
} from './qr'

/**
 * There is no QR library in this repo to check the encoder against, and adding one
 * would defeat the point of writing the encoder by hand. So this file checks it two
 * ways instead.
 *
 * First, against published constants: the Reed-Solomon worked example in ISO/IEC
 * 18004 Annex I, the 32 format strings of Table C.1, the version strings of
 * Table D.1, and the alignment-pattern centres of Table E.1. Those are the parts
 * where a plausible-looking wrong answer is easiest to produce and hardest to
 * notice, and they are the only parts that can be anchored to something outside
 * this repo at all.
 *
 * Second, by decoding. The decoder below is written from the specification rather
 * than by calling back into `qr.ts`: it builds its own map of reserved modules from
 * the Table E.1 positions, applies its own copy of the eight mask predicates, and
 * splits blocks from the error-correction tables directly. It also re-derives each
 * block's parity and compares it to what was written, so an interleaving mistake
 * cannot hide behind a symmetric mistake in the reader.
 *
 * What that deliberately does NOT prove is the direction of the placement walk:
 * reading the modules back requires walking them in the same order, so a
 * consistently-wrong walk would round-trip happily. The free-module count check
 * catches a walk that visits the wrong modules, and beyond that the guard is the
 * structural assertions on the patterns a real scanner keys off.
 */

// --- Published constants ----------------------------------------------------

/**
 * ISO/IEC 18004 Table E.1: alignment pattern centre coordinates, versions 1-20.
 * Transcribed rather than computed, so that the formula in `qr.ts` has something
 * to be wrong against.
 */
const ALIGNMENT_POSITIONS: readonly (readonly number[])[] = [
  [], // version 1 has none
  [6, 18],
  [6, 22],
  [6, 26],
  [6, 30],
  [6, 34],
  [6, 22, 38],
  [6, 24, 42],
  [6, 26, 46],
  [6, 28, 50],
  [6, 30, 54],
  [6, 32, 58],
  [6, 34, 62],
  [6, 26, 46, 66],
  [6, 26, 48, 70],
  [6, 26, 50, 74],
  [6, 30, 54, 78],
  [6, 30, 56, 82],
  [6, 30, 58, 86],
  [6, 34, 62, 90],
]

/**
 * ISO/IEC 18004 Table C.1: the 15-bit format information for every level and mask,
 * as [level][mask]. Two of the values circulated as "known" for this table are
 * wrong and worth naming, because both look right at a glance:
 *
 *   - H with mask 0 is 0x1689, not 0x2D89. The top two bits of a format string are
 *     the level indicator XORed with 0b10 (from the 0x5412 mask), so H (10) always
 *     starts 00 and cannot produce a value in the 0x2000 range at all.
 *   - M with mask 5 is 0x40CE, not 0x5B75. 0x5B75 begins 10110, which unmasks to
 *     level M mask 3 — and M mask 3 is 0x5B4B, so 0x5B75 is not a codeword of the
 *     BCH(15,5) code under any reading.
 */
const FORMAT_INFO: Record<EccLevel, readonly number[]> = {
  L: [0x77c4, 0x72f3, 0x7daa, 0x789d, 0x662f, 0x6318, 0x6c41, 0x6976],
  M: [0x5412, 0x5125, 0x5e7c, 0x5b4b, 0x45f9, 0x40ce, 0x4f97, 0x4aa0],
  Q: [0x355f, 0x3068, 0x3f31, 0x3a06, 0x24b4, 0x2183, 0x2eda, 0x2bed],
  H: [0x1689, 0x13be, 0x1ce7, 0x19d0, 0x0762, 0x0255, 0x0d0c, 0x083b],
}

/** ISO/IEC 18004 Table D.1: version information, versions 7-20. */
const VERSION_INFO: Record<number, number> = {
  7: 0x07c94,
  8: 0x085bc,
  9: 0x09a99,
  10: 0x0a4d3,
  11: 0x0bbf6,
  12: 0x0c762,
  13: 0x0d847,
  14: 0x0e60d,
  15: 0x0f928,
  16: 0x10b78,
  17: 0x1145d,
  18: 0x12a17,
  19: 0x13532,
  20: 0x149a6,
}

/**
 * ISO/IEC 18004 Table 7: byte-mode data capacity in characters, as
 * [version - 1][L, M, Q, H]. Transcribed, and worth transcribing in full: this is
 * the one published table that depends on both error-correction tables at once.
 */
const BYTE_CAPACITY: readonly (readonly number[])[] = [
  [17, 14, 11, 7],
  [32, 26, 20, 14],
  [53, 42, 32, 24],
  [78, 62, 46, 34],
  [106, 84, 60, 44],
  [134, 106, 74, 58],
  [154, 122, 86, 64],
  [192, 152, 108, 84],
  [230, 180, 130, 98],
  [271, 213, 151, 119],
  [321, 251, 177, 137],
  [367, 287, 203, 155],
  [425, 331, 241, 177],
  [458, 362, 258, 194],
  [520, 412, 292, 220],
  [586, 450, 322, 250],
  [644, 504, 364, 280],
  [718, 560, 394, 310],
  [792, 624, 442, 338],
  [858, 666, 482, 382],
]

// --- Test-only decoder ------------------------------------------------------

/** ISO/IEC 18004 Table 10, written out again so the reader does not share code. */
const MASK_PREDICATES: readonly ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
]

/**
 * Every module a decoder must skip when reading data: function patterns, their
 * separators, and the metadata fields. Built here from the published alignment
 * table rather than from `qr.ts`, so the two can disagree.
 */
const reservedMap = (version: number): boolean[][] => {
  const size = 17 + 4 * version
  const reserved = Array.from({ length: size }, () => new Array<boolean>(size).fill(false))
  const fill = (x0: number, y0: number, width: number, height: number): void => {
    for (let y = y0; y < y0 + height; y++) {
      for (let x = x0; x < x0 + width; x++) reserved[y][x] = true
    }
  }

  fill(0, 0, 9, 9) // top-left finder + separator + first format copy
  fill(size - 8, 0, 8, 9) // top-right finder + separator + format copy
  fill(0, size - 8, 9, 8) // bottom-left finder + separator + format copy
  for (let i = 0; i < size; i++) {
    reserved[6][i] = true
    reserved[i][6] = true
  }

  const positions = ALIGNMENT_POSITIONS[version - 1]
  const last = positions.length - 1
  for (let i = 0; i <= last; i++) {
    for (let j = 0; j <= last; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) continue
      fill(positions[i] - 2, positions[j] - 2, 5, 5)
    }
  }

  if (version >= 7) {
    fill(size - 11, 0, 3, 6)
    fill(0, size - 11, 6, 3)
  }

  return reserved
}

const countFreeModules = (version: number): number => {
  const reserved = reservedMap(version)
  let free = 0
  for (const row of reserved) for (const cell of row) if (!cell) free++
  return free
}

/** Both copies of the format information, read out of the finished matrix. */
const readFormatInfo = (matrix: QrMatrix): { ecc: EccLevel; mask: number } => {
  const size = matrix.length
  const collect = (positions: readonly (readonly [number, number])[]): number => {
    let bits = 0
    positions.forEach(([x, y], index) => {
      if (matrix[y][x]) bits |= 1 << index
    })
    return bits
  }

  const first: [number, number][] = []
  for (let i = 0; i <= 5; i++) first.push([8, i])
  first.push([8, 7], [8, 8], [7, 8])
  for (let i = 9; i < 15; i++) first.push([14 - i, 8])

  const second: [number, number][] = []
  for (let i = 0; i < 8; i++) second.push([size - 1 - i, 8])
  for (let i = 8; i < 15; i++) second.push([8, size - 15 + i])

  const bits = collect(first)
  expect(collect(second), 'the two format-information copies must agree').toBe(bits)

  for (const level of ECC_LEVELS) {
    for (let mask = 0; mask < 8; mask++) {
      if (formatInfoBits(level, mask) === bits) return { ecc: level, mask }
    }
  }
  throw new Error(`format bits ${bits.toString(2)} are not a valid format string`)
}

/** Both copies of the version information, for version 7 and up. */
const readVersionInfo = (matrix: QrMatrix): { first: number; second: number } => {
  const size = matrix.length
  let first = 0
  let second = 0
  for (let i = 0; i < 18; i++) {
    const a = size - 11 + (i % 3)
    const b = Math.floor(i / 3)
    if (matrix[b][a]) first |= 1 << i
    if (matrix[a][b]) second |= 1 << i
  }
  return { first, second }
}

/**
 * Undo the mask and walk the placement path backwards, recovering the interleaved
 * codeword stream. The remainder bits past the last codeword are discarded.
 */
const readCodewordStream = (matrix: QrMatrix, version: number, mask: number): number[] => {
  const size = matrix.length
  const reserved = reservedMap(version)
  const predicate = MASK_PREDICATES[mask]
  const bits: boolean[] = []

  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5
    for (let vertical = 0; vertical < size; vertical++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j
        const upward = ((right + 1) & 2) === 0
        const y = upward ? size - 1 - vertical : vertical
        if (!reserved[y][x]) bits.push(matrix[y][x] !== predicate(x, y))
      }
    }
  }

  const total = TOTAL_CODEWORDS[version - 1]
  expect(bits.length).toBeGreaterThanOrEqual(total * 8)
  const stream: number[] = []
  for (let i = 0; i < total; i++) {
    let byte = 0
    for (let j = 0; j < 8; j++) byte = (byte << 1) | (bits[i * 8 + j] ? 1 : 0)
    stream.push(byte)
  }
  return stream
}

/** De-interleave, then check each block's parity before dropping it. */
const recoverDataCodewords = (stream: readonly number[], version: number, ecc: EccLevel): number[] => {
  const index = version - 1
  const total = TOTAL_CODEWORDS[index]
  const eccLength = ECC_CODEWORDS_PER_BLOCK[ecc][index]
  const blocks = ECC_BLOCKS[ecc][index]
  const shortLength = Math.floor(total / blocks) - eccLength
  const longBlocks = total % blocks
  const lengths = Array.from({ length: blocks }, (_unused, b) =>
    b < blocks - longBlocks ? shortLength : shortLength + 1,
  )

  const dataBlocks: number[][] = lengths.map(() => [])
  const eccBlocks: number[][] = lengths.map(() => [])
  let cursor = 0
  const longest = Math.max(...lengths)
  for (let i = 0; i < longest; i++) {
    for (let b = 0; b < blocks; b++) if (i < lengths[b]) dataBlocks[b].push(stream[cursor++])
  }
  for (let i = 0; i < eccLength; i++) {
    for (let b = 0; b < blocks; b++) eccBlocks[b].push(stream[cursor++])
  }
  expect(cursor, 'every codeword in the stream must belong to some block').toBe(total)

  for (let b = 0; b < blocks; b++) {
    expect(reedSolomonRemainder(dataBlocks[b], eccLength), `block ${b} parity`).toEqual(eccBlocks[b])
  }

  return dataBlocks.flat()
}

/** Parse the byte-mode segment out of the recovered data codewords. */
const decodePayload = (data: readonly number[], version: number): string => {
  let cursor = 0
  const take = (count: number): number => {
    let value = 0
    for (let i = 0; i < count; i++) {
      const bit = (data[cursor >>> 3] >>> (7 - (cursor & 7))) & 1
      value = (value << 1) | bit
      cursor++
    }
    return value
  }

  expect(take(4), 'mode indicator must be byte mode').toBe(0b0100)
  const length = take(version <= 9 ? 8 : 16)
  const bytes = new Uint8Array(length)
  for (let i = 0; i < length; i++) bytes[i] = take(8)
  return new TextDecoder().decode(bytes)
}

/** The whole read path: matrix in, original string out. */
const decodeQr = (result: ReturnType<typeof encodeQr>): string => {
  const { ecc, mask } = readFormatInfo(result.matrix)
  expect(ecc, 'level read back from the matrix').toBe(result.ecc)
  expect(mask, 'mask read back from the matrix').toBe(result.mask)

  const size = result.matrix.length
  expect(size).toBe(17 + 4 * result.version)
  if (result.version >= 7) {
    const { first, second } = readVersionInfo(result.matrix)
    expect(first).toBe(VERSION_INFO[result.version])
    expect(second).toBe(VERSION_INFO[result.version])
  }

  const stream = readCodewordStream(result.matrix, result.version, mask)
  return decodePayload(recoverDataCodewords(stream, result.version, ecc), result.version)
}

const roundTrip = (text: string, ecc: EccLevel): void => {
  const result = encodeQr(text, { ecc })
  expect(decodeQr(result), `round trip at level ${ecc}`).toBe(text)
}

/**
 * A 32-bit LCG, so the "random" inputs are the same on every run. A flaky encoder
 * test would be worse than no test: it would be blamed on the machine.
 */
const seededStrings = (seed: number, lengths: readonly number[]): string[] => {
  let state = seed >>> 0
  const next = (): number => {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0
    return (state >>> 16) & 0x7fff
  }
  // Printable ASCII only: every character is one UTF-8 byte, so a length is also a
  // byte count and the long cases stay inside version 20's capacity at level H.
  return lengths.map((length) => {
    let text = ''
    for (let i = 0; i < length; i++) text += String.fromCharCode(32 + (next() % 95))
    return text
  })
}

// --- Tests ------------------------------------------------------------------

describe('Reed-Solomon error correction', () => {
  it('reproduces the ISO/IEC 18004 Annex I worked example', () => {
    // Data codewords for "01234567" in version 1-M numeric mode, and the ten
    // parity codewords the standard prints for them.
    const data = [0x10, 0x20, 0x0c, 0x56, 0x61, 0x80, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11]
    expect(reedSolomonRemainder(data, 10)).toEqual([0xa5, 0x24, 0xd4, 0xc1, 0xed, 0x36, 0xc7, 0x87, 0x2c, 0x55])
  })

  it('returns the requested number of parity codewords', () => {
    for (const length of [7, 10, 13, 16, 17, 22, 26, 28, 30]) {
      expect(reedSolomonRemainder([1, 2, 3, 4, 5], length)).toHaveLength(length)
    }
  })

  it('leaves all-zero data with zero parity', () => {
    // A degenerate case worth pinning: a wrong generator polynomial would still
    // give zeros here, but a broken shift or an off-by-one in the tables would not.
    expect(reedSolomonRemainder([0, 0, 0, 0], 10)).toEqual(new Array(10).fill(0))
  })

  it('is linear over GF(256), as a Reed-Solomon code must be', () => {
    const a = [0x11, 0x22, 0x33, 0x44, 0x55]
    const b = [0xf0, 0x0f, 0xa5, 0x5a, 0x01]
    const sum = a.map((value, i) => value ^ b[i])
    const expected = reedSolomonRemainder(a, 15).map((value, i) => value ^ reedSolomonRemainder(b, 15)[i])
    expect(reedSolomonRemainder(sum, 15)).toEqual(expected)
  })
})

describe('format information', () => {
  it('matches every entry of ISO/IEC 18004 Table C.1', () => {
    for (const level of ECC_LEVELS) {
      for (let mask = 0; mask < 8; mask++) {
        expect(formatInfoBits(level, mask), `${level} mask ${mask}`).toBe(FORMAT_INFO[level][mask])
      }
    }
  })

  it('keeps all 32 strings at least 7 bits apart', () => {
    // The BCH(15,5) code has minimum distance 7, which is what lets a decoder
    // recover the format after three flipped modules. If any pair came out closer,
    // the parity generator would be wrong even if individual values looked fine.
    const all = ECC_LEVELS.flatMap((level) => [0, 1, 2, 3, 4, 5, 6, 7].map((mask) => formatInfoBits(level, mask)))
    expect(new Set(all).size).toBe(32)
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        let differences = 0
        for (let bit = 0; bit < 15; bit++) if ((((all[i] ^ all[j]) >>> bit) & 1) !== 0) differences++
        expect(differences, `distance between entries ${i} and ${j}`).toBeGreaterThanOrEqual(7)
      }
    }
  })

  it('rejects an out-of-range mask', () => {
    expect(() => formatInfoBits('M', 8)).toThrow()
    expect(() => formatInfoBits('M', -1)).toThrow()
  })
})

describe('version information', () => {
  it('matches ISO/IEC 18004 Table D.1 for versions 7-20', () => {
    for (let version = 7; version <= MAX_VERSION; version++) {
      expect(versionInfoBits(version), `version ${version}`).toBe(VERSION_INFO[version])
    }
  })

  it('keeps the version data in the top six bits', () => {
    for (let version = 7; version <= MAX_VERSION; version++) {
      expect(versionInfoBits(version) >>> 12).toBe(version)
    }
  })

  it('rejects versions outside the supported range', () => {
    expect(() => versionInfoBits(0)).toThrow()
    expect(() => versionInfoBits(MAX_VERSION + 1)).toThrow()
  })
})

describe('per-version tables', () => {
  it('derives the Table E.1 alignment pattern centres', () => {
    for (let version = 1; version <= MAX_VERSION; version++) {
      expect(alignmentPatternPositions(version), `version ${version}`).toEqual([...ALIGNMENT_POSITIONS[version - 1]])
    }
  })

  it('agrees with the modules actually left free by the function patterns', () => {
    // The total codeword count is not independent data: it is the free module count
    // divided by eight. Checking one against the other catches both a typo in the
    // table and a function pattern drawn in the wrong place.
    for (let version = 1; version <= MAX_VERSION; version++) {
      const free = countFreeModules(version)
      expect(Math.floor(free / 8), `version ${version} codewords`).toBe(TOTAL_CODEWORDS[version - 1])
      expect(free - TOTAL_CODEWORDS[version - 1] * 8, `version ${version} remainder bits`).toBeLessThan(8)
    }
  })

  it('splits every version and level into whole blocks', () => {
    for (let version = 1; version <= MAX_VERSION; version++) {
      for (const ecc of ECC_LEVELS) {
        const total = TOTAL_CODEWORDS[version - 1]
        const blocks = ECC_BLOCKS[ecc][version - 1]
        const eccLength = ECC_CODEWORDS_PER_BLOCK[ecc][version - 1]
        const shortLength = Math.floor(total / blocks) - eccLength
        expect(shortLength, `version ${version}-${ecc} block length`).toBeGreaterThan(0)
        // Blocks differ in length by at most one codeword, by construction.
        expect(total % blocks).toBeLessThan(blocks)
        expect(dataCodewords(version, ecc)).toBe(total - eccLength * blocks)
      }
    }
  })

  it('increases capacity with version and decreases it with error correction', () => {
    for (let version = 1; version < MAX_VERSION; version++) {
      for (const ecc of ECC_LEVELS) {
        expect(byteModeCapacity(version + 1, ecc)).toBeGreaterThan(byteModeCapacity(version, ecc))
      }
    }
    for (let version = 1; version <= MAX_VERSION; version++) {
      expect(byteModeCapacity(version, 'L')).toBeGreaterThan(byteModeCapacity(version, 'M'))
      expect(byteModeCapacity(version, 'M')).toBeGreaterThan(byteModeCapacity(version, 'Q'))
      expect(byteModeCapacity(version, 'Q')).toBeGreaterThan(byteModeCapacity(version, 'H'))
    }
  })

  it('matches every published byte-mode capacity in ISO/IEC 18004 Table 7', () => {
    // The strongest external check on the two error-correction tables there is.
    // Capacity is a function of both of them plus the total codeword count, so
    // eighty published numbers agreeing pins all three at once — this is how the
    // level-H block count for version 8 was found to be 6 rather than 5.
    for (let version = 1; version <= MAX_VERSION; version++) {
      const published = BYTE_CAPACITY[version - 1]
      ECC_LEVELS.forEach((ecc, i) => {
        expect(byteModeCapacity(version, ecc), `version ${version} level ${ecc}`).toBe(published[i])
      })
    }
  })
})

describe('symbol structure', () => {
  const versions = [1, 2, 6, 7, 10, 14, 20]

  // One symbol per version, shared by every assertion below. Function patterns do
  // not depend on the payload, and encoding is the expensive part of this file.
  const symbols = new Map<number, QrMatrix>()
  const symbolFor = (version: number): QrMatrix => {
    const cached = symbols.get(version)
    if (cached !== undefined) return cached
    const { matrix } = encodeQr('structure', { minVersion: version, maxVersion: version })
    symbols.set(version, matrix)
    return matrix
  }

  it('is square and sized 17 + 4 * version', () => {
    for (const version of versions) {
      const matrix = symbolFor(version)
      expect(matrix).toHaveLength(17 + 4 * version)
      expect(matrix).toHaveLength(matrixSize(version))
      for (const row of matrix) expect(row).toHaveLength(matrix.length)
    }
  })

  it('places the three finder patterns exactly', () => {
    // Written out as literal rows: this is the pattern a scanner hunts for, so it
    // is worth spelling rather than generating from the same rule as the encoder.
    const finder = [
      [1, 1, 1, 1, 1, 1, 1],
      [1, 0, 0, 0, 0, 0, 1],
      [1, 0, 1, 1, 1, 0, 1],
      [1, 0, 1, 1, 1, 0, 1],
      [1, 0, 1, 1, 1, 0, 1],
      [1, 0, 0, 0, 0, 0, 1],
      [1, 1, 1, 1, 1, 1, 1],
    ]
    for (const version of versions) {
      const matrix = symbolFor(version)
      const size = matrix.length
      for (const [ox, oy] of [
        [0, 0],
        [size - 7, 0],
        [0, size - 7],
      ]) {
        for (let y = 0; y < 7; y++) {
          for (let x = 0; x < 7; x++) {
            expect(matrix[oy + y][ox + x], `v${version} finder at ${ox},${oy} module ${x},${y}`).toBe(
              finder[y][x] === 1,
            )
          }
        }
      }
      // Separators: the light ring on the inner sides of each finder.
      for (let i = 0; i < 8; i++) {
        expect(matrix[7][i]).toBe(false)
        expect(matrix[i][7]).toBe(false)
        expect(matrix[7][size - 1 - i]).toBe(false)
        expect(matrix[i][size - 8]).toBe(false)
        expect(matrix[size - 8][i]).toBe(false)
        expect(matrix[size - 1 - i][7]).toBe(false)
      }
    }
  })

  it('alternates the timing patterns', () => {
    for (const version of versions) {
      const matrix = symbolFor(version)
      const size = matrix.length
      for (let i = 8; i < size - 8; i++) {
        expect(matrix[6][i], `v${version} horizontal timing at ${i}`).toBe(i % 2 === 0)
        expect(matrix[i][6], `v${version} vertical timing at ${i}`).toBe(i % 2 === 0)
      }
    }
  })

  it('sets the dark module at (8, 4 * version + 9)', () => {
    for (const version of versions) {
      const matrix = symbolFor(version)
      expect(matrix[4 * version + 9][8]).toBe(true)
    }
  })

  it('draws the right number of correctly shaped alignment patterns', () => {
    for (const version of versions) {
      const matrix = symbolFor(version)
      const positions = ALIGNMENT_POSITIONS[version - 1]
      const last = positions.length - 1
      let count = 0
      for (let i = 0; i <= last; i++) {
        for (let j = 0; j <= last; j++) {
          if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) continue
          count++
          for (let dy = -2; dy <= 2; dy++) {
            for (let dx = -2; dx <= 2; dx++) {
              const expected = Math.max(Math.abs(dx), Math.abs(dy)) !== 1
              expect(
                matrix[positions[j] + dy][positions[i] + dx],
                `v${version} alignment at ${positions[i]},${positions[j]} offset ${dx},${dy}`,
              ).toBe(expected)
            }
          }
        }
      }
      const expectedCount = version === 1 ? 0 : positions.length * positions.length - 3
      expect(count, `v${version} alignment pattern count`).toBe(expectedCount)
    }
  })
})

describe('mask selection', () => {
  /** Re-mask a finished symbol with a different mask, format bits included. */
  const withMask = (result: ReturnType<typeof encodeQr>, mask: number): QrMatrix => {
    const size = result.matrix.length
    const reserved = reservedMap(result.version)
    const matrix = result.matrix.map((row) => [...row])
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (reserved[y][x]) continue
        // Two XORs: strip the mask the encoder chose, then lay the candidate on.
        if (MASK_PREDICATES[result.mask](x, y)) matrix[y][x] = !matrix[y][x]
        if (MASK_PREDICATES[mask](x, y)) matrix[y][x] = !matrix[y][x]
      }
    }
    const bits = formatInfoBits(result.ecc, mask)
    const at = (i: number): boolean => ((bits >>> i) & 1) !== 0
    for (let i = 0; i <= 5; i++) matrix[i][8] = at(i)
    matrix[7][8] = at(6)
    matrix[8][8] = at(7)
    matrix[8][7] = at(8)
    for (let i = 9; i < 15; i++) matrix[8][14 - i] = at(i)
    for (let i = 0; i < 8; i++) matrix[8][size - 1 - i] = at(i)
    for (let i = 8; i < 15; i++) matrix[size - 15 + i][8] = at(i)
    return matrix
  }

  it('picks the lowest-penalty mask, ties going to the lowest index', () => {
    const inputs = ['a', 'HELLO WORLD', 'otpauth://totp/x?secret=AAAA', ...seededStrings(7, [40, 111, 260])]
    for (const text of inputs) {
      for (const ecc of ECC_LEVELS) {
        const result = encodeQr(text, { ecc })
        const scores = [0, 1, 2, 3, 4, 5, 6, 7].map((mask) => penaltyScore(withMask(result, mask)))
        const best = Math.min(...scores)
        expect(scores[result.mask], `chosen mask for ${ecc} / ${text.length} bytes`).toBe(best)
        expect(result.mask, 'ties must go to the lowest mask index').toBe(scores.indexOf(best))
      }
    }
  })

  it('re-masking with the chosen mask reproduces the encoder output', () => {
    const result = encodeQr('idempotence', { ecc: 'Q' })
    expect(withMask(result, result.mask)).toEqual(result.matrix)
  })

  it('scores a solid matrix far worse than a real symbol', () => {
    // A completely dark 21x21 grid trips every rule at once, so this mostly proves
    // the penalty function is doing anything at all — but it also pins the sign.
    const solid: QrMatrix = Array.from({ length: 21 }, () => new Array<boolean>(21).fill(true))
    expect(penaltyScore(solid)).toBeGreaterThan(penaltyScore(encodeQr('a').matrix))
  })
})

describe('round trip', () => {
  const otpauth =
    'otpauth://totp/Open%20Hybrid%20Cloud:root@example.org?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ' +
    '&issuer=Open+Hybrid+Cloud&algorithm=SHA1&digits=6&period=30'

  const fixtures: readonly string[] = [
    '',
    'a',
    'HELLO WORLD',
    otpauth,
    'grüße 日本',
    '🎉 émoji ✓ and ünïcödé — with an em dash',
    ...seededStrings(20260821, [1, 2, 3, 7, 13, 31, 64, 97, 150, 233, 300]),
  ]

  for (const ecc of ECC_LEVELS) {
    it(`recovers every fixture at level ${ecc}`, () => {
      for (const text of fixtures) roundTrip(text, ecc)
    })
  }

  it('recovers a payload that only fits from version 10 upwards, where the count field grows', () => {
    // The character-count indicator widens from 8 to 16 bits at version 10, which
    // is the single easiest place to lose a byte.
    for (const ecc of ECC_LEVELS) {
      const text = 'x'.repeat(byteModeCapacity(9, ecc) + 1)
      const result = encodeQr(text, { ecc })
      expect(result.version).toBe(10)
      expect(decodeQr(result)).toBe(text)
    }
  })

  it(
    'recovers a payload filling a version exactly, at every version and level',
    () => {
      // The broadest test here, and the one that would catch a single wrong number
      // in the error-correction tables: it visits all eighty version-and-level
      // combinations. Exact fits also leave no padding, so a terminator written one
      // bit too eagerly would overwrite real data, which nothing else exercises.
      // The version is not pinned, so this doubles as the version-selection check.
      for (let version = 1; version <= MAX_VERSION; version++) {
        for (const ecc of ECC_LEVELS) {
          const text = 'Z'.repeat(byteModeCapacity(version, ecc))
          const result = encodeQr(text, { ecc })
          expect(result.version, `exact fit v${version}-${ecc}`).toBe(version)
          expect(decodeQr(result), `exact fit v${version}-${ecc}`).toBe(text)
        }
      }
    },
    // Eighty encodes plus eighty decodes, each trying all eight masks. Slow on a
    // loaded machine, and the default five seconds is too tight to rely on.
    30_000,
  )

  it('recovers multi-byte characters split across a codeword boundary', () => {
    for (const ecc of ECC_LEVELS) {
      for (let pad = 0; pad < 4; pad++) {
        const text = `${'.'.repeat(pad)}日本語テキスト`
        roundTrip(text, ecc)
      }
    }
  })
})

describe('version selection', () => {
  it('steps up when the payload is one byte too long', () => {
    // That the smallest fitting version is chosen for an exact fit is covered
    // exhaustively by the round trip above; this is the other side of the
    // boundary, sampled rather than swept because each encode is not cheap.
    for (const ecc of ECC_LEVELS) {
      for (const version of [1, 2, 9, 10, 19]) {
        const overflow = encodeQr('y'.repeat(byteModeCapacity(version, ecc) + 1), { ecc })
        expect(overflow.version, `one byte over ${version}-${ecc}`).toBeGreaterThan(version)
      }
    }
  })

  it('honours minVersion and maxVersion', () => {
    expect(encodeQr('a', { minVersion: 5 }).version).toBe(5)
    expect(encodeQr('a', { minVersion: 12, maxVersion: 20 }).version).toBe(12)
    expect(() => encodeQr('a', { minVersion: 6, maxVersion: 3 })).toThrow(/exceeds/)
    expect(() => encodeQr('a', { minVersion: 0 })).toThrow()
    expect(() => encodeQr('a', { maxVersion: MAX_VERSION + 1 })).toThrow()
  })

  it('refuses a payload that does not fit the largest allowed version', () => {
    expect(() => encodeQr('x'.repeat(byteModeCapacity(MAX_VERSION, 'H') + 1), { ecc: 'H' })).toThrow(/do not fit/)
    expect(() => encodeQr('x'.repeat(30), { maxVersion: 1 })).toThrow(/do not fit/)
  })

  it('defaults to level M', () => {
    expect(encodeQr('default level').ecc).toBe('M')
  })
})

describe('qrSvg', () => {
  const { matrix } = encodeQr('svg output', { ecc: 'M' })
  const darkModules = matrix.flat().filter(Boolean).length

  it('is a self-contained svg element', () => {
    const svg = qrSvg(matrix)
    expect(svg.startsWith('<svg')).toBe(true)
    expect(svg.endsWith('</svg>')).toBe(true)
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"')
    // The only external-looking reference allowed is the namespace itself. No
    // <image href>, no <use>, no @import: the SVG has to render inside a data URI
    // and inside an email client with remote content switched off.
    expect(svg.split('http')).toHaveLength(2)
    expect(svg).not.toContain('<image')
    expect(svg).not.toContain('<use')
    expect(svg).not.toContain('href')
  })

  it('sizes the viewBox from the module count, quiet zone and module size', () => {
    for (const [moduleSize, quietZone] of [
      [4, 4],
      [1, 4],
      [8, 0],
      [3, 2],
    ]) {
      const side = (matrix.length + 2 * quietZone) * moduleSize
      const svg = qrSvg(matrix, { moduleSize, quietZone })
      expect(svg).toContain(`viewBox="0 0 ${side} ${side}"`)
      expect(svg).toContain(`width="${side}"`)
      expect(svg).toContain(`height="${side}"`)
    }
  })

  it('defaults to a module size of 4 and a quiet zone of 4 modules', () => {
    const side = (matrix.length + 8) * 4
    expect(qrSvg(matrix)).toContain(`viewBox="0 0 ${side} ${side}"`)
  })

  it('paints a light background behind the modules', () => {
    const svg = qrSvg(matrix, { light: '#fafafa', dark: '#101010' })
    expect(svg).toContain('<rect')
    expect(svg).toContain('fill="#fafafa"')
    expect(svg).toContain('fill="#101010"')
    // Background first, modules second, or the modules would be painted over.
    expect(svg.indexOf('<rect')).toBeLessThan(svg.indexOf('<path'))
  })

  it('draws every dark module exactly once, as horizontal runs in one path', () => {
    const svg = qrSvg(matrix)
    expect(svg.split('<path')).toHaveLength(2)
    let drawn = 0
    let runs = 0
    for (const run of svg.matchAll(/M(\d+) (\d+)h(\d+)v1h-(\d+)z/g)) {
      expect(run[4]).toBe(run[3])
      drawn += Number(run[3])
      runs++
    }
    expect(drawn, 'modules covered by the path').toBe(darkModules)
    // Merging runs is the point of the path: a symbol always has adjacent modules,
    // so there must be strictly fewer subpaths than dark modules.
    expect(runs).toBeLessThan(darkModules)
    // Nothing outside the recognised run syntax may appear in the path data.
    const path = /<path fill="[^"]*" d="([^"]*)"\/>/.exec(svg)
    expect(path).not.toBeNull()
    expect(path === null ? 'unmatched' : path[1].replace(/M\d+ \d+h\d+v1h-\d+z/g, '')).toBe('')
  })

  it('adds a title and an image role only when a title is given', () => {
    expect(qrSvg(matrix)).not.toContain('<title>')
    expect(qrSvg(matrix)).not.toContain('role=')
    const titled = qrSvg(matrix, { title: 'Scan with your authenticator app' })
    expect(titled).toContain('role="img"')
    expect(titled).toContain('<title>Scan with your authenticator app</title>')
  })

  it('escapes markup in the title', () => {
    const svg = qrSvg(matrix, { title: 'Ben & Jerry <script>alert("x")</script>' })
    expect(svg).toContain('<title>Ben &amp; Jerry &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;</title>')
    expect(svg).not.toContain('<script>')
  })
})

describe('qrSvgFor', () => {
  it('matches encoding and rendering done separately', () => {
    const text = 'otpauth://totp/ohc:root@example.org?secret=GEZDGNBVGY3TQOJQ&issuer=ohc'
    const options = { ecc: 'Q' as const, moduleSize: 6, quietZone: 4, title: 'Enrolment code' }
    expect(qrSvgFor(text, options)).toBe(qrSvg(encodeQr(text, options).matrix, options))
  })

  it('is deterministic', () => {
    expect(qrSvgFor('deterministic')).toBe(qrSvgFor('deterministic'))
  })
})
