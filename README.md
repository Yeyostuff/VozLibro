# VozLibro Studio — Convertidor EPUB a audiolibro MP3

Aplicación web para convertir **archivos EPUB sin DRM** en audiolibros mediante **voces de ElevenLabs** (IA, no voces del sistema). Diseñada con **React + Vite + funciones Node.js de Vercel**.

## Qué incluye

- Importación de EPUB y extracción de texto **en el navegador**, respetando el orden del *spine* del libro.
- Selección de capítulos, modelo de voz y narrador de tu biblioteca ElevenLabs.
- Tres modelos: `eleven_v4` (alta expresividad), `eleven_multilingual_v2` (estabilidad en narraciones largas), `eleven_flash_v2_5` (económico).
- Prueba de narración, progreso, pausa después del fragmento actual, reanudación sin repetir las piezas que ya están almacenadas.
- Audio **MP3 por capítulo**, descarga individual o ZIP con archivos MP3 y lista de reproducción M3U8.
- Fragmentos cortos para que Vercel no reciba el EPUB completo ni genere una respuesta de audio demasiado grande.
- Clave API únicamente en el servidor; la conversión exige un PIN privado. Cache local por huella digital del libro, modelo y voz.

## Despliegue en Vercel (recomendado)

1. Crea una cuenta y clave API de **ElevenLabs** en https://elevenlabs.io/app/settings/api-keys. Esta clave necesita acceso a Text to Speech y Voices. El plan de ElevenLabs determina créditos, calidad disponible y precio.
2. En **GitHub**, crea un repositorio nuevo (por ejemplo `vozlibro-epub-audio`), **separado** del proyecto `hojas-three`, y sube los archivos de esta carpeta a la raíz del nuevo repositorio. No subas `.env`.
3. Ve a https://vercel.com/new, importa el nuevo repositorio. Elige **Framework Preset: Vite**, **Build Command: `npm run build`**, **Output Directory: `dist`**. La carpeta raíz debe contener `package.json`.
4. En Vercel, **Project Settings → Environment Variables**, agrega las siguientes variables **de servidor** (Production; añade Preview/Development si las usas):
   - `ELEVENLABS_API_KEY` = tu clave privada de ElevenLabs.
   - `APP_ACCESS_PIN` = una contraseña larga y secreta para usar la aplicación (mínimo sugerido: 12 caracteres).
5. Ejecuta **Deploy**. Si agregaste variables después de publicar, ejecuta **Redeploy**. Verifica en `https://TU-PROYECTO.vercel.app/api/status` que devuelva `{"ready":true,"provider":"ElevenLabs"}`.
6. Abre tu página, ingresa el PIN, presiona **Conectar**, escoge una voz, importa el EPUB y pulsa **Prueba** antes de iniciar un libro entero.

**IMPORTANTE:** Una clave API de ElevenLabs no es lo mismo que ChatGPT Plus. Las conversiones consumen créditos de ElevenLabs. No publiques el PIN, pues cualquier persona que lo conozca podría gastar tus créditos. En tu panel de ElevenLabs establece un límite de gasto y revisa los permisos de la clave.

## Desarrollo local

Necesitas **Node.js 20 o posterior**.

```bash
npm install
npm run build
npm test
```

Para probar el sitio **con las funciones `/api`** en local:

```bash
npm install -g vercel
vercel login
vercel link
vercel env pull .env.local
vercel dev
```

Puedes crear las variables de Vercel desde el dashboard. `npm run dev` inicia únicamente el frontend Vite; **el servicio `/api` no funciona con Vite por sí solo**. Para un ensayo completo usa `vercel dev` o publica en Vercel.

## Estructura

```text
api/status.js       Diagnóstico de variables (sin revelar secretos)
api/voices.js       Consulta la biblioteca de voces de ElevenLabs
api/tts.js          Generación de fragmentos MP3 en servidor
server-utils/       PIN, validación y gestión de errores
src/lib/epub.js     Lectura de EPUB, OPF, spine y XHTML
src/lib/chunks.js   División de texto por oraciones
src/lib/storage.js  Persistencia IndexedDB de audio
src/lib/audio.js    MP3 por capítulo y ZIP
src/App.jsx         Interfaz React
```

## Límites y consideraciones

- Archivos EPUB de hasta **45 MB**, sin cifrado/DRM; los EPUB escaneados sin texto no se convierten directamente.
- El texto se procesa localmente, pero el **texto de los fragmentos seleccionados sí se envía a ElevenLabs** para generar la voz.
- La conversión sucede **mientras la pestaña está abierta**. Puedes pausarla y retomarla con el mismo EPUB y la misma voz/modelo; los audios almacenados en IndexedDB sobreviven a recargas normales, a menos que borres los datos del sitio o el navegador los elimine por falta de espacio.
- El audio MP3 por capítulo se forma al unir segmentos MP3 del mismo formato. Pueden percibirse **breves pausas en las uniones**. Se pasa contexto anterior y posterior a ElevenLabs para mejorar la continuidad de la narración, pero no elimina por completo estos cortes.
- Descargas ZIP muy grandes requieren memoria en el dispositivo. En móviles conviene seleccionar pocos capítulos o descargarlos uno a uno.
- Las estimaciones de duración son aproximadas y **no representan una cotización** de ElevenLabs.
- La voz generada puede contener errores de pronunciación. Revisa previamente si la voz seleccionada tiene el acento que buscas, especialmente para español.
- Solo conviertas libros cuya transformación y uso estén autorizados por los derechos de autor aplicables.

## Validaciones y seguridad

- La clave API y el PIN solo se leen desde el servidor. Nunca uses `VITE_ELEVENLABS_API_KEY` ni los coloques en archivos React.
- Los endpoints de voces y síntesis exigen el PIN y validan las solicitudes.
- Hay reintentos limitados solamente ante la respuesta HTTP 429 del proveedor; otros fallos no se reintentan automáticamente para evitar cargos duplicados.
- El caché local diferencia libros por huella digital SHA-256, modelo, voz y segmento.
- **No incluye** sistema de cuentas, pagos, almacenamiento en la nube ni servicio de conversión en segundo plano.

## Documentación técnica de referencia

- ElevenLabs TTS: https://elevenlabs.io/docs/api-reference/text-to-speech/convert
- ElevenLabs voces: https://elevenlabs.io/docs/api-reference/voices/search
- ElevenLabs modelos: https://elevenlabs.io/docs/overview/models
- Vercel Functions: https://vercel.com/docs/functions/limitations
