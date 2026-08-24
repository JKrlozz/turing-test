(function () {
  const h = React.createElement;
  const INSTRUCTIONS = 'En este experimento verás dos chats, A y B. Haz las preguntas en orden y espera a que aparezcan las dos respuestas antes de continuar. Al terminar, decide cuál chat crees que respondió una persona real y escribe brevemente por qué. No compartas información personal durante la prueba.';
  const savedSessionKey = 'turing-evaluator-session';
  let socket;

  function Connection({ online, operatorConnected }) {
    return h('div', { className: 'connection' },
      h('span', { className: `connection-dot ${online ? 'online' : ''}` }),
      online ? (operatorConnected ? 'Operador conectado' : 'Esperando al operador') : 'Reconectando…'
    );
  }

  function Topbar({ online, operatorConnected }) {
    return h('header', { className: 'topbar' },
      h('div', { className: 'brand' }, h('img', { className: 'school-logo', src: '/logo-itsm', alt: 'Logo ITSM' }), h('div', { className: 'brand-name' }, 'Turing / aula')),
      h(Connection, { online, operatorConnected })
    );
  }

  function Writing() {
    return h('div', { className: 'writing' }, 'escribiendo', h('span', { className: 'dots' }, h('span'), h('span'), h('span')));
  }

  function ChatCard({ label, text, waiting }) {
    return h('article', { className: 'card chat-card' },
      h('div', { className: 'chat-head' }, h('div', { className: 'chat-label' }, label), waiting && !text ? h('span', { className: 'muted' }, '…') : h('span', { className: 'muted' }, 'listo')),
      h('div', { className: 'chat-body' }, text ? h('div', { className: 'response' }, text) : waiting ? h(Writing) : h('span', { className: 'muted' }, 'La respuesta aparecerá aquí'))
    );
  }

  function Intro({ state, online, onStart }) {
    const [visible, setVisible] = React.useState(false);
    const [playing, setPlaying] = React.useState(false);
    const [done, setDone] = React.useState(false);
    const utteranceRef = React.useRef(null);

    const playInstructions = () => {
      setVisible(true);
      setDone(false);
      setPlaying(true);
      if (!window.speechSynthesis) {
        setTimeout(() => { setPlaying(false); setDone(true); }, 9000);
        return;
      }
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(INSTRUCTIONS);
      utterance.lang = 'es-MX';
      utterance.rate = 0.93;
      utterance.pitch = 1;
      utterance.onend = () => { setPlaying(false); setDone(true); };
      utterance.onerror = () => { setPlaying(false); setDone(true); };
      utteranceRef.current = utterance;
      window.speechSynthesis.speak(utterance);
    };

    React.useEffect(() => () => {
      if (window.speechSynthesis) window.speechSynthesis.cancel();
    }, []);

    return h('main', { className: 'content intro-grid' },
      h('section', { className: 'intro-copy' },
        h('div', { className: 'eyebrow' }, 'Experimento de conversación'),
        h('h1', null, '¿Quién está del otro lado?'),
        h('p', { className: 'lead' }, 'Haz diez preguntas. Lee dos respuestas. Después, confía en tu intuición.'),
        h('p', { className: 'objective' }, h('strong', null, 'Objetivo de la prueba: '), 'observar si puedes distinguir una conversación respondida por una persona real de otra generada por una IA, basándote únicamente en el estilo y el contenido.'),
        h('p', { className: 'session-note' }, 'Sesión: ', h('span', { className: 'session-code' }, state.sessionId || 'preparando…')),
        h('p', { className: 'privacy-note' }, 'Las etiquetas A y B son neutrales durante toda la prueba.')
      ),
      h('section', { className: 'card instructions-card' },
        h('div', { className: 'eyebrow' }, 'Antes de comenzar'),
        h('h2', null, 'Escucha las instrucciones'),
        h('p', null, 'Puedes iniciar directamente. Si pulsas Instrucciones, el inicio se pausará hasta que termine el audio. Puedes subir el volumen de la laptop.'),
        visible && h('div', { className: 'instruction-text', 'aria-live': 'polite' }, INSTRUCTIONS),
        h('div', { className: 'instruction-status' }, playing ? 'Reproduciendo instrucciones…' : done ? 'Instrucciones terminadas.' : state.operatorReady ? 'El operador confirmó que está listo.' : 'Esperando confirmación del operador.'),
        h('div', { className: 'button-row' },
          h('button', { className: 'button secondary', onClick: playInstructions, disabled: playing }, playing ? 'Reproduciendo…' : 'Instrucciones'),
          h('button', { className: 'button coral', onClick: onStart, disabled: playing || !online || !state.operatorReady }, 'Iniciar experimento')
        ),
      )
    );
  }

  function Experiment({ state, response, waiting, onNext }) {
    const answered = state.answers.length;
    return h('main', { className: 'content' },
      h('div', { className: 'experiment-head' },
        h('div', null, h('div', { className: 'eyebrow' }, 'Ronda en curso'), h('h2', null, `Pregunta ${state.questionIndex + 1} de ${state.totalQuestions}`)),
        h('span', { className: 'muted' }, `${answered} ${answered === 1 ? 'respuesta doble' : 'respuestas dobles'}`)
      ),
      h('section', { className: 'question-panel' }, h('div', { className: 'eyebrow' }, 'Pregunta para ambos chats'), h('h2', null, state.question)),
      h('div', { className: 'chat-grid' },
        h(ChatCard, { label: 'Chat A', text: response && response.sideA, waiting }),
        h(ChatCard, { label: 'Chat B', text: response && response.sideB, waiting })
      ),
      h('div', { className: 'next-row' }, h('button', { className: 'button', onClick: onNext, disabled: waiting }, state.questionIndex + 1 === state.totalQuestions ? 'Ver resultado' : 'Siguiente pregunta')),
      state.answers.length > 0 && h('details', { className: 'progress-list' },
        h('summary', null, 'Ver respuestas anteriores'),
        state.answers.map((answer) => h('div', { className: 'progress-item', key: answer.index },
          h('span', null, String(answer.index + 1).padStart(2, '0')),
          h('div', null, h('strong', null, 'Chat A'), h('p', null, answer.sideA)),
          h('div', null, h('strong', null, 'Chat B'), h('p', null, answer.sideB))
        ))
      )
    );
  }

  function FinalScreen({ state, choice, setChoice, justification, setJustification, onSubmit }) {
    return h('main', { className: 'content' },
      h('section', { className: 'card final-card' },
        h('div', { className: 'eyebrow' }, 'Fin de la ronda'),
        h('h2', null, 'Tu decisión'),
        h('p', null, '¿Cuál de los dos chats crees que era la persona real? No hay una respuesta correcta: nos interesa tu impresión.'),
        h('div', { className: 'choice-row' },
          h('button', { className: `button choice ${choice === 'A' ? 'selected' : ''}`, onClick: () => setChoice('A') }, h('strong', null, 'Chat A'), h('br'), 'era la persona real'),
          h('button', { className: `button choice ${choice === 'B' ? 'selected' : ''}`, onClick: () => setChoice('B') }, h('strong', null, 'Chat B'), h('br'), 'era la persona real')
        ),
        h('label', { className: 'choice-title', htmlFor: 'justification' }, '¿Por qué elegiste esa opción?'),
        h('textarea', { id: 'justification', value: justification, onChange: (event) => setJustification(event.target.value), rows: 5, placeholder: 'Escribe aquí las señales que notaste…' }),
        h('div', { className: 'button-row', style: { marginTop: '14px' } }, h('button', { className: 'button coral', onClick: onSubmit, disabled: !choice }, 'Revelar resultado')),
        h('details', { className: 'progress-list' },
          h('summary', null, 'Revisar respuestas'),
          state.answers.map((answer) => h('div', { className: 'progress-item', key: answer.index },
            h('span', null, String(answer.index + 1).padStart(2, '0')),
            h('div', null, h('strong', null, 'Chat A'), h('p', null, answer.sideA)),
            h('div', null, h('strong', null, 'Chat B'), h('p', null, answer.sideB))
          ))
        )
      )
    );
  }

  function Reveal({ reveal, state, onNewSession }) {
    return h('main', { className: 'content' },
      h('section', { className: 'reveal-banner' },
        h('div', { className: 'eyebrow' }, 'Revelación'),
        h('h2', null, `Chat ${reveal.humanSide} era la persona real`),
        h('p', null, `Chat ${reveal.aiSide} era la IA. Tu elección fue Chat ${reveal.choice}.`),
        h('p', null, reveal.justification ? `Tu explicación: “${reveal.justification}”` : 'No se añadió una explicación.')
      ),
      h('div', { className: 'final-grid' },
        h('section', { className: 'card final-card' }, h('h3', null, 'La identidad compartida'), h('p', { className: 'muted' }, `${reveal.identity.name}, ${reveal.identity.age} años, de ${reveal.identity.city}. Esta identidad se mostró al operador y se dio a la IA.`)),
        h('section', { className: 'card question-editor' }, h('h3', null, 'Resumen'), h('p', { className: 'helper' }, `${state.answers.length} preguntas registradas. La sesión se guardó en el servidor.`), h('button', { className: 'button', onClick: onNewSession }, 'Nueva sesión'))
      )
    );
  }

  function App() {
    const [state, setState] = React.useState({ status: 'loading', questions: [], answers: [], online: false, operatorConnected: false });
    const [response, setResponse] = React.useState(null);
    const [waiting, setWaiting] = React.useState(true);
    const [reveal, setReveal] = React.useState(null);
    const [choice, setChoice] = React.useState(null);
    const [justification, setJustification] = React.useState('');
    const [error, setError] = React.useState('');

    const applyState = (data) => {
      const currentResponse = (data.answers || []).find((answer) => answer.index === data.questionIndex) || null;
      setState((old) => ({ ...old, ...data }));
      setResponse(currentResponse);
      setWaiting(data.status === 'active' && !currentResponse);
      setError('');
    };

    React.useEffect(() => {
      socket = io({ reconnection: true, reconnectionAttempts: Infinity });
      socket.on('connect', () => {
        setState((old) => ({ ...old, online: true }));
        const oldSession = localStorage.getItem(savedSessionKey);
        if (oldSession) socket.emit('evaluator_join', oldSession);
        else socket.emit('create_session');
      });
      socket.on('disconnect', () => setState((old) => ({ ...old, online: false })));
      socket.on('session_ready', (data) => { localStorage.setItem(savedSessionKey, data.sessionId); applyState(data); });
      socket.on('session_state', applyState);
      socket.on('session_expired', (data) => {
        localStorage.removeItem(savedSessionKey);
        setError(data.message || 'La sesión anterior terminó. Preparando una nueva…');
        socket.emit('create_session');
      });
      socket.on('connection_state', (data) => setState((old) => ({ ...old, operatorConnected: data.operatorConnected, operatorReady: data.operatorReady })));
      socket.on('round_started', (data) => {
        setState((old) => ({ ...old, status: 'active', questionIndex: data.index, totalQuestions: data.totalQuestions, question: data.question }));
        setResponse(null);
        setWaiting(true);
        setError('');
      });
      socket.on('human_response_early', (data) => {
        setResponse(data);
        setWaiting(true);
      });
      socket.on('round_complete', (data) => {
        setResponse(data);
        setWaiting(false);
        setState((old) => ({ ...old, answers: [...old.answers.filter((answer) => answer.index !== data.index), data].sort((a, b) => a.index - b.index) }));
      });
      socket.on('experiment_finished', (data) => { applyState({ ...data, status: 'finished' }); setWaiting(false); });
      socket.on('questions_updated', applyState);
      socket.on('reveal', (data) => setReveal(data));
      socket.on('app_error', (data) => setError(data.message || 'Ocurrió un error.'));
      return () => socket.disconnect();
    }, []);

    const start = () => { setError(''); socket.emit('start_experiment'); };
    const next = () => { setError(''); socket.emit('next_question'); };
    const submit = () => { setError(''); socket.emit('submit_guess', { choice, justification }); };
    const newSession = () => { localStorage.removeItem(savedSessionKey); setReveal(null); setChoice(null); setJustification(''); socket.emit('create_session'); };

    let page;
    if (state.status === 'loading') page = h('main', { className: 'content waiting' }, 'Conectando con el servidor…');
    else if (reveal) page = h(Reveal, { reveal, state, onNewSession: newSession });
    else if (state.status === 'intro') page = h(Intro, { state, online: state.online, onStart: start });
    else if (state.status === 'active') page = h(Experiment, { state, response, waiting, onNext: next });
    else page = h(FinalScreen, { state, choice, setChoice, justification, setJustification, onSubmit: submit });

    return h('div', { className: 'shell' }, h(Topbar, { online: state.online, operatorConnected: state.operatorConnected }), error && h('div', { className: 'content error', role: 'alert' }, error), page);
  }

  ReactDOM.createRoot(document.getElementById('root')).render(h(App));
})();
