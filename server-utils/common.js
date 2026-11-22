import { timingSafeEqual } from 'node:crypto';

export function respond(res, status, data) {
  res.status(status).setHeader('Cache-Control', 'no-store').json(data);
}

export function authorize(req, res) {
  if (!process.env.ELEVENLABS_API_KEY || !process.env.APP_ACCESS_PIN) {
    respond(res, 503, { error: 'Configura ELEVENLABS_API_KEY y APP_ACCESS_PIN en las variables de entorno de Vercel.' });
    return false;
  }
  const supplied = req.headers['x-access-pin'];
  const submitted = typeof supplied === 'string' ? supplied : '';
  const expected = process.env.APP_ACCESS_PIN;
  const a = Buffer.from(submitted);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    respond(res, 401, { error: 'PIN de acceso incorrecto.' });
    return false;
  }
  return true;
}

export async function providerError(response) {
  let message = `Servicio de voz: error HTTP ${response.status}.`;
  try {
    const body = await response.json();
    const detail = body?.detail;
    const msg = typeof detail === 'string'
      ? detail
      : detail?.message || detail?.status || body?.message;
    if (typeof msg === 'string') message = msg.slice(0, 500);
  } catch { /* La respuesta puede no ser JSON. */ }
  return message;
}
