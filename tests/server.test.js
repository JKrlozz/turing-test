const { test } = require('node:test');
const assert = require('node:assert/strict');
const { io: connect } = require('socket.io-client');
const { createApp } = require('../server');

const audio = Buffer.from('fake-mp3-for-local-tests');
const words = (count) => Array.from({ length: count }, (_, i) => `word${i}`).join(' ');
const last = (state) => state.chats[state.chatIndex].turns.at(-1);

function wait(socket, event, predicate = () => true) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, listener);
      reject(new Error(`Timeout waiting for ${event}`));
    }, 3000);
    function listener(data) {
      if (!predicate(data)) return;
      clearTimeout(timer);
      socket.off(event, listener);
      resolve(data);
    }
    socket.on(event, listener);
  });
}

async function fixture(t, options = {}) {
  const calls = { sleep: [], generated: [], synthesized: [] };
  const { server, io } = createApp({
    humanChatIndex: 0,
    sleep: async (ms) => { calls.sleep.push(ms); },
    generateText: async (session, turn) => {
      calls.generated.push({ sessionId: session.id, question: turn.question });
      return words(40);
    },
    synthesize: async (text) => { calls.synthesized.push(text); return audio; },
    ...options,
  });
  const sockets = [];
  t.after(async () => {
    sockets.forEach((socket) => socket.disconnect());
    await new Promise((resolve) => io.close(resolve));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  async function client(role) {
    const socket = connect(url, { autoConnect: false, reconnection: false, transports: ['websocket'] });
    sockets.push(socket);
    const event = role === 'operator' ? 'operator_state' : 'session_state';
    const states = [];
    socket.on(event, (state) => states.push(state));
    socket.on('connect', () => socket.emit(`${role}_join`));
    const initial = wait(socket, event);
    socket.connect();
    await initial;
    return {
      socket, states, event,
      get state() { return states.at(-1); },
      async send(command, payload = {}, predicate = () => true) {
        const response = wait(socket, event, predicate);
        socket.emit(command, { sessionId: this.state.sessionId, ...payload });
        return response;
      },
      async reject(command, payload = {}, message) {
        const response = wait(socket, 'app_error');
        socket.emit(command, { sessionId: this.state.sessionId, ...payload });
        assert.match((await response).message, message);
      },
      async snapshot() {
        const response = wait(socket, event);
        socket.emit(`${role}_join`);
        return response;
      },
    };
  }
  const evaluator = await client('evaluator');
  const operator = await client('operator');
  async function start() {
    await operator.send('operator_ready', { name: 'Alex', age: 20, city: 'Merida' });
    await evaluator.send('start_experiment', {}, (s) => s.status === 'active');
  }
  return { url, calls, client, evaluator, operator, start };
}

function assertPrivate(states) {
  for (const state of states) {
    assert.deepEqual(Object.keys(state).sort(), ['sessionId', 'status', 'chatIndex', 'limit',
      'operatorConnected', 'operatorReady', 'configured', 'chats',
      ...(state.status === 'closed' ? ['humanChat'] : [])].sort());
    for (const chat of state.chats) for (const turn of chat.turns) {
      assert.deepEqual(Object.keys(turn).sort(), ['id', 'question', 'status', 'audioUrl'].sort());
      assert.ok(['waiting', 'complete', 'error'].includes(turn.status));
    }
  }
}

for (const humanChatIndex of [0, 1]) {
  test(`complete A/B flow, humanChatIndex=${humanChatIndex}`, { timeout: 15000 }, async (t) => {
    const f = await fixture(t, { humanChatIndex });
    let e = f.evaluator;
    const o = f.operator;
    assert.equal(e.state.status, 'intro');
    assert.equal(e.state.configured, true);
    assert.equal(e.state.limit, 5);
    assert.equal(o.state.humanChatIndex, humanChatIndex);
    await e.reject('start_experiment', {}, /listo y conectado/);
    await f.start();
    await e.reject('new_session', {}, /Termina/);
    await e.reject('submit_guess', { choice: 'A' }, /terminar/);
    let humanTurn;
    let firstAudio;
    for (let chatIndex = 0; chatIndex < 2; chatIndex++) {
      await e.reject('advance_chat', { chatIndex }, /cinco/);
      for (let index = 0; index < 5; index++) {
        const question = `Question ${index + 1}?`;
        await e.send('send_question', { chatIndex, expectedTurn: index, text: question },
          (s) => s.chats[chatIndex].turns.length === index + 1);
        if (chatIndex === humanChatIndex) {
          const state = await o.snapshot();
          assert.equal(state.canAnswer, true);
          humanTurn = last(state).id;
          await e.reject('send_question', { chatIndex, expectedTurn: index + 1, text: 'Too early' }, /Espera/);
          await e.reject('advance_chat', { chatIndex }, /cinco/);
          await o.reject('human_answer', { chatIndex, turnId: humanTurn, text: words(36) }, /35 palabras/);
          assert.equal((await o.snapshot()).canAnswer, true);
          await o.send('human_answer', { chatIndex, turnId: humanTurn, text: words(35) },
            (s) => last(s).status === 'complete');
          await o.reject('human_answer', { chatIndex, turnId: humanTurn, text: 'Late' }, /no admite/);
        }
        const complete = await e.snapshot();
        if (last(complete).status !== 'complete') await wait(e.socket, e.event, (s) => last(s)?.status === 'complete');
        assert.equal(last(e.state).question, question);
        assert.equal(last(e.state).status, 'complete');
        firstAudio ||= last(e.state).audioUrl;
        await e.reject('send_question', { chatIndex, expectedTurn: index, text: 'Duplicate' }, /turno cambio/);
      }
      await e.reject('send_question', { chatIndex, expectedTurn: 5, text: 'Sixth' }, /Espera/);
      assert.equal((await e.snapshot()).chats[chatIndex].turns.length, 5);
      await e.send('advance_chat', { chatIndex }, (s) => s.chatIndex !== chatIndex || s.status === 'selection');
      if (humanTurn) await o.reject('human_answer', { chatIndex: humanChatIndex, turnId: humanTurn, text: 'Late' }, /no admite/);
    }
    assert.equal(e.state.status, 'selection');
    assert.deepEqual(e.state.chats.map((c) => c.turns.length), [5, 5]);
    assert.equal(f.calls.generated.length, 5);
    assert.equal(f.calls.sleep.length, 5);
    assert.ok(f.calls.sleep.every((ms) => ms >= 10000 && ms <= 20000));
    assert.equal(f.calls.synthesized.length, 10);
    assert.ok(f.calls.synthesized.every((text) => text.split(/\s+/).length === 35));
    const response = await fetch(f.url + firstAudio);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /^audio\/mpeg/);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), audio);
    assert.equal((await fetch(`${f.url}/api/audio/missing`)).status, 404);
    const before = e.state;
    e.socket.disconnect();
    e = await f.client('evaluator');
    assert.equal(e.state.sessionId, before.sessionId);
    assert.equal(e.state.status, 'selection');
    assert.deepEqual(e.state.chats, before.chats);
    await e.reject('submit_guess', { choice: 'C' }, /Elige/);
    assertPrivate(e.states);
    await e.send('submit_guess', { choice: 'A' }, (s) => s.status === 'closed');
    assert.equal(e.state.humanChat, humanChatIndex === 0 ? 'A' : 'B');
    await e.reject('submit_guess', { choice: 'B' }, /Elige/);
    assert.equal((await e.snapshot()).status, 'closed');
    e.socket.disconnect();
    e = await f.client('evaluator');
    assert.equal(e.state.status, 'closed');
    assert.equal(e.state.humanChat, humanChatIndex === 0 ? 'A' : 'B');
    await e.send('new_session', {}, (s) => s.sessionId !== before.sessionId);
    assert.equal(e.state.status, 'intro');
    assert.equal(e.state.operatorReady, false);
    assert.deepEqual(e.state.chats.map((c) => c.turns), [[], []]);
    assert.equal((await fetch(f.url + firstAudio)).status, 404);
    e.socket.emit('submit_guess', { sessionId: before.sessionId, choice: 'B' });
    assert.equal((await e.snapshot()).status, 'intro');
    assertPrivate([...f.evaluator.states, ...e.states]);
  });
}

