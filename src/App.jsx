import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AudioLines, BookOpenText, Check, CheckCircle2, ChevronDown, CircleAlert, Clock3,
  CloudDownload, FileAudio2, FileUp, Headphones, KeyRound, Layers3, LoaderCircle,
  LockKeyhole, Mic2, Pause, Play, RefreshCw, RotateCcw, ShieldCheck, Sparkles,
  Trash2, Volume2, WandSparkles, X,
} from 'lucide-react';
import { parseEpub, sanitizeFilename } from './lib/epub';
import { splitForSpeech, formatChars } from './lib/chunks';
import { downloadBlob, filenameForChapter, makeZip, mergeMp3 } from './lib/audio';
import { clearAudioCache, countAvailable, getChapterAudio, getSegment, putSegment } from './lib/storage';
import './styles.css';

const MODEL_CHOICES = [
  { id: 'eleven_v4', name: 'Eleven v4', subtitle: 'Máxima expresividad', tag: 'Más natural' },
  { id: 'eleven_multilingual_v2', name: 'Multilingual v2', subtitle: 'Narración estable para libros largos', tag: 'Audiolibros' },
  { id: 'eleven_flash_v2_5', name: 'Flash v2.5', subtitle: 'Más económico y rápido', tag: 'Ahorro' },
];

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function jsonFrom(res) {
  const value = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(value.error || `Error del servidor (${res.status}).`);
    e.status = res.status;
    e.retryAfter = Number(res.headers.get('Retry-After')) || 0;
    throw e;
  }
  return value;
}

async function sendTts({ text, voiceId, model, pin, previousText = '', nextText = '' }) {
  let tries = 0;
  while (true) {
    const res = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-access-pin': pin },
      body: JSON.stringify({ text, voiceId, model, previousText, nextText }),
    });
    if (res.ok) return await res.blob();
    const info = await jsonFrom(res).catch(err => err);
    // Solo se reintenta al recibir 429 (límite confirmado). Otros errores pueden ya haber consumido créditos.
    if (res.status === 429 && tries < 2) {
      await sleep(Math.min(30000, Math.max(4, info.retryAfter || 0) * 1000 * (tries + 1)));
      tries++;
      continue;
    }
    throw info;
  }
}

function secondsToApproxDuration(chars) {
  const mins = Math.max(1, Math.round(chars / 850));
  if (mins < 60) return `~${mins} min de audio`;
  return `~${Math.floor(mins / 60)} h ${mins % 60} min de audio`;
}

function SectionHeading({ number, title, subtitle }) {
  return <div className="section-heading"><div className="step-number">{number}</div><div><h2>{title}</h2><p>{subtitle}</p></div></div>;
}

