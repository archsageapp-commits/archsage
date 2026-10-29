// web/public/favicon.svg を読んで desktop/icon.png を作る（512px）。
// 読めるのは、この図に使っている rect（地）、circle、path（M L H V Q Z の絶対座標）だけ
import { readFileSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SIZE = 512;
const SS = 4; // 1画素あたりの標本数（縦横）
const scale = SIZE / 64;
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

type Pt = [number, number];
type Rgb = [number, number, number];
type Shape = { color: Rgb; hit: (x: number, y: number) => boolean };

const hex = (s: string): Rgb => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16)) as Rgb;
const attr = (tag: string, name: string) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1] ?? '';

function inPoly(x: number, y: number, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// 曲線は細かい折れ線にする
function flatten(d: string): Pt[] {
  const tok = d.match(/[MLHVQZ]|-?\d*\.?\d+/g) ?? [];
  const pts: Pt[] = [];
  let cur: Pt = [0, 0];
  let i = 0;
  let cmd = '';
  const num = () => Number(tok[i++]);
  while (i < tok.length) {
    if (/[MLHVQZ]/.test(tok[i])) cmd = tok[i++];
    if (cmd === 'Z') continue;
    if (cmd === 'M' || cmd === 'L') cur = [num(), num()];
    else if (cmd === 'H') cur = [num(), cur[1]];
    else if (cmd === 'V') cur = [cur[0], num()];
    else if (cmd === 'Q') {
      const c: Pt = [num(), num()];
      const e: Pt = [num(), num()];
      for (let k = 1; k <= 16; k++) {
        const t = k / 16;
        pts.push([(1 - t) ** 2 * cur[0] + 2 * (1 - t) * t * c[0] + t * t * e[0], (1 - t) ** 2 * cur[1] + 2 * (1 - t) * t * c[1] + t * t * e[1]]);
      }
      cur = e;
      continue;
    }
    pts.push(cur);
  }
  return pts;
}

function inRoundRect(x: number, y: number, r: number): boolean {
  const cx = Math.min(Math.max(x, r), 64 - r);
  const cy = Math.min(Math.max(y, r), 64 - r);
  return x >= 0 && y >= 0 && x <= 64 && y <= 64 && (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

const svg = readFileSync(join(root, 'web', 'public', 'favicon.svg'), 'utf8');
const tags = svg.match(/<(rect|circle|path)\b[^>]*>/g) ?? [];
const bgTag = tags.find((t) => t.startsWith('<rect'));
if (!bgTag) throw new Error('favicon.svg に地の rect がありません');
const radius = Number(attr(bgTag, 'rx') || 0);
// 上に描いたものほど後ろに並ぶ。後ろから順に当たりを見る
const shapes: Shape[] = tags.map((t) => {
  const color = hex(attr(t, 'fill'));
  if (t.startsWith('<rect')) return { color, hit: () => true };
  if (t.startsWith('<circle')) {
    const [cx, cy, r] = ['cx', 'cy', 'r'].map((n) => Number(attr(t, n)));
    return { color, hit: (x, y) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r };
  }
  const poly = flatten(attr(t, 'd'));
  return { color, hit: (x, y) => inPoly(x, y, poly) };
});

const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);
for (let py = 0; py < SIZE; py++) {
  raw[py * (SIZE * 4 + 1)] = 0;
  for (let px = 0; px < SIZE; px++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        const x = (px + (sx + 0.5) / SS) / scale;
        const y = (py + (sy + 0.5) / SS) / scale;
        if (!inRoundRect(x, y, radius)) continue;
        let c = shapes[0].color;
        for (let k = shapes.length - 1; k >= 0; k--) {
          if (shapes[k].hit(x, y)) {
            c = shapes[k].color;
            break;
          }
        }
        r += c[0];
        g += c[1];
        b += c[2];
        a += 1;
      }
    }
    const o = py * (SIZE * 4 + 1) + 1 + px * 4;
    const n = SS * SS;
    raw[o] = a ? Math.round(r / a) : 0;
    raw[o + 1] = a ? Math.round(g / a) : 0;
    raw[o + 2] = a ? Math.round(b / a) : 0;
    raw[o + 3] = Math.round((a / n) * 255);
  }
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // ビット深度
ihdr[9] = 6; // RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw)),
  chunk('IEND', Buffer.alloc(0)),
]);
const out = join(root, 'desktop', 'icon.png');
writeFileSync(out, png);
console.log(`${out} を作りました`);
