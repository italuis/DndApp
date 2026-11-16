/* Mesa D&D 5e — servidor v2.0.0 (Node.js + Socket.io). Uso: npm install && npm start */
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
const str = (v, n) => String(v ?? '').slice(0, n);
const numv = v => parseInt(v, 10) || 0;
function newCode() {
  let c;
  do { c = Array.from({ length: 4 }, () => ALPH[crypto.randomInt(ALPH.length)]).join(''); } while (rooms.has(c));
  return c;
}
const pub = p => ({ id: p.id, name: p.name, avatar: p.avatar, online: p.online, sheet: p.sheet, tok: p.tok });
const full = r => ({ players: [...r.players.values()].map(pub), map: r.map, markers: r.markers });
function touch(r) { // limpa a sala 30 min depois que todos saírem
  clearTimeout(r.timer);
  const alive = r.dmSock || [...r.players.values()].some(p => p.sock);
  if (!alive) r.timer = setTimeout(() => rooms.delete(r.code), 30 * 60 * 1000);
}

io.on('connection', s => {
  let room = null, role = null, pid = null;
  const ok = (cb, d) => typeof cb === 'function' && cb(d);
  const isDM = () => room && role === 'dm' && room.dmSock === s.id;
  const me = () => room && role === 'player' ? room.players.get(pid) : null;
  const toDM = (ev, d) => room?.dmSock && io.to(room.dmSock).emit(ev, d);
  const attach = (r, ro, id) => { room = r; role = ro; pid = id || null; s.join(r.code); if (ro === 'player' && id) s.join('p:' + id); clearTimeout(r.timer); };

  // Criar mesa => quem cria é o ÚNICO Mestre (token secreto)
  s.on('room:create', (_, cb) => {
    const code = newCode();
    const r = { code, dmSock: s.id, dmToken: rid(), players: new Map(), markers: [], timer: null,
                map: { img: '', w: 2000, h: 1500, cell: 50 } };
    rooms.set(code, r); attach(r, 'dm');
    ok(cb, { ok: true, code, token: r.dmToken, state: full(r) });
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
      return ok(cb, { ok: true, state: full(r) });
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
server.listen(PORT, '0.0.0.0', () => console.log(`Mesa D&D 5e v2.0.0 rodando em http://localhost:${PORT}`));