test('AI waits 10-20 seconds before generation; processing blocks commands', async (t) => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  t.after(() => release());
  const order = [];
  const f = await fixture(t, {
    humanChatIndex: 1,
    sleep: async (ms) => { assert.ok(ms >= 10000 && ms <= 20000); order.push('sleep'); await gate; order.push('awake'); },
    generateText: async () => { order.push('generate'); return 'Private AI answer'; },
  });
  await f.start();
  const e = f.evaluator;
  await e.send('send_question', { chatIndex: 0, expectedTurn: 0, text: 'Hello?' });
  assert.deepEqual(order, ['sleep']);
  assert.equal(last(e.state).status, 'waiting');
  await e.reject('send_question', { chatIndex: 0, expectedTurn: 1, text: 'Early' }, /Espera/);
  await e.reject('advance_chat', { chatIndex: 0 }, /cinco/);
  await f.operator.reject('human_answer', { chatIndex: 0, turnId: last(e.state).id, text: 'Intrusion' }, /no admite/);
  const completed = wait(e.socket, e.event, (s) => last(s)?.status === 'complete');
  release();
  await completed;
  assert.deepEqual(order, ['sleep', 'awake', 'generate']);
  assertPrivate(e.states);
});

test('invalid OpenAI key is diagnosed only to the operator', async (t) => {
  const f = await fixture(t, {
    humanChatIndex: 1,
    generateText: async () => { throw Object.assign(new Error('secret credential fragment'), { status: 401 }); },
  });
  await f.start();
  const diagnosis = wait(f.operator.socket, f.operator.event, (state) => Boolean(state.responseError));
  await f.evaluator.send('send_question', { chatIndex: 0, expectedTurn: 0, text: 'Hola' },
    (state) => last(state)?.status === 'error');
  const operator = await diagnosis;
  assert.match(operator.responseError, /OPENAI_API_KEY/);
  assert.match(operator.responseError, /401/);
  assert.ok(!JSON.stringify(operator).includes('secret credential fragment'));
  assertPrivate(f.evaluator.states);
});

