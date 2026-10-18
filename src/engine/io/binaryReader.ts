// Little-endian cursor over a byte array, with the string encodings Guitar Pro uses.

const decoder = new TextDecoder('windows-1252');

export class BinaryReader {
  private view: DataView;
  pos = 0;

  constructor(readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  get remaining(): number {
    return this.bytes.length - this.pos;
  }

  private need(n: number) {
    if (this.pos + n > this.bytes.length) throw new Error(`Unexpected end of file at byte ${this.pos}`);
  }

  u8(): number {
    this.need(1);
    return this.view.getUint8(this.pos++);
  }

  i8(): number {
    this.need(1);
    return this.view.getInt8(this.pos++);
  }

  bool(): boolean {
    return this.u8() !== 0;
  }

  i16(): number {
    this.need(2);
    const v = this.view.getInt16(this.pos, true);
    this.pos += 2;
    return v;
  }

  i32(): number {
    this.need(4);
    const v = this.view.getInt32(this.pos, true);
    this.pos += 4;
    return v;
  }

  f64(): number {
    this.need(8);
    const v = this.view.getFloat64(this.pos, true);
    this.pos += 8;
    return v;
  }

  skip(n: number) {
    this.need(n);
    this.pos += n;
  }

  raw(n: number): Uint8Array {
    this.need(n);
    const out = this.bytes.subarray(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }

  // 1-byte length, then exactly `size` bytes (padding included).
  byteSizeString(size: number): string {
    const len = this.u8();
    const data = this.raw(size);
    return decoder.decode(data.subarray(0, Math.min(len, size)));
  }

  // 4-byte length, then that many bytes.
  intSizeString(): string {
    const len = this.i32();
    if (len < 0 || len > this.remaining) throw new Error(`Bad string length ${len} at byte ${this.pos - 4}`);
    return decoder.decode(this.raw(len));
  }

  // 4-byte total size, then a 1-byte length prefixed string occupying size-1 bytes.
  intByteSizeString(): string {
    const size = this.i32() - 1;
    if (size < 0) {
      this.u8();
      return '';
    }
    return this.byteSizeString(size);
  }
}
