import { describe, it, expect } from 'vitest';
import { splitForSpeech } from '../src/lib/chunks.js';

function words(text) { return text.trim().split(/\s+/).filter(Boolean); }

describe('División de texto', () => {
  it('conserva todas las palabras en el mismo orden', () => {
    const source = Array.from({ length: 3000 }, (_, i) => `palabra${i}${i % 9 === 0 ? '.' : ''}`).join(' ');
    const result = splitForSpeech(source);
    expect(result.length).toBeGreaterThan(10);
    expect(result.every(x => x.length <= 1900)).toBe(true);
    expect(words(result.join(' '))).toEqual(words(source));
  });
  it('mantiene capítulos breves en un solo segmento', () => {
    expect(splitForSpeech('Érase una vez.')).toEqual(['Érase una vez.']);
    expect(splitForSpeech('   ')).toEqual([]);
  });
  it('divide una sola palabra excepcionalmente larga sin colgarse', () => {
    const result = splitForSpeech('a'.repeat(10000));
    expect(result.join('')).toHaveLength(10000);
    expect(result.every(x => x.length <= 1900)).toBe(true);
  });
});
