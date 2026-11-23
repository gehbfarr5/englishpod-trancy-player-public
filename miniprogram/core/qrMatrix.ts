/**
 * ============================================================================
 *  轻量级纯 TypeScript QR 矩阵编码器（core/qrMatrix.ts —— 零平台依赖）
 * ============================================================================
 *  规范：ISO/IEC 18004（Byte 模式，EC Level M，Version 1–4，支持最多 62 字节 UTF-8）。
 *  - 配对二维码载荷 `epsync://v1/pair?c=XXXXXXXX` 固定为 27 字节，命中 Version 3-M（29×29 模块）。
 *  - 不依赖 DOM、Canvas、Node Buffer 或 wx.* API，可供 Mini Program 与单测直接复用。
 * ============================================================================
 */

export interface QrMatrix {
  readonly version: number;
  readonly size: number;
  readonly modules: ReadonlyArray<ReadonlyArray<boolean>>;
}

interface VersionSpec {
  readonly version: number;
  readonly totalDataBytes: number;
  readonly ecBytesPerBlock: number;
  readonly numBlocks: number;
  readonly maxBytePayload: number;
  readonly alignmentCenters: readonly number[];
  readonly remainderBits: number;
}

/** ISO/IEC 18004 EC Level M (Version 1..4) 参数表。 */
const VERSION_SPECS: readonly VersionSpec[] = [
  {
    version: 1,
    totalDataBytes: 16,
    ecBytesPerBlock: 10,
    numBlocks: 1,
    maxBytePayload: 14,
    alignmentCenters: [],
    remainderBits: 0,
  },
  {
    version: 2,
    totalDataBytes: 28,
    ecBytesPerBlock: 16,
    numBlocks: 1,
    maxBytePayload: 26,
    alignmentCenters: [6, 18],
    remainderBits: 7,
  },
  {
    version: 3,
    totalDataBytes: 44,
    ecBytesPerBlock: 26,
    numBlocks: 1,
    maxBytePayload: 42,
    alignmentCenters: [6, 22],
    remainderBits: 7,
  },
  {
    version: 4,
    totalDataBytes: 64,
    ecBytesPerBlock: 18,
    numBlocks: 2,
    maxBytePayload: 62,
    alignmentCenters: [6, 26],
    remainderBits: 7,
  },
];

/** EC Level M 在 ISO/IEC 18004 中的 2-bit 格式指示值。 */
const EC_LEVEL_M_FORMAT_BITS = 0b00;

/** 纯 TS UTF-8 编码（不依赖 TextEncoder / Buffer）。 */
export function encodeUtf8Bytes(text: string): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    let code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
        i += 1;
      }
    }
    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    }
  }
  return bytes;
}

/** GF(2^8) 乘法（本原多项式 x^8 + x^4 + x^3 + x^2 + 1 = 0x11d）。 */
function gfMultiply(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i -= 1) {
    z = (z << 1) ^ ((z >> 7) * 0x11d);
    if (((y >> i) & 1) !== 0) {
      z ^= x;
    }
  }
  return z;
}

/** 生成长度为 degree 的 Reed-Solomon 生成多项式系数（最高次项隐含为 1，仅存降幂余项）。 */
function rsComputeDivisor(degree: number): number[] {
  const result = new Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i += 1) {
    for (let j = 0; j < degree; j += 1) {
      result[j] = gfMultiply(result[j], root);
      if (j + 1 < degree) {
        result[j] ^= result[j + 1];
      }
    }
    root = gfMultiply(root, 0x02);
  }
  return result;
}

function rsComputeRemainder(data: readonly number[], divisor: readonly number[]): number[] {
  const degree = divisor.length;
  const result = new Array<number>(degree).fill(0);
  for (const b of data) {
    const factor = b ^ result.shift()!;
    result.push(0);
    for (let i = 0; i < degree; i += 1) {
      result[i] ^= gfMultiply(divisor[i], factor);
    }
  }
  return result;
}

function appendBits(target: number[], value: number, bitCount: number): void {
  for (let i = bitCount - 1; i >= 0; i -= 1) {
    target.push((value >> i) & 1);
  }
}

