require('dotenv').config();

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const OpenAI = require('openai');

const PORT = Number(process.env.PORT || 3000);
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const MAX_TOKENS = Number(process.env.OPENAI_MAX_TOKENS || 100);
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data', 'sesiones');
const PUBLIC_DIR = path.join(ROOT, 'public');

const QUESTIONS = [
  '¿Qué cosa pequeña te alegró esta semana?',
  'Si pudieras aprender algo nuevo este año, ¿qué elegirías?',
  '¿Qué actividad hace que pierdas la noción del tiempo?',
  '¿Prefieres trabajar en equipo o por tu cuenta?',
  '¿Qué opinas de que las clases empiecen más tarde?',
  'Cuéntame una situación en la que hayas cambiado de opinión.',
  '¿Qué haces normalmente cuando tienes un día difícil?',
  '¿Qué invento te parece más útil en la vida diaria?',
  '¿Qué película, serie o libro recuerdas especialmente?',
  '¿Cómo imaginas tu vida dentro de diez años?'
];

const NAMES = ['Alex', 'Sam', 'Dani', 'Nico', 'Vale', 'Cris', 'Mara', 'Leo', 'Noa', 'Iris'];
const CITIES = ['Guadalajara', 'Monterrey', 'Puebla', 'Merida', 'Queretaro', 'Tijuana', 'Bogota', 'Lima', 'Santiago', 'Medellin'];

const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: { origin: true, credentials: true },
  pingInterval: 10000,
  pingTimeout: 20000
});

let currentSession = null;
let sessionCounter = 0;
const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

