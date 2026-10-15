/**
 * A deliberately small HTML reader for software probes.
 *
 * It does NOT execute anything. There is no script engine, no event dispatch, no network
 * fetch and no dynamic evaluation anywhere in this file or in the solver that uses it. That
 * is the entire security model: agent-authored markup is parsed as DATA and nothing more.
 *
 * The consequence is stated plainly in the manifest: a web app's client-side JavaScript does
 * not run here, so a page that only reveals its content after a script runs is not
 * observable by this solver. That is reported as unavailable, never approximated.
 *
 * Supported query operations: exists, count, text, html, attr, value, has_class.
 */

const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta',
  'param', 'source', 'track', 'wbr',
]);
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeEntities(text) {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X'
        ? Number.parseInt(body.slice(2), 16)
        : Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return ENTITIES[body.toLowerCase()] ?? match;
  });
}

/**
 * Parse a document into a flat, ordered element list.
 *
 * Not a conforming HTML parser and not trying to be: it recognises tags, attributes, text
 * and comments, which is everything a static assertion needs, and it never resolves
 * anything it did not literally read.
 */
export function parseHtml(source) {
  const html = String(source ?? '');
  const elements = [];
  const textNodes = [];
  const stack = [];
  let index = 0;

  while (index < html.length) {
    const lt = html.indexOf('<', index);
    if (lt === -1) {
      pushText(html.slice(index));
      break;
    }
    if (lt > index) pushText(html.slice(index, lt));

    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt);
      index = end === -1 ? html.length : end + 3;
      continue;
    }
    if (html.startsWith('<!', lt) || html.startsWith('<?', lt)) {
      const end = html.indexOf('>', lt);
      index = end === -1 ? html.length : end + 1;
      continue;
    }
    const gt = findTagEnd(html, lt);
    if (gt === -1) {
      pushText(html.slice(lt));
      break;
    }
    const raw = html.slice(lt + 1, gt).trim();
    index = gt + 1;

    if (raw.startsWith('/')) {
      const name = raw.slice(1).trim().toLowerCase();
      for (let depth = stack.length - 1; depth >= 0; depth -= 1) {
        if (stack[depth] === name) {
          stack.length = depth;
          break;
        }
      }
      continue;
    }
    const selfClosing = raw.endsWith('/');
    const body = selfClosing ? raw.slice(0, -1) : raw;
    const name = (body.match(/^[a-zA-Z][a-zA-Z0-9-]*/) ?? [''])[0].toLowerCase();
    if (!name) continue;
    const element = {
      tag: name,
      attrs: parseAttributes(body.slice(name.length)),
      children: [],
      text: '',
      parent: stack.length ? stack[stack.length - 1] : null,
      index: elements.length,
    };
    elements.push(element);
    textNodes.push({ parent: element, text: '' });
    if (!selfClosing && !VOID_ELEMENTS.has(name)) stack.push(name);
  }

  for (const element of elements) {
    const own = textNodes
      .filter((entry) => entry.parent === element)
      .map((entry) => entry.text)
      .join(' ');
    element.text = decodeEntities(own).replace(/\s+/g, ' ').trim();
  }
  const document = { elements, source: html };
  for (const element of elements) {
    if (element.parent) {
      const parent = elements.find((candidate) => candidate.tag === element.parent);
      if (parent) parent.children.push(element);
    }
  }
  return document;

  function pushText(raw) {
    if (!raw) return;
    const current = stack.length
      ? elements.find((candidate) => candidate.tag === stack.at(-1))
      : null;
    if (!current) return;
    const holder = textNodes.find((entry) => entry.parent === current);
    if (holder) holder.text += raw;
  }
}

function findTagEnd(html, start) {
  let quote = null;
  for (let index = start + 1; index < html.length; index += 1) {
    const char = html[index];
    if (quote) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    else if (char === '>') return index;
  }
  return -1;
}

function parseAttributes(source) {
  const attributes = {};
  const pattern = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*("[^"]*"|'[^']*'|[^\s"'>]+))?/g;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    const value = match[2] ?? '';
    attributes[match[1].toLowerCase()] = value.replace(/^["']|["']$/g, '');
  }
  return attributes;
}

/** CSS-ish selection: `tag`, `#id`, `.class`, or a bare tag name. No combinators, no engine. */
export function select(document, selector) {
  const query = String(selector ?? '').trim();
  if (!query) return [];
  if (query.startsWith('#')) {
    const id = query.slice(1);
    return document.elements.filter((element) => element.attrs.id === id);
  }
  if (query.startsWith('.')) {
    const className = query.slice(1);
    return document.elements.filter((element) => hasClass(element, className));
  }
  const tag = query.toLowerCase();
  return document.elements.filter((element) => element.tag === tag);
}

function hasClass(element, className) {
  return (element.attrs.class ?? '').split(/\s+/).includes(className);
}

/** Apply one named probe operation. There is no arbitrary traversal. */
export function domOperation(document, operation) {
  const { op, selector, url_path: urlPath, attribute } = operation;
  switch (op) {
    case 'exists':
      return select(document, selector).length > 0;
    case 'count':
      return select(document, selector).length;
    case 'text':
      return select(document, selector).map((element) => element.text).join(' ');
    case 'html':
      return select(document, selector).map((element) => element.text).join(' ');
    case 'value':
      return select(document, selector).map((element) => element.attrs.value ?? '').join(' ');
    case 'attr':
      if (!attribute) throw new TypeError("The 'attr' operation needs an attribute name.");
      return select(document, selector).map((element) => element.attrs[attribute] ?? '').join(' ');
    case 'has_class':
      return select(document, selector).every((element) => hasClass(element, selector.replace(/^\./, '')));
    case 'title':
      return /<title[^>]*>([\s\S]*?)<\/title>/i.exec(document.source)?.[1]?.trim() ?? '';
    case 'url_path':
      return String(urlPath ?? '/');
    default:
      throw Object.assign(new Error(`Unknown DOM probe operation '${op}'.`), {
        code: 'UNKNOWN_DOM_OPERATION',
      });
  }
}

/**
 * Static safety scan of served markup.
 *
 * A finding here is not a warning: the supervisor refuses to serve the file, and the run
 * records the violation. Inline event handlers and remote script sources are the two shapes
 * this project refuses, because both are a way to smuggle code past a "static" promise.
 */
export function scanMarkup(source, { origin }) {
  const violations = [];
  const src = /<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/i.exec(String(source))?.[1] ?? null;
  if (src !== null && (/^https?:|^\/\//i.test(src))) {
    violations.push({ code: 'REMOTE_SCRIPT_SOURCE', detail: `script src="${src}" is remote; remote scripts are refused.` });
  }
  for (const match of String(source).matchAll(/\son[a-z]+\s*=\s*(".*?"|'.*?'|[^\s>]+)/gi)) {
    violations.push({ code: 'INLINE_EVENT_HANDLER', detail: `inline handler ${match[0].trim()} is refused.` });
  }
  for (const match of String(source).matchAll(/javascript\s*:/gi)) {
    violations.push({ code: 'JAVASCRIPT_URL', detail: `javascript: URL ${match[0]} is refused.` });
  }
  if (/<iframe\b/i.test(String(source))) {
    violations.push({ code: 'EMBEDDED_FRAME', detail: 'iframes are refused; they are a navigation escape.' });
  }
  return { origin, violations, clean: violations.length === 0 };
}