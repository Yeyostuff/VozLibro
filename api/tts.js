import { authorize, respond, providerError } from '../server-utils/common.js';

const ALLOWED_MODELS = new Set(['eleven_v4', 'eleven_multilingual_v2', 'eleven_flash_v2_5']);
const MAX_CHARS = 2200;

export default async function handler(req, res) {
  if (req.method !== 'POST') return respond(res, 405, { error: 'Método no permitido.' });
  if (!authorize(req, res)) return;

  const { text, voiceId, model, previousText = '', nextText = '' } = req.body || {};
  if (typeof text !== 'string' || text.trim().length < 1 || text.length > MAX_CHARS) {
    return respond(res, 400, { error: `Cada fragmento debe contener entre 1 y ${MAX_CHARS} caracteres.` });
  }
  if (typeof voiceId !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(voiceId)) {
    return respond(res, 400, { error: 'Selecciona un ID de voz válido.' });
  }
  if (typeof previousText !== 'string' || previousText.length > 500 || typeof nextText !== 'string' || nextText.length > 500) {
    return respond(res, 400, { error: 'Contexto de narración no válido.' });
  }
  if (!ALLOWED_MODELS.has(model)) {
    return respond(res, 400, { error: 'Modelo de voz no compatible.' });
  }
  try {
    const endpoint = new URL(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`);
    endpoint.searchParams.set('output_format', 'mp3_44100_128');
    const upstream = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'xi-api-key': process.env.ELEVENLABS_API_KEY,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg',
      },
      body: JSON.stringify({ text, model_id: model, ...(previousText && { previous_text: previousText }), ...(nextText && { next_text: nextText }) }),
      signal: AbortSignal.timeout(110000),
    });
    if (!upstream.ok) return respond(res, upstream.status, { error: await providerError(upstream) });

    const buffer = Buffer.from(await upstream.arrayBuffer());
    if (!buffer.length) return respond(res, 502, { error: 'ElevenLabs devolvió un audio vacío.' });
    if (buffer.length > 4_300_000) return respond(res, 502, { error: 'Audio demasiado grande para Vercel. Reduce la longitud del fragmento.' });
    res.status(200);
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Length', String(buffer.length));
    res.setHeader('Cache-Control', 'no-store, private');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.end(buffer);
  } catch (e) {
    return respond(res, 502, { error: e?.name === 'TimeoutError' ? 'La síntesis de voz excedió el tiempo permitido. Puedes reanudarla.' : 'No se pudo generar el audio; verifica la conexión.' });
  }
}