function randomItem(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function createIdentity() {
  return {
    name: randomItem(NAMES),
    age: 15 + Math.floor(Math.random() * 6),
    city: randomItem(CITIES)
  };
}

function makeId() {
  return `${Date.now().toString(36)}-${(++sessionCounter).toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function normalizeQuestions(value) {
  if (!Array.isArray(value)) return null;
  const cleaned = value
    .map((question) => String(question || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, 30);
  return cleaned.length ? cleaned : null;
}

function normalizeIdentity(payload) {
  const name = String(payload.name || '').replace(/\s+/g, ' ').trim().slice(0, 40);
  const city = String(payload.city || '').replace(/\s+/g, ' ').trim().slice(0, 40);
  const age = Number(payload.age);
  if (!name || !city || !Number.isInteger(age) || age < 10 || age > 99) return null;
  return { name, age, city };
}

function createSession() {
  const aiSide = Math.random() < 0.5 ? 'A' : 'B';
  return {
    id: makeId(),
    createdAt: new Date().toISOString(),
    identity: createIdentity(),
    aiSide,
    questions: [...QUESTIONS],
    answers: [],
    removedAnswers: [],
    aiHistory: [],
    status: 'intro',
    currentIndex: -1,
    operatorReady: false,
    evaluatorSockets: new Set(),
    operatorSockets: new Set(),
    writeChain: Promise.resolve()
  };
}

function identityPrompt(identity) {
  return `Eres ${identity.name}, un estudiante de ${identity.age} años de ${identity.city}. Estás chateando informalmente
con alguien que no conoces. Responde como lo haría una persona real escribiendo rápido:
frases cortas, tono natural y amable, sin usar mayusculas ni acentos, no fuerces modismos, expresiones
anticuadas ni regionalismos extraños. No uses lenguaje robótico ni listas. Ten opiniones
propias, dudas y muletillas naturales ("o sea", "pues", "no sé"). Responde en 1-2 líneas,
con aproximadamente 8-22 palabras, salvo que la pregunta pida más. Nunca hagas preguntas
de vuelta ni pidas información al interlocutor: responde directamente. Mantén coherencia
total con tus respuestas anteriores en esta conversación y evita errores ortográficos obvios.`;
}

function sessionForSocket(socket) {
  return socket.data.sessionId && currentSession && currentSession.id === socket.data.sessionId
    ? currentSession
    : null;
}

function publicAnswers(session) {
  return session.answers
    .filter((answer) => answer.completed)
    .map((answer) => ({
      index: answer.index,
      question: answer.question,
      sideA: session.aiSide === 'A' ? answer.ai.text : answer.human.text,
      sideB: session.aiSide === 'B' ? answer.ai.text : answer.human.text,
      sideATimeMs: session.aiSide === 'A' ? answer.ai.responseTimeMs : answer.human.responseTimeMs,
      sideBTimeMs: session.aiSide === 'B' ? answer.ai.responseTimeMs : answer.human.responseTimeMs
    }));
}

function evaluatorState(session) {
  const current = session.answers[session.currentIndex];
  return {
    sessionId: session.id,
    status: session.status,
    questionIndex: session.currentIndex,
    totalQuestions: session.questions.length,
    question: current ? current.question : null,
    questions: session.questions,
    answers: publicAnswers(session),
    operatorConnected: session.operatorSockets.size > 0,
    operatorReady: session.operatorReady
  };
}

function operatorState(session) {
  const current = session.answers[session.currentIndex];
  return {
    sessionId: session.id,
    status: session.status,
    questionIndex: session.currentIndex,
    totalQuestions: session.questions.length,
    question: current ? current.question : null,
    questions: session.questions,
    identity: session.identity,
    operatorReady: session.operatorReady,
    humanAnswered: Boolean(current && current.human.text),
    answers: session.answers
      .filter((answer) => answer.human.text)
      .map((answer) => ({ index: answer.index, question: answer.question, text: answer.human.text }))
  };
}

function serializeSession(session) {
  return {
    id: session.id,
    createdAt: session.createdAt,
    identity: session.identity,
    aiSide: session.aiSide,
    questions: session.questions,
    answers: session.answers,
    removedAnswers: session.removedAnswers,
    status: session.status,
    currentIndex: session.currentIndex,
    operatorReady: session.operatorReady,
    evaluatorChoice: session.evaluatorChoice || null,
    justification: session.justification || '',
    aiModel: MODEL
  };
}

function persistSession(session) {
  const snapshot = serializeSession(session);
  session.writeChain = session.writeChain
    .then(async () => {
      await fs.promises.mkdir(DATA_DIR, { recursive: true });
      const filename = `${session.createdAt.replace(/[:.]/g, '-')}-${session.id}.json`;
      await fs.promises.writeFile(path.join(DATA_DIR, filename), JSON.stringify(snapshot, null, 2), 'utf8');
    })
    .catch((error) => console.error('No se pudo guardar la sesión:', error.message));
  return session.writeChain;
}

function emitEvaluator(session, event, payload) {
  for (const socketId of session.evaluatorSockets) io.to(socketId).emit(event, payload);
}

function emitOperator(session, event, payload) {
  for (const socketId of session.operatorSockets) io.to(socketId).emit(event, payload);
}

function emitConnectionState(session) {
  emitEvaluator(session, 'connection_state', {
    operatorConnected: session.operatorSockets.size > 0,
    operatorReady: session.operatorReady
  });
}

function randomInt(min, max) {
  return Math.floor(min + Math.random() * (max - min + 1));
}

function createAiPlan() {
  const fastMode = Math.random() < 0.4;
  return {
    fastMode,
    baseDelayMs: fastMode ? randomInt(7000, 8500) : randomInt(9000, 14000),
    releaseAtMs: null,
    humanBeforeSevenSeconds: false,
    extraDelayMs: 0
  };
}

function waitForAiRelease(answer) {
  const plan = answer.aiPlan;
  if (!plan.releaseAtMs) plan.releaseAtMs = answer.startedAtMs + plan.baseDelayMs;
  return new Promise((resolve) => {
    const check = () => {
      const remaining = plan.releaseAtMs - Date.now();
      if (remaining <= 0) return resolve();
      setTimeout(check, Math.min(150, remaining));
    };
    check();
  });
}

async function deliverAiAnswer(session, answer, text, error = false) {
  await waitForAiRelease(answer);
  answer.ai = {
    text: text.slice(0, 420),
    generatedAt: new Date().toISOString(),
    responseTimeMs: Date.now() - answer.startedAtMs,
    delayMs: Date.now() - answer.startedAtMs,
    fastMode: answer.aiPlan.fastMode,
    humanBeforeSevenSeconds: answer.aiPlan.humanBeforeSevenSeconds,
    extraDelayMs: answer.aiPlan.extraDelayMs,
    error
  };
  session.aiHistory.push({ role: 'user', content: answer.question });
  session.aiHistory.push({ role: 'assistant', content: answer.ai.text });
  persistSession(session);
  maybeCompleteRound(session);
}

async function askAI(session, answer) {
  const messages = [
    { role: 'system', content: identityPrompt(session.identity) },
    ...session.aiHistory,
    { role: 'user', content: answer.question }
  ];
  let text;
  if (!openai) {
    console.warn('OPENAI_API_KEY no configurada: se usara una respuesta local de prueba.');
    text = 'pues no sé, lo pensaría un rato y luego haría lo que me pareciera más normal';
  } else {
    const completion = await openai.chat.completions.create({ model: MODEL, messages, max_tokens: MAX_TOKENS });
    text = completion.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error('OpenAI no devolvió contenido.');
  }
  await deliverAiAnswer(session, answer, text);
}

function maybeCompleteRound(session) {
  const answer = session.answers[session.currentIndex];
  if (!answer || answer.completed || !answer.human.text || !answer.ai.text) return;
  answer.completed = true;
  persistSession(session);
  emitEvaluator(session, 'round_complete', {
    index: answer.index,
    question: answer.question,
    sideA: session.aiSide === 'A' ? answer.ai.text : answer.human.text,
    sideB: session.aiSide === 'B' ? answer.ai.text : answer.human.text,
    sideATimeMs: session.aiSide === 'A' ? answer.ai.responseTimeMs : answer.human.responseTimeMs,
    sideBTimeMs: session.aiSide === 'B' ? answer.ai.responseTimeMs : answer.human.responseTimeMs
  });
}

function beginQuestion(session, index) {
  const question = session.questions[index];
  if (!question) {
    session.status = 'finished';
    session.currentIndex = session.answers.length - 1;
    persistSession(session);
    emitEvaluator(session, 'experiment_finished', { ...evaluatorState(session), answers: publicAnswers(session) });
    emitOperator(session, 'operator_state', operatorState(session));
    return;
  }

  session.status = 'active';
  session.currentIndex = index;
  session.answers[index] = {
    index,
    question,
    startedAt: new Date().toISOString(),
    startedAtMs: Date.now(),
    human: { text: null, submittedAt: null, responseTimeMs: null },
    ai: { text: null, generatedAt: null, responseTimeMs: null, delayMs: null },
    aiPlan: createAiPlan(),
    showHumanEarly: Math.random() < 0.5,
    completed: false
  };
  persistSession(session);
  const payload = { index, question, totalQuestions: session.questions.length };
  emitEvaluator(session, 'round_started', payload);
  emitOperator(session, 'question_started', payload);
  askAI(session, session.answers[index]).catch((error) => {
    console.error('Error en OpenAI:', error.message);
    const answer = session.answers[index];
    if (!answer || answer.ai.text) return;
    deliverAiAnswer(session, answer, 'mmm, no estoy muy seguro, pero creo que lo vería según la situación', true).catch((deliveryError) => console.error('No se pudo entregar el fallback:', deliveryError.message));
  });
}

function activeSessionOrCreate() {
  if (!currentSession || currentSession.status === 'finished') currentSession = createSession();
  return currentSession;
}

app.use(express.json({ limit: '50kb' }));
app.use('/vendor/react', express.static(path.join(ROOT, 'node_modules', 'react', 'umd')));
app.use('/vendor/react-dom', express.static(path.join(ROOT, 'node_modules', 'react-dom', 'umd')));
app.get('/logo-itsm', (req, res) => res.sendFile(path.join(ROOT, 'ITSM(Escudo).png')));
app.use(express.static(PUBLIC_DIR));
app.get('/api/health', (req, res) => res.json({ ok: true, model: MODEL, openaiConfigured: Boolean(openai) }));
app.get('/api/session/current', (req, res) => {
  if (!currentSession) return res.json({ sessionId: null });
  return res.json({ sessionId: currentSession.id, status: currentSession.status });
});
app.get('/evaluador', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'evaluador.html')));
app.get('/operador', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'operador.html')));
app.get('/', (req, res) => res.redirect('/evaluador'));

io.on('connection', (socket) => {
  socket.on('create_session', () => {
    const previousSession = currentSession;
    if (!currentSession || currentSession.status === 'finished' || currentSession.evaluatorSockets.size > 0) {
      currentSession = createSession();
    }
    socket.data.role = 'evaluator';
    socket.data.sessionId = currentSession.id;
    currentSession.evaluatorSockets.add(socket.id);
    socket.join(currentSession.id);
    socket.emit('session_ready', evaluatorState(currentSession));

    // Mantiene al operador conectado cuando el evaluador inicia otra sesión.
    if (previousSession && previousSession !== currentSession && previousSession.status === 'finished') {
      previousSession.evaluatorSockets.delete(socket.id);
      for (const operatorId of previousSession.operatorSockets) {
        const operatorSocket = io.sockets.sockets.get(operatorId);
        if (!operatorSocket) continue;
        previousSession.operatorSockets.delete(operatorId);
        currentSession.operatorSockets.add(operatorId);
        operatorSocket.data.sessionId = currentSession.id;
        operatorSocket.leave(previousSession.id);
        operatorSocket.join(currentSession.id);
        operatorSocket.emit('operator_state', operatorState(currentSession));
      }
      emitConnectionState(currentSession);
    }
  });

  socket.on('evaluator_join', (sessionId) => {
    const session = currentSession && currentSession.id === sessionId ? currentSession : null;
    if (!session || session.status === 'finished') {
      return socket.emit('session_expired', { message: 'La sesión anterior ya terminó. Se preparará una sesión nueva.' });
    }
    socket.data.role = 'evaluator';
    socket.data.sessionId = session.id;
    session.evaluatorSockets.add(socket.id);
    socket.join(session.id);
    socket.emit('session_state', evaluatorState(session));
    emitConnectionState(session);
  });

  socket.on('operator_join', (sessionId) => {
    const session = sessionId && currentSession && currentSession.id === sessionId
      ? currentSession
      : activeSessionOrCreate();
    socket.data.role = 'operator';
    socket.data.sessionId = session.id;
    session.operatorSockets.add(socket.id);
    socket.join(session.id);
    socket.emit('operator_state', operatorState(session));
    emitConnectionState(session);
  });

  socket.on('start_experiment', () => {
    const session = sessionForSocket(socket);
    if (!session || socket.data.role !== 'evaluator' || session.status !== 'intro') return;
    if (!session.operatorReady) return socket.emit('app_error', { message: 'El operador todavía no ha confirmado que está listo.' });
    session.instructionsCompleted = true;
    beginQuestion(session, 0);
  });

  socket.on('next_question', () => {
    const session = sessionForSocket(socket);
    if (!session || socket.data.role !== 'evaluator' || session.status !== 'active') return;
    const current = session.answers[session.currentIndex];
    if (!current || !current.completed) return socket.emit('app_error', { message: 'Aún faltan las dos respuestas.' });
    beginQuestion(session, session.currentIndex + 1);
  });

  socket.on('human_answer', (payload = {}) => {
    const session = sessionForSocket(socket);
    if (!session || socket.data.role !== 'operator' || session.status !== 'active') return;
    const answer = session.answers[session.currentIndex];
    const text = String(payload.text || '').replace(/\s+/g, ' ').trim().slice(0, 2000);
    if (!answer || !text || answer.human.text) return;
    answer.human = {
      text,
      submittedAt: new Date().toISOString(),
      responseTimeMs: Date.now() - answer.startedAtMs
    };
    const elapsedMs = Date.now() - answer.startedAtMs;
    if (elapsedMs < 7000) {
      answer.aiPlan.humanBeforeSevenSeconds = true;
      answer.aiPlan.extraDelayMs = randomInt(2000, 5000);
      answer.aiPlan.releaseAtMs = Math.max(
        answer.aiPlan.releaseAtMs || answer.startedAtMs + answer.aiPlan.baseDelayMs,
        Date.now() + answer.aiPlan.extraDelayMs,
        answer.startedAtMs + 7000
      );
    }
    persistSession(session);
    socket.emit('human_answer_accepted', { index: answer.index, text });
    emitOperator(session, 'operator_state', operatorState(session));
    if (answer.showHumanEarly) {
      emitEvaluator(session, 'human_response_early', {
        index: answer.index,
        sideA: session.aiSide === 'A' ? null : text,
        sideB: session.aiSide === 'B' ? null : text
      });
    }
    maybeCompleteRound(session);
  });

  socket.on('update_questions', (payload = {}) => {
    const session = sessionForSocket(socket);
    const allowed = session && ((socket.data.role === 'operator' && session.status === 'intro') || (socket.data.role === 'evaluator' && session.status === 'finished'));
    if (!allowed) return;
    const questions = normalizeQuestions(payload.questions);
    if (!questions) return socket.emit('app_error', { message: 'Debe quedar al menos una pregunta.' });
    session.questions = questions;
    if (questions.length < session.answers.length) {
      session.removedAnswers.push(...session.answers.slice(questions.length));
      session.answers = session.answers.slice(0, questions.length);
    }
    const previousAnswered = session.answers.length;
    persistSession(session);
    if (session.status === 'intro') {
      emitEvaluator(session, 'questions_updated', evaluatorState(session));
      emitOperator(session, 'operator_state', operatorState(session));
      return;
    }
    if (questions.length > previousAnswered) {
      beginQuestion(session, previousAnswered);
    } else {
      emitEvaluator(session, 'questions_updated', evaluatorState(session));
      emitOperator(session, 'operator_state', operatorState(session));
    }
  });

  socket.on('update_identity', (payload = {}) => {
    const session = sessionForSocket(socket);
    if (!session || socket.data.role !== 'operator' || session.status !== 'intro' || session.operatorReady) return;
    const identity = normalizeIdentity(payload);
    if (!identity) return socket.emit('app_error', { message: 'Completa un nombre, una edad válida y una ciudad.' });
    session.identity = identity;
    persistSession(session);
    emitOperator(session, 'operator_state', operatorState(session));
  });

  socket.on('operator_ready', (payload = {}) => {
    const session = sessionForSocket(socket);
    if (!session || socket.data.role !== 'operator' || session.status !== 'intro') return;
    const identity = normalizeIdentity(payload);
    if (!identity) return socket.emit('app_error', { message: 'Completa un nombre, una edad válida y una ciudad antes de confirmar.' });
    session.identity = identity;
    session.operatorReady = true;
    persistSession(session);
    emitOperator(session, 'operator_state', operatorState(session));
    emitConnectionState(session);
  });

  socket.on('operator_unready', () => {
    const session = sessionForSocket(socket);
    if (!session || socket.data.role !== 'operator' || session.status !== 'intro') return;
    session.operatorReady = false;
    persistSession(session);
    emitOperator(session, 'operator_state', operatorState(session));
    emitConnectionState(session);
  });

  socket.on('submit_guess', (payload = {}) => {
    const session = sessionForSocket(socket);
    if (!session || socket.data.role !== 'evaluator' || session.status !== 'finished') return;
    const choice = payload.choice === 'A' || payload.choice === 'B' ? payload.choice : null;
    if (!choice) return socket.emit('app_error', { message: 'Elige Chat A o Chat B.' });
    session.evaluatorChoice = choice;
    session.justification = String(payload.justification || '').trim().slice(0, 5000);
    persistSession(session);
    socket.emit('reveal', {
      choice,
      justification: session.justification,
      aiSide: session.aiSide,
      humanSide: session.aiSide === 'A' ? 'B' : 'A',
      answers: publicAnswers(session),
      identity: session.identity
    });
  });

  socket.on('disconnect', () => {
    const session = sessionForSocket(socket);
    if (!session) return;
    session.evaluatorSockets.delete(socket.id);
    session.operatorSockets.delete(socket.id);
    emitConnectionState(session);
  });
});

function localAddresses() {
  const interfaces = os.networkInterfaces();
  return Object.values(interfaces).flat().filter((entry) => entry && entry.family === 'IPv4' && !entry.internal).map((entry) => entry.address);
}

fs.promises.mkdir(DATA_DIR, { recursive: true }).then(() => {
  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`\nTest de Turing disponible en http://localhost:${PORT}/evaluador`);
    const addresses = localAddresses();
    if (addresses.length) addresses.forEach((address) => console.log(`Evaluador / operador en la red: http://${address}:${PORT}`));
    else console.log('No se detectó una IP local. Revisa la conexión WiFi o Ethernet.');
    console.log(`Modelo OpenAI: ${MODEL}${openai ? '' : ' (modo de prueba: falta OPENAI_API_KEY)'}`);
  });
}).catch((error) => {
  console.error('No se pudo preparar data/sesiones:', error);
  process.exitCode = 1;
});
