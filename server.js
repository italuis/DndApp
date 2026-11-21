/* Mesa D&D 5e — servidor v2.1.0 (Node.js + Socket.io). Uso: npm install && npm start */
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const { Server } = require('socket.io');

const server = http.createServer((req, res) => {
  const u = req.url.split('?')[0];
  if (u === '/health') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('ok ' + rooms.size + ' mesas'); }
  if (u === '/' || u === '/index.html') {
    fs.readFile(path.join(__dirname, 'index.html'), (e, d) => {
      if (e) { res.writeHead(500); return res.end('index.html não encontrado'); }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(d);
    });
  } else if (u === '/manifest.json' || u === '/icon.png') {
    const type = u.endsWith('.json') ? 'application/manifest+json' : 'image/png';
    fs.readFile(path.join(__dirname, u.slice(1)), (e, d) => {
      if (e) { res.writeHead(404); return res.end('Not found'); }
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'public, max-age=3600' }); res.end(d);
    });
  } else { res.writeHead(404); res.end('Not found'); }
});
const io = new Server(server, { maxHttpBufferSize: 25e6 });

const rooms = new Map();
const ALPH = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sem 0/O/1/I
const rid = () => crypto.randomBytes(8).toString('hex');
// ---- Senha de Mestre: guardada só como hash scrypt com sal aleatório ----
const hashPw = (pw, salt) => crypto.scryptSync(String(pw), salt, 32).toString('hex');
const newAuth = pw => { const salt = crypto.randomBytes(16).toString('hex'); return { salt, hash: hashPw(pw, salt) }; };
const validAuth = a => (a && /^[a-f0-9]{32}$/.test(a.salt) && /^[a-f0-9]{64}$/.test(a.hash)) ? { salt: a.salt, hash: a.hash } : null;
const checkPw = (a, pw) => {
  if (!a || typeof pw !== 'string') return false;
  const h = Buffer.from(hashPw(pw, a.salt), 'hex'), t = Buffer.from(a.hash, 'hex');
  return h.length === t.length && crypto.timingSafeEqual(h, t);
};
const str = (v, n) => String(v ?? '').slice(0, n);
const numv = v => parseInt(v, 10) || 0;
function newCode() {
  let c;
  do { c = Array.from({ length: 4 }, () => ALPH[crypto.randomInt(ALPH.length)]).join(''); } while (rooms.has(c));
  return c;
}
const pub = p => ({ id: p.id, name: p.name, avatar: p.avatar, online: p.online, sheet: p.sheet, tok: p.tok });
const full = r => ({ players: [...r.players.values()].map(pub), map: r.map, markers: r.markers, draw: r.draw, weather: r.weather });

// ---- Desenho / clima / dados: validação ----
const COR = /^#[0-9a-f]{6}$/i;
function cleanStroke(d, layer) {
  if (!d || !Array.isArray(d.pts) || d.pts.length < 2 || d.pts.length > 1000 || d.pts.length % 2) return null;
  const pts = d.pts.map(Number); if (!pts.every(Number.isFinite)) return null;
  return { id: rid(), layer: str(layer, 20), color: COR.test(d.color) ? d.color : '#e53935',
           w: Math.min(40, Math.max(1, numv(d.w) || 6)), erase: !!d.erase, pts: pts.map(Math.round) };
}
function trimDraw(r) { // limita histórico para a mesa não ficar pesada
  let n = r.draw.reduce((a, s) => a + s.pts.length, 0);
  while (r.draw.length > 800 || n > 120000) n -= r.draw.shift().pts.length;
}
const cleanWeather = w => ({ type: ['clear', 'rain', 'storm', 'fog'].includes(w?.type) ? w.type : 'clear',
                             level: Math.min(3, Math.max(1, numv(w?.level) || 2)) });
function touch(r) { // limpa a sala 30 min depois que todos saírem
  clearTimeout(r.timer);
  const alive = r.dmSock || [...r.players.values()].some(p => p.sock);
  if (!alive) r.timer = setTimeout(() => rooms.delete(r.code), 30 * 60 * 1000);
}

