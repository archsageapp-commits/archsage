// 書きかけのJSONを、読めたところまで値にする。ストリーミングで届く途中の返答を見せるのに使う。
// 文字列は途中までを返し、途中で切れたキーや数値、true などは捨てる

const WS = new Set([' ', '\t', '\n', '\r']);
const ESCAPES: Record<string, string> = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };

export function parsePartialJson(text: string): unknown {
  let i = 0;
  const n = text.length;
  const skipWs = () => {
    while (i < n && WS.has(text[i])) i++;
  };

  // 文字列を読む。閉じていなければ done: false
  const readString = (): { value: string; done: boolean } => {
    i++; // "
    let out = '';
    while (i < n) {
      const c = text[i];
      if (c === '"') {
        i++;
        return { value: out, done: true };
      }
      if (c === '\\') {
        if (i + 1 >= n) break;
        const e = text[i + 1];
        if (e === 'u') {
          const hex = text.slice(i + 2, i + 6);
          if (hex.length < 4) break;
          out += String.fromCharCode(parseInt(hex, 16));
          i += 6;
          continue;
        }
        out += ESCAPES[e] ?? e;
        i += 2;
        continue;
      }
      out += c;
      i++;
    }
    i = n;
    return { value: out, done: false };
  };

  const readValue = (): unknown => {
    skipWs();
    if (i >= n) return undefined;
    const c = text[i];
    if (c === '{') {
      i++;
      const obj: Record<string, unknown> = {};
      while (true) {
        skipWs();
        if (i >= n) return obj;
        const d = text[i];
        if (d === '}') {
          i++;
          return obj;
        }
        if (d !== '"') {
          i++; // , や崩れた文字は読み飛ばす
          continue;
        }
        const key = readString();
        if (!key.done) return obj;
        skipWs();
        if (text[i] !== ':') return obj;
        i++;
        const v = readValue();
        if (v !== undefined) obj[key.value] = v;
      }
    }
    if (c === '[') {
      i++;
      const arr: unknown[] = [];
      while (true) {
        skipWs();
        if (i >= n) return arr;
        const d = text[i];
        if (d === ']') {
          i++;
          return arr;
        }
        if (d === ',') {
          i++;
          continue;
        }
        const before = i;
        const v = readValue();
        if (v !== undefined) arr.push(v);
        if (i === before) i++;
      }
    }
    if (c === '"') return readString().value;
    const m = /^(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/.exec(text.slice(i, i + 40));
    if (!m) {
      i++;
      return undefined;
    }
    // 末尾で切れた数値は、まだ続くかもしれないので捨てる
    if (i + m[0].length >= n && /\d$/.test(m[0])) {
      i = n;
      return undefined;
    }
    i += m[0].length;
    return JSON.parse(m[0]);
  };

  return readValue();
}

// 届いた途中の返答から、JSONの始まりより後ろを取り出す。考える過程を書いている途中なら undefined
export function partialJsonBody(raw: string): string | undefined {
  const text = raw.replace(/<(think|thinking|reasoning)>[\s\S]*?<\/\1>/gi, '').replace(/^[\s\S]*?<\/(think|thinking)>/i, '');
  if (/<(think|thinking|reasoning)>/i.test(text)) return undefined;
  const start = text.indexOf('{');
  return start >= 0 ? text.slice(start) : undefined;
}
