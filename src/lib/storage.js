const DB_NAME = 'vozlibro-audio-v1';
const STORE_NAME = 'segments';
const VERSION = 1;

function openDb() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) return reject(new Error('Este navegador no admite almacenamiento local de audio.'));
    const request = indexedDB.open(DB_NAME, VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function requestKey(book, model, voiceId, chapterIndex, chunkIndex) {
  return `${book.fingerprint}|${model}|${voiceId}|${chapterIndex}|${chunkIndex}`;
}

async function withStore(mode, fn) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, mode);
      const result = fn(tx.objectStore(STORE_NAME));
      tx.oncomplete = () => resolve(result.result);
      tx.onerror = () => reject(tx.error || result.error);
      tx.onabort = () => reject(tx.error || new Error('Almacenamiento interrumpido.'));
    });
  } finally {
    db.close();
  }
}

export function getSegment(book, model, voiceId, chapter, chunk) {
  return withStore('readonly', store => store.get(requestKey(book, model, voiceId, chapter, chunk)));
}
export function putSegment(book, model, voiceId, chapter, chunk, blob) {
  return withStore('readwrite', store => store.put(blob, requestKey(book, model, voiceId, chapter, chunk)));
}

export async function getChapterAudio(book, model, voiceId, index, length) {
  const blobs = [];
  for (let i = 0; i < length; i++) {
    const blob = await getSegment(book, model, voiceId, index, i);
    if (!blob) throw new Error(`Falta el fragmento ${i + 1} del capítulo ${index + 1}.`);
    blobs.push(blob);
  }
  return blobs;
}

export async function countAvailable(book, model, voiceId, jobs) {
  let completed = 0;
  for (const job of jobs) {
    if (await getSegment(book, model, voiceId, job.chapterIndex, job.chunkIndex)) completed++;
  }
  return completed;
}

export async function clearAudioCache() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Cierra otras pestañas de VozLibro e inténtalo de nuevo.'));
  });
}
