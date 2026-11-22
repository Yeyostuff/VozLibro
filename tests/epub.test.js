import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { parseEpub, sanitizeFilename } from '../src/lib/epub.js';

async function sample() {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip');
  zip.file('META-INF/container.xml', `<?xml version="1.0"?>
    <container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml" /></rootfiles></container>`);
  zip.file('OEBPS/content.opf', `<?xml version="1.0"?>
    <package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/">
    <metadata><dc:title>Mi libro de prueba</dc:title><dc:creator>Autor de prueba</dc:creator></metadata>
    <manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav" />
    <item id="ch1" href="Text/ch1.xhtml" media-type="application/xhtml+xml" />
    <item id="ch2" href="Text/ch2.xhtml" media-type="application/xhtml+xml" /></manifest>
    <spine><itemref idref="nav" /><itemref idref="ch2" /><itemref idref="ch1" /></spine></package>`);
  zip.file('OEBPS/nav.xhtml', '<html><body><h1>Índice</h1><nav>Menú</nav></body></html>');
  zip.file('OEBPS/Text/ch1.xhtml', '<html><head><title>Primero</title></head><body><h1>Primero</h1><p>Érase una vez una historia feliz.</p><script>ALERTA</script></body></html>');
  zip.file('OEBPS/Text/ch2.xhtml', '<html><body><h1>Segundo</h1><p>Un contenido de la segunda sección.</p><aside epub:type="footnote">nota oculta</aside></body></html>');
  const array = await zip.generateAsync({ type: 'arraybuffer' });
  return { name: 'prueba.epub', size: array.byteLength, arrayBuffer: async () => array };
}

describe('EPUB', () => {
  it('lee el orden del spine y excluye índice, scripts y notas', async () => {
    const book = await parseEpub(await sample());
    expect(book.title).toBe('Mi libro de prueba');
    expect(book.author).toBe('Autor de prueba');
    expect(book.chapters).toHaveLength(2);
    expect(book.chapters.map(ch => ch.title)).toEqual(['Segundo', 'Primero']);
    expect(book.chapters[0].text).not.toContain('nota oculta');
    expect(book.chapters[1].text).not.toContain('ALERTA');
    expect(book.fingerprint).toBeTruthy();
  });
  it('rechaza archivos no EPUB', async () => {
    await expect(parseEpub({ name: 'otro.zip' })).rejects.toThrow('EPUB');
  });
  it('limpia nombres de archivo inseguros', () => {
    expect(sanitizeFilename('Hola: / mundo?')).toBe('Hola mundo');
  });
});
