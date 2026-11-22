import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import tts from '../api/tts.js';
import voices from '../api/voices.js';

function mockResponse() {
  return { code: 200, headers: {}, data: null,
    status(value) { this.code = value; return this; },
    setHeader(key, value) { this.headers[key] = value; return this; },
    json(value) { this.data = value; return this; },
    end(value) { this.data = value; return this; },
  };
}

beforeEach(() => {
  process.env.ELEVENLABS_API_KEY = 'clave-prueba';
  process.env.APP_ACCESS_PIN = 'PIN-DE-PRUEBA-SEGURA';
});
afterEach(() => vi.unstubAllGlobals());

describe('API segura', () => {
  it('rechaza un PIN incorrecto sin llamar al proveedor', async () => {
    const req = { method: 'POST', headers: { 'x-access-pin': 'erróneo' }, body: {} };
    const res = mockResponse();
    const remote = vi.fn(); vi.stubGlobal('fetch', remote);
    await tts(req, res);
    expect(res.code).toBe(401);
    expect(remote).not.toHaveBeenCalled();
  });
  it('rechaza fragmentos enormes y modelos desconocidos', async () => {
    const headers = { 'x-access-pin': process.env.APP_ACCESS_PIN };
    const tooLong = mockResponse();
    await tts({ method: 'POST', headers, body: { text: 'a'.repeat(2400), model: 'eleven_v4', voiceId: 'voice12345678' } }, tooLong);
    expect(tooLong.code).toBe(400);
    const unsupported = mockResponse();
    await tts({ method: 'POST', headers, body: { text: 'Hola', model: 'invalido', voiceId: 'voice12345678' } }, unsupported);
    expect(unsupported.code).toBe(400);
  });
  it('envía el texto y el contexto a ElevenLabs y devuelve MP3', async () => {
    const fakeAudio = new Uint8Array([73, 68, 51, 1, 2, 3]);
    const remote = vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => fakeAudio.buffer });
    vi.stubGlobal('fetch', remote);
    const res = mockResponse();
    await tts({ method: 'POST', headers: { 'x-access-pin': process.env.APP_ACCESS_PIN }, body: {
      text: 'Hola mundo', previousText: 'Anterior.', nextText: 'Siguiente.', model: 'eleven_v4', voiceId: 'voice12345678',
    } }, res);
    expect(res.code).toBe(200);
    expect(res.headers['Content-Type']).toBe('audio/mpeg');
    const sent = JSON.parse(remote.mock.calls[0][1].body);
    expect(sent.previous_text).toBe('Anterior.');
    expect(sent.next_text).toBe('Siguiente.');
  });
  it('convierte la respuesta de voces a un listado restringido', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ voices: [{ voice_id: 'testvoice123', name: 'Laura', labels: { language: 'es' } }] }) }));
    const res = mockResponse();
    await voices({ method: 'GET', headers: { 'x-access-pin': process.env.APP_ACCESS_PIN } }, res);
    expect(res.data.voices[0].name).toBe('Laura');
    expect(res.code).toBe(200);
  });
});