export default function App() {
  const [book, setBook] = useState(null);
  const [selected, setSelected] = useState([]);
  const [fileBusy, setFileBusy] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [model, setModel] = useState('eleven_v4');
  const [voices, setVoices] = useState([]);
  const [pin, setPin] = useState('');
  const [connected, setConnected] = useState(false);
  const [configReady, setConfigReady] = useState(null);
  const [voiceId, setVoiceId] = useState('');
  const [manualVoice, setManualVoice] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [running, setRunning] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0, title: '' });
  const [readyChapters, setReadyChapters] = useState([]);
  const [makingZip, setMakingZip] = useState(false);
  const [zipProgress, setZipProgress] = useState(0);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewUrl, setPreviewUrl] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [openChapters, setOpenChapters] = useState(true);
  const fileInputRef = useRef(null);
  const runRef = useRef(false);
  const currentAudioRef = useRef(null);

  const chosenVoice = manualVoice.trim() || voiceId;
  const selectedIds = useMemo(() => new Set(selected), [selected]);
  const selectedChapters = useMemo(() => book?.chapters.filter(ch => selectedIds.has(ch.id)) || [], [book, selectedIds]);
  const selectedChars = useMemo(() => selectedChapters.reduce((acc, ch) => acc + ch.charCount, 0), [selectedChapters]);
  const jobs = useMemo(() => selectedChapters.flatMap(ch => {
    const parts = splitForSpeech(ch.text);
    return parts.map((text, chunkIndex) => ({
      chapterIndex: ch.id, chapterTitle: ch.title, chunkIndex, text,
      previousText: parts[chunkIndex - 1]?.slice(-250) || '',
      nextText: parts[chunkIndex + 1]?.slice(0, 250) || '',
    }));
  }), [selectedChapters]);
  const chunkCounts = useMemo(() => Object.fromEntries((book?.chapters || []).map(ch => [ch.id, splitForSpeech(ch.text).length])), [book]);
  const canConvert = Boolean(book && selected.length && chosenVoice && connected && pin && !running && !makingZip);

  useEffect(() => {
    fetch('/api/status').then(jsonFrom).then(data => setConfigReady(data.ready)).catch(() => setConfigReady(false));
  }, []);

  useEffect(() => () => {
    if (currentAudioRef.current) URL.revokeObjectURL(currentAudioRef.current);
  }, []);

  useEffect(() => {
    setReadyChapters([]);
    if (!book || !chosenVoice || !connected) return;
    let cancelled = false;
    (async () => {
      const done = [];
      for (const ch of book.chapters) {
        let valid = true;
        for (let i = 0; i < chunkCounts[ch.id]; i++) {
          if (!(await getSegment(book, model, chosenVoice, ch.id, i))) { valid = false; break; }
        }
        if (valid) done.push(ch.id);
      }
      if (!cancelled) setReadyChapters(done);
    })().catch(() => {});
    return () => { cancelled = true; };
  }, [book, chosenVoice, connected, model, chunkCounts]);

  async function processFile(file) {
    if (!file || running) return;
    setFileBusy(true);
    setError(''); setNotice('');
    try {
      const parsed = await parseEpub(file);
      setBook(parsed);
      setSelected(parsed.chapters.map(ch => ch.id));
      setProgress({ done: 0, total: 0, title: '' });
      setReadyChapters([]);
      setNotice('Libro cargado. Puedes elegir qué capítulos convertir.');
    } catch (e) { setError(e.message || 'No se pudo leer el libro.'); }
    finally { setFileBusy(false); if (fileInputRef.current) fileInputRef.current.value = ''; }
  }

  async function connect() {
    setConnecting(true);
    setError(''); setNotice('');
    try {
      if (!pin.trim()) throw new Error('Escribe el PIN de acceso definido en Vercel.');
      const res = await fetch('/api/voices', { headers: { 'x-access-pin': pin } });
      const data = await jsonFrom(res);
      setVoices(data.voices || []);
      setVoiceId(current => (data.voices || []).some(v => v.voice_id === current) ? current : (data.voices?.[0]?.voice_id || ''));
      setConnected(true);
      setConfigReady(true);
      setNotice(data.hasMore ? 'Conectado. Se muestran las primeras 100 voces; también puedes pegar un ID.' : 'Conexión establecida. Elige una voz para narrar.');
    } catch (e) { setConnected(false); setError(e.message); }
    finally { setConnecting(false); }
  }

  async function preview() {
    if (!chosenVoice || !connected || !pin || previewBusy) return;
    setError(''); setPreviewBusy(true);
    try {
      const sample = selectedChapters[0]?.text.slice(0, 290) || 'Bienvenidos a VozLibro. Esta es una pequeña muestra de narración con una voz de inteligencia artificial, cálida y natural.';
      const blob = await sendTts({ text: sample, voiceId: chosenVoice, model, pin });
      if (currentAudioRef.current) URL.revokeObjectURL(currentAudioRef.current);
      const url = URL.createObjectURL(blob);
      currentAudioRef.current = url;
      setPreviewUrl(url);
      setNotice('Vista previa generada. Escucha el resultado antes de convertir el libro. Esta prueba puede consumir créditos.');
    } catch (e) { setError(e.message); }
    finally { setPreviewBusy(false); }
  }

  async function convert() {
    if (!canConvert) return;
    setRunning(true); setStopping(false); runRef.current = true;
    setError(''); setNotice('');
    const parameters = { book, model, voice: chosenVoice, pin };
    let done = 0;
    const updatedReady = new Set(readyChapters);
    setProgress({ done: 0, total: jobs.length, title: 'Preparando conversión…' });
    try {
      let lastChapter = -1;
      for (const job of jobs) {
        if (!runRef.current) break;
        const cached = await getSegment(parameters.book, parameters.model, parameters.voice, job.chapterIndex, job.chunkIndex);
        if (!cached) {
          const audio = await sendTts({ text: job.text, voiceId: parameters.voice, model: parameters.model, pin: parameters.pin, previousText: job.previousText, nextText: job.nextText });
          await putSegment(parameters.book, parameters.model, parameters.voice, job.chapterIndex, job.chunkIndex, audio);
        }
        done++;
        lastChapter = job.chapterIndex;
        setProgress({ done, total: jobs.length, title: job.chapterTitle });
        if (job.chunkIndex === chunkCounts[job.chapterIndex] - 1) {
          updatedReady.add(job.chapterIndex);
          setReadyChapters(Array.from(updatedReady));
        }
      }
      if (done === jobs.length) setNotice('¡Conversión completada! Descarga un capítulo o todos en un ZIP.');
      else setNotice(`Conversión pausada: ${done} de ${jobs.length} fragmentos revisados en esta sesión. Puedes reanudar sin volver a pagar los guardados.`);
      if (lastChapter >= 0 && done === jobs.length) setOpenChapters(true);
    } catch (e) {
      setError(`${e.message} Los audios ya terminados permanecen guardados en este navegador; puedes reanudar.`);
    } finally { runRef.current = false; setRunning(false); setStopping(false); }
  }

  async function downloadChapter(chapter) {
    setError('');
    try {
      const blobs = await getChapterAudio(book, model, chosenVoice, chapter.id, chunkCounts[chapter.id]);
      const mp3 = await mergeMp3(blobs);
      downloadBlob(mp3, filenameForChapter(chapter, chapter.id));
    } catch (e) { setError(e.message); }
  }

  async function downloadAll() {
    const entries = selectedChapters.filter(ch => readyChapters.includes(ch.id)).map(ch => ({ index: ch.id, chapter: ch }));
    if (!entries.length) return;
    setMakingZip(true); setZipProgress(0); setError('');
    try {
      const zip = await makeZip(book, entries, idx => getChapterAudio(book, model, chosenVoice, idx, chunkCounts[idx]), setZipProgress);
      downloadBlob(zip, `${sanitizeFilename(book.title)} - Audiolibro.zip`);
      setNotice('ZIP descargado, con un MP3 por capítulo, lista de reproducción y archivo de información.');
    } catch (e) { setError(e.message || 'No se pudo crear el ZIP. Intenta descargar capítulos por separado.'); }
    finally { setMakingZip(false); }
  }

  function toggleChapter(id) {
    if (running) return;
    setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
    setProgress({ done: 0, total: 0, title: '' });
  }

  async function clearCache() {
    if (running || makingZip) return;
    if (!window.confirm('¿Eliminar TODOS los fragmentos de audio guardados en este navegador? Esta acción no se puede deshacer.')) return;
    try {
      await clearAudioCache();
      setReadyChapters([]); setProgress({ done: 0, total: 0, title: '' });
      setNotice('Audios locales eliminados.');
    } catch (e) { setError(e.message); }
  }

  const doneCount = readyChapters.filter(id => selectedIds.has(id)).length;
  const percent = progress.total ? Math.round(progress.done / progress.total * 100) : 0;

  return <div className="app-shell">
    <div className="ambient ambient-one" aria-hidden="true" /><div className="ambient ambient-two" aria-hidden="true" />
    <header className="site-header container">
      <div className="brand"><div className="brand-mark"><AudioLines size={27} strokeWidth={2.5} /></div><div className="brand-text">Voz<span>Libro</span><small>STUDIO</small></div></div>
      <div className="header-label"><span className="status-dot" /> ESTUDIO DE AUDIO IA <span className="header-version">/ v1.0</span></div>
    </header>

    <main className="container">
      <section className="hero">
        <div className="hero-copy">
          <div className="hero-eyebrow"><Sparkles size={15} /> TU BIBLIOTECA, CON UNA NUEVA VOZ</div>
          <h1>Convierte tus libros en <span>audiolibros.</span></h1>
          <p>De EPUB a MP3, con voces de inteligencia artificial que narran con expresividad y naturalidad. Escoge el libro, el narrador y comienza.</p>
          <div className="feature-pills"><span><ShieldCheck size={15} /> EPUB privado</span><span><Layers3 size={15} /> Por capítulos</span><span><Headphones size={15} /> Audio MP3</span></div>
        </div>
        <div className="hero-visual" aria-hidden="true">
          <div className="glow-orbit" /><div className="record-surface"><div className="record-inner"><BookOpenText size={55} strokeWidth={1.25}/></div></div>
          <div className="visual-wave">{Array.from({ length: 32 }, (_, i) => <span key={i} style={{ height: `${18 + Math.abs(Math.sin(i * 1.4) * Math.cos(i / 2.8)) * 85}%` }}/>)}</div>
          <div className="floating-note"><AudioLines size={16} /> AUDIOBOOK EDITION</div>
        </div>
      </section>

      {error && <div role="alert" className="alert alert-error"><CircleAlert size={19} /><div>{error}</div><button onClick={() => setError('')} title="Cerrar aviso"><X size={17} /></button></div>}
      {notice && <div role="status" className="alert alert-good"><CheckCircle2 size={19} /><div>{notice}</div><button onClick={() => setNotice('')} title="Cerrar aviso"><X size={17} /></button></div>}
      {configReady === false && <div className="alert alert-warn"><KeyRound size={19}/><div>El servidor necesita las variables <code>ELEVENLABS_API_KEY</code> y <code>APP_ACCESS_PIN</code>. Configúralas en Vercel para activar las voces.</div></div>}

      <div className="workspace">
        <div className="workspace-main">
          <section className="panel">
            <SectionHeading number="01" title="Importar libro" subtitle="Elige un archivo EPUB para extraer su contenido." />
            <input ref={fileInputRef} type="file" accept=".epub,application/epub+zip" hidden onChange={e => processFile(e.target.files?.[0])} />
            <div className={`dropzone ${isDragging ? 'dragging' : ''} ${book ? 'has-book' : ''}`}
              onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={e => { e.preventDefault(); setIsDragging(false); }}
              onDrop={e => { e.preventDefault(); setIsDragging(false); processFile(e.dataTransfer.files?.[0]); }}
              onClick={() => !running && !fileBusy && fileInputRef.current?.click()}
              role="button" tabIndex={0} aria-label="Cargar archivo EPUB" onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click(); }}>
              <div className="upload-icon">{fileBusy ? <LoaderCircle className="spin" size={29} /> : book ? <BookOpenText size={29} /> : <FileUp size={29} />}</div>
              <strong>{fileBusy ? 'Leyendo tu EPUB…' : book ? 'Cambiar archivo EPUB' : 'Arrastra tu EPUB aquí'}</strong>
              <span>o <b>haz clic para explorar archivos</b></span>
              <small>Hasta 45 MB · Formato EPUB sin DRM · El archivo no se sube al servidor</small>
            </div>
            {book && <div className="book-info">
              <div className="book-icon"><BookOpenText size={26} /></div>
              <div className="book-details"><b>{book.title}</b><span>{book.author}</span><small>{book.chapters.length} secciones · {formatChars(book.totalChars)} caracteres</small></div>
              <div className="book-check"><Check size={18} /></div>
            </div>}
          </section>

          {book && <section className="panel chapters-panel">
            <div className="section-heading row-heading"><div className="step-number">02</div><div className="section-title"><h2>Elegir capítulos</h2><p>Selecciona lo que quieres convertir a audio.</p></div><button className="icon-btn" aria-label="Mostrar u ocultar capítulos" onClick={() => setOpenChapters(v => !v)}><ChevronDown className={openChapters ? '' : 'rotate-up'} size={19} /></button></div>
            {openChapters && <>
              <div className="selection-toolbar"><button className="text-button" disabled={running} onClick={() => setSelected(book.chapters.map(ch => ch.id))}>Seleccionar todos</button><span>·</span><button className="text-button" disabled={running} onClick={() => setSelected([])}>Ninguno</button><small>{selected.length} de {book.chapters.length} seleccionados</small></div>
              <div className="chapter-list">{book.chapters.map((chapter, idx) => <label className={`chapter-row ${selectedIds.has(chapter.id) ? 'chosen' : ''}`} key={chapter.id}>
                <input type="checkbox" disabled={running} checked={selectedIds.has(chapter.id)} onChange={() => toggleChapter(chapter.id)} />
                <span className="custom-check"><Check size={12} /></span>
                <span className="chapter-index">{String(idx + 1).padStart(2, '0')}</span>
                <span className="chapter-title">{chapter.title}<small>{formatChars(chapter.charCount)} caracteres · {chunkCounts[chapter.id]} fragmentos</small></span>
                {readyChapters.includes(chapter.id) && <span className="ready-label"><Check size={12}/> Listo</span>}
              </label>)}</div>
            </>}
          </section>}
        </div>

        <aside className="workspace-side">
          <section className="panel voice-panel">
            <SectionHeading number={book ? '03' : '02'} title="Configurar narrador" subtitle="Voces naturales generadas con ElevenLabs." />
            <div className="setting-field"><label htmlFor="access-pin"><LockKeyhole size={15} /> PIN privado de acceso</label>
              <div className="pin-row"><input id="access-pin" type="password" placeholder="PIN configurado en Vercel" autoComplete="off" value={pin} onChange={e => { setPin(e.target.value); setConnected(false); }} disabled={running} /><button className="btn connect-btn" disabled={!pin || connecting || running} onClick={connect}>{connecting ? <LoaderCircle className="spin" size={16} /> : connected ? <Check size={16} /> : <KeyRound size={16} />}{connected ? 'Conectado' : 'Conectar'}</button></div>
            </div>
            <div className="setting-field"><label htmlFor="model-select"><WandSparkles size={15} /> Modelo de narración</label><div className="select-wrap"><select id="model-select" value={model} disabled={running} onChange={e => { setModel(e.target.value); setPreviewUrl(''); }}>{MODEL_CHOICES.map(option => <option value={option.id} key={option.id}>{option.name} — {option.subtitle}</option>)}</select><ChevronDown size={18}/></div><small className="field-note">{MODEL_CHOICES.find(m => m.id === model)?.tag} · El coste depende de tu plan de ElevenLabs.</small></div>
            <div className="setting-field"><label htmlFor="voice-select"><Mic2 size={15} /> Voz del narrador</label><div className="select-wrap"><select id="voice-select" disabled={!connected || running} value={voiceId} onChange={e => { setVoiceId(e.target.value); setManualVoice(''); setPreviewUrl(''); }}><option value="">{connected ? 'Selecciona una voz…' : 'Conecta tu cuenta primero…'}</option>{voices.map(v => <option value={v.voice_id} key={v.voice_id}>{v.name}{v.labels?.accent ? ` (${v.labels.accent})` : ''}</option>)}</select><ChevronDown size={18}/></div>
              <small className="field-note">Busca voces de español en tu biblioteca de ElevenLabs. <a href="https://elevenlabs.io/app/voice-library" target="_blank" rel="noopener noreferrer">Explorar biblioteca ↗</a></small>
              <details className="advanced-field"><summary>¿Tienes un ID de voz específico?</summary><input aria-label="ID de voz de ElevenLabs" placeholder="Pega aquí el voice_id" value={manualVoice} disabled={running} onChange={e => { setManualVoice(e.target.value); setPreviewUrl(''); }} /></details>
            </div>
            {connected && chosenVoice && <div className="voice-preview"><div className="preview-icon"><Volume2 size={21}/></div><div className="preview-copy"><b>{voices.find(v => v.voice_id === chosenVoice)?.name || 'Voz personalizada'}</b><span>Prueba cómo suena tu narrador</span></div><button className="preview-play" aria-label="Generar muestra de voz" title="Generar muestra (consume créditos)" disabled={previewBusy || running} onClick={preview}>{previewBusy ? <LoaderCircle className="spin" size={17}/> : <Play size={18} fill="currentColor"/>}</button></div>}
            {previewUrl && <audio className="audio-preview-player" src={previewUrl} controls preload="auto" aria-label="Escuchar prueba de voz" />}
            <div className="privacy-tip"><ShieldCheck size={17}/><p>Tu EPUB se analiza en el dispositivo. Solo se envían a ElevenLabs los textos elegidos para narrar.</p></div>
          </section>

          <section className="panel summary-panel">
            <h3><FileAudio2 size={20} /> Tu audiolibro</h3>
            <div className="summary-line"><span>Secciones</span><strong>{selected.length}</strong></div>
            <div className="summary-line"><span>Caracteres</span><strong>{formatChars(selectedChars)}</strong></div>
            <div className="summary-line"><span>Duración estimada</span><strong>{selectedChars ? secondsToApproxDuration(selectedChars) : '—'}</strong></div>
            <div className="summary-line"><span>Formato de salida</span><strong>MP3 · 128 kbps</strong></div>
            <p className="cost-note"><CircleAlert size={15}/> La conversión utiliza créditos de tu cuenta de ElevenLabs. Haz una prueba de voz primero.</p>
            {running ? <button className="btn btn-primary large" onClick={() => { runRef.current = false; setStopping(true); }} disabled={stopping}><Pause size={18} />{stopping ? 'Pausando al terminar…' : 'Pausar conversión'}</button> : <button className="btn btn-primary large" disabled={!canConvert} onClick={convert}><Sparkles size={18} /> {progress.done ? 'Reanudar / verificar audio' : 'Convertir a audiolibro'}</button>}
            <div className="conversion-hint">{!book ? 'Primero importa un libro EPUB' : !connected ? 'Conecta tu cuenta con el PIN' : !chosenVoice ? 'Selecciona una voz' : !selected.length ? 'Selecciona algún capítulo' : 'Procesamiento secuencial y recuperable'}</div>
            {progress.total > 0 && <div className="progress-area"><div className="progress-top"><span>{running ? 'Convirtiendo…' : 'Último avance'}</span><strong>{percent}%</strong></div><div className="progress-rail"><div className="progress-fill" style={{ width: `${percent}%` }}/></div><small>{formatChars(progress.done)} / {formatChars(progress.total)} fragmentos · {progress.title}</small></div>}
          </section>
        </aside>
      </div>

      {book && readyChapters.length > 0 && <section className="panel downloads-panel"><div className="downloads-heading"><div><div className="hero-eyebrow"><CheckCircle2 size={15}/> AUDIOS DISPONIBLES</div><h2>Tu colección de MP3</h2><p>{doneCount} de {selected.length} capítulos seleccionados preparados para descargar.</p></div><button className="btn btn-primary" disabled={makingZip || running || !doneCount} onClick={downloadAll}>{makingZip ? <LoaderCircle className="spin" size={17}/> : <CloudDownload size={17}/>} {makingZip ? `Empaquetando ${zipProgress}%` : 'Descargar capítulos en ZIP'}</button></div>
        <div className="download-list">{selectedChapters.filter(ch => readyChapters.includes(ch.id)).map(ch => <div className="download-row" key={ch.id}><span className="download-file-icon"><FileAudio2 size={20}/></span><div><strong>{filenameForChapter(ch, ch.id)}</strong><small>MP3 · Capítulo completo</small></div><button className="btn btn-secondary" disabled={makingZip || running} onClick={() => downloadChapter(ch)}><CloudDownload size={16}/> Descargar</button></div>)}</div>
      </section>}

      <footer className="site-footer"><div><AudioLines size={20}/> <strong>VozLibro</strong> · EPUB a audiolibro con IA</div><button disabled={running || makingZip} onClick={clearCache}><Trash2 size={15}/> Borrar audios locales</button><span>Para contenido propio o con permiso de uso. No compatible con DRM.</span></footer>
    </main>
  </div>;
}
