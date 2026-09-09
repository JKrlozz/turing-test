(function () {
  const h = React.createElement;
  const PRIVACY = 'Para esta prueba usamos OpenAI y Cartesia para generar las respuestas y la voz. Evita compartir datos personales y, si necesitas hablar de alguien, usa un nombre inventado.';

  function AudioReply({ url, label, chatName, autoPlay }) {
    const audio = React.useRef(null);
    const [failed, setFailed] = React.useState(false);
    const [playing, setPlaying] = React.useState(false);
    const [loading, setLoading] = React.useState(false);
    const [autoplayBlocked, setAutoplayBlocked] = React.useState(false);
    React.useEffect(() => {
      if (!autoPlay) return;
      const player = audio.current;
      let cancelled = false;
      document.querySelectorAll('audio').forEach((other) => { if (other !== player) other.pause(); });
      setLoading(true);
      player.play().catch((error) => {
        if (cancelled) return;
        if (error.name === 'NotAllowedError') setAutoplayBlocked(true);
        else setFailed(true);
      }).finally(() => { if (!cancelled) setLoading(false); });
      return () => { cancelled = true; player.pause(); };
    }, [url, autoPlay]);
    async function toggle() {
      const player = audio.current;
      if (!player.paused) return player.pause();
      document.querySelectorAll('audio').forEach((other) => { if (other !== player) other.pause(); });
      setLoading(true);
      setFailed(false);
      setAutoplayBlocked(false);
      try {
        if (player.error) player.load();
        await player.play();
      } catch (_) {
        setFailed(true);
      } finally {
        setLoading(false);
      }
    }
    return h('div', { className: 'audio-reply' },
      h('span', { className: 'message-meta' }, chatName),
      h('audio', { ref: audio, src: url, hidden: true, preload: 'none', onPlay: () => setPlaying(true), onPause: () => setPlaying(false), onEnded: () => setPlaying(false), onError: () => { setFailed(true); setPlaying(false); setLoading(false); } }),
      h('button', { className: 'button audio-button', type: 'button', onClick: toggle, disabled: loading,
        'aria-label': `${loading ? 'Cargando' : playing ? 'Pausar' : failed ? 'Reintentar' : 'Reproducir'} ${label}`, title: playing ? 'Pausar audio' : 'Reproducir audio', 'aria-busy': loading },
        h('svg', { viewBox: '0 0 24 24', width: 24, height: 24, fill: 'currentColor', 'aria-hidden': true },
          h('path', { d: playing ? 'M6 4h4v16H6zm8 0h4v16h-4z' : 'M7 4v16l14-8z' }))),
      failed && h('p', { role: 'alert' }, 'No se pudo reproducir. Pulsa el botón para reintentar.'),
      autoplayBlocked && h('p', { role: 'status' }, 'Pulsa el botón para escuchar; el navegador bloqueó la reproducción automática.')
    );
  }

  function TypingIndicator({ online }) {
    const [writing, setWriting] = React.useState(false);
    React.useEffect(() => {
      setWriting(false);
      if (!online) return;
      let timer;
      let visible = false;
      // Simulate writing and thinking pauses equally for both anonymous chats.
      function alternate() {
        visible = !visible;
        setWriting(visible);
        timer = setTimeout(alternate, visible ? 2000 + Math.random() * 4000 : 1500 + Math.random() * 3500);
      }
      timer = setTimeout(alternate, 1000 + Math.random() * 2500);
      return () => clearTimeout(timer);
    }, [online]);
    return h('div', { className: 'writing typing-indicator', role: 'status', 'aria-label': online && writing ? 'Escribiendo' : 'Esperando respuesta' },
      h('span', { className: 'dots', 'aria-hidden': true, style: { visibility: online && writing ? 'visible' : 'hidden' } }, h('span'), h('span'), h('span')));
  }

  function App() {
    const [state, setState] = React.useState(null);
    const [online, setOnline] = React.useState(false);
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState('');
    const [drafts, setDrafts] = React.useState({});
    const socket = React.useRef(null);
    const pending = React.useRef(null);
    const syncing = React.useRef(true);
    const bottom = React.useRef(null);

    React.useEffect(() => {
      const connection = io({ reconnection: true, reconnectionAttempts: Infinity });
      socket.current = connection;
      connection.on('connect', () => { syncing.current = true; connection.emit('evaluator_join'); });
      connection.on('disconnect', () => { syncing.current = true; setOnline(false); });
      connection.on('connect_error', () => { setOnline(false); setError('Sin conexión. Intentando reconectar; tu borrador se conserva.'); });
      connection.on('session_state', (data) => {
        const command = pending.current;
        const accepted = command && command.accepted(data);
        if (accepted && command.onAccepted) command.onAccepted();
        if (accepted || syncing.current || (command && command.sessionId !== data.sessionId)) {
          pending.current = null;
          setBusy(false);
        }
        const wasSyncing = syncing.current;
        syncing.current = false;
        setOnline(true);
        setState((previous) => {
          const latest = data.chats[data.chatIndex].turns.at(-1);
          const previousTurn = previous?.chats[data.chatIndex].turns.find((turn) => turn.id === latest?.id);
          const newAudio = !wasSyncing && previous?.sessionId === data.sessionId && latest?.audioUrl && previousTurn && !previousTurn.audioUrl;
          return { ...data, autoPlayTurnId: wasSyncing ? null : newAudio ? latest.id : previous?.autoPlayTurnId };
        });
      });
      // Never expose provider details from server errors to the evaluator.
      connection.on('app_error', () => {
        pending.current = null;
        setBusy(false);
        setError('No se pudo completar la acción. Tu borrador se conserva. Inténtalo de nuevo.');
      });
      return () => { connection.removeAllListeners(); connection.disconnect(); };
    }, []);

    const chat = state && state.chats[state.chatIndex];
    const turns = chat ? chat.turns : [];
    const progress = turns.map((turn) => `${turn.id}:${turn.status}:${turn.audioUrl || ''}`).join('|');
    React.useEffect(() => {
      if (bottom.current) {
        const list = bottom.current.parentElement;
        list.scrollTop = list.scrollHeight;
      }
    }, [state && state.sessionId, state && state.chatIndex, progress]);

    function command(event, payload, accepted, onAccepted) {
      if (!online || syncing.current || !socket.current.connected || pending.current || !state) return;
      pending.current = { sessionId: state.sessionId, accepted, onAccepted };
      setBusy(true);
      setError('');
      socket.current.emit(event, { sessionId: state.sessionId, ...payload });
    }

    const disabled = !online || busy;
    let page = h('main', { className: 'content waiting' }, 'Conectando con la sesión...');
    if (state) {
      const key = `${state.sessionId}:${state.chatIndex}`;
      const text = drafts[key] || '';
      const complete = turns.filter((turn) => turn.status === 'complete' && turn.audioUrl).length;
      const canAsk = state.status === 'active' && turns.length < state.limit && turns.every((turn) => turn.status === 'complete' && turn.audioUrl);
      if (state.status === 'intro') page = h('main', { className: 'content intro-grid' },
        h('section', { className: 'intro-copy' },
          h('div', { className: 'eyebrow' }, 'Experimento de conversación'),
          h('h1', null, '¿Quién está del otro lado?'),
           h('p', { className: 'lead' }, 'Vas a conversar con una persona y con una inteligencia artificial, sin saber cuál es cuál. Antes de empezar, piensa cinco preguntas que te gustaría hacerles a las dos.'),
           h('p', { className: 'objective' }, 'Primero hablarás con el Chat A y después con el Chat B. Hazles las mismas preguntas y fíjate en cómo te responden. Cuando termines, tendrás que elegir en cuál de los dos crees que estaba la persona real.'),
          h('p', { className: 'privacy-note' }, PRIVACY)),
        h('section', { className: 'card instructions-card' },
           h('div', { className: 'eyebrow' }, 'Antes de comenzar'), h('h2', null, 'Así funciona la conversación'),
           h('p', null, 'Escribe tu primera pregunta y espera la respuesta antes de mandar la siguiente. La escucharás en un mensaje de voz que podrás reproducir las veces que quieras. Tienes cinco mensajes para cada chat; cuando termines con el primero, aparecerá un botón para pasar al segundo. Tómate tu tiempo para escuchar y comparar antes de elegir.'),
          h('p', { className: 'instruction-status', role: 'status' }, !state.configured ? 'Esperando la configuración de la sesión.' : !state.operatorConnected || !state.operatorReady ? 'Esperando a que la sesión esté lista.' : 'Todo listo para comenzar.'),
          h('button', { className: 'button coral', disabled: disabled || !state.configured || !state.operatorConnected || !state.operatorReady, onClick: () => command('start_experiment', {}, (data) => data.status !== 'intro') }, 'Iniciar experimento')));
      if (state.status === 'active') page = h('main', { className: 'content conversation' },
        h('div', { className: 'experiment-head' },
          h('div', null, h('div', { className: 'eyebrow' }, 'Conversación en curso'), h('h2', null, `Chat ${chat.label}`)),
           h('span', { className: 'muted', role: 'status' }, state.limit - turns.length === 1 ? 'Te queda 1 mensaje' : `Te quedan ${state.limit - turns.length} mensajes`)),
        h('section', { className: 'card messenger', 'aria-label': `Conversación Chat ${chat.label}` },
          h('div', { className: 'message-list' },
            !turns.length && h('p', { className: 'waiting' }, state.chatIndex === 0 ? 'Escribe tu primera pregunta.' : 'Repite aquí tus cinco preguntas del Chat A.'),
            turns.map((turn, index) => h('div', { className: 'message-turn', key: turn.id },
              h('div', { className: 'message question-message' }, h('span', { className: 'message-meta' }, `Tú · Pregunta ${index + 1}`), h('p', null, turn.question)),
              h('div', { className: 'message reply-message' },
                turn.status === 'complete' && turn.audioUrl ? h(AudioReply, { key: turn.audioUrl, url: turn.audioUrl, chatName: `Chat ${chat.label}`, autoPlay: state.autoPlayTurnId === turn.id, label: `respuesta ${index + 1} del Chat ${chat.label}` }) :
                  turn.status === 'error' ? h(React.Fragment, null,
                    h('p', { role: 'status' }, 'No se pudo preparar la respuesta.'),
                    h('button', { className: 'button secondary', disabled, onClick: () => command('retry_response', { chatIndex: state.chatIndex, turnId: turn.id }, (data) => data.chats[state.chatIndex].turns.some((item) => item.id === turn.id && item.status !== 'error')) }, 'Reintentar respuesta')) :
                    h(TypingIndicator, { key: turn.id, online })))),
            h('div', { ref: bottom })),
          h('form', { className: 'message-composer', onSubmit: (event) => {
            event.preventDefault();
            if (!canAsk || !text.trim()) return;
            const count = turns.length;
            command('send_question', { chatIndex: state.chatIndex, expectedTurn: count, text: text.trim() },
              (data) => data.sessionId === state.sessionId && data.chats[state.chatIndex].turns.length > count,
              () => setDrafts((old) => old[key] === text ? { ...old, [key]: '' } : old));
          } },
          h('label', { htmlFor: 'question-text', className: 'choice-title' }, 'Tu pregunta'),
           h('input', { id: 'question-text', className: 'question-input', type: 'text', maxLength: 1000, autoComplete: 'off', value: text, disabled: busy || turns.length >= state.limit, onChange: (event) => setDrafts({ ...drafts, [key]: event.target.value }), placeholder: 'Escribe una pregunta...' }),
          h('div', { className: 'next-row' }, h('button', { className: 'button coral', type: 'submit', disabled: disabled || !canAsk || !text.trim() }, busy ? 'Enviando...' : 'Enviar pregunta')))),
        complete === state.limit && h('div', { className: 'next-row' }, h('button', { className: 'button', disabled, onClick: () => command('advance_chat', { chatIndex: state.chatIndex }, (data) => data.chatIndex !== state.chatIndex || data.status !== 'active') }, state.chatIndex === 0 ? 'Continuar al Chat B' : 'Elegir Chat A o B')));
      if (state.status === 'selection') page = h('main', { className: 'content conversation' }, h('section', { className: 'card final-card' },
        h('div', { className: 'eyebrow' }, 'Tu decisión'), h('h2', null, '¿Cuál chat era una persona?'),
        h('p', null, 'Selecciona una sola opción para terminar.'),
        h('div', { className: 'choice-row' }, ['A', 'B'].map((choice) => h('button', { key: choice, className: 'button choice', disabled, onClick: () => command('submit_guess', { choice }, (data) => data.status === 'closed') }, `Chat ${choice}`)))));
      if (state.status === 'closed') page = h('main', { className: 'content conversation' }, h('section', { className: 'card final-card' },
         h('div', { className: 'eyebrow' }, 'Sesión finalizada'), h('h2', null, `Chat ${state.humanChat} era la persona real`),
        h('p', null, 'Tu elección quedó registrada. Gracias por compartir tu impresión.'),
        h('button', { className: 'button', disabled, onClick: () => command('new_session', {}, (data) => data.sessionId !== state.sessionId) }, 'Nueva sesión')));
    }
    return h('div', { className: `shell${state && state.status === 'active' ? ' evaluator-chat-shell' : ''}` },
      h('header', { className: 'topbar' }, h('div', { className: 'brand' }, h('img', { className: 'school-logo', src: '/logo-itsm', alt: 'Logo ITSM' }), h('div', { className: 'brand-name' }, 'Turing / aula')),
        h('div', { className: 'connection', role: 'status' }, h('span', { className: `connection-dot ${online ? 'online' : ''}` }), online ? 'Conectado' : 'Reconectando...')),
      !online && h('div', { className: 'content connection-notice', role: 'status' }, 'Sin conexión o sincronizando. Los envíos están pausados; tu borrador se conserva.'),
      error && h('div', { className: 'content error', role: 'alert' }, error), page);
  }
  ReactDOM.createRoot(document.getElementById('root')).render(h(App));
})();