function encodeDataCodewords(payloadBytes: readonly number[], spec: VersionSpec): number[] {
  const capacityBits = spec.totalDataBytes * 8;
  const bits: number[] = [];
  // Byte mode indicator (0100) + 8-bit character count (Version 1-9)
  appendBits(bits, 0b0100, 4);
  appendBits(bits, payloadBytes.length, 8);
  for (const b of payloadBytes) {
    appendBits(bits, b, 8);
  }
  const terminatorLen = Math.min(4, capacityBits - bits.length);
  for (let i = 0; i < terminatorLen; i += 1) {
    bits.push(0);
  }
  while (bits.length % 8 !== 0) {
    bits.push(0);
  }
  const codewords: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let val = 0;
    for (let b = 0; b < 8; b += 1) {
      val = (val << 1) | bits[i + b];
    }
    codewords.push(val);
  }
  const pads = [0xec, 0x11];
  let padIdx = 0;
  while (codewords.length < spec.totalDataBytes) {
    codewords.push(pads[padIdx % 2]);
    padIdx += 1;
  }
  return codewords;
}

function interleaveBlocksAndEc(dataCodewords: readonly number[], spec: VersionSpec): number[] {
  const divisor = rsComputeDivisor(spec.ecBytesPerBlock);
  const blockDataLen = spec.totalDataBytes / spec.numBlocks;
  const blocks: number[][] = [];
  const eccs: number[][] = [];

  for (let b = 0; b < spec.numBlocks; b += 1) {
    const start = b * blockDataLen;
    const chunk = dataCodewords.slice(start, start + blockDataLen);
    blocks.push(chunk);
    eccs.push(rsComputeRemainder(chunk, divisor));
  }

  const out: number[] = [];
  for (let i = 0; i < blockDataLen; i += 1) {
    for (let b = 0; b < spec.numBlocks; b += 1) {
      out.push(blocks[b][i]);
    }
  }
  for (let i = 0; i < spec.ecBytesPerBlock; i += 1) {
    for (let b = 0; b < spec.numBlocks; b += 1) {
      out.push(eccs[b][i]);
    }
  }
  return out;
}

function createMatrix(size: number): boolean[][] {
  return Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
}

function setModule(
  modules: boolean[][],
  isFunction: boolean[][],
  row: number,
  col: number,
  dark: boolean,
  markFunction = true,
): void {
  const size = modules.length;
  if (row < 0 || row >= size || col < 0 || col >= size) {
    return;
  }
  modules[row][col] = dark;
  if (markFunction) {
    isFunction[row][col] = true;
  }
}

function drawFinderPattern(
  modules: boolean[][],
  isFunction: boolean[][],
  topRow: number,
  leftCol: number,
): void {
  for (let dr = -1; dr <= 7; dr += 1) {
    for (let dc = -1; dc <= 7; dc += 1) {
      const r = topRow + dr;
      const c = leftCol + dc;
      if (r < 0 || r >= modules.length || c < 0 || c >= modules.length) {
        continue;
      }
      const dist = Math.max(Math.abs(dr - 3), Math.abs(dc - 3));
      const dark = dist === 0 || dist === 1 || dist === 3;
      setModule(modules, isFunction, r, c, dark);
    }
  }
}

function drawAlignmentPattern(
  modules: boolean[][],
  isFunction: boolean[][],
  centerRow: number,
  centerCol: number,
): void {
  for (let dr = -2; dr <= 2; dr += 1) {
    for (let dc = -2; dc <= 2; dc += 1) {
      const dist = Math.max(Math.abs(dr), Math.abs(dc));
      setModule(modules, isFunction, centerRow + dr, centerCol + dc, dist !== 1);
    }
  }
}

function drawFunctionPatterns(
  modules: boolean[][],
  isFunction: boolean[][],
  spec: VersionSpec,
): void {
  const size = modules.length;

  // Timing patterns
  for (let i = 0; i < size; i += 1) {
    setModule(modules, isFunction, 6, i, i % 2 === 0);
    setModule(modules, isFunction, i, 6, i % 2 === 0);
  }

  // Three finder patterns + white separators
  drawFinderPattern(modules, isFunction, 0, 0);
  drawFinderPattern(modules, isFunction, 0, size - 7);
  drawFinderPattern(modules, isFunction, size - 7, 0);

  // Dark module (always dark at row 4V+9, col 8)
  setModule(modules, isFunction, size - 8, 8, true);

  // Alignment patterns (skip corners overlapping finder patterns)
  const centers = spec.alignmentCenters;
  for (let i = 0; i < centers.length; i += 1) {
    for (let j = 0; j < centers.length; j += 1) {
      const isCornerFinder =
        (i === 0 && j === 0) ||
        (i === 0 && j === centers.length - 1) ||
        (i === centers.length - 1 && j === 0);
      if (!isCornerFinder) {
        drawAlignmentPattern(modules, isFunction, centers[i], centers[j]);
      }
    }
  }

  // Reserve format info slots before data placement
  drawFormatBits(modules, isFunction, 0);
}

