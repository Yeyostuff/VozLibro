export default function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Método no permitido.' });
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({
    ready: Boolean(process.env.ELEVENLABS_API_KEY && process.env.APP_ACCESS_PIN),
    provider: 'ElevenLabs',
  });
}
