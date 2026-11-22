import { authorize, respond, providerError } from '../server-utils/common.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return respond(res, 405, { error: 'Método no permitido.' });
  if (!authorize(req, res)) return;
  try {
    const url = new URL('https://api.elevenlabs.io/v2/voices');
    url.searchParams.set('page_size', '100');
    const remote = await fetch(url, {
      headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY },
      signal: AbortSignal.timeout(25000),
    });
    if (!remote.ok) return respond(res, remote.status, { error: await providerError(remote) });
    const data = await remote.json();
    const voices = (data.voices || [])
      .filter(v => typeof v.voice_id === 'string')
      .map(v => ({
        voice_id: v.voice_id,
        name: String(v.name || 'Voz sin nombre'),
        description: String(v.description || '').slice(0, 190),
        preview_url: v.preview_url?.startsWith('https://') ? v.preview_url : null,
        labels: v.labels || {},
        category: String(v.category || ''),
      }));
    return respond(res, 200, { voices, hasMore: Boolean(data.has_more) });
  } catch (e) {
    return respond(res, 502, { error: e.name === 'TimeoutError' ? 'ElevenLabs tardó demasiado en responder.' : 'No se pudo consultar ElevenLabs.' });
  }
}
