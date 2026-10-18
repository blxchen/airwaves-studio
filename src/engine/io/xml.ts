// Minimal XML parser (elements, attributes, text, CDATA). Enough for GPIF documents,
// and usable outside the browser where DOMParser does not exist.

export interface XmlNode {
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  text: string;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeEntities(s: string): string {
  if (!s.includes('&')) return s;
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENTITIES[e] ?? m;
  });
}

export function parseXml(src: string): XmlNode {
  const root: XmlNode = { name: '#document', attrs: {}, children: [], text: '' };
  const stack: XmlNode[] = [root];
  let i = 0;
  const n = src.length;

  while (i < n) {
    const lt = src.indexOf('<', i);
    if (lt < 0) break;
    if (lt > i) stack[stack.length - 1].text += decodeEntities(src.slice(i, lt));

    if (src.startsWith('<![CDATA[', lt)) {
      const end = src.indexOf(']]>', lt);
      stack[stack.length - 1].text += src.slice(lt + 9, end < 0 ? n : end);
      i = end < 0 ? n : end + 3;
    } else if (src.startsWith('<!--', lt)) {
      const end = src.indexOf('-->', lt);
      i = end < 0 ? n : end + 3;
    } else if (src[lt + 1] === '?' || src[lt + 1] === '!') {
      const end = src.indexOf('>', lt);
      i = end < 0 ? n : end + 1;
    } else if (src[lt + 1] === '/') {
      const end = src.indexOf('>', lt);
      if (stack.length > 1) stack.pop();
      i = end < 0 ? n : end + 1;
    } else {
      // Find the tag end, skipping over quoted attribute values.
      let j = lt + 1;
      let quote = '';
      while (j < n) {
        const c = src[j];
        if (quote) {
          if (c === quote) quote = '';
        } else if (c === '"' || c === "'") {
          quote = c;
        } else if (c === '>') {
          break;
        }
        j++;
      }
      const selfClosing = src[j - 1] === '/';
      const body = src.slice(lt + 1, selfClosing ? j - 1 : j);
      const nameEnd = body.search(/[\s/]|$/);
      const node: XmlNode = { name: body.slice(0, nameEnd), attrs: {}, children: [], text: '' };
      const attrRe = /([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
      let m: RegExpExecArray | null;
      while ((m = attrRe.exec(body.slice(nameEnd)))) node.attrs[m[1]] = decodeEntities(m[3] ?? m[4] ?? '');
      stack[stack.length - 1].children.push(node);
      if (!selfClosing) stack.push(node);
      i = j + 1;
    }
  }
  return root.children.find((c) => c.name) ?? root;
}

export function child(node: XmlNode | undefined, name: string): XmlNode | undefined {
  return node?.children.find((c) => c.name === name);
}

export function children(node: XmlNode | undefined, name: string): XmlNode[] {
  return node ? node.children.filter((c) => c.name === name) : [];
}

// Follows a path of child element names.
export function path(node: XmlNode | undefined, ...names: string[]): XmlNode | undefined {
  let cur = node;
  for (const name of names) cur = child(cur, name);
  return cur;
}

export function text(node: XmlNode | undefined): string {
  return node ? node.text.trim() : '';
}
