import JSZip from 'jszip';

const MAX_EPUB_BYTES = 45 * 1024 * 1024;
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'IFRAME', 'NAV', 'MATH']);
const BLOCK_TAGS = new Set(['P', 'DIV', 'SECTION', 'ARTICLE', 'BLOCKQUOTE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'UL', 'OL', 'TABLE', 'TR', 'BR', 'HR', 'FIGCAPTION', 'PRE', 'DD', 'DT']);

function parseXml(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('El libro contiene metadatos XML dañados.');
  return doc;
}

function elements(doc, name) {
  return Array.from(doc.getElementsByTagName('*')).filter(el => el.localName?.toLowerCase() === name);
}

function cleanPath(input) {
  const paths = String(input).split('/');
  const stack = [];
  for (const segment of paths) {
    if (!segment || segment === '.') continue;
    if (segment === '..') { stack.pop(); continue; }
    stack.push(segment);
  }
  return stack.join('/');
}

function resolvePath(base, href) {
  const stripped = String(href || '').split('#')[0].split('?')[0];
  if (/^[a-z][a-z\d+.-]*:/i.test(stripped)) return '';
  let decoded;
  try { decoded = decodeURIComponent(stripped); } catch { decoded = stripped; }
  if (decoded.startsWith('/')) return cleanPath(decoded);
  const dir = base.includes('/') ? base.substring(0, base.lastIndexOf('/') + 1) : '';
  return cleanPath(dir + decoded);
}

function getEntry(zip, path) {
  return zip.file(path) || Object.values(zip.files).find(entry => entry.name.toLowerCase() === path.toLowerCase());
}

function speechText(root) {
  const output = [];
  function walk(node) {
    if (node.nodeType === 3) {
      output.push(node.nodeValue.replace(/[\u00a0\u200b\u200c\u200d]/g, ' '));
      return;
    }
    if (node.nodeType !== 1) return;
    const element = node;
    if (SKIP_TAGS.has(element.tagName)) return;
    if (/^(doc-noteref|doc-footnote|doc-endnote|navigation)$/i.test(element.getAttribute('role') || '')) return;
    const epubType = element.getAttribute('epub:type') || '';
    if (/(^|\s)(noteref|footnote|endnote|toc|landmarks)(\s|$)/i.test(epubType)) return;
    if (element.getAttribute('aria-hidden') === 'true' || element.hidden) return;
    if (element.tagName === 'BR') { output.push('\n'); return; }
    const block = BLOCK_TAGS.has(element.tagName);
    if (block) output.push('\n');
    for (const child of element.childNodes) walk(child);
    if (block) output.push('\n');
  }
  walk(root);
  return output.join('')
    .replace(/\r\n?/g, '\n')
    .replace(/[\t \f]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function getTitle(doc, fallback) {
  const title = doc.querySelector('h1, h2, h3, title')?.textContent?.trim() || fallback;
  return title.replace(/\s+/g, ' ').slice(0, 90);
}

async function sha256(arrayBuffer) {
  if (globalThis.crypto?.subtle) {
    const hash = await crypto.subtle.digest('SHA-256', arrayBuffer);
    return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
  }
  // La alternativa solo se usa para pruebas o navegadores HTTP antiguos.
  const bytes = new Uint8Array(arrayBuffer);
  let value = 2166136261;
  for (const b of bytes) value = Math.imul(value ^ b, 16777619);
  return `fallback-${(value >>> 0).toString(16)}-${bytes.length}`;
}

export async function parseEpub(file) {
  if (!file || !/\.epub$/i.test(file.name || '')) throw new Error('Selecciona un archivo con extensión .epub.');
  if (file.size > MAX_EPUB_BYTES) throw new Error('El EPUB supera el máximo de 45 MB de esta versión.');
  const bytes = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(bytes, { checkCRC32: true }).catch(() => {
    throw new Error('No se puede abrir el EPUB. Puede estar dañado o protegido con DRM.');
  });

  const container = getEntry(zip, 'META-INF/container.xml');
  let opfPath;
  if (container) {
    const containerDoc = parseXml(await container.async('string'));
    opfPath = elements(containerDoc, 'rootfile')[0]?.getAttribute('full-path');
  }
  if (!opfPath) opfPath = Object.keys(zip.files).find(name => name.toLowerCase().endsWith('.opf'));
  if (!opfPath || !getEntry(zip, cleanPath(opfPath))) throw new Error('El EPUB no contiene un archivo OPF válido.');

  const packageDoc = parseXml(await getEntry(zip, cleanPath(opfPath)).async('string'));
  const title = elements(packageDoc, 'title')[0]?.textContent?.trim() || file.name.replace(/\.epub$/i, '');
  const author = elements(packageDoc, 'creator')[0]?.textContent?.trim() || 'Autor no indicado';
  const manifest = new Map();
  for (const item of elements(packageDoc, 'item')) {
    manifest.set(item.getAttribute('id'), {
      href: item.getAttribute('href'),
      type: item.getAttribute('media-type') || '',
      properties: item.getAttribute('properties') || '',
    });
  }
  const spine = elements(packageDoc, 'itemref')
    .filter(el => el.getAttribute('linear') !== 'no')
    .map(el => el.getAttribute('idref'));

  const chapters = [];
  let totalChars = 0;
  for (let chapterIndex = 0; chapterIndex < spine.length; chapterIndex++) {
    const item = manifest.get(spine[chapterIndex]);
    if (!item?.href || /(^|\s)nav(\s|$)/.test(item.properties)) continue;
    if (!/(xhtml|html)/i.test(item.type)) continue;
    const path = resolvePath(opfPath, item.href);
    const entry = getEntry(zip, path);
    if (!entry) continue;
    if (entry._data?.uncompressedSize > 18_000_000) throw new Error('Una sección del libro es demasiado grande para procesarse con seguridad.');
    const chapterMarkup = await entry.async('string');
    const html = new DOMParser().parseFromString(chapterMarkup, 'text/html');
    const body = html.body || html.documentElement;
    const text = speechText(body);
    if (text.length < 12) continue;
    totalChars += text.length;
    if (totalChars > 6_000_000) throw new Error('El texto del libro excede el límite de 6 millones de caracteres.');
    chapters.push({
      id: chapters.length,
      title: getTitle(html, `Sección ${chapters.length + 1}`),
      text,
      charCount: text.length,
      source: path,
    });
  }
  if (!chapters.length) throw new Error('No se encontró texto legible en el EPUB. Los archivos con DRM no son compatibles.');
  return { title, author, chapters, totalChars, fingerprint: await sha256(bytes) };
}

export function sanitizeFilename(str, max = 65) {
  return String(str || 'Sin titulo')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .trim()
    .slice(0, max) || 'Sin titulo';
}

export const MAX_EPUB_SIZE_MB = 45;
