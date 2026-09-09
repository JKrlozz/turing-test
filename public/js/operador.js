(function () {
  const h = React.createElement;

  function App() {
    const [state, setState] = React.useState(null);
    const [online, setOnline] = React.useState(false);
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState('');
    const [identity, setIdentity] = React.useState({ name: '', age: '', city: '' });
    const [drafts, setDrafts] = React.useState({});
    const socket = React.useRef(null);
    const pending = React.useRef(null);
    const syncing = React.useRef(true);
    const identitySession = React.useRef(null);
    const bottom = React.useRef(null);

    React.useEffect(() => {
      const connection = io({ reconnection: true, reconnectionAttempts: Infinity });
      socket.current = connection;
      connection.on('connect', () => { syncing.current = true; connection.emit('operator_join'); });
      connection.on('disconnect', () => { syncing.current = true; setOnline(false); });
      connection.on('connect_error', () => { setOnline(false); setError('Sin conexión. Intentando reconectar; tus borradores se conservan.'); });
      connection.on('operator_state', (data) => {
        const command = pending.current;
        const accepted = command && command.accepted(data);
        if (accepted && command.onAccepted) command.onAccepted();
        if (accepted || syncing.current || (command && command.sessionId !== data.sessionId)) {
          pending.current = null;
          setBusy(false);
        }
        if (identitySession.current !== data.sessionId) {
          identitySession.current = data.sessionId;
          setIdentity({ name: '', age: '', city: '', ...data.identity });
        }
        syncing.current = false;
        setOnline(true);
        setState(data);
      });
      connection.on('app_error', (data) => {
        pending.current = null;
        setBusy(false);
        setError(data.message || 'No se pudo completar la acción. Tu borrador se conserva.');
      });
      return () => { connection.removeAllListeners(); connection.disconnect(); };
    }, []);

    const history = state ? state.humanHistory : [];
    const turn = state && state.currentTurn;
    React.useEffect(() => {
      if (bottom.current) bottom.current.scrollIntoView({ block: 'nearest' });
    }, [state && state.sessionId, history.length, turn && turn.id]);

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
      const intro = state.status === 'intro';
      const humanActive = state.status === 'active' && state.chatIndex === state.humanChatIndex;
      const canAnswer = humanActive && state.canAnswer && turn;
      const key = `${state.sessionId}:${turn ? turn.id : 'waiting'}`;
      const text = drafts[key] || '';
      const words = text.trim() ? text.trim().split(/\s+/u).length : 0;
      const activeTurns = state.chats[state.chatIndex].turns;
      const failedTurn = activeTurns.find((item) => item.status === 'error');
      const shownIdentity = state.operatorReady ? state.identity || identity : identity;
      page = h('main', { className: 'content operator-layout' },
        h('section', { className: 'card operator-main' },
          h('div', { className: 'eyebrow' }, 'Panel del operador'),
          h('p', { className: 'instruction-text' }, h('strong', null, `Te corresponde el Chat ${state.chats[state.humanChatIndex].label}. `), 'Escribe aquí tus respuestas cuando el evaluador te envíe una pregunta.'),
          h('h2', null, intro ? 'Prepara tu identidad' : state.status === 'closed' ? 'Gracias por participar' : state.status === 'selection' ? 'Esperando la elección' : humanActive ? 'Tu conversación' : 'IA activa'),
          h('p', { className: 'muted', role: 'status' }, intro ? (state.operatorReady ? 'Estás listo. Espera a que el evaluador comience.' : 'Completa una identidad ficticia y confirma que estás listo.') : state.status !== 'active' ? 'El evaluador controla el siguiente paso.' : !humanActive ? 'Espera mientras la IA responde. No tienes que enviar nada.' : canAnswer ? 'Responde con naturalidad en un máximo de 35 palabras.' : 'Esperando la siguiente pregunta o la preparación del audio.'),
          state.status === 'active' && h('p', { className: 'muted' }, `Conversación activa: Chat ${state.chats[state.chatIndex].label} · ${activeTurns.length}/${state.limit} preguntas`),
          h('div', { className: 'operator-transcript', 'aria-label': 'Historial humano' },
            h('h3', null, 'Historial humano'),
            !history.length && h('p', { className: 'muted' }, 'Todavía no hay respuestas enviadas.'),
            history.map((item) => h('div', { className: 'history-item', key: item.id }, h('small', null, item.question), h('div', null, item.text))),
            humanActive && turn && h('div', { className: 'operator-question' }, h('div', { className: 'eyebrow' }, 'Pregunta actual'), h('h2', null, turn.question)),
            h('div', { ref: bottom })),
          humanActive && turn && h('form', { className: 'operator-form', onSubmit: (event) => {
            event.preventDefault();
            if (!canAnswer || words === 0 || words > 35) return;
            command('human_answer', { chatIndex: state.chatIndex, turnId: turn.id, text: text.trim() },
              (data) => data.sessionId === state.sessionId && (data.humanHistory.some((item) => item.id === turn.id) || (data.currentTurn && data.currentTurn.id === turn.id && !!data.currentTurn.text)),
              () => setDrafts((old) => old[key] === text ? { ...old, [key]: '' } : old));
          } },
          h('label', { className: 'choice-title', htmlFor: 'answer-text' }, 'Tu respuesta'),
           h('textarea', { id: 'answer-text', maxLength: 2000, value: text, onChange: (event) => setDrafts({ ...drafts, [key]: event.target.value }), disabled: busy || !canAnswer, rows: 4, 'aria-describedby': 'word-count', placeholder: 'Escribe tu respuesta...' }),
          h('p', { id: 'word-count', className: words > 35 ? 'word-count over-limit' : 'word-count', role: 'status' }, `${words}/35 palabras`),
          h('div', { className: 'button-row' }, h('button', { className: 'button coral', type: 'submit', disabled: disabled || !canAnswer || !words || words > 35 }, busy ? 'Enviando...' : 'Enviar respuesta'))),
          state.status === 'active' && failedTurn && h('div', { className: 'response-error' },
            h('p', { role: 'alert' }, state.responseError || 'No se pudo preparar la respuesta.'),
            h('button', { className: 'button secondary', disabled, onClick: () => command('retry_response', { chatIndex: state.chatIndex, turnId: failedTurn.id }, (data) => data.chats[state.chatIndex].turns.some((item) => item.id === failedTurn.id && item.status !== 'error')) }, 'Reintentar respuesta')),
          ),
        h('aside', { className: 'card identity-card' },
          h('div', { className: 'eyebrow' }, 'Identidad compartida'), h('h2', null, 'Tu personaje'),
          h('form', { onSubmit: (event) => {
            event.preventDefault();
            if (!intro || state.operatorReady || !identity.name.trim() || !identity.city.trim() || !identity.age) return;
            command('operator_ready', { name: identity.name.trim(), age: Number(identity.age), city: identity.city.trim() }, (data) => data.operatorReady);
          } },
          ['name', 'age', 'city'].map((field) => h(React.Fragment, { key: field },
            h('label', { className: 'identity-label', htmlFor: `identity-${field}` }, { name: 'Nombre', age: 'Edad', city: 'Ciudad' }[field]),
             h('input', { id: `identity-${field}`, className: 'identity-input', type: field === 'age' ? 'number' : 'text', required: true, min: field === 'age' ? 10 : undefined, max: field === 'age' ? 99 : undefined, maxLength: field === 'age' ? undefined : 40, step: field === 'age' ? 1 : undefined, value: shownIdentity[field] == null ? '' : shownIdentity[field], disabled: !intro || state.operatorReady || busy, onChange: (event) => setIdentity({ ...identity, [field]: event.target.value }) }))),
          intro && h('div', { className: 'button-row identity-actions' }, state.operatorReady ?
            h('button', { className: 'button secondary', type: 'button', disabled, onClick: () => {
              setIdentity({ ...shownIdentity });
              command('operator_unready', {}, (data) => !data.operatorReady);
            } }, 'Editar identidad') :
            h('button', { className: 'button coral', type: 'submit', disabled: disabled || !identity.name.trim() || !identity.city.trim() || !identity.age }, 'Confirmar que estoy listo')))));
    }
    return h('div', { className: 'shell' },
      h('header', { className: 'topbar' }, h('div', { className: 'brand' }, h('img', { className: 'school-logo', src: '/logo-itsm', alt: 'Logo ITSM' }), h('div', { className: 'brand-name' }, 'Turing / operador')),
        h('div', { className: 'connection', role: 'status' }, h('span', { className: `connection-dot ${online ? 'online' : ''}` }), online ? 'Conectado' : 'Reconectando...')),
      !online && h('div', { className: 'content connection-notice', role: 'status' }, 'Sin conexión o sincronizando. Los envíos están pausados; tus borradores se conservan.'),
      error && h('div', { className: 'content error', role: 'alert' }, error), page);
  }
  ReactDOM.createRoot(document.getElementById('root')).render(h(App));
})();
