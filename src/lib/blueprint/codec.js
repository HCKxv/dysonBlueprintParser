// 将 Base64 字符串解码为 Uint8Array
function base64ToUint8Array(base64String) {
  const binary = atob(base64String);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// 将 Uint8Array 编码为 Base64 字符串
function uint8ArrayToBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// 将 Base64 字符串解码并解压（gzip）
async function decodeBase64Gzip(base64String) {
  const compressed = base64ToUint8Array(base64String);

  if (typeof DecompressionStream === 'function') {
    const ds = new DecompressionStream('gzip');
    const decompressedStream = new Response(compressed).body.pipeThrough(ds);
    const arrayBuffer = await new Response(decompressedStream).arrayBuffer();
    return new Uint8Array(arrayBuffer);
  }

  throw new Error('浏览器不支持 gzip 解压，请使用 Edge 或 Chrome 浏览器。');
}

// 使用 gzip 压缩数据
async function gzipCompress(data) {
  if (typeof CompressionStream === 'function') {
    const cs = new CompressionStream('gzip');
    const writer = cs.writable.getWriter();
    writer.write(data);
    writer.close();
    const arrayBuffer = await new Response(cs.readable).arrayBuffer();
    return new Uint8Array(arrayBuffer);
  }

  throw new Error('浏览器不支持 gzip 压缩，请使用 Edge 或 Chrome 浏览器。');
}

// 二进制读取器，用于从 Uint8Array 中按小端序读取各种基础类型
class BinaryReader {
  constructor(array) {
    this.data = array instanceof Uint8Array ? array : new Uint8Array(array);
    this.view = new DataView(this.data.buffer, this.data.byteOffset, this.data.byteLength);
    this.offset = 0;
  }

  readInt32() {
    const value = this.view.getInt32(this.offset, true);
    this.offset += 4;
    return value;
  }

  readUInt32() {
    const value = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return value;
  }

  readFloat32() {
    const value = this.view.getFloat32(this.offset, true);
    this.offset += 4;
    return value;
  }

  readUInt8() {
    const value = this.view.getUint8(this.offset);
    this.offset += 1;
    return value;
  }

  readBool() {
    const value = this.readUInt8();
    return value !== 0;
  }

  skip(bytes) {
    this.offset += bytes;
  }
}

// 二进制写入器，用于按小端序写入各种基础类型到 Uint8Array
class BinaryWriter {
  constructor(initialCapacity = 4096) {
    this.buffer = new ArrayBuffer(initialCapacity);
    this.view = new DataView(this.buffer);
    this.offset = 0;
  }

  _ensureCapacity(additionalBytes) {
    const needed = this.offset + additionalBytes;
    if (needed > this.buffer.byteLength) {
      let newCapacity = this.buffer.byteLength * 2;
      while (newCapacity < needed) newCapacity *= 2;
      const newBuffer = new ArrayBuffer(newCapacity);
      new Uint8Array(newBuffer).set(new Uint8Array(this.buffer));
      this.buffer = newBuffer;
      this.view = new DataView(this.buffer);
    }
  }

  writeInt32(value) {
    this._ensureCapacity(4);
    this.view.setInt32(this.offset, value, true);
    this.offset += 4;
  }

  writeUInt32(value) {
    this._ensureCapacity(4);
    this.view.setUint32(this.offset, value, true);
    this.offset += 4;
  }

  writeFloat32(value) {
    this._ensureCapacity(4);
    this.view.setFloat32(this.offset, value, true);
    this.offset += 4;
  }

  writeUInt8(value) {
    this._ensureCapacity(1);
    this.view.setUint8(this.offset, value & 0xFF);
    this.offset += 1;
  }

  writeBool(value) {
    this.writeUInt8(value ? 1 : 0);
  }

  toUint8Array() {
    return new Uint8Array(this.buffer, 0, this.offset);
  }
}

export { base64ToUint8Array, uint8ArrayToBase64, decodeBase64Gzip, gzipCompress, BinaryReader, BinaryWriter };
