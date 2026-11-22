export const CHUNK_LIMIT = 1900;

// Divide sin saltarse palabras: prioriza párrafos, después oraciones, después espacios.
export function splitForSpeech(text, max = CHUNK_LIMIT) {
  if (max < 30) throw new Error('El tamaño mínimo del fragmento es 30.');
  const normalized = String(text || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\f]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!normalized) return [];
  const result = [];
  let pending = '';
  let remaining = normalized;
  while (remaining.length) {
    if (pending.length + (pending ? 1 : 0) + remaining.length <= max) {
      pending = pending ? `${pending} ${remaining}` : remaining;
      break;
    }
    const capacity = max - pending.length - (pending ? 1 : 0);
    // Si la frase pendiente ya es larga, cerrarla antes de cortar la siguiente.
    if (capacity < Math.round(max * 0.35) && pending) {
      result.push(pending);
      pending = '';
      continue;
    }
    const part = remaining.slice(0, capacity + 1);
    let split = -1;
    // Prefiere pausar en los finales de frases y párrafos.
    const endings = /(?:[.!?…;:]\s+|\n{2,})/gu;
    let match;
    while ((match = endings.exec(part)) !== null) {
      const i = match.index + match[0].length;
      if (i > Math.round(capacity * 0.43) && i <= capacity) split = i;
    }
    if (split < 0) {
      const space = part.lastIndexOf(' ', capacity);
      if (space >= Math.round(capacity * 0.4)) split = space + 1;
    }
    if (split < 0) split = capacity;
    const chosen = remaining.slice(0, split).trim();
    pending = pending ? `${pending} ${chosen}` : chosen;
    if (pending) result.push(pending);
    pending = '';
    remaining = remaining.slice(split).trimStart();
  }
  if (pending) result.push(pending);
  return result;
}

export function formatChars(chars) {
  return new Intl.NumberFormat('es-GT').format(chars);
}
