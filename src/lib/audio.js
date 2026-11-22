import JSZip from 'jszip';
import { sanitizeFilename } from './epub';

// Elimina las cabeceras ID3v2 repetidas al unir segmentos MP3 de ElevenLabs.
function stripLeadingID3(bytes) {
  let offset = 0;
  while (bytes.length - offset >= 10 && bytes[offset] === 73 && bytes[offset + 1] === 68 && bytes[offset + 2] === 51) {
    const footer = Boolean(bytes[offset + 5] & 0x10);
    const tagSize = (bytes[offset + 6] << 21) | (bytes[offset + 7] << 14) | (bytes[offset + 8] << 7) | bytes[offset + 9];
    const newOffset = offset + 10 + tagSize + (footer ? 10 : 0);
    if (newOffset > bytes.length) break;
    offset = newOffset;
  }
  return bytes.subarray(offset);
}

// MP3 permite concatenar flujos con bitrate/frecuencia uniformes; es normal
// una pausa muy breve entre fragmentos. Conservamos el primer ID3 solamente.
export async function mergeMp3(blobs) {
  if (!blobs.length) throw new Error('No hay audio para unir.');
  const parts = [];
  for (let i = 0; i < blobs.length; i++) {
    const buffer = new Uint8Array(await blobs[i].arrayBuffer());
    parts.push(i === 0 ? buffer : stripLeadingID3(buffer));
  }
  return new Blob(parts, { type: 'audio/mpeg' });
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export function filenameForChapter(chapter, index) {
  return `${String(index + 1).padStart(3, '0')} - ${sanitizeFilename(chapter.title)}.mp3`;
}

export async function makeZip(book, completed, fetchAudio, onProgress) {
  const zip = new JSZip();
  const folder = zip.folder(sanitizeFilename(book.title));
  const playlist = [];
  for (let i = 0; i < completed.length; i++) {
    const entry = completed[i];
    const name = filenameForChapter(entry.chapter, entry.index);
    const mp3 = await mergeMp3(await fetchAudio(entry.index));
    folder.file(name, mp3, { binary: true, compression: 'STORE' });
    playlist.push(name);
    onProgress?.(Math.round(((i + 1) / completed.length) * 45));
  }
  folder.file('lista_de_reproduccion.m3u8', playlist.join('\n'), { compression: 'STORE' });
  folder.file('LEEME.txt', [
    `AUDIOLIBRO: ${book.title}`,
    `AUTOR: ${book.author}`,
    '',
    'Narración generada mediante inteligencia artificial (ElevenLabs).',
    'Los archivos MP3 están organizados por capítulo.',
    'La reproducción seguida de todos los capítulos se puede realizar con la lista de reproducción .m3u8.',
    'Nota: la conversión larga puede dejar pausas cortas entre los fragmentos de un capítulo.',
  ].join('\n'), { compression: 'STORE' });
  const file = await zip.generateAsync({ type: 'blob', compression: 'STORE', streamFiles: true }, metadata => {
    onProgress?.(45 + Math.round(metadata.percent * 0.55));
  });
  return file;
}