export function computeFormatBits(mask: number): number {
  const data = (EC_LEVEL_M_FORMAT_BITS << 3) | (mask & 0x7);
  let rem = data << 10;
  for (let bit = 14; bit >= 10; bit -= 1) {
    if ((rem >> bit) & 1) {
      rem ^= 0x537 << (bit - 10);
    }
  }
  return ((data << 10) | rem) ^ 0x5412;
}

function drawFormatBits(modules: boolean[][], isFunction: boolean[][], mask: number): void {
  const size = modules.length;
  const bits = computeFormatBits(mask);

  // ISO/IEC 18004 垂直条带（col = 8，bit 0..14：LSB 在顶部 (0,8)，MSB 在左下 (size-1,8)）
  for (let i = 0; i < 15; i += 1) {
    const dark = ((bits >> i) & 1) !== 0;
    if (i < 6) {
      setModule(modules, isFunction, i, 8, dark);
    } else if (i < 8) {
      setModule(modules, isFunction, i + 1, 8, dark);
    } else {
      setModule(modules, isFunction, size - 15 + i, 8, dark);
    }
  }

  // ISO/IEC 18004 水平条带（row = 8，bit 0..14：LSB 在右上 (8,size-1)，MSB 在左上 (8,0)）
  for (let i = 0; i < 15; i += 1) {
    const dark = ((bits >> i) & 1) !== 0;
    if (i < 8) {
      setModule(modules, isFunction, 8, size - 1 - i, dark);
    } else if (i === 8) {
      setModule(modules, isFunction, 8, 7, dark);
    } else {
      setModule(modules, isFunction, 8, 14 - i, dark);
    }
  }
}

function placeCodewords(
  modules: boolean[][],
  isFunction: boolean[][],
  codewords: readonly number[],
  remainderBits: number,
): void {
  const size = modules.length;
  const totalBits = codewords.length * 8 + remainderBits;
  let bitIndex = 0;

  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) {
      right = 5;
    }
    for (let vert = 0; vert < size; vert += 1) {
      for (let j = 0; j < 2; j += 1) {
        const col = right - j;
        const upward = ((right + 1) & 2) === 0;
        const row = upward ? size - 1 - vert : vert;
        if (!isFunction[row][col]) {
          let dark = false;
          if (bitIndex < codewords.length * 8) {
            const cw = codewords[bitIndex >> 3];
            dark = ((cw >> (7 - (bitIndex & 7))) & 1) !== 0;
          }
          modules[row][col] = dark;
          bitIndex += 1;
        }
      }
    }
  }

  if (bitIndex !== totalBits) {
    throw new Error(`QR bit placement mismatch: placed ${bitIndex}, expected ${totalBits}`);
  }
}

function isMaskBitInverted(mask: number, row: number, col: number): boolean {
  switch (mask) {
    case 0:
      return (row + col) % 2 === 0;
    case 1:
      return row % 2 === 0;
    case 2:
      return col % 3 === 0;
    case 3:
      return (row + col) % 3 === 0;
    case 4:
      return (Math.floor(row / 2) + Math.floor(col / 3)) % 2 === 0;
    case 5:
      return ((row * col) % 2) + ((row * col) % 3) === 0;
    case 6:
      return (((row * col) % 2) + ((row * col) % 3)) % 2 === 0;
    case 7:
      return (((row + col) % 2) + ((row * col) % 3)) % 2 === 0;
    default:
      return false;
  }
}

function applyMask(modules: boolean[][], isFunction: readonly (readonly boolean[])[], mask: number): void {
  const size = modules.length;
  for (let r = 0; r < size; r += 1) {
    for (let c = 0; c < size; c += 1) {
      if (!isFunction[r][c] && isMaskBitInverted(mask, r, c)) {
        modules[r][c] = !modules[r][c];
      }
    }
  }
}

