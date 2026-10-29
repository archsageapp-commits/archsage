// テンプレートは {{name}} の置換と、{{#name}}…{{/name}}（値が空なら丸ごと消す）だけ

export type TemplateVars = Record<string, string | undefined | null>;

const SECTION = /\{\{#([\w.]+)\}\}([\s\S]*?)\{\{\/\1\}\}/g;
const VARIABLE = /\{\{([\w.]+)\}\}/g;

export function renderTemplate(template: string, vars: TemplateVars): string {
  let out = template;
  // 入れ子にも対応するため、変化がなくなるまで繰り返す
  for (let i = 0; i < 5; i++) {
    const next = out.replace(SECTION, (_m, name: string, body: string) => {
      const v = vars[name];
      return v != null && String(v).trim() !== '' ? body : '';
    });
    if (next === out) break;
    out = next;
  }
  out = out.replace(VARIABLE, (m, name: string) => {
    const v = vars[name];
    return v == null ? (name in vars ? '' : m) : String(v);
  });
  return out.replace(/\n{3,}/g, '\n\n').trim();
}
