import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { computeFormatBits, encodeUtf8Bytes, generateQrMatrix } from './qrMatrix';

/** 按 ISO/IEC 18004 读取垂直与水平两条格式信息条带，校验一致并反解掩码编号。 */
function decodeMaskFromFormatBits(modules: ReadonlyArray<ReadonlyArray<boolean>>): number {
  const size = modules.length;
  let vertical = 0;
  for (let i = 0; i < 15; i += 1) {
    const bit = i < 6 ? modules[i][8] : i < 8 ? modules[i + 1][8] : modules[size - 15 + i][8];
    if (bit) vertical |= 1 << i;
  }

  let horizontal = 0;
  for (let i = 0; i < 15; i += 1) {
    const bit =
      i < 8 ? modules[8][size - 1 - i] : i === 8 ? modules[8][7] : modules[8][14 - i];
    if (bit) horizontal |= 1 << i;
  }

  assert.equal(vertical, horizontal, '垂直与水平两条格式条带必须完全一致');
  const unmasked = vertical ^ 0x5412;
  const dataBits = unmasked >> 10;
  const ecLevel = dataBits >> 3;
  const mask = dataBits & 0x7;
  assert.equal(ecLevel, 0b00, 'EC Level 必须为 M (0b00)');
  assert.equal(vertical, computeFormatBits(mask), '格式字 BCH 校验位必须匹配');

  // 显式核对 MSB (bit 14) 与 LSB (bit 0) 端点方位
  const msb = ((vertical >> 14) & 1) !== 0;
  const lsb = (vertical & 1) !== 0;
  assert.equal(modules[8][0], msb, 'bit 14 (MSB) 必须位于 (8, 0)');
  assert.equal(modules[size - 1][8], msb, 'bit 14 (MSB) 必须位于 (size-1, 8)');
  assert.equal(modules[0][8], lsb, 'bit 0 (LSB) 必须位于 (0, 8)');
  assert.equal(modules[8][size - 1], lsb, 'bit 0 (LSB) 必须位于 (8, size-1)');

  return mask;
}

/** 根据 ISO 18004 反掩码并读取原始码字（支持单块 V1–V3 与双块 V4-M）。 */
function decodeQrBytePayload(modules: ReadonlyArray<ReadonlyArray<boolean>>, version: number): string {
  const size = modules.length;
  const mask = decodeMaskFromFormatBits(modules);

  const isFunc = (r: number, c: number): boolean => {
    if (r === 6 || c === 6) return true;
    if (r <= 8 && c <= 8) return true;
    if (r <= 8 && c >= size - 8) return true;
    if (r >= size - 8 && c <= 8) return true;
    if (version >= 2) {
      const center = size - 7;
      if (Math.abs(r - center) <= 2 && Math.abs(c - center) <= 2) {
        return true;
      }
    }
    return false;
  };

  const maskInvert = (m: number, r: number, c: number): boolean => {
    switch (m) {
      case 0: return (r + c) % 2 === 0;
      case 1: return r % 2 === 0;
      case 2: return c % 3 === 0;
      case 3: return (r + c) % 3 === 0;
      case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
      case 5: return ((r * c) % 2) + ((r * c) % 3) === 0;
      case 6: return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0;
      case 7: return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0;
      default: return false;
    }
  };

  const bits: number[] = [];
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert += 1) {
      for (let j = 0; j < 2; j += 1) {
        const col = right - j;
        const upward = ((right + 1) & 2) === 0;
        const row = upward ? size - 1 - vert : vert;
        if (!isFunc(row, col)) {
          const val = modules[row][col] !== maskInvert(mask, row, col);
          bits.push(val ? 1 : 0);
        }
      }
    }
  }

  const interleavedBytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    let b = 0;
    for (let k = 0; k < 8; k += 1) {
      b = (b << 1) | bits[i + k];
    }
    interleavedBytes.push(b);
  }

  // 反交织：V1..V3-M 为单块，V4-M 为 2×32 数据块
  const dataByteLenByVersion: Record<number, number> = { 1: 16, 2: 28, 3: 44, 4: 64 };
  const totalData = dataByteLenByVersion[version];
  const dataBytes: number[] = [];
  if (version === 4) {
    const half = totalData / 2;
    for (let b = 0; b < 2; b += 1) {
      for (let i = 0; i < half; i += 1) {
        dataBytes.push(interleavedBytes[i * 2 + b]);
      }
    }
  } else {
    for (let i = 0; i < totalData; i += 1) {
      dataBytes.push(interleavedBytes[i]);
    }
  }

  const dataBits: number[] = [];
  for (const byte of dataBytes) {
    for (let i = 7; i >= 0; i -= 1) {
      dataBits.push((byte >> i) & 1);
    }
  }
  const readBits = (offset: number, count: number): number => {
    let out = 0;
    for (let i = 0; i < count; i += 1) {
      out = (out << 1) | dataBits[offset + i];
    }
    return out;
  };

  assert.equal(readBits(0, 4), 0b0100, '模式指示符必须为 Byte (0100)');
  const charCount = readBits(4, 8);
  const rawBytes: number[] = [];
  for (let i = 0; i < charCount; i += 1) {
    rawBytes.push(readBits(12 + i * 8, 8));
  }
  return Buffer.from(rawBytes).toString('utf8');
}

describe('core/qrMatrix · ISO 18004 Byte Mode EC Level M', () => {
  test('encodes epsync://v1/pair?c=K7M9P2XR into Version 3-M (29x29) and round-trips bit-for-bit', () => {
    const payload = 'epsync://v1/pair?c=K7M9P2XR';
    assert.equal(encodeUtf8Bytes(payload).length, 27);

    const qr = generateQrMatrix(payload);
    assert.equal(qr.version, 3);
    assert.equal(qr.size, 29);
    assert.equal(qr.modules.length, 29);
    assert.equal(qr.modules[0].length, 29);

    // Finder & dark module invariants
    assert.equal(qr.modules[0][0], true);
    assert.equal(qr.modules[3][3], true);
    assert.equal(qr.modules[1][1], false);
    assert.equal(qr.modules[qr.size - 8][8], true);

    const decoded = decodeQrBytePayload(qr.modules, qr.version);
    assert.equal(decoded, payload);
  });

  test('supports Version 1-M, 2-M, and 2-block Version 4-M UTF-8 payloads', () => {
    const samples = [
      { text: 'K7M9-P2XR', expectedVersion: 1, expectedSize: 21 },
      { text: '12345678901234567890', expectedVersion: 2, expectedSize: 25 },
      { text: 'epsync://v1/pair?c=23456789&device=测试设备', expectedVersion: 4, expectedSize: 33 },
    ];
    for (const sample of samples) {
      const qr = generateQrMatrix(sample.text);
      assert.equal(qr.version, sample.expectedVersion);
      assert.equal(qr.size, sample.expectedSize);
      assert.equal(decodeQrBytePayload(qr.modules, qr.version), sample.text);
    }
  });

  test('throws when payload exceeds Version 4-M capacity', () => {
    assert.throws(() => generateQrMatrix('A'.repeat(63)), /exceeds Version 4-M/);
  });
});
