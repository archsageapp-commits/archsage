// 画像に埋め込まれた情報を消す。ComfyUIはPNGにプロンプトとワークフローを丸ごと入れるので、配る前に通す
// 画素には触らないので、画質は変わらない。PNGとJPEGだけ扱い、ほかの形式はそのまま返す

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
// 文字の情報、Exif、更新日時。色の情報（iCCPなど）は表示に効くので残す
const PNG_DROP = new Set(['tEXt', 'iTXt', 'zTXt', 'eXIf', 'tIME']);

function isPng(b: Uint8Array): boolean {
  return b.length > 8 && PNG_SIGNATURE.every((v, i) => b[i] === v);
}

function stripPng(b: Uint8Array): Uint8Array {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const keep: Uint8Array[] = [b.subarray(0, 8)];
  let i = 8;
  while (i + 12 <= b.length) {
    const len = view.getUint32(i);
    const end = i + 12 + len;
    if (end > b.length) break;
    const type = String.fromCharCode(b[i + 4], b[i + 5], b[i + 6], b[i + 7]);
    if (!PNG_DROP.has(type)) keep.push(b.subarray(i, end));
    i = end;
    if (type === 'IEND') break;
  }
  return concat(keep);
}

// APP1（Exif、XMP）、APP13（IPTC）、コメントを外す。APP0（JFIF）とAPP2（色の情報）は残す
function stripJpeg(b: Uint8Array): Uint8Array {
  const keep: Uint8Array[] = [b.subarray(0, 2)];
  let i = 2;
  while (i + 4 <= b.length && b[i] === 0xff) {
    const marker = b[i + 1];
    if (marker === 0xda) break; // ここから先は画素のデータ
    const len = (b[i + 2] << 8) | b[i + 3];
    const end = i + 2 + len;
    if (end > b.length) break;
    const drop = marker === 0xe1 || marker === 0xed || marker === 0xfe;
    if (!drop) keep.push(b.subarray(i, end));
    i = end;
  }
  keep.push(b.subarray(i));
  return concat(keep);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function stripImageMetadata(b: Uint8Array): Uint8Array {
  if (isPng(b)) return stripPng(b);
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) return stripJpeg(b);
  return b;
}