for (const failure of ['generate', 'ai-audio', 'human-audio']) {
  test(`failure and retry: ${failure}`, async (t) => {
    let generations = 0;
    let syntheses = 0;
    let sleeps = 0;
    const human = failure === 'human-audio';
    const f = await fixture(t, {
      humanChatIndex: human ? 0 : 1,
      sleep: async () => { sleeps++; },
      generateText: async () => {
        generations++;
        if (failure === 'generate' && generations === 1) throw new Error('Injected generation failure');
        return 'Private answer';
      },
      synthesize: async (text) => {
        syntheses++;
        assert.equal(text, 'Private answer');
        if (failure !== 'generate' && syntheses === 1) throw new Error('Injected audio failure');
        return audio;
      },
    });
    await f.start();
    const e = f.evaluator;
    const failed = wait(e.socket, e.event, (s) => last(s)?.status === 'error');
    await e.send('send_question', { chatIndex: 0, expectedTurn: 0, text: 'Hello?' });
    if (human) {
      await f.operator.snapshot();
      await f.operator.send('human_answer', { chatIndex: 0, turnId: last(e.state).id, text: 'Private answer' });
    }
    await failed;
    const turnId = last(e.state).id;
    assert.equal(last(e.state).audioUrl, null);
    await e.reject('advance_chat', { chatIndex: 0 }, /cinco/);
    await e.reject('send_question', { chatIndex: 0, expectedTurn: 1, text: 'Early' }, /Espera/);
    const retryClient = human ? f.operator : e;
    const completed = wait(e.socket, e.event, (s) => last(s)?.status === 'complete');
    await retryClient.send('retry_response', { chatIndex: 0, turnId }, (s) => last(s).status !== 'error');
    await completed;
    assert.equal(last(e.state).id, turnId);
    assert.equal(e.state.chats[0].turns.length, 1);
    assert.equal(generations, human ? 0 : failure === 'generate' ? 2 : 1);
    assert.equal(sleeps, generations);
    assert.equal(syntheses, failure === 'generate' ? 1 : 2);
    e.socket.emit('retry_response', { sessionId: e.state.sessionId, chatIndex: 0, turnId });
    await e.snapshot();
    assert.equal(syntheses, failure === 'generate' ? 1 : 2);
    assertPrivate(e.states);
  });
}