function getPenaltyScore(modules: readonly (readonly boolean[])[]): number {
  const size = modules.length;
  let penalty = 0;

  // Rule 1: >= 5 same-color modules in row/col
  for (let r = 0; r < size; r += 1) {
    let runColor = modules[r][0];
    let runLen = 1;
    for (let c = 1; c < size; c += 1) {
      if (modules[r][c] === runColor) {
        runLen += 1;
      } else {
        if (runLen >= 5) {
          penalty += 3 + (runLen - 5);
        }
        runColor = modules[r][c];
        runLen = 1;
      }
    }
    if (runLen >= 5) {
      penalty += 3 + (runLen - 5);
    }
  }
  for (let c = 0; c < size; c += 1) {
    let runColor = modules[0][c];
    let runLen = 1;
    for (let r = 1; r < size; r += 1) {
      if (modules[r][c] === runColor) {
        runLen += 1;
      } else {
        if (runLen >= 5) {
          penalty += 3 + (runLen - 5);
        }
        runColor = modules[r][c];
        runLen = 1;
      }
    }
    if (runLen >= 5) {
      penalty += 3 + (runLen - 5);
    }
  }

  // Rule 2: 2x2 same-color blocks
  for (let r = 0; r < size - 1; r += 1) {
    for (let c = 0; c < size - 1; c += 1) {
      const color = modules[r][c];
      if (
        color === modules[r][c + 1] &&
        color === modules[r + 1][c] &&
        color === modules[r + 1][c + 1]
      ) {
        penalty += 3;
      }
    }
  }

  // Rule 3: 1:1:3:1:1 finder-like ratio with 4 light modules on either side
  const isFinderLikeAt = (getMod: (idx: number) => boolean, start: number): boolean => {
    const p = [true, false, true, true, true, false, true];
    for (let k = 0; k < 7; k += 1) {
      if (getMod(start + k) !== p[k]) {
        return false;
      }
    }
    const leftWhite =
      start >= 4 &&
      !getMod(start - 1) &&
      !getMod(start - 2) &&
      !getMod(start - 3) &&
      !getMod(start - 4);
    const rightWhite =
      start + 10 < size &&
      !getMod(start + 7) &&
      !getMod(start + 8) &&
      !getMod(start + 9) &&
      !getMod(start + 10);
    return leftWhite || rightWhite;
  };

  for (let r = 0; r < size; r += 1) {
    for (let c = 0; c <= size - 7; c += 1) {
      if (isFinderLikeAt((idx) => modules[r][idx], c)) {
        penalty += 40;
      }
    }
  }
  for (let c = 0; c < size; c += 1) {
    for (let r = 0; r <= size - 7; r += 1) {
      if (isFinderLikeAt((idx) => modules[idx][c], r)) {
        penalty += 40;
      }
    }
  }

  // Rule 4: Balance of dark modules vs 50%
  let darkCount = 0;
  for (let r = 0; r < size; r += 1) {
    for (let c = 0; c < size; c += 1) {
      if (modules[r][c]) {
        darkCount += 1;
      }
    }
  }
  const total = size * size;
  const k = Math.floor(Math.abs(darkCount * 20 - total * 10) / total);
  penalty += k * 10;

  return penalty;
}

/**
 * 为配对文本生成 ISO/IEC 18004 QR 矩阵（EC Level M，Byte 模式）。
 */
export function generateQrMatrix(text: string): QrMatrix {
  const bytes = encodeUtf8Bytes(text);
  const spec = VERSION_SPECS.find((item) => bytes.length <= item.maxBytePayload);
  if (!spec) {
    throw new Error(`QR payload exceeds Version 4-M capacity (${bytes.length} > 62 bytes)`);
  }

  const size = 4 * spec.version + 17;
  const modules = createMatrix(size);
  const isFunction = createMatrix(size);

  drawFunctionPatterns(modules, isFunction, spec);
  const dataCodewords = encodeDataCodewords(bytes, spec);
  const finalCodewords = interleaveBlocksAndEc(dataCodewords, spec);
  placeCodewords(modules, isFunction, finalCodewords, spec.remainderBits);

  let bestMask = 0;
  let minPenalty = Number.POSITIVE_INFINITY;
  for (let mask = 0; mask < 8; mask += 1) {
    applyMask(modules, isFunction, mask);
    drawFormatBits(modules, isFunction, mask);
    const penalty = getPenaltyScore(modules);
    if (penalty < minPenalty) {
      minPenalty = penalty;
      bestMask = mask;
    }
    applyMask(modules, isFunction, mask);
  }

  applyMask(modules, isFunction, bestMask);
  drawFormatBits(modules, isFunction, bestMask);

  return {
    version: spec.version,
    size,
    modules,
  };
}