io.on('connection', s => {
  let room = null, role = null, pid = null;
  const hits = {}; // limitador simples por socket
  const lim = (k, max, ms) => { const n = Date.now(), a = (hits[k] || []).filter(t => n - t < ms); const okk = a.length < max; if (okk) a.push(n); hits[k] = a; return okk; };
  const ok = (cb, d) => typeof cb === 'function' && cb(d);
  const isDM = () => room && role === 'dm' && room.dmSock === s.id;
  const me = () => room && role === 'player' ? room.players.get(pid) : null;
  const toDM = (ev, d) => room?.dmSock && io.to(room.dmSock).emit(ev, d);
  const attach = (r, ro, id) => { room = r; role = ro; pid = id || null; s.join(r.code); if (ro === 'player' && id) s.join('p:' + id); clearTimeout(r.timer); };

  // Criar mesa => quem cria é o ÚNICO Mestre (token secreto)
  s.on('room:create', (d, cb) => {
    const pw = typeof d?.pw === 'string' ? d.pw : '';
    if (pw.length < 4 || pw.length > 64) return ok(cb, { ok: false, error: 'A senha de Mestre precisa ter de 4 a 64 caracteres.' });
    const code = newCode();
    const r = { code, dmSock: s.id, dmToken: rid(), pwAuth: newAuth(pw), fails: 0, lockUntil: 0, players: new Map(), markers: [], draw: [], weather: { type: 'clear', level: 2 }, timer: null,
                map: { img: '', w: 2000, h: 1500, cell: 50 } };
    rooms.set(code, r); attach(r, 'dm');
    ok(cb, { ok: true, code, token: r.dmToken, pwAuth: r.pwAuth, state: full(r) });
  });

  // Entrar sempre como Jogador. Não existe caminho para virar Mestre sem o token.
  s.on('room:join', (d, cb) => {
    const r = rooms.get(str(d?.code, 4).toUpperCase());
    if (!r) return ok(cb, { ok: false, error: 'Mesa não encontrada. Confira o código.' });
    if (r.players.size >= 12) return ok(cb, { ok: false, error: 'Mesa lotada (12 jogadores).' });
    const id = rid();
    const p = { id, name: str(d.name, 40) || 'Jogador', avatar: '', sheet: null, tok: null, online: true, sock: s.id };
    r.players.set(id, p); attach(r, 'player', id);
    ok(cb, { ok: true, code: r.code, pid: id, state: full(r) });
    toDM('player:update', pub(p));
  });

  s.on('room:rejoin', (d, cb) => {
    const r = rooms.get(str(d?.code, 4).toUpperCase());
    if (!r) return ok(cb, { ok: false });
    if (d.role === 'dm') {
      if (d.token !== r.dmToken) return ok(cb, { ok: false, error: 'Esta mesa já tem um Mestre.' });
      r.dmSock = s.id; attach(r, 'dm');
      s.to(r.code).emit('dm:status', { online: true });
      return ok(cb, { ok: true, state: full(r), pwAuth: r.pwAuth });
    }
    const p = r.players.get(d.pid);
    if (!p) return ok(cb, { ok: false });
    p.sock = s.id; p.online = true; attach(r, 'player', p.id);
    const pending = !!p.pending; p.pending = false;
    ok(cb, { ok: true, state: full(r), pending });
    if (pending) io.to(s.id).emit('sheet:replace', { sheet: p.sheet }); // edições do Mestre feitas offline
    toDM('player:update', pub(p));
  });

  // Jogador -> servidor: ficha atualizada
  s.on('sheet:sync', d => {
    const p = me(); if (!p || !d || typeof d.sheet !== 'object') return;
    if (JSON.stringify(d.sheet).length > 400000) return;
    p.name = str(d.name, 40) || p.name; p.sheet = d.sheet;
    p.avatar = typeof d.avatar === 'string' && d.avatar.length < 60000 ? d.avatar : '';
    toDM('player:update', pub(p));
  });

  // Recupera a mesa como Mestre com código + senha (mesa ativa)
  s.on('room:recover', (d, cb) => {
    const r = rooms.get(str(d?.code, 4).toUpperCase());
    if (!r) return ok(cb, { ok: false, error: 'Mesa não encontrada. Se o servidor reiniciou, use o arquivo de backup.' });
    if (!r.pwAuth) return ok(cb, { ok: false, error: 'Esta mesa não tem senha de Mestre. Use o arquivo de backup.' });
    if (Date.now() < r.lockUntil) return ok(cb, { ok: false, error: 'Muitas tentativas erradas. Aguarde 5 minutos.' });
    if (!lim('rec', 5, 60000)) return ok(cb, { ok: false, error: 'Muitas tentativas. Aguarde 1 minuto.' });
    if (!checkPw(r.pwAuth, d?.pw)) {
      r.fails = (r.fails || 0) + 1;
      if (r.fails >= 5) { r.lockUntil = Date.now() + 5 * 60000; r.fails = 0; }
      return ok(cb, { ok: false, error: 'Senha incorreta.' });
    }
    r.fails = 0;
    r.dmSock = s.id; r.dmToken = rid(); attach(r, 'dm'); // novo token invalida o Mestre antigo
    s.to(r.code).emit('dm:status', { online: true });
    ok(cb, { ok: true, code: r.code, token: r.dmToken, pwAuth: r.pwAuth, state: full(r) });
  });

  // Restaura uma mesa a partir de um backup salvo pelo Mestre
  s.on('room:restore', (d, cb) => {
    const code = str(d?.code, 4).toUpperCase();
    if (!/^[A-Z0-9]{4}$/.test(code)) return ok(cb, { ok: false, error: 'Código inválido no arquivo.' });
    const tok = typeof d.dmToken === 'string' && /^[a-f0-9]{16}$/.test(d.dmToken) ? d.dmToken : null;
    if (rooms.has(code)) {
      const cur = rooms.get(code);
      if (!tok || tok !== cur.dmToken) return ok(cb, { ok: false, error: 'Esta mesa já está ativa e o arquivo não é dela.' });
      cur.dmSock = s.id; attach(cur, 'dm');
      s.to(cur.code).emit('dm:status', { online: true });
      return ok(cb, { ok: true, code, token: cur.dmToken, pwAuth: cur.pwAuth, state: full(cur) });
    }
    const players = (Array.isArray(d.players) ? d.players : []).slice(0, 12)
      .filter(p => p && typeof p.id === 'string' && /^[a-z0-9]{6,12}$/i.test(p.id))
      .map(p => ({ id: p.id, name: str(p.name, 40) || 'Jogador',
        avatar: typeof p.avatar === 'string' && p.avatar.length < 60000 ? p.avatar : '',
        sheet: p.sheet && typeof p.sheet === 'object' ? p.sheet : null,
        tok: p.tok && isFinite(p.tok.x) && isFinite(p.tok.y) ? { x: p.tok.x, y: p.tok.y } : null,
        online: false, sock: null, pending: false }));
    const markers = (Array.isArray(d.markers) ? d.markers : []).slice(0, 200)
      .filter(m => m && isFinite(m.x) && isFinite(m.y))
      .map(m => ({ id: typeof m.id === 'string' ? str(m.id, 20) : rid(), x: m.x, y: m.y, ...mk(m) }));
    const mp = d.map || {};
    const draw = (Array.isArray(d.draw) ? d.draw : []).slice(-800).map(x => cleanStroke(x, x?.layer)).filter(Boolean);
    const weather = cleanWeather(d.weather);
    const r = { code, dmSock: s.id, dmToken: tok || rid(), timer: null, markers, draw, weather, pwAuth: validAuth(d.pwAuth), fails: 0, lockUntil: 0,
      players: new Map(players.map(p => [p.id, p])),
      map: { img: typeof mp.img === 'string' && (mp.img === '' || mp.img.startsWith('data:image/')) ? mp.img : '',
             w: numv(mp.w) || 2000, h: numv(mp.h) || 1500, cell: numv(mp.cell) || 50 } };
    rooms.set(code, r); attach(r, 'dm');
    ok(cb, { ok: true, code, token: r.dmToken, pwAuth: r.pwAuth, state: full(r) });
  });

  // Mestre edita a ficha INTEIRA do jogador
  s.on('dm:sheet', d => {
    if (!isDM() || !d || typeof d.sheet !== 'object' || d.sheet === null) return;
    const p = room.players.get(d.pid); if (!p) return;
    if (JSON.stringify(d.sheet).length > 400000) return;
    p.sheet = d.sheet; p.name = str(d.sheet.f?.nome, 40) || p.name;
    const online = io.sockets.adapter.rooms.get('p:' + p.id)?.size > 0;
    if (online) io.to('p:' + p.id).emit('sheet:replace', { sheet: p.sheet }); else p.pending = true;
    toDM('player:update', pub(p));
  });

  // Mestre ajusta HP
  s.on('dm:hp', d => {
    if (!isDM()) return;
    const p = room.players.get(d?.pid); if (!p || !p.sheet) return;
    const hp = (p.sheet.hp ??= {});
    const max = numv(hp.max);
    let v = Math.max(0, numv(hp.cur) + numv(d.delta));
    if (max > 0) v = Math.min(v, max);
    hp.cur = v;
    io.to('p:' + p.id).emit('sheet:patch', { hp: { cur: v } });
    toDM('player:update', pub(p));
  });

  // Mapa (só Mestre)
  s.on('map:set', d => {
    if (!isDM() || !d) return;
    const c = {};
    if (typeof d.img === 'string' && (d.img === '' || (d.img.startsWith('data:image/') && d.img.length < 24e6))) c.img = d.img;
    for (const k of ['w', 'h']) if (d[k] >= 100 && d[k] <= 8000) c[k] = Math.round(d[k]);
    if (d.cell >= 8 && d.cell <= 800) c.cell = Math.round(d.cell);
    Object.assign(room.map, c);
    s.to(room.code).emit('map:update', c);
  });

  s.on('token:move', d => {
    if (!isDM()) return;
    const p = room.players.get(d?.pid); if (!p || !isFinite(d.x) || !isFinite(d.y)) return;
    p.tok = { x: d.x, y: d.y };
    s.to(room.code).emit('token:move', { pid: p.id, x: d.x, y: d.y });
  });

  const mk = d => ({ type: str(d.type, 12) || 'pin', title: str(d.title, 60) || 'Marcador', desc: str(d.desc, 500) });
  s.on('marker:add', d => {
    if (!isDM() || !d || !isFinite(d.x) || !isFinite(d.y) || room.markers.length >= 200) return;
    const m = { id: rid(), x: d.x, y: d.y, ...mk(d) };
    room.markers.push(m); io.to(room.code).emit('marker:add', m);
  });
  s.on('marker:update', d => {
    if (!isDM()) return;
    const m = room.markers.find(x => x.id === d?.id); if (!m) return;
    Object.assign(m, mk(d)); io.to(room.code).emit('marker:update', m);
  });
  s.on('marker:remove', d => {
    if (!isDM()) return;
    room.markers = room.markers.filter(x => x.id !== d?.id);
    io.to(room.code).emit('marker:remove', { id: d?.id });
  });

  // ---- Desenho colaborativo: Mestre e Jogadores desenham; só o Mestre limpa ----
  s.on('draw:stroke', d => {
    if (!room || !lim('draw', 40, 1000)) return;
    const st = cleanStroke(d, role === 'dm' ? 'dm' : pid); if (!st) return;
    room.draw.push(st); trimDraw(room);
    s.to(room.code).emit('draw:stroke', st);
  });
  s.on('draw:clear', d => {
    if (!isDM()) return;
    const l = str(d?.layer, 20);
    room.draw = l === 'all' ? [] : room.draw.filter(x => x.layer !== l);
    io.to(room.code).emit('draw:clear', { layer: l });
  });

  // ---- Clima (só o Mestre) ----
  s.on('weather:set', d => {
    if (!isDM() || !d) return;
    room.weather = cleanWeather(d);
    s.to(room.code).emit('weather:set', room.weather);
  });
  s.on('weather:flash', d => {
    if (!isDM() || !lim('flash', 4, 3000)) return;
    s.to(room.code).emit('weather:flash', { p: Math.min(1, Math.max(.2, Number(d?.p) || .6)) });
  });

  // ---- Dados: o sorteio é feito aqui (não dá para forjar) e vai para todos ----
  s.on('dice:roll', d => {
    if (!room || !lim('dice', 6, 3000)) return;
    const sides = [4, 6, 8, 10, 12, 20, 100].find(x => x === d?.sides); if (!sides) return;
    const n = Math.min(10, Math.max(1, numv(d.n) || 1)), mod = Math.max(-99, Math.min(99, numv(d.mod)));
    const rolls = Array.from({ length: n }, () => crypto.randomInt(1, sides + 1));
    const who = role === 'dm' ? 'Mestre' : (me()?.name || 'Jogador');
    io.to(room.code).emit('dice:result', { rid: str(d.rid, 12), who, sides, n, mod,
      color: COR.test(d.color) ? d.color : '#b3261e', rolls, total: rolls.reduce((a, b) => a + b, 0) + mod });
  });

  s.on('disconnect', () => {
    if (!room) return;
    if (role === 'dm' && room.dmSock === s.id) {
      room.dmSock = null; io.to(room.code).emit('dm:status', { online: false });
    } else if (role === 'player') {
      const p = room.players.get(pid);
      if (p && p.sock === s.id) { p.online = false; p.sock = null; toDM('player:update', pub(p)); }
    }
    touch(room);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => console.log(`Mesa D&D 5e v2.1.0 rodando em http://localhost:${PORT}`));
