// File containers used by newer Guitar Pro versions:
//   GP7/GP8 (.gp)  - a ZIP archive holding Content/score.gpif
//   GP6 (.gpx)     - a BCFZ-compressed BCFS sector filesystem holding score.gpif

export type Inflate = (data: Uint8Array) => Promise<Uint8Array>;

function u16(b: Uint8Array, o: number) {
  return b[o] | (b[o + 1] << 8);
}

function u32(b: Uint8Array, o: number) {
  return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
}

export function isZip(bytes: Uint8Array): boolean {
  return bytes.length > 4 && u32(bytes, 0) === 0x04034b50;
}

export async function readZipEntries(bytes: Uint8Array, inflate: Inflate, wanted: (name: string) => boolean): Promise<Map<string, Uint8Array>> {
  // Locate the end-of-central-directory record.
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (u32(bytes, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Not a valid ZIP archive');
  const count = u16(bytes, eocd + 10);
  let p = u32(bytes, eocd + 16);
  const out = new Map<string, Uint8Array>();
  const names = new TextDecoder();

  for (let i = 0; i < count; i++) {
    if (u32(bytes, p) !== 0x02014b50) throw new Error('Corrupt ZIP central directory');
    const method = u16(bytes, p + 10);
    const compressedSize = u32(bytes, p + 20);
    const nameLen = u16(bytes, p + 28);
    const extraLen = u16(bytes, p + 30);
    const commentLen = u16(bytes, p + 32);
    const localOffset = u32(bytes, p + 42);
    const name = names.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (!wanted(name)) continue;

    const dataStart = localOffset + 30 + u16(bytes, localOffset + 26) + u16(bytes, localOffset + 28);
    const data = bytes.subarray(dataStart, dataStart + compressedSize);
    if (method === 0) out.set(name, data);
    else if (method === 8) out.set(name, await inflate(data));
    else throw new Error(`Unsupported ZIP compression method ${method}`);
  }
  return out;
}

export function isGpx(bytes: Uint8Array): boolean {
  const magic = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  return magic === 'BCFZ' || magic === 'BCFS';
}

// BCFZ: LZ77-style bit stream. Each chunk starts with a flag bit:
//   1 -> back-reference: 4-bit word size n, then offset and length (n bits each, LSB first)
//   0 -> literal run: 2-bit length (LSB first), then that many bytes (MSB first)
function decompressBcfz(bytes: Uint8Array): Uint8Array {
  const expected = u32(bytes, 4);
  const out = new Uint8Array(expected);
  let outLen = 0;
  let pos = 8;
  let bit = 0;

  const readBit = () => {
    if (pos >= bytes.length) throw new Error('Truncated GPX data');
    const value = (bytes[pos] >> (7 - bit)) & 1;
    if (++bit === 8) {
      bit = 0;
      pos++;
    }
    return value;
  };
  const readBits = (count: number) => {
    let v = 0;
    for (let i = count - 1; i >= 0; i--) v |= readBit() << i;
    return v;
  };
  const readBitsReversed = (count: number) => {
    let v = 0;
    for (let i = 0; i < count; i++) v |= readBit() << i;
    return v;
  };

  while (outLen < expected && pos < bytes.length) {
    if (readBit()) {
      const size = readBits(4);
      const offset = readBitsReversed(size);
      const length = readBitsReversed(size);
      const from = outLen - offset;
      const toCopy = Math.min(offset, length, expected - outLen);
      for (let i = 0; i < toCopy; i++) out[outLen++] = out[from + i];
    } else {
      const length = readBitsReversed(2);
      for (let i = 0; i < length && outLen < expected; i++) out[outLen++] = readBits(8);
    }
  }
  return out.subarray(0, outLen);
}

export function readGpxFiles(bytes: Uint8Array): Map<string, Uint8Array> {
  let data = bytes;
  if (String.fromCharCode(...data.subarray(0, 4)) === 'BCFZ') data = decompressBcfz(data);
  if (String.fromCharCode(...data.subarray(0, 4)) !== 'BCFS') throw new Error('Not a Guitar Pro 6 file');
  data = data.subarray(4);

  const SECTOR = 0x1000;
  const files = new Map<string, Uint8Array>();
  for (let offset = SECTOR; offset + 3 < data.length; offset += SECTOR) {
    if (u32(data, offset) !== 2) continue; // 2 = file entry
    let nameEnd = offset + 4;
    while (nameEnd < offset + 4 + 127 && data[nameEnd] !== 0) nameEnd++;
    const name = new TextDecoder().decode(data.subarray(offset + 4, nameEnd));
    const size = u32(data, offset + 0x8c);
    const chunks: Uint8Array[] = [];
    for (let p = offset + 0x94; p + 4 <= offset + SECTOR; p += 4) {
      const sector = u32(data, p);
      if (!sector) break;
      chunks.push(data.subarray(sector * SECTOR, sector * SECTOR + SECTOR));
    }
    const file = new Uint8Array(size);
    let written = 0;
    for (const c of chunks) {
      const take = Math.min(c.length, size - written);
      file.set(c.subarray(0, take), written);
      written += take;
      if (written >= size) break;
    }
    files.set(name, file);
  }
  return files;
}
