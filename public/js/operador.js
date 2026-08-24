(function () {
  const h = React.createElement;
  const storageKey = 'turing-operator-session';
  let socket;

  function Connection({ online }) {
    return h('div', { className: 'connection' }, h('span', { className: `connection-dot ${online ? 'online' : ''}` }), online ? 'Conectado' : 'Reconectando…');
  }

  function Topbar({ online }) {
    return h('header', { className: 'topbar' }, h('div', { className: 'brand' }, h('img', { className: 'school-logo', src: '/logo-itsm', alt: 'Logo ITSM' }), h('div', { className: 'brand-name' }, 'Turing / operador')), h(Connection, { online }));
  }

  function QuestionEditor({ questions, onChange, onApply }) {
    const addQuestion = () => onChange([...questions, '']);
    const removeQuestion = (index) => onChange(questions.filter((_, current) => current !== index));
    const editQuestion = (index, value) => onChange(questions.map((question, current) => current === index ? value : question));
    return h('section', { className: 'card question-editor operator-question-editor' },
      h('h3', null, 'Preguntas de la sesión'),
      h('p', { className: 'helper' }, 'Puedes quitar o añadir preguntas antes de confirmar que estás listo.'),
      questions.map((question, index) => h('div', { className: 'question-row', key: index },
        h('input', { className: 'question-input', value: question, onChange: (event) => editQuestion(index, event.target.value), 'aria-label': `Pregunta ${index + 1}` }),
        h('button', { className: 'remove', onClick: () => removeQuestion(index), disabled: questions.length === 1, title: 'Eliminar pregunta', 'aria-label': 'Eliminar pregunta' }, '×')
      )),
      h('div', { className: 'button-row' },
        h('button', { className: 'button secondary', onClick: addQuestion }, '+ Añadir pregunta'),
        h('button', { className: 'button', onClick: () => onApply(questions), disabled: questions.some((question) => !question.trim()) }, 'Guardar preguntas')
      )
    );
  }

  function IdentityCard({ identity, draft, ready, answers, onDraftChange, onSave, onReady, onUnready }) {
    const update = (field, value) => onDraftChange({ ...draft, [field]: value });
    return h('aside', { className: 'card identity-card' },
      h('div', { className: 'eyebrow' }, ready ? 'Personaje confirmado' : 'Configura tu personaje'),
      h('h2', null, ready ? identity.name : 'Tu identidad'),
      h('label', { className: 'identity-label', htmlFor: 'operator-name' }, 'Nombre'),
      h('input', { id: 'operator-name', className: 'identity-input', value: draft.name, onChange: (event) => update('name', event.target.value), disabled: ready, maxLength: 40 }),
      h('label', { className: 'identity-label', htmlFor: 'operator-age' }, 'Edad'),
      h('input', { id: 'operator-age', className: 'identity-input', type: 'number', min: 10, max: 99, value: draft.age, onChange: (event) => update('age', event.target.value), disabled: ready }),
      h('label', { className: 'identity-label', htmlFor: 'operator-city' }, 'Ciudad'),
      h('input', { id: 'operator-city', className: 'identity-input', value: draft.city, onChange: (event) => update('city', event.target.value), disabled: ready, maxLength: 40 }),
      h('p', { className: 'privacy-note' }, 'Estos datos se compartirán con la IA para que ambos lados mantengan la misma identidad. No uses tus datos reales.'),
      h('div', { className: 'button-row identity-actions' },
        !ready && h('button', { className: 'button secondary', onClick: onSave }, 'Guardar datos'),
        h('button', { className: `button ${ready ? 'secondary' : 'coral'}`, onClick: ready ? onUnready : onReady }, ready ? 'Editar identidad' : 'Confirmar que estoy listo')
      ),
      answers.length > 0 && h('div', { className: 'operator-history' },
        h('h3', null, 'Lo que ya dijiste'),
        answers.map((answer) => h('div', { className: 'history-item', key: answer.index }, h('small', null, `Pregunta ${answer.index + 1}: ${answer.question}`), h('div', null, answer.text)))
      )
    );
  }

  function App() {
    const [state, setState] = React.useState({ status: 'loading', answers: [], questions: [], online: false, identity: null, operatorReady: false, humanAnswered: false });
    const [draft, setDraft] = React.useState({ name: '', age: '', city: '' });
    const [questionDraft, setQuestionDraft] = React.useState([]);
    const [text, setText] = React.useState('');
    const [error, setError] = React.useState('');

    React.useEffect(() => {
      if (state.identity && !state.operatorReady) setDraft({ name: state.identity.name, age: state.identity.age, city: state.identity.city });
    }, [state.identity, state.operatorReady]);

    React.useEffect(() => {
      if (state.questions.length) setQuestionDraft(state.questions);
    }, [state.questions]);

    React.useEffect(() => {
      socket = io({ reconnection: true, reconnectionAttempts: Infinity });
      const querySession = new URLSearchParams(window.location.search).get('session');
      const storedSession = querySession || localStorage.getItem(storageKey);
      socket.on('connect', () => {
        setState((old) => ({ ...old, online: true }));
        socket.emit('operator_join', storedSession || null);
      });
      socket.on('disconnect', () => setState((old) => ({ ...old, online: false })));
      socket.on('operator_state', (data) => {
        localStorage.setItem(storageKey, data.sessionId);
        setState((old) => ({ ...old, ...data }));
      });
      socket.on('question_started', (data) => {
        setText('');
        setState((old) => ({ ...old, status: 'active', questionIndex: data.index, totalQuestions: data.totalQuestions, question: data.question, humanAnswered: false }));
      });
      socket.on('human_answer_accepted', () => setState((old) => ({ ...old, humanAnswered: true })));
      socket.on('app_error', (data) => setError(data.message || 'Ocurrió un error.'));
      return () => socket.disconnect();
    }, []);

    const send = (event) => {
      event.preventDefault();
      const clean = text.trim();
      if (!clean || state.humanAnswered || state.status !== 'active') return;
      setError('');
      socket.emit('human_answer', { text: clean });
    };
    const saveIdentity = () => { setError(''); socket.emit('update_identity', draft); };
    const confirmReady = () => { setError(''); socket.emit('operator_ready', draft); };
    const editIdentity = () => { setError(''); socket.emit('operator_unready'); };
    const saveQuestions = (questions) => { setError(''); socket.emit('update_questions', { questions }); };

    let content;
    if (state.status === 'loading') {
      content = h('main', { className: 'content waiting' }, 'Conectando con la sesión…');
    } else {
      const canAnswer = state.status === 'active' && !state.humanAnswered;
      const intro = state.status === 'intro';
      content = h('main', { className: 'content operator-layout' },
        h('section', { className: 'card operator-main' },
          h('div', { className: 'eyebrow' }, state.status === 'active' ? `Pregunta ${state.questionIndex + 1} de ${state.totalQuestions}` : 'Panel del operador'),
          h('h2', null, state.status === 'active' ? 'Escribe tu respuesta' : state.status === 'finished' ? 'El experimento terminó' : state.operatorReady ? 'Estás listo' : 'Prepara la sesión'),
          state.status === 'active' ? h('div', { className: 'operator-question' }, h('div', { className: 'eyebrow' }, 'Pregunta actual'), h('h2', null, state.question)) : h('div', { className: 'waiting' }, intro ? 'Configura tu identidad, revisa las preguntas y confirma cuando estés listo.' : 'El evaluador iniciará la siguiente sesión desde su laptop.'),
          state.status === 'active' && h('form', { className: 'operator-form', onSubmit: send },
            h('textarea', { value: text, onChange: (event) => setText(event.target.value), disabled: !canAnswer, placeholder: canAnswer ? 'Escribe de forma natural…' : 'Respuesta enviada', maxLength: 2000, autoFocus: true }),
            h('div', { className: 'button-row' }, h('button', { className: 'button coral', type: 'submit', disabled: !canAnswer || !text.trim() }, state.humanAnswered ? 'Enviada' : 'Enviar respuesta'))
          ),
          intro && h(QuestionEditor, { questions: questionDraft, onChange: setQuestionDraft, onApply: saveQuestions }),
          h('p', { className: 'privacy-note' }, 'La respuesta se envía únicamente al servidor local. No escribas tu nombre real ni datos personales.')
        ),
        h(IdentityCard, { identity: state.identity || { name: '', age: '', city: '' }, draft, ready: state.operatorReady, answers: state.answers || [], onDraftChange: setDraft, onSave: saveIdentity, onReady: confirmReady, onUnready: editIdentity })
      );
    }
    return h('div', { className: 'shell' }, h(Topbar, { online: state.online }), error && h('div', { className: 'content error', role: 'alert' }, error), content);
  }

  ReactDOM.createRoot(document.getElementById('root')).render(h(App));
})();
