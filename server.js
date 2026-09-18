const express = require('express');
const http = require('http');
const crypto = require('crypto');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { Bonjour } = require('bonjour-service');
const GKAI = require('./gomoku-ai');

// ─────────────────────────── DEPLOY CONFIG ───────────────────────────
// 反向代理（nginx 等）部署时设 TRUST_PROXY=1，限流才能取得真实客户端 IP；
// 裸奔公网切勿开启，否则 X-Forwarded-For 可被伪造绕过限流。
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
// 跨域白名单（逗号分隔，如 https://game.example.com）；不设置则仅允许同源。
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
// 公网部署可设 DISABLE_MDNS=1 关闭局域网 mDNS 广播。
const DISABLE_MDNS = process.env.DISABLE_MDNS === '1';
// 后台观战密码：设置后 /admin 后台可用；留空（默认）则后台登录一律拒绝。
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const ADMIN_LOGIN_PER_MIN = 5;

const app = express();
const server = http.createServer(app);
if (TRUST_PROXY) app.set('trust proxy', 1);
app.disable('x-powered-by');

// 浏览器侧纵深防御：固定 CSP，脚本仅允许同源（内联主题脚本已外移至 js/early-theme.js）
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Content-Security-Policy', CSP);
  next();
});

// 应用版本号取自 package.json，渲染首页时替换 HTML 中的 __APP_VERSION__ 占位符
const APP_VERSION = require('./package.json').version;

app.get(['/', '/index.html'], (req, res) => {
  const html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8')
    .replace('__APP_VERSION__', APP_VERSION);
  res.type('html').send(html);
});

// 后台页面：独立于主 SPA，密码经 Socket.IO 校验（见 admin:login 事件）
app.get(['/admin', '/admin.html'], (req, res) => {
  const html = fs.readFileSync(path.join(__dirname, 'public', 'admin.html'), 'utf8');
  res.type('html').send(html);
});

app.use(express.static(path.join(__dirname, 'public')));

// 兜底 404 与错误处理：不向客户端泄露堆栈等内部信息
app.use((req, res) => res.status(404).type('txt').send('Not Found'));
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).type('txt').send('Internal Server Error');
});

// 单条消息上限 64KB（聊天 ≤400 字、笔画指令均远小于此），压缩保持默认
const ioOptions = { maxHttpBufferSize: 64 * 1024 };
if (ALLOWED_ORIGINS.length) {
  ioOptions.cors = {
    origin(origin, cb) {
      // 非浏览器客户端与同源请求不带 Origin，一律放行；仅校验显式跨域来源
      if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
      return cb(new Error('origin not allowed'));
    },
  };
}
const io = new Server(server, ioOptions);

const rooms = new Map();
const playerRooms = new Map(); // socketId -> roomCode

// ─────────────────────────── SETTINGS ───────────────────────────

function defaultSettings(gameType) {
  switch (gameType) {
    case 'scribble':     return { drawTime: 45, rounds: 3, wordChoices: 3 };
    case 'killerdoctor': return { discussionTime: 45, votingTime: 45, nightTime: 45 };
    case 'tictactoe':    return { bestOf: 0, turnTime: 30 };
    case 'gomoku':       return { boardSize: 15, mode: 'pvp', aiDifficulty: 'normal', turnTime: 30 };
    case 'uno':          return { turnTime: 30 };
    default:             return {};
  }
}

function validateSettings(incoming, gameType) {
  const out = {};
  const n = k => Math.round(Number(incoming[k]));
  const isValidTime = k => Number.isFinite(n(k)) && n(k) >= 10 && n(k) <= 600;
  // 回合计时仅井字棋/五子棋/UNO 支持
  const isValidTurnTime = () => Number.isFinite(n('turnTime')) && n('turnTime') >= 0 && n('turnTime') <= 120;
  switch (gameType) {
    case 'scribble':
      if (isValidTime('drawTime'))              out.drawTime    = n('drawTime');
      if ([2,3,4,5].includes(n('rounds')))      out.rounds      = n('rounds');
      if ([2,3,4].includes(n('wordChoices')))   out.wordChoices = n('wordChoices');
      break;
    case 'killerdoctor':
      if (isValidTime('discussionTime'))        out.discussionTime = n('discussionTime');
      if (isValidTime('votingTime'))            out.votingTime     = n('votingTime');
      if (isValidTime('nightTime'))             out.nightTime      = n('nightTime');
      break;
    case 'tictactoe':
      if ([0,3,5,7].includes(n('bestOf')))      out.bestOf = n('bestOf');
      if (isValidTurnTime())                    out.turnTime = n('turnTime');
      break;
    case 'gomoku':
      if ([13,15,19].includes(n('boardSize')))  out.boardSize = n('boardSize');
      if (['pvp','pve'].includes(incoming.mode)) out.mode = incoming.mode;
      if (['easy','normal','hard'].includes(incoming.aiDifficulty)) out.aiDifficulty = incoming.aiDifficulty;
      if (isValidTurnTime())                    out.turnTime = n('turnTime');
      break;
    case 'uno':
      if (isValidTurnTime())                    out.turnTime = n('turnTime');
      break;
  }
  return out;
}

// ─────────────────────────── HARDENING ───────────────────────────

const GAME_TYPES = new Set(['tictactoe', 'gomoku', 'killerdoctor', 'scribble', 'uno']);
const MAX_NAME_LEN = 20;
const MAX_PLAYERS = 15;
const MAX_CONNS_PER_IP = 30;
const HANDSHAKES_PER_MIN = 60;
const ROOM_OPS_PER_MIN = 30;

/**
 * 昵称规范化：剥离 C0/C1 控制字符、零宽与双向排版字符（防冒名伪装），
 * 去首尾空白并限长；返回空串表示非法输入。
 */
function sanitizeName(raw) {
  return String(raw ?? '')
    .replace(/[\x00-\x1F\x7F\u0080-\u009F\u200B-\u200F\u202A-\u202E\uFEFF]/g, '')
    .trim()
    .slice(0, MAX_NAME_LEN);
}

/** 头像序号只接受 0–255 整数，其余回退 0 */
function normalizeAvatar(raw) {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 && n <= 255 ? n : 0;
}

/** 玩家重连令牌：24 字节 CSPRNG，公网环境下身份恢复只认它而非昵称 */
function genPlayerToken() {
  return crypto.randomBytes(24).toString('hex');
}

/** 取客户端真实 IP；仅在 TRUST_PROXY 时采信 X-Forwarded-For 第一段 */
function clientIp(socket) {
  if (TRUST_PROXY) {
    const xff = socket.handshake.headers['x-forwarded-for'];
    if (typeof xff === 'string' && xff.length) return xff.split(',')[0].trim();
  }
  return socket.handshake.address;
}

// 内存固定窗口限流（滑动时间戳数组），按 key 维度计数
const rateHits = new Map();
function rateLimit(key, windowMs, max) {
  const now = Date.now();
  const hits = (rateHits.get(key) || []).filter(t => now - t < windowMs);
  if (hits.length >= max) { rateHits.set(key, hits); return false; }
  hits.push(now);
  rateHits.set(key, hits);
  return true;
}
// 周期性清理过期计数，避免内存随唯一 IP 无限增长
setInterval(() => {
  const now = Date.now();
  for (const [key, hits] of rateHits) {
    const fresh = hits.filter(t => now - t < 5 * 60 * 1000);
    if (fresh.length) rateHits.set(key, fresh);
    else rateHits.delete(key);
  }
}, 5 * 60 * 1000).unref();

// 每 IP 并发连接计数（独立监听器，保证任何断开路径都会递减）
const ipConnCount = new Map();

// ─────────────────────────── UTILITIES ───────────────────────────

function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c = '';
  for (let i = 0; i < 6; i++) c += chars[crypto.randomInt(chars.length)];
  return c;
}
function uniqueCode() { let c; do { c = genCode(); } while (rooms.has(c)); return c; }
function getRoom(sid) { const code = playerRooms.get(sid); return code ? rooms.get(code) : null; }
function clearTurnTimer(room) {
  if (room.turnTimer) {
    clearTimeout(room.turnTimer);
    room.turnTimer = null;
  }
}
function clearTimers(room) {
  clearTurnTimer(room);
  (room.timers||[]).forEach(clearTimeout);
  room.timers = [];
}
function addTimer(room, fn, ms) { if (!room.timers) room.timers = []; const t = setTimeout(fn, ms); room.timers.push(t); return t; }
function minPlayers(g, settings) {
  if (g === 'gomoku') return settings?.mode === 'pve' ? 1 : 2;
  return { tictactoe: 2, killerdoctor: 4, scribble: 3, uno: 2 }[g] ?? 2;
}

function broadcastLobby(room) {
  io.to(room.code).emit('lobby:update', {
    players: [...room.players.values()].map(p => ({ id: p.id, name: p.name, avatar: p.avatar ?? 0, isHost: p.id === room.host })),
    code: room.code,
    gameType: room.gameType,
    hostId: room.host,
    hasPassword: Boolean(room.password),
    minPlayers: minPlayers(room.gameType, room.settings),
    settings: room.settings,
    sessionStats: Object.keys(room.sessionStats || {}).length ? room.sessionStats : null,
  });
}

function getLocalIPs() {
  const ips = [];
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const iface of ifaces) {
      if (iface.family === 'IPv4' && !iface.internal) ips.push(iface.address);
    }
  }
  return ips;
}

// ─────────────────────────── ADMIN BACKEND ───────────────────────────
// 后台仅依赖房间级广播频道：管理员 socket 加入 code 频道即可收到全部
// io.to(code) 公开事件，但绝不写入 room.players / playerRooms，因此不影响
// 对局、人数统计与断线逻辑；手牌/身份/秘密词等私密数据均为点对点下发，
// 后台天然收不到。

/** 已通过密码校验的后台连接 */
const adminSockets = new Set();

/** 常数时间密码比较，避免时序侧信道逐位泄露管理员密码 */
function adminSafeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) {
    // 长度不等时也执行一次比较，使两种失败路径耗时一致
    crypto.timingSafeEqual(ba, ba);
    return false;
  }
  return crypto.timingSafeEqual(ba, bb);
}

/** 后台视角的房间列表（不含房间密码明文与令牌） */
function adminRoomsPayload() {
  return [...rooms.values()].map(r => ({
    code: r.code,
    gameType: r.gameType,
    status: r.status,
    playerCount: r.players.size,
    hasPassword: Boolean(r.password),
    players: [...r.players.values()].map(p => p.name),
    createdAt: r.createdAt || 0,
  }));
}

/**
 * 观战初始快照：仅聚合各游戏对全体房间成员公开的状态，
 * 不包含 UNO 手牌、杀手身份、Scribble 秘密词与对局方私有令牌。
 */
function adminSnapshot(room) {
  const snap = {
    code: room.code,
    gameType: room.gameType,
    status: room.status,
    players: [...room.players.values()].map(p => ({ id: p.id, name: p.name })),
  };
  const gs = room.gameState;
  if (!gs) return snap;
  switch (room.gameType) {
    case 'tictactoe':
      snap.ttt = tttPublic(gs);
      if (gs.mode === 'tournament') snap.tttTournament = tttTournamentPublic(gs);
      break;
    case 'gomoku':
      snap.gk = gkPublic(gs);
      break;
    case 'uno':
      snap.uno = unoPublic(gs);
      break;
    case 'scribble':
      snap.scribble = {
        phase: gs.phase,
        drawerId: gs.drawerOrder[gs.drawerIndex],
        round: gs.round,
        maxRounds: gs.maxRounds,
        masked: gs.masked,
        scores: gs.scores,
        drawingData: gs.drawingData,
        players: scribblePlayers(room),
      };
      break;
    case 'killerdoctor':
      snap.kd = {
        phase: gs.phase,
        round: gs.round,
        livingPlayers: kdAlive(gs).map(kdPub),
        deadPlayers: kdDead(gs).map(kdPub),
        history: gs.history,
      };
      break;
  }
  return snap;
}

// 有管理员在线时低频同步房间列表，统一覆盖创建/销毁/开局/结束等一切变更
setInterval(() => {
  if (!adminSockets.size) return;
  const payload = adminRoomsPayload();
  for (const s of adminSockets) s.emit('admin:rooms', { rooms: payload });
}, 2000).unref();

// ─────────────────────────── SOCKET CORE ───────────────────────────

// 握手门禁：限制单 IP 握手频率与并发连接数，抑制公网连接洪泛
io.use((socket, next) => {
  const ip = clientIp(socket);
  if ((ipConnCount.get(ip) || 0) >= MAX_CONNS_PER_IP) return next(new Error('too many connections'));
  if (!rateLimit(`handshake:${ip}`, 60 * 1000, HANDSHAKES_PER_MIN)) return next(new Error('handshake rate limited'));
  ipConnCount.set(ip, (ipConnCount.get(ip) || 0) + 1);
  socket.data.ip = ip;
  // 独立于业务 disconnect 监听，保证计数在任何断开路径下都递减
  socket.on('disconnect', () => {
    ipConnCount.set(ip, Math.max(0, (ipConnCount.get(ip) || 1) - 1));
  });
  next();
});

io.on('connection', socket => {

  socket.on('room:create', ({ gameType, playerName, avatar, password }) => {
    if (!rateLimit(`roomop:${socket.data.ip}`, 60 * 1000, ROOM_OPS_PER_MIN)) {
      socket.emit('room:error', { msg: '操作太频繁啦，歇一会儿再试。' }); return;
    }
    if (!GAME_TYPES.has(gameType)) return;
    const name = sanitizeName(playerName);
    if (!name) return;
    const cleanPassword = typeof password === 'string' ? password.trim().slice(0, 32) : '';
    const code = uniqueCode();
    const token = genPlayerToken();
    const room = {
      code, gameType,
      password: cleanPassword,
      host: socket.id,
      players: new Map([[socket.id, { id: socket.id, name, avatar: normalizeAvatar(avatar), token }]]),
      status: 'lobby',
      gameState: null,
      timers: [],
      settings: defaultSettings(gameType),
      sessionStats: {},
      createdAt: Date.now(),
    };
    rooms.set(code, room);
    playerRooms.set(socket.id, code);
    socket.join(code);
    socket.emit('room:joined', { code, isHost: true, gameType, token, hasPassword: Boolean(cleanPassword) });
    broadcastLobby(room);
  });

  socket.on('room:join', ({ code, playerName, avatar, token, password }) => {
    if (!rateLimit(`roomop:${socket.data.ip}`, 60 * 1000, ROOM_OPS_PER_MIN)) {
      socket.emit('room:error', { msg: '操作太频繁啦，歇一会儿再试。' }); return;
    }
    const upper = String(code ?? '').toUpperCase().trim().slice(0, 6);
    const room = rooms.get(upper);
    if (!room) { socket.emit('room:error', { msg: '房间不存在，检查下代码有没有输错？' }); return; }

    if (room.password) {
      const reqPwd = typeof password === 'string' ? password.trim() : '';
      if (reqPwd !== room.password) {
        socket.emit('room:error', { msg: '房间密码错误，请输入正确的密码。' });
        return;
      }
    }

    if (room.status === 'playing') {
      // 游戏中的身份恢复必须同时持有原昵称与服务端签发的令牌，
      // 仅凭昵称可被同房间其他人冒名接管（泄露杀手身份/手牌）
      const name = sanitizeName(playerName);
      const existing = [...room.players.values()]
        .find(p => p.token && p.name === name && p.token === token);
      if (!existing) { socket.emit('room:error', { msg: '游戏已开始，需用原来的设备与昵称重新进入。' }); return; }
      // 身份迁移到当前连接：旧连接必须立即移出房间频道并清映射，防止其继续接收广播
      const oldSocket = io.sockets.sockets.get(existing.id);
      if (oldSocket && oldSocket !== socket) oldSocket.leave(upper);
      playerRooms.delete(existing.id);
      room.players.delete(existing.id);
      if (room.host === existing.id) room.host = socket.id;
      existing.id = socket.id;
      room.players.set(socket.id, existing);
      playerRooms.set(socket.id, upper);
      socket.join(upper);
      socket.emit('room:joined', { code: upper, isHost: room.host === socket.id, gameType: room.gameType, token: existing.token, hasPassword: Boolean(room.password) });
      sendReconnectState(room, socket);
      return;
    }

    if (room.players.has(socket.id)) return;
    if (room.players.size >= MAX_PLAYERS) {
      socket.emit('room:error', { msg: '房间人数已满。' }); return;
    }
    const name = sanitizeName(playerName) || `玩家${room.players.size + 1}`;
    const av = normalizeAvatar(avatar);
    const existing = [...room.players.values()];
    if (existing.some(p => p.name.toLowerCase() === name.toLowerCase())) {
      socket.emit('room:error', { msg: '这个名字房间里已经有人用了，换一个吧。' }); return;
    }
    if (existing.some(p => p.avatar === av)) {
      socket.emit('room:error', { msg: '这个头像已经被选走了，换一个吧。' }); return;
    }
    const playerToken = genPlayerToken();
    room.players.set(socket.id, { id: socket.id, name, avatar: av, token: playerToken });
    playerRooms.set(socket.id, upper);
    socket.join(upper);
    socket.emit('room:joined', { code: upper, isHost: false, gameType: room.gameType, token: playerToken, hasPassword: Boolean(room.password) });
    broadcastLobby(room);
    io.to(upper).emit('notification', `${name} 进入了房间`);
  });

  socket.on('room:settings', newSettings => {
    const room = getRoom(socket.id);
    if (!room || room.host !== socket.id || room.status !== 'lobby') return;
    const validated = validateSettings(newSettings, room.gameType);
    room.settings = { ...room.settings, ...validated };
    io.to(room.code).emit('lobby:settings', room.settings);
    // 重新广播大厅：人数门槛等可能随设置变化（如五子棋人机模式 1 人即可开局）
    broadcastLobby(room);
  });

  socket.on('room:kick', ({ playerId }) => {
    const room = getRoom(socket.id);
    if (!room) return;
    if (room.host !== socket.id) {
      socket.emit('room:error', { msg: '只有房主才能踢出玩家。' });
      return;
    }
    if (!playerId || playerId === socket.id) return;
    const player = room.players.get(playerId);
    if (!player) return;
    io.to(playerId).emit('room:kicked');
    io.sockets.sockets.get(playerId)?.leave(room.code);
    room.players.delete(playerId);
    playerRooms.delete(playerId);
    io.to(room.code).emit('notification', `${player.name} 被房主请出了房间`);
    if (room.status === 'playing') {
      onPlayerDisconnect(room, playerId, player.name);
    } else {
      broadcastLobby(room);
    }
  });

  socket.on('room:transfer_host', ({ playerId }) => {
    const room = getRoom(socket.id);
    if (!room || room.host !== socket.id || room.status !== 'lobby') return;
    if (!playerId || !room.players.has(playerId) || playerId === socket.id) return;
    room.host = playerId;
    io.to(room.code).emit('notification', `${room.players.get(playerId).name} 成为新房主啦`);
    broadcastLobby(room);
  });

  socket.on('game:start', () => {
    const room = getRoom(socket.id);
    if (!room || room.host !== socket.id || room.status !== 'lobby') return;
    if (room.players.size < minPlayers(room.gameType, room.settings)) {
      socket.emit('room:error', { msg: `至少要 ${minPlayers(room.gameType, room.settings)} 名玩家才能开局。` });
      return;
    }
    room.status = 'playing';
    io.to(room.code).emit('game:starting');
    addTimer(room, () => ({ tictactoe: startTTT, killerdoctor: startKD, scribble: startScribble, gomoku: startGK, uno: startUno })[room.gameType]?.(room), 3200);
  });

  socket.on('game:action', data => {
    const room = getRoom(socket.id);
    if (!room || room.status !== 'playing') return;
    handleAction(room, socket, data);
  });

  socket.on('chat:send', ({ message }) => {
    const room = getRoom(socket.id);
    if (!room || !message?.trim()) return;
    const player = room.players.get(socket.id);
    if (!player) return;
    handleChat(room, socket, player, message.trim().slice(0, 400));
  });

  socket.on('game:restart', () => {
    const room = getRoom(socket.id);
    if (!room || room.host !== socket.id) return;
    // 对局中可能有人被踢/离场，重开前必须重验人数，否则 startTTT 等开局函数会以残缺玩家数组运行
    if (room.players.size < minPlayers(room.gameType, room.settings)) {
      socket.emit('room:error', { msg: `至少要 ${minPlayers(room.gameType, room.settings)} 名玩家才能开局。` });
      return;
    }
    restartGame(room);
  });

  socket.on('game:back_to_lobby', () => {
    const room = getRoom(socket.id);
    if (!room || room.host !== socket.id) return;
    clearTimers(room);
    room.status = 'lobby';
    room.gameState = null;
    io.to(room.code).emit('game:back_to_lobby');
    broadcastLobby(room);
  });

  // ─────────────────────── ADMIN SOCKET ───────────────────────

  socket.on('admin:login', ({ password } = {}) => {
    if (!rateLimit(`adminlogin:${socket.data.ip}`, 60 * 1000, ADMIN_LOGIN_PER_MIN)) {
      socket.emit('admin:login_result', { ok: false, msg: '尝试过于频繁，请稍后再试。' });
      return;
    }
    if (!ADMIN_PASSWORD) {
      socket.emit('admin:login_result', { ok: false, msg: '后台未启用：请设置 ADMIN_PASSWORD 环境变量后重启服务。' });
      return;
    }
    if (typeof password !== 'string' || !adminSafeEqual(password, ADMIN_PASSWORD)) {
      socket.emit('admin:login_result', { ok: false, msg: '密码错误。' });
      return;
    }
    socket.data.admin = true;
    adminSockets.add(socket);
    socket.emit('admin:login_result', { ok: true, rooms: adminRoomsPayload() });
  });

  socket.on('admin:watch', ({ code } = {}) => {
    if (!socket.data.admin) return;
    const upper = String(code ?? '').toUpperCase().trim().slice(0, 6);
    const room = rooms.get(upper);
    if (!room) {
      socket.emit('admin:watch_result', { ok: false, msg: '房间不存在或已关闭。' });
      return;
    }
    if (socket.data.adminWatch && socket.data.adminWatch !== room.code) socket.leave(socket.data.adminWatch);
    socket.data.adminWatch = room.code;
    // 只加入广播频道，不写入 players/playerRooms：观战不影响对局与人数
    socket.join(room.code);
    socket.emit('admin:watch_result', { ok: true, snapshot: adminSnapshot(room) });
  });

  socket.on('admin:unwatch', () => {
    if (socket.data.adminWatch) socket.leave(socket.data.adminWatch);
    socket.data.adminWatch = null;
  });

  socket.on('disconnect', () => {
    adminSockets.delete(socket);
    const room = getRoom(socket.id);
    if (!room) return;
    const player = room.players.get(socket.id);
    const name = player?.name || '有位玩家';
    room.players.delete(socket.id);
    playerRooms.delete(socket.id);
    if (room.players.size === 0) { clearTimers(room); rooms.delete(room.code); return; }
    if (room.host === socket.id) room.host = room.players.keys().next().value;
    broadcastLobby(room);
    io.to(room.code).emit('notification', `${name} 离开了房间`);
    if (room.status === 'playing') onPlayerDisconnect(room, socket.id, name);
  });
});

// ─────────────────────────── HELPERS ───────────────────────────

function sendReconnectState(room, socket) {
  const gs = room.gameState;
  if (!gs) { broadcastLobby(room); return; }
  switch (room.gameType) {
    case 'tictactoe': {
      if (gs.mode === 'tournament') {
        socket.emit('ttt:tournament_state', tttTournamentPublic(gs));
        if (gs.board) socket.emit('ttt:state', tttPublic(gs));
        const sym = gs.players?.X?.id === socket.id ? 'X' : gs.players?.O?.id === socket.id ? 'O' : null;
        socket.emit('ttt:symbol', { symbol: sym });
      } else {
        socket.emit('ttt:state', tttPublic(gs));
        const sym = gs.players.X.id === socket.id ? 'X' : gs.players.O.id === socket.id ? 'O' : null;
        socket.emit('ttt:symbol', { symbol: sym });
      }
      break;
    }
    case 'gomoku': {
      socket.emit('gk:state', gkPublic(gs));
      const color = gs.players?.black.id === socket.id ? 'black'
        : gs.players?.white.id === socket.id ? 'white' : null;
      socket.emit('gk:color', { color });
      break;
    }
    case 'killerdoctor': {
      const pd = gs.playerData?.[socket.id];
      if (pd) socket.emit('kd:reconnect', { role: pd.role, phase: gs.phase, alive: pd.alive, avatar: pd.avatar ?? 0 });
      break;
    }
    case 'scribble':
      socket.emit('scribble:reconnect', {
        phase: gs.phase, drawerId: gs.drawerOrder[gs.drawerIndex],
        scores: gs.scores, drawingData: gs.drawingData, masked: gs.masked,
        players: scribblePlayers(room), round: gs.round, maxRounds: gs.maxRounds,
      });
      break;
    case 'uno':
      socket.emit('uno:state', unoPublic(gs));
      if (gs.hands[socket.id]) socket.emit('uno:hand', { hand: gs.hands[socket.id] });
      break;
  }
}

function restartGame(room) {
  clearTimers(room);
  room.status = 'playing';
  room.gameState = null;
  io.to(room.code).emit('game:starting');
  addTimer(room, () => ({ tictactoe: startTTT, killerdoctor: startKD, scribble: startScribble, gomoku: startGK, uno: startUno })[room.gameType]?.(room), 3200);
}

function handleAction(room, socket, data) {
  const gs = room.gameState; if (!gs) return;
  switch (room.gameType) {
    case 'tictactoe':
      if (data.action === 'move')     tttMove(room, socket, data.index);
      if (data.action === 'new_game' && room.gameState?.mode !== 'tournament') tttNewGame(room);
      break;
    case 'gomoku':
      if (data.action === 'gk_move')    gkMove(room, socket, data.r, data.c);
      if (data.action === 'new_game')   gkNewGame(room);
      break;
    case 'killerdoctor': kdAction(room, socket, data); break;
    case 'scribble':     scribbleAction(room, socket, data); break;
    case 'uno':          unoAction(room, socket, data); break;
  }
}

function handleChat(room, socket, player, message) {
  const gs = room.gameState;

  if (room.gameType === 'scribble' && gs?.phase === 'drawing') {
    const drawerId = gs.drawerOrder[gs.drawerIndex];
    if (socket.id === drawerId || gs.guessedThisRound.has(socket.id)) return;
    const guess = message.toLowerCase().trim();
    const word  = gs.word.toLowerCase().trim();
    if (guess === word) {
      gs.guessedThisRound.add(socket.id);
      const elapsed   = (Date.now() - gs.roundStartTime) / 1000;
      const remaining = Math.max(0, gs.ROUND_DURATION - elapsed);
      const points    = Math.round(100 + (remaining / gs.ROUND_DURATION) * 200);
      gs.scores[socket.id]  = (gs.scores[socket.id]  || 0) + points;
      gs.scores[drawerId]   = (gs.scores[drawerId]   || 0) + 50;
      socket.emit('scribble:correct_guess', { word: gs.word, points });
      io.to(room.code).emit('scribble:guess_event', { playerId: socket.id, playerName: player.name, correct: true, scores: gs.scores });
      const nonDrawers = [...room.players.keys()].filter(id => id !== drawerId);
      if (gs.guessedThisRound.size >= nonDrawers.length) { clearTimers(room); endScribbleRound(room, true); }
    } else {
      io.to(room.code).emit('chat:message', { playerId: socket.id, playerName: player.name, message });
    }
    return;
  }

  if (room.gameType === 'killerdoctor' && gs) {
    const pd = gs.playerData?.[socket.id];
    if (!pd?.alive || gs.phase !== 'day_discussion') return;
  }

  io.to(room.code).emit('chat:message', { playerId: socket.id, playerName: player.name, message });
}

function onPlayerDisconnect(room, sid, name) {
  const gs = room.gameState; if (!gs) return;
  switch (room.gameType) {
    case 'killerdoctor':
      if (gs.playerData?.[sid]) gs.playerData[sid].alive = false;
      { const win = kdCheckWin(gs);
        if (win) { clearTimers(room); endKD(room, win); }
        else if (kdAlive(gs).length < minPlayers(room.gameType)) { clearTimers(room); endKD(room, { winner: 'abandoned', reason: '人不够了，游戏没法继续。' }); }
        else if (gs.phase === 'night') checkNightDone(room); }
      break;
    case 'tictactoe':
      if (gs.mode === 'tournament' && gs.players) {
        const isActive = gs.players.X.id === sid || gs.players.O.id === sid;
        if (isActive) {
          const winnerId = gs.players.X.id === sid ? gs.players.O.id : gs.players.X.id;
          if (gs.allPlayers[winnerId]) {
            gs.rounds[gs.currentRound][gs.currentMatch].winner = winnerId;
            delete gs.allPlayers[sid];
            io.to(room.code).emit('notification', `${name} 中途退场，${gs.allPlayers[winnerId]?.name} 直接晋级！`);
            io.to(room.code).emit('ttt:tournament_state', tttTournamentPublic(gs));
            clearTimers(room);
            addTimer(room, () => advanceTournament(room), 2000);
          }
        }
      } else if (gs.players?.X?.id === sid || gs.players?.O?.id === sid) {
        clearTurnTimer(room);
        gs.turnEndsAt = 0;
        const winnerKey = gs.players.X.id === sid ? 'O' : 'X';
        const winner = gs.players[winnerKey];
        if (winner && !gs.winner && !gs.matchWinner) {
          gs.winner = winner.id;
          gs.winnerSymbol = winnerKey;
          gs.scores[winner.id] = (gs.scores[winner.id] || 0) + 1;
          if (gs.bestOf > 0 && gs.scores[winner.id] >= Math.ceil(gs.bestOf / 2)) {
            gs.matchWinner = winner.id;
          }
          // 战绩记账口径与 tttMove 保持一致：自由对战不记账，系列赛仅在决出整场胜者时记一次
          if (gs.matchWinner) recordResult(room, [winner.id]);
          io.to(room.code).emit('notification', `${name} 离开了对局，${winner.name} 获胜！`);
          io.to(room.code).emit('ttt:state', tttPublic(gs));
        }
        io.to(room.code).emit('ttt:player_left', { name });
      }
      break;
    case 'gomoku':
      if (gs.mode !== 'pve' && (gs.players?.black.id === sid || gs.players?.white.id === sid)) {
        clearTurnTimer(room);
        gs.turnEndsAt = 0;
        const remainingId = gs.players.black.id === sid ? gs.players.white.id : gs.players.black.id;
        const winnerColor = gs.players.black.id === remainingId ? 'black' : 'white';
        if (!gs.winner) {
          gs.winner = winnerColor;
          gs.scores[remainingId] = (gs.scores[remainingId] || 0) + 1;
          recordResult(room, [remainingId], [remainingId]);
          io.to(room.code).emit('notification', `${name} 离开了对局，${gs.players[winnerColor]?.name} 获胜！`);
          io.to(room.code).emit('gk:state', gkPublic(gs));
        }
        io.to(room.code).emit('gk:player_left', { name });
      }
      break;
    case 'scribble': {
      const idx = gs.drawerOrder.indexOf(sid); if (idx !== -1) gs.drawerOrder.splice(idx, 1);
      if (gs.drawerIndex >= gs.drawerOrder.length) gs.drawerIndex = 0;
      delete gs.scores[sid];
      const nonDrawers = [...room.players.keys()].filter(id => id !== gs.drawerOrder[gs.drawerIndex]);
      if (!gs.drawerOrder.length || nonDrawers.length === 0) { clearTimers(room); endScribbleGame(room); }
      else if ((gs.phase === 'drawing' || gs.phase === 'choosing') && sid === gs.drawerOrder[gs.drawerIndex]) {
        clearTimers(room); endScribbleRound(room, false);
      }
      break;
    }
    case 'uno': {
      const idx = gs.playerOrder.indexOf(sid);
      if (idx === -1) break;
      const wasCurrentPlayer = gs.currentPlayerIndex === idx;
      gs.playerOrder.splice(idx, 1);
      delete gs.hands[sid];
      delete gs.unoSaid[sid];
      if (gs.playerOrder.length < 2) {
        if (gs.playerOrder.length === 1) endUno(room, gs.playerOrder[0]);
        break;
      }
      if (idx < gs.currentPlayerIndex) {
        gs.currentPlayerIndex--;
      } else if (idx === gs.currentPlayerIndex && gs.currentPlayerIndex >= gs.playerOrder.length) {
        gs.currentPlayerIndex = 0;
      }
      if (wasCurrentPlayer && gs.phase === 'choose_color') {
        gs.currentColor = UNO_COLORS[Math.floor(Math.random() * 4)];
        gs.phase = 'playing';
      }
      gs.awaitingPass = false;
      gs.drawnCardIndex = -1;
      if (wasCurrentPlayer) {
        resetUnoTurnTimer(room);
      }
      io.to(room.code).emit('uno:state', unoPublic(gs));
      break;
    }
  }
}

// ─────────────────────── SESSION STATS ───────────────────────

function recordResult(room, winnerIds, allIds) {
  if (!room.sessionStats) room.sessionStats = {};
  const ids = allIds || [...room.players.keys()];
  ids.forEach(pid => {
    const name = room.players.get(pid)?.name || room.sessionStats[pid]?.name || '?';
    if (!room.sessionStats[pid]) room.sessionStats[pid] = { name, wins: 0, gamesPlayed: 0 };
    else room.sessionStats[pid].name = name;
    room.sessionStats[pid].gamesPlayed++;
  });
  winnerIds.forEach(pid => { if (room.sessionStats[pid]) room.sessionStats[pid].wins++; });
}

// ─────────────────────── TIC TAC TOE ───────────────────────

function nextPow2(n) { let p = 1; while (p < n) p <<= 1; return p; }

function buildTournamentRounds(playerIds) {
  const size = nextPow2(playerIds.length);
  const seeds = [...playerIds];
  while (seeds.length < size) seeds.push(null);
  const rounds = [];
  let current = seeds;
  let prevPhantoms = null;
  while (current.length > 1) {
    const matches = [];
    const phantoms = [];
    for (let i = 0; i < current.length; i += 2) {
      const p1 = current[i], p2 = current[i + 1] ?? null;
      const isBye = p2 === null;
      // A match is phantom when no real player will ever appear in it.
      // Round 0: phantom iff both seeds are null.
      // Later rounds: phantom iff BOTH feeding matches were phantom.
      const phantom = prevPhantoms === null
        ? (p1 === null && p2 === null)
        : ((prevPhantoms[i] ?? true) && (prevPhantoms[i + 1] ?? true));
      matches.push({ p1, p2, winner: isBye ? p1 : null, isBye, phantom });
      phantoms.push(phantom);
    }
    rounds.push(matches);
    prevPhantoms = phantoms;
    current = new Array(matches.length).fill(null);
  }
  return rounds;
}

function propagateTournamentWinners(gs) {
  for (let r = 0; r < gs.rounds.length - 1; r++) {
    const cur = gs.rounds[r], nxt = gs.rounds[r + 1];
    for (let m = 0; m < cur.length; m += 2) {
      const ti = Math.floor(m / 2);
      if (ti >= nxt.length) break;
      const match1 = cur[m], match2 = cur[m + 1];
      if (match1?.winner) nxt[ti].p1 = match1.winner;
      if (match2?.winner) nxt[ti].p2 = match2.winner;
      // Only auto-advance when the other slot is permanently empty (phantom match or missing)
      const m2empty = !match2 || match2.phantom;
      const m1empty = !match1 || match1.phantom;
      if (nxt[ti].p1 && !nxt[ti].p2 && !nxt[ti].winner && m2empty) { nxt[ti].winner = nxt[ti].p1; nxt[ti].isBye = true; }
      if (nxt[ti].p2 && !nxt[ti].p1 && !nxt[ti].winner && m1empty) { nxt[ti].winner = nxt[ti].p2; nxt[ti].isBye = true; }
    }
  }
}

function advanceTournament(room) {
  const gs = room.gameState;
  propagateTournamentWinners(gs);
  const finalMatch = gs.rounds[gs.rounds.length - 1][0];
  if (finalMatch.winner) {
    gs.tournamentWinner = finalMatch.winner;
    gs.board = null; gs.players = null; room.status = 'ended';
    recordResult(room, [gs.tournamentWinner], Object.keys(gs.allPlayers));
    io.to(room.code).emit('ttt:tournament_over', {
      winner: gs.allPlayers[gs.tournamentWinner],
      rounds: gs.rounds, allPlayers: gs.allPlayers,
    });
    return;
  }
  for (let r = 0; r < gs.rounds.length; r++) {
    for (let m = 0; m < gs.rounds[r].length; m++) {
      const match = gs.rounds[r][m];
      if (!match.winner && match.p1 && match.p2) {
        gs.currentRound = r; gs.currentMatch = m;
        startTournamentMatch(room, match.p1, match.p2);
        return;
      }
    }
  }
}

function startTournamentMatch(room, p1Id, p2Id) {
  const gs = room.gameState;
  const p1 = gs.allPlayers[p1Id], p2 = gs.allPlayers[p2Id];
  if (!p1 || !p2) { advanceTournament(room); return; }
  const [X, O] = Math.random() < 0.5 ? [p1, p2] : [p2, p1];
  gs.board = Array(9).fill(null);
  gs.players = { X: { id: X.id, name: X.name }, O: { id: O.id, name: O.name } };
  gs.currentTurn = X.id;
  gs.winner = null; gs.winLine = null; gs.winnerSymbol = null;
  resetTTTTurnTimer(room);
  io.to(room.code).emit('ttt:state', tttPublic(gs));
  io.to(room.code).emit('ttt:tournament_state', tttTournamentPublic(gs));
  io.to(X.id).emit('ttt:symbol', { symbol: 'X' });
  io.to(O.id).emit('ttt:symbol', { symbol: 'O' });
  Object.keys(gs.allPlayers).filter(id => id !== X.id && id !== O.id).forEach(id => io.to(id).emit('ttt:symbol', { symbol: null }));
}

function tttTournamentPublic(gs) {
  return {
    rounds: gs.rounds, allPlayers: gs.allPlayers,
    currentRound: gs.currentRound, currentMatch: gs.currentMatch,
    tournamentWinner: gs.tournamentWinner,
    currentPlayerIds: gs.players ? [gs.players.X.id, gs.players.O.id] : [],
  };
}

function resetTTTTurnTimer(room) {
  clearTurnTimer(room);
  const gs = room.gameState;
  const turnTime = Number(room.settings?.turnTime || 0);
  if (!gs || gs.winner || (gs.mode !== 'tournament' && gs.matchWinner) || turnTime <= 0 || !gs.currentTurn) {
    if (gs) gs.turnEndsAt = 0;
    return;
  }
  gs.turnEndsAt = Date.now() + turnTime * 1000;
  room.turnTimer = setTimeout(() => {
    room.turnTimer = null;
    tttTimeoutAutoplay(room);
  }, turnTime * 1000);
}

function tttTimeoutAutoplay(room) {
  const gs = room.gameState;
  if (!gs || !gs.board || gs.winner || (gs.mode !== 'tournament' && gs.matchWinner) || !gs.currentTurn) return;
  const empty = [];
  for (let i = 0; i < 9; i++) {
    if (gs.board[i] === null) empty.push(i);
  }
  if (empty.length === 0) return;
  const pick = empty[Math.floor(Math.random() * empty.length)];
  const curPlayer = gs.players?.X?.id === gs.currentTurn ? gs.players.X : gs.players?.O;
  io.to(room.code).emit('notification', `${curPlayer?.name || '玩家'} 思考超时，系统已自动随机落子`);
  tttMove(room, { id: gs.currentTurn }, pick);
}

function startTTT(room) {
  const players = [...room.players.values()].sort(() => Math.random() - 0.5);
  const bestOf = room.settings?.bestOf ?? 0;

  if (players.length >= 3) {
    const allPlayers = {};
    players.forEach(p => { allPlayers[p.id] = { id: p.id, name: p.name }; });
    const rounds = buildTournamentRounds(players.map(p => p.id));
    room.gameState = {
      type: 'tictactoe', mode: 'tournament',
      allPlayers, rounds, currentRound: 0, currentMatch: 0,
      board: null, players: null, currentTurn: null,
      winner: null, winLine: null, winnerSymbol: null, tournamentWinner: null,
      turnEndsAt: 0,
    };
    io.to(room.code).emit('ttt:tournament_state', tttTournamentPublic(room.gameState));
    addTimer(room, () => advanceTournament(room), 2000);
  } else {
    const X = players[0], O = players[1];
    room.gameState = {
      type: 'tictactoe', mode: 'classic',
      board: Array(9).fill(null),
      players: { X: { id: X.id, name: X.name }, O: { id: O.id, name: O.name } },
      currentTurn: X.id,
      winner: null, winLine: null, winnerSymbol: null,
      scores: { [X.id]: 0, [O.id]: 0 },
      gameCount: 1, bestOf, matchWinner: null,
      turnEndsAt: 0,
    };
    resetTTTTurnTimer(room);
    io.to(room.code).emit('ttt:state', tttPublic(room.gameState));
    io.to(X.id).emit('ttt:symbol', { symbol: 'X' });
    io.to(O.id).emit('ttt:symbol', { symbol: 'O' });
    players.filter(p => p.id !== X.id && p.id !== O.id).forEach(p => io.to(p.id).emit('ttt:symbol', { symbol: null }));
  }
}

function tttMove(room, socket, index) {
  const gs = room.gameState;
  if (!gs.board || gs.winner || (gs.mode !== 'tournament' && gs.matchWinner) || gs.currentTurn !== socket.id) return;
  if (index < 0 || index > 8 || gs.board[index] !== null) return;
  const sym = gs.players.X.id === socket.id ? 'X' : gs.players.O.id === socket.id ? 'O' : null;
  if (!sym) return;
  gs.board[index] = sym;
  const win = tttWin(gs.board);
  if (win) {
    clearTurnTimer(room);
    gs.turnEndsAt = 0;
    gs.winner = socket.id; gs.winnerSymbol = sym; gs.winLine = win;
    if (gs.mode === 'tournament') {
      gs.rounds[gs.currentRound][gs.currentMatch].winner = socket.id;
      io.to(room.code).emit('ttt:state', tttPublic(gs));
      io.to(room.code).emit('ttt:tournament_state', tttTournamentPublic(gs));
      addTimer(room, () => advanceTournament(room), 4000);
    } else {
      gs.scores[socket.id] = (gs.scores[socket.id] || 0) + 1;
      if (gs.bestOf > 0) {
        const needed = Math.ceil(gs.bestOf / 2);
        if (gs.scores[socket.id] >= needed) {
          gs.matchWinner = socket.id;
          recordResult(room, [socket.id]);
        }
      }
      io.to(room.code).emit('ttt:state', tttPublic(gs));
    }
  } else if (gs.board.every(Boolean)) {
    clearTurnTimer(room);
    gs.turnEndsAt = 0;
    gs.winner = 'draw';
    io.to(room.code).emit('ttt:state', tttPublic(gs));
    if (gs.mode === 'tournament') {
      const { p1, p2 } = gs.rounds[gs.currentRound][gs.currentMatch];
      addTimer(room, () => startTournamentMatch(room, p1, p2), 2500);
    }
  } else {
    gs.currentTurn = gs.currentTurn === gs.players.X.id ? gs.players.O.id : gs.players.X.id;
    resetTTTTurnTimer(room);
    io.to(room.code).emit('ttt:state', tttPublic(gs));
  }
}

function tttNewGame(room) {
  const gs = room.gameState;
  if (!gs || gs.mode === 'tournament' || gs.matchWinner) return;
  // 任一对局方已离场/被踢（gs.players 是开局快照）时禁止与“幽灵”续局
  if (!room.players.has(gs.players.X.id) || !room.players.has(gs.players.O.id)) return;
  const tmp = gs.players.X; gs.players.X = gs.players.O; gs.players.O = tmp;
  gs.board = Array(9).fill(null);
  gs.currentTurn = gs.players.X.id;
  gs.winner = null; gs.winLine = null; gs.winnerSymbol = null;
  gs.gameCount++;
  resetTTTTurnTimer(room);
  io.to(room.code).emit('ttt:state', tttPublic(gs));
  io.to(gs.players.X.id).emit('ttt:symbol', { symbol: 'X' });
  io.to(gs.players.O.id).emit('ttt:symbol', { symbol: 'O' });
}

function tttWin(board) {
  const lines = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
  for (const [a,b,c] of lines) if (board[a] && board[a] === board[b] && board[a] === board[c]) return [a,b,c];
  return null;
}

function tttPublic(gs) {
  return {
    mode: gs.mode || 'classic',
    board: gs.board, currentTurn: gs.currentTurn, players: gs.players,
    winner: gs.winner, winLine: gs.winLine, winnerSymbol: gs.winnerSymbol,
    scores: gs.scores || {}, gameCount: gs.gameCount || 1,
    bestOf: gs.bestOf || 0, matchWinner: gs.matchWinner || null,
    turnEndsAt: gs.turnEndsAt || 0,
  };
}

// ─────────────────────── GOMOKU (五子棋) ───────────────────────

const GK_AI_ID = '__gomoku_ai__';
const GK_AI_PLAYER = { id: GK_AI_ID, name: 'AI 机器人', isAI: true };

function resetGKTurnTimer(room) {
  clearTurnTimer(room);
  const gs = room.gameState;
  const turnTime = Number(room.settings?.turnTime || 0);
  if (!gs || gs.winner || turnTime <= 0) {
    if (gs) gs.turnEndsAt = 0;
    return;
  }
  if (gs.players[gs.current]?.isAI) {
    gs.turnEndsAt = 0;
    return;
  }
  gs.turnEndsAt = Date.now() + turnTime * 1000;
  room.turnTimer = setTimeout(() => {
    room.turnTimer = null;
    gkTimeoutAutoplay(room);
  }, turnTime * 1000);
}

function gkTimeoutAutoplay(room) {
  const gs = room.gameState;
  if (!gs || gs.winner || gs.players[gs.current]?.isAI) return;
  const piece = gs.current === 'black' ? GKAI.BLACK : GKAI.WHITE;
  const m = GKAI.chooseMove(gs.board, gs.difficulty || 'normal', piece);
  if (!m || gs.board[m.r]?.[m.c] !== GKAI.EMPTY) return;
  const curPlayer = gs.players[gs.current];
  io.to(room.code).emit('notification', `${curPlayer?.name || '玩家'} 思考超时，系统已自动代为落子`);
  gkPlace(room, m.r, m.c, gs.current);
}

/** 开局：人人随机定黑白；人机固定玩家执黑、AI 执白 */
function startGK(room) {
  const players = [...room.players.values()].sort(() => Math.random() - 0.5);
  const size = room.settings?.boardSize ?? 15;
  const mode = room.settings?.mode === 'pve' ? 'pve' : 'pvp';
  const difficulty = ['easy','normal','hard'].includes(room.settings?.aiDifficulty) ? room.settings.aiDifficulty : 'normal';

  let black, white;
  if (mode === 'pve') {
    black = { id: players[0].id, name: players[0].name };
    white = { ...GK_AI_PLAYER };
  } else {
    black = { id: players[0].id, name: players[0].name };
    white = { id: players[1].id, name: players[1].name };
  }

  room.gameState = {
    type: 'gomoku', mode, size, difficulty,
    board: GKAI.createBoard(size),
    current: 'black',
    players: { black, white },
    winner: null, winLine: null, lastMove: null, moves: 0,
    scores: { [black.id]: 0, [white.id]: 0 },
    gameCount: 1,
    turnEndsAt: 0,
  };

  resetGKTurnTimer(room);
  io.to(room.code).emit('gk:state', gkPublic(room.gameState));
  const colorOf = id => (id === black.id ? 'black' : id === white.id ? 'white' : null);
  players.forEach(p => io.to(p.id).emit('gk:color', { color: colorOf(p.id) }));
}

/** 玩家落子校验入口 */
function gkMove(room, socket, r, c) {
  const gs = room.gameState;
  if (!gs || gs.winner) return;
  if (!Number.isInteger(r) || !Number.isInteger(c) || r < 0 || c < 0 || r >= gs.size || c >= gs.size) return;
  if (gs.board[r][c] !== GKAI.EMPTY) return;
  const color = gs.players.black.id === socket.id ? 'black'
    : gs.players.white.id === socket.id ? 'white' : null;
  if (!color || gs.current !== color) return;
  gkPlace(room, r, c, color);
}

/** 放置一子并推进局面（胜负/平局/换手，人机局调度 AI） */
function gkPlace(room, r, c, color) {
  const gs = room.gameState;
  const piece = color === 'black' ? GKAI.BLACK : GKAI.WHITE;
  gs.board[r][c] = piece;
  gs.lastMove = [r, c];
  gs.moves++;

  const win = GKAI.checkWinAt(gs.board, r, c, piece);
  if (win) {
    clearTurnTimer(room);
    gs.turnEndsAt = 0;
    gs.winner = color;
    gs.winLine = win;
    gs.scores[gs.players[color].id]++;
    const realIds = [gs.players.black.id, gs.players.white.id].filter(id => id !== GK_AI_ID);
    recordResult(room, gs.players[color].isAI ? [] : [gs.players[color].id], realIds);
    io.to(room.code).emit('gk:state', gkPublic(gs));
    return;
  }
  if (gs.moves >= gs.size * gs.size) {
    clearTurnTimer(room);
    gs.turnEndsAt = 0;
    gs.winner = 'draw';
    io.to(room.code).emit('gk:state', gkPublic(gs));
    return;
  }

  gs.current = color === 'black' ? 'white' : 'black';
  resetGKTurnTimer(room);
  io.to(room.code).emit('gk:state', gkPublic(gs));
  if (gs.mode === 'pve' && gs.players[gs.current]?.isAI) gkScheduleAI(room, gs);
}

/** 延迟一小段时间后由 AI 落子，营造思考节奏 */
function gkScheduleAI(room, gsRef) {
  const delay = 500 + Math.random() * 500;
  addTimer(room, () => {
    // 房间已重开/返回大厅时放弃本次调度
    if (room.gameState !== gsRef || gsRef.winner) return;
    if (!gsRef.players[gsRef.current]?.isAI) return;
    const piece = gsRef.current === 'white' ? GKAI.WHITE : GKAI.BLACK;
    const m = GKAI.chooseMove(gsRef.board, gsRef.difficulty, piece);
    if (gsRef.board[m.r]?.[m.c] !== GKAI.EMPTY) return;
    gkPlace(room, m.r, m.c, gsRef.current);
  }, delay);
}

/** 下一局：人人交换黑白，人机玩家始终执黑；比分累计 */
function gkNewGame(room) {
  const gs = room.gameState;
  if (!gs) return;
  // 人人对局任一方已离场/被踢时禁止续局（人机局白方是 AI，不在 room.players 中）
  if (gs.mode !== 'pve' && (!room.players.has(gs.players.black.id) || !room.players.has(gs.players.white.id))) return;
  if (gs.mode !== 'pve') {
    const tmp = gs.players.black;
    gs.players.black = gs.players.white;
    gs.players.white = tmp;
  }
  gs.board = GKAI.createBoard(gs.size);
  gs.current = 'black';
  gs.winner = null;
  gs.winLine = null;
  gs.lastMove = null;
  gs.moves = 0;
  gs.gameCount++;
  gs.turnEndsAt = 0;
  resetGKTurnTimer(room);
  io.to(room.code).emit('gk:state', gkPublic(gs));
  const colorOf = id => (id === gs.players.black.id ? 'black' : id === gs.players.white.id ? 'white' : null);
  [...room.players.keys()].forEach(id => io.to(id).emit('gk:color', { color: colorOf(id) }));
}

/** 对外状态：AI 棋子信息原样下发，棋盘为二维数组 */
function gkPublic(gs) {
  return {
    mode: gs.mode, size: gs.size, difficulty: gs.difficulty,
    board: gs.board, current: gs.current, players: gs.players,
    winner: gs.winner, winLine: gs.winLine, lastMove: gs.lastMove,
    scores: gs.scores, gameCount: gs.gameCount,
    turnEndsAt: gs.turnEndsAt || 0,
  };
}

// ─────────────────────── KILLER DOCTOR ───────────────────────

function startKD(room) {
  const players = [...room.players.values()].sort(() => Math.random() - 0.5);
  const maxDoctors = Math.max(1, Math.floor(players.length / 5));
  const numDoctors = Math.floor(Math.random() * maxDoctors) + 1;
  const playerData = {};
  players.forEach((p, i) => {
    playerData[p.id] = { id: p.id, name: p.name, avatar: p.avatar ?? 0,
      role: i === 0 ? 'killer' : i <= numDoctors ? 'doctor' : 'villager',
      alive: true, hasActedNight: false, nightChoice: null, vote: null };
  });
  room.gameState = { type: 'killerdoctor', phase: 'role_reveal', playerData, round: 1, history: [] };
  players.forEach(p => io.to(p.id).emit('kd:role_assigned', {
    role: playerData[p.id].role,
    allPlayers: players.map(q => kdPub(playerData[q.id])),
  }));
  addTimer(room, () => kdStartNight(room), 6000);
}

function kdStartNight(room) {
  const gs = room.gameState;
  gs.phase = 'night';
  Object.values(gs.playerData).forEach(p => { p.hasActedNight = false; p.nightChoice = null; p.vote = null; });
  const alive = kdAlive(gs);
  io.to(room.code).emit('kd:night_start', {
    round: gs.round,
    livingPlayers: alive.map(kdPub),
    deadPlayers: kdDead(gs).map(kdPub),
  });
  const nightTime = room.settings?.nightTime ?? 90;
  addTimer(room, () => { if (room.gameState?.phase !== 'night') return; kdAutoNight(room); checkNightDone(room); }, nightTime * 1000);
}

function kdAutoNight(room) {
  const gs = room.gameState;
  const alive = kdAlive(gs);
  const killer = kdRole(gs, 'killer');
  if (killer?.alive && !killer.hasActedNight) {
    const targets = alive.filter(p => p.id !== killer.id);
    if (targets.length) { killer.nightChoice = targets[Math.floor(Math.random()*targets.length)].id; killer.hasActedNight = true; }
  }
  kdRoles(gs, 'doctor').forEach(doctor => {
    if (doctor.alive && !doctor.hasActedNight) { doctor.nightChoice = doctor.id; doctor.hasActedNight = true; }
  });
  alive.forEach(p => { if (!p.hasActedNight) p.hasActedNight = true; });
}

function kdResolveNight(room) {
  const gs = room.gameState; gs.phase = 'night_resolution';
  const killer = kdRole(gs, 'killer');
  const kChoice = killer?.nightChoice;
  const dChoices = new Set(kdRoles(gs, 'doctor').filter(d => d.alive).map(d => d.nightChoice).filter(Boolean));
  let died = null, saved = false;
  if (kChoice) {
    if (dChoices.has(kChoice)) saved = true;
    else { died = kChoice; gs.playerData[died].alive = false; }
  }
  const msg = saved ? '医生出手相救！昨晚无人死亡。'
    : died ? `今天一早发现了 ${gs.playerData[died].name} 的尸体。`
    : '一夜平安，啥事没有。';
  if (died) gs.history.push({ name: gs.playerData[died].name, reason: 'night_kill', round: gs.round });
  io.to(room.code).emit('kd:night_result', {
    message: msg,
    died: died ? kdPub(gs.playerData[died]) : null,
    saved,
    livingPlayers: kdAlive(gs).map(kdPub),
    deadPlayers: kdDead(gs).map(kdPub),
  });
  const win = kdCheckWin(gs);
  if (win) { addTimer(room, () => endKD(room, win), 3500); return; }
  addTimer(room, () => kdStartDay(room), 4000);
}

function checkNightDone(room) {
  const gs = room.gameState; if (gs?.phase !== 'night') return;
  if (!kdAlive(gs).every(p => p.hasActedNight)) return;
  clearTimers(room);
  const delay = 1000 + Math.random() * 4000;
  addTimer(room, () => kdResolveNight(room), delay);
}

function kdStartDay(room) {
  const gs = room.gameState; gs.phase = 'day_discussion';
  const dur = room.settings?.discussionTime ?? 120;
  io.to(room.code).emit('kd:day_start', {
    round: gs.round, duration: dur,
    livingPlayers: kdAlive(gs).map(kdPub),
    deadPlayers: kdDead(gs).map(kdPub),
  });
  addTimer(room, () => { if (room.gameState?.phase === 'day_discussion') kdStartVoting(room); }, dur * 1000);
}

function kdStartVoting(room) {
  const gs = room.gameState; gs.phase = 'voting';
  Object.values(gs.playerData).forEach(p => { p.vote = null; });
  const dur = room.settings?.votingTime ?? 60;
  io.to(room.code).emit('kd:voting_start', {
    duration: dur,
    livingPlayers: kdAlive(gs).map(kdPub),
    deadPlayers: kdDead(gs).map(kdPub),
  });
  addTimer(room, () => { if (room.gameState?.phase === 'voting') kdResolveVoting(room); }, dur * 1000);
}

function kdResolveVoting(room) {
  const gs = room.gameState; gs.phase = 'vote_resolution';
  const tally = {};
  Object.values(gs.playerData).forEach(p => { if (p.alive && p.vote) tally[p.vote] = (tally[p.vote]||0) + 1; });
  let maxV = 0, elim = null, tied = false;
  Object.entries(tally).forEach(([pid, cnt]) => {
    if (cnt > maxV) { maxV = cnt; elim = pid; tied = false; }
    else if (cnt === maxV) tied = true;
  });
  let elimPlayer = null;
  if (!tied && elim && maxV > 0) {
    elimPlayer = gs.playerData[elim]; elimPlayer.alive = false;
    gs.history.push({ name: elimPlayer.name, reason: 'vote', role: elimPlayer.role, round: gs.round });
  }
  const voteDetails = Object.entries(tally).map(([pid,cnt]) => ({ ...kdPub(gs.playerData[pid]), votes: cnt }));
  io.to(room.code).emit('kd:vote_result', {
    tied, voteDetails,
    eliminated: elimPlayer ? { ...kdPub(elimPlayer), role: elimPlayer.role } : null,
    message: tied ? '平票！这轮没人出局。'
      : elimPlayer ? `${elimPlayer.name} 被村民们投出局了！`
      : '这轮没人出局。',
    livingPlayers: kdAlive(gs).map(kdPub),
    deadPlayers: kdDead(gs).map(kdPub),
  });
  const win = kdCheckWin(gs);
  if (win) { addTimer(room, () => endKD(room, win), 5000); return; }
  gs.round++;
  addTimer(room, () => kdStartNight(room), 5000);
}

function kdCheckWin(gs) {
  const killer = kdRole(gs,'killer');
  if (!killer?.alive) return { winner: 'villagers', reason: '杀手已被正法！' };
  if (kdAlive(gs).length <= 2) return { winner: 'killer', reason: '杀手已经无人能挡！' };
  return null;
}

function endKD(room, win) {
  const gs = room.gameState; gs.phase = 'game_over'; room.status = 'ended';
  const allKdIds = Object.keys(gs.playerData);
  const kdKiller = kdRole(gs, 'killer');
  const winnerIds = win.winner === 'villagers'
    ? allKdIds.filter(id => gs.playerData[id]?.role !== 'killer')
    : [kdKiller?.id].filter(Boolean);
  recordResult(room, winnerIds, allKdIds);
  io.to(room.code).emit('kd:game_over', {
    winner: win.winner, reason: win.reason,
    allPlayers: Object.values(gs.playerData).map(p => ({ ...kdPub(p), role: p.role, alive: p.alive })),
    history: gs.history,
  });
}

function kdAction(room, socket, data) {
  const gs = room.gameState, pd = gs.playerData?.[socket.id];
  if (!pd?.alive) return;
  switch (data.action) {
    case 'night_kill':
      // Any living player may submit a night pick; the screen is identical for all.
      // The pick is stored per-player and only matters for the killer (kill) and
      // doctor (save) at resolution — a villager's pick is an ignored decoy.
      if (gs.phase!=='night'||pd.hasActedNight) return;
      { const t=gs.playerData[data.targetId]; if (!t?.alive||(pd.role==='killer'&&data.targetId===socket.id)) return;
        pd.nightChoice=data.targetId; pd.hasActedNight=true;
        socket.emit('kd:action_confirmed',{action:'night_kill'}); kdBroadcastNightProgress(room); checkNightDone(room); } break;
    case 'vote':
      if (gs.phase!=='voting'||data.targetId===socket.id) return;
      { const t=gs.playerData[data.targetId]; if (!t?.alive) return;
        pd.vote=data.targetId;
        const cast=Object.values(gs.playerData).filter(p=>p.alive&&p.vote!==null).length;
        const total=kdAlive(gs).length;
        io.to(room.code).emit('kd:vote_update',{cast,total});
        socket.emit('kd:vote_confirmed',{targetId:data.targetId,targetName:t.name});
        if (cast>=total){clearTimers(room);kdResolveVoting(room);} } break;
  }
}

function kdBroadcastNightProgress(room) {
  const alive = kdAlive(room.gameState);
  io.to(room.code).emit('kd:night_progress', { confirmed: alive.filter(p => p.hasActedNight).length, total: alive.length });
}

const kdAlive = gs => Object.values(gs.playerData).filter(p => p.alive);
const kdDead  = gs => Object.values(gs.playerData).filter(p => !p.alive);
const kdRole  = (gs, role) => Object.values(gs.playerData).find(p => p.role === role);
const kdRoles = (gs, role) => Object.values(gs.playerData).filter(p => p.role === role);
const kdPub   = p  => ({ id: p.id, name: p.name, avatar: p.avatar ?? 0 });

// ─────────────────────────── SCRIBBLE ───────────────────────────

const WORDS = [
  '苹果','香蕉','城堡','飞龙','大象','烟花','吉他','直升机',
  '冰山','丛林','袋鼠','灯塔','美人鱼','笔记本','章鱼','降落伞',
  '流沙','彩虹','宇宙飞船','望远镜','雨伞','火山','瀑布','木琴',
  '斑马','飞机','气球','指南针','恐龙','信封','喷泉','大猩猩',
  '吊床','海岛','水母','风筝','灯笼','蘑菇','项链','橙子',
  '企鹅','火箭','萨克斯','龙卷风','独角兽','吸血鬼','鲸鱼','仙人掌',
  '蝴蝶','蹦床','篝火','向日葵','机器人','宝藏','海盗','忍者',
  '巫师','幽灵','汉堡包','披萨','船锚','大桥','皇冠','钻石','老鹰',
  '森林','银河','冰屋','骑士','柠檬','显微镜','面条','猫头鹰','河流',
  '沙堡','老虎','小提琴','风车','毛线','动物园','牛油果','西兰花',
  '烟囱','门铃','扶手电梯','火烈鸟','长颈鹿','沙漏','冰柱',
  '杂技演员','钥匙孔','磁铁','独角鲸','画笔','犀牛',
  '潜水艇','温度计','打字机','尤克里里','游艇','飞艇',
  '赛车','冰淇淋','热狗','椰子树','消防栓','过山车',
  '雷阵雨','雪花','生日蛋糕','藏宝箱','轮滑鞋',
];

function randWords(n=3) { return [...WORDS].sort(()=>Math.random()-.5).slice(0,n); }

function maskWord(word, revealed=[]) {
  return word.split('').map((c,i) => c===' ' ? '  ' : revealed.includes(i) ? c : '_').join(' ');
}

function startScribble(room) {
  const players = [...room.players.values()];
  const order = players.map(p => p.id);
  const { drawTime=80, rounds=3, wordChoices=3 } = room.settings || {};
  room.gameState = {
    type:'scribble', phase:'choosing',
    drawerOrder: order, drawerIndex: 0,
    round: 1, maxRounds: rounds,
    word: null, masked: null, revealedIndices: [],
    scores: Object.fromEntries(order.map(id=>[id,0])),
    guessedThisRound: new Set(),
    drawingData: [],
    roundStartTime: null,
    ROUND_DURATION: drawTime,
    wordChoices,
  };
  io.to(room.code).emit('scribble:game_start', { players: scribblePlayers(room), maxRounds: rounds });
  addTimer(room, () => scribbleStartTurn(room), 2000);
}

function scribbleStartTurn(room) {
  const gs = room.gameState;
  while (gs.drawerOrder.length && !room.players.has(gs.drawerOrder[gs.drawerIndex])) {
    gs.drawerOrder.splice(gs.drawerIndex, 1);
    if (gs.drawerIndex >= gs.drawerOrder.length) gs.drawerIndex = 0;
  }
  if (!gs.drawerOrder.length) { endScribbleGame(room); return; }
  const drawerId = gs.drawerOrder[gs.drawerIndex];
  gs.phase='choosing'; gs.word=null; gs.masked=null;
  gs.revealedIndices=[]; gs.guessedThisRound=new Set(); gs.drawingData=[];
  const drawerName = room.players.get(drawerId)?.name;
  io.to(room.code).emit('scribble:turn_start', {
    drawerId, drawerName, round: gs.round, maxRounds: gs.maxRounds,
    scores: gs.scores, players: scribblePlayers(room),
  });
  const wordOpts = randWords(gs.wordChoices || 3);
  io.to(drawerId).emit('scribble:choose_word', { words: wordOpts });
  addTimer(room, () => {
    if (room.gameState?.phase === 'choosing' && !room.gameState.word)
      scribbleWordChosen(room, drawerId, wordOpts[0]);
  }, 15000);
}

function scribbleWordChosen(room, drawerId, word) {
  const gs = room.gameState; if (gs.phase !== 'choosing') return;
  gs.word=word; gs.phase='drawing'; gs.masked=maskWord(word); gs.roundStartTime=Date.now();
  // 全房间广播无词版本（含观战者），画师再单独收到含词版本
  io.to(room.code).emit('scribble:draw_start', { word: null, masked: gs.masked, duration: gs.ROUND_DURATION });
  io.to(drawerId).emit('scribble:draw_start', { word, masked: gs.masked, duration: gs.ROUND_DURATION });
  addTimer(room, () => sendHint(room), 40000);
  addTimer(room, () => sendHint(room), 55000);
  addTimer(room, () => { if (room.gameState?.phase==='drawing') endScribbleRound(room, false); }, gs.ROUND_DURATION*1000);
}

function sendHint(room) {
  const gs = room.gameState; if (!gs||gs.phase!=='drawing') return;
  const word = gs.word;
  const unrevealed = [...Array(word.length).keys()].filter(i=>word[i]!==' '&&!gs.revealedIndices.includes(i));
  if (!unrevealed.length) return;
  const idx = unrevealed[Math.floor(Math.random()*unrevealed.length)];
  gs.revealedIndices.push(idx); gs.masked = maskWord(word, gs.revealedIndices);
  const drawerId = gs.drawerOrder[gs.drawerIndex];
  [...room.players.keys()].filter(id=>id!==drawerId&&!gs.guessedThisRound.has(id))
    .forEach(id=>io.to(id).emit('scribble:hint',{masked:gs.masked}));
}

function endScribbleRound(room, allGuessed) {
  const gs = room.gameState; if (gs.phase!=='drawing'&&gs.phase!=='choosing') return;
  gs.phase='round_end';
  io.to(room.code).emit('scribble:round_end', { word:gs.word, scores:gs.scores, players:scribblePlayers(room), allGuessed });
  addTimer(room, () => advanceScribble(room), 5000);
}

function advanceScribble(room) {
  const gs = room.gameState;
  gs.drawerIndex++;
  if (gs.drawerIndex >= gs.drawerOrder.length) {
    gs.drawerIndex=0; gs.round++;
    if (gs.round > gs.maxRounds) { endScribbleGame(room); return; }
  }
  scribbleStartTurn(room);
}

function endScribbleGame(room) {
  const gs = room.gameState; gs.phase='game_over'; room.status='ended';
  const ranked = scribblePlayers(room).sort((a,b)=>(gs.scores[b.id]||0)-(gs.scores[a.id]||0));
  if (ranked[0]) recordResult(room, [ranked[0].id]);
  io.to(room.code).emit('scribble:game_over', { scores:gs.scores, players:ranked, winner:ranked[0] });
}

// 绘画指令上限与结构白名单：防止伪造超大 stroke 撑爆内存并向全房间广播
const STROKE_LIMIT = 6000;
const isUnitNum = v => Number.isFinite(v) && v >= 0 && v <= 1;
const STROKE_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

/** 将客户端笔画指令收敛为白名单字段；非法返回 null */
function sanitizeStroke(stroke) {
  if (!stroke || typeof stroke !== 'object') return null;
  if (stroke.type === 'begin') {
    if (!STROKE_COLOR_RE.test(stroke.color)) return null;
    if (!['pencil', 'eraser', 'fill'].includes(stroke.tool)) return null;
    if (!Number.isFinite(stroke.size) || stroke.size < 1 || stroke.size > 100) return null;
    if (!isUnitNum(stroke.nx) || !isUnitNum(stroke.ny)) return null;
    return { type: 'begin', nx: stroke.nx, ny: stroke.ny, color: stroke.color, size: stroke.size, tool: stroke.tool };
  }
  if (stroke.type === 'point') {
    if (!isUnitNum(stroke.nx) || !isUnitNum(stroke.ny)) return null;
    return { type: 'point', nx: stroke.nx, ny: stroke.ny };
  }
  if (stroke.type === 'end') return { type: 'end' };
  return null;
}

function scribbleAction(room, socket, data) {
  const gs = room.gameState; if (!gs) return;
  const drawerId = gs.drawerOrder[gs.drawerIndex];
  switch (data.action) {
    case 'choose_word':
      // 词库内词语均为短中文；只放行受限字符串，杜绝超长/非字符串载荷
      if (socket.id===drawerId&&gs.phase==='choosing'
        && typeof data.word === 'string' && data.word.length > 0 && data.word.length <= 12) {
        clearTimers(room); scribbleWordChosen(room,drawerId,data.word);
      }
      break;
    case 'draw': {
      if (socket.id!==drawerId||gs.phase!=='drawing') return;
      const safe = sanitizeStroke(data.stroke);
      if (!safe || gs.drawingData.length >= STROKE_LIMIT) return;
      gs.drawingData.push(safe);
      socket.to(room.code).emit('scribble:draw', { stroke: safe });
      break;
    }
    case 'clear':
      if (socket.id!==drawerId||gs.phase!=='drawing') return;
      gs.drawingData=[]; io.to(room.code).emit('scribble:clear'); break;
    case 'fill': {
      if (socket.id!==drawerId||gs.phase!=='drawing') return;
      if (!isUnitNum(data.x) || !isUnitNum(data.y) || !STROKE_COLOR_RE.test(data.color)) return;
      if (gs.drawingData.length >= STROKE_LIMIT) return;
      const safe = { type: 'fill', x: data.x, y: data.y, color: data.color };
      gs.drawingData.push(safe);
      socket.to(room.code).emit('scribble:draw', { stroke: safe });
      break;
    }
  }
}

const scribblePlayers = room => {
  const gs = room.gameState;
  return [...room.players.values()].map(p => ({ id:p.id, name:p.name, score:gs?.scores?.[p.id]||0 }));
};

// ─────────────────────────── UNO ───────────────────────────

const UNO_COLORS = ['red', 'yellow', 'green', 'blue'];

function buildUnoDeck() {
  const deck = [];
  for (const color of UNO_COLORS) {
    deck.push({ color, value: '0' });
    for (let n = 1; n <= 9; n++) {
      deck.push({ color, value: String(n) }, { color, value: String(n) });
    }
    for (const v of ['skip', 'reverse', 'draw2']) {
      deck.push({ color, value: v }, { color, value: v });
    }
  }
  for (let i = 0; i < 4; i++) {
    deck.push({ color: 'wild', value: 'wild' });
    deck.push({ color: 'wild', value: 'wild4' });
  }
  return deck;
}

function shuffleArr(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function unoNextIdx(gs, steps) {
  const n = gs.playerOrder.length;
  return ((gs.currentPlayerIndex + gs.direction * steps) % n + n) % n;
}

function unoCanPlay(card, topCard, currentColor) {
  if (card.color === 'wild') return true;
  if (card.color === currentColor) return true;
  if (topCard && card.value === topCard.value) return true;
  return false;
}

function unoDrawN(gs, playerId, n) {
  for (let i = 0; i < n; i++) {
    if (gs.deck.length === 0) {
      if (gs.discardPile.length > 1) {
        const top = gs.discardPile.pop();
        gs.deck = shuffleArr(gs.discardPile);
        gs.discardPile = [top];
      } else break;
    }
    if (gs.deck.length > 0) gs.hands[playerId].push(gs.deck.shift());
  }
}

function unoPublic(gs) {
  return {
    discardTop: gs.discardPile[gs.discardPile.length - 1] || null,
    currentColor: gs.currentColor,
    currentPlayerId: gs.playerOrder[gs.currentPlayerIndex],
    direction: gs.direction,
    phase: gs.phase,
    awaitingPass: gs.awaitingPass,
    playerOrder: gs.playerOrder,
    cardCounts: Object.fromEntries(gs.playerOrder.map(id => [id, gs.hands[id]?.length ?? 0])),
    players: gs.players,
    unoSaid: gs.unoSaid,
    lastAction: gs.lastAction,
    deckCount: gs.deck.length,
    turnEndsAt: gs.turnEndsAt || 0,
  };
}

function resetUnoTurnTimer(room) {
  clearTurnTimer(room);
  const gs = room.gameState;
  const turnTime = Number(room.settings?.turnTime || 0);
  if (!gs || gs.phase === 'game_over' || turnTime <= 0) {
    if (gs) gs.turnEndsAt = 0;
    return;
  }
  const curPlayerId = gs.playerOrder[gs.currentPlayerIndex];
  if (!curPlayerId) {
    gs.turnEndsAt = 0;
    return;
  }
  gs.turnEndsAt = Date.now() + turnTime * 1000;
  room.turnTimer = setTimeout(() => {
    room.turnTimer = null;
    unoTimeoutAutoplay(room);
  }, turnTime * 1000);
}

function unoTimeoutAutoplay(room) {
  const gs = room.gameState;
  if (!gs || gs.phase === 'game_over') return;
  const curPlayerId = gs.playerOrder[gs.currentPlayerIndex];
  if (!curPlayerId) return;
  const curPlayer = gs.players[curPlayerId];
  const curName = curPlayer?.name || '玩家';

  if (gs.phase === 'choose_color') {
    const randomColor = UNO_COLORS[Math.floor(Math.random() * UNO_COLORS.length)];
    io.to(room.code).emit('notification', `${curName} 选色超时，系统已随机选择颜色`);
    unoChooseColor(room, { id: curPlayerId }, randomColor);
  } else if (gs.phase === 'playing') {
    if (gs.awaitingPass) {
      io.to(room.code).emit('notification', `${curName} 思考超时，系统已自动过牌`);
      unoPass(room, { id: curPlayerId });
    } else {
      io.to(room.code).emit('notification', `${curName} 思考超时，系统已自动摸牌跳过`);
      unoDrawCard(room, { id: curPlayerId });
      if (gs.awaitingPass && gs.playerOrder[gs.currentPlayerIndex] === curPlayerId) {
        unoPass(room, { id: curPlayerId });
      }
    }
  }
}

function startUno(room) {
  const players = [...room.players.values()].sort(() => Math.random() - 0.5);
  const deck = shuffleArr(buildUnoDeck());
  const hands = {};
  players.forEach(p => { hands[p.id] = []; });
  for (let i = 0; i < 7; i++) players.forEach(p => hands[p.id].push(deck.shift()));

  let startCard = deck.shift();
  while (startCard.color === 'wild') { deck.push(startCard); shuffleArr(deck); startCard = deck.shift(); }

  const playerOrder = players.map(p => p.id);
  room.gameState = {
    type: 'uno', deck, discardPile: [startCard],
    currentColor: startCard.color,
    playerOrder, currentPlayerIndex: 0, direction: 1,
    phase: 'playing', awaitingPass: false, drawnCardIndex: -1,
    hands, unoSaid: {}, lastAction: null,
    players: Object.fromEntries(players.map(p => [p.id, { id: p.id, name: p.name, avatar: p.avatar ?? 0 }])),
    turnEndsAt: 0,
  };

  const gs = room.gameState;
  if (startCard.value === 'skip') {
    gs.currentPlayerIndex = unoNextIdx(gs, 1);
    io.to(room.code).emit('notification', `起始牌是跳过！${players[0].name} 第一回合被跳过。`);
  } else if (startCard.value === 'reverse') {
    if (playerOrder.length > 2) gs.direction = -1;
    io.to(room.code).emit('notification', `起始牌是反转！出牌顺序掉头了。`);
  } else if (startCard.value === 'draw2') {
    unoDrawN(gs, playerOrder[0], 2);
    gs.currentPlayerIndex = unoNextIdx(gs, 1);
    io.to(room.code).emit('notification', `起始牌是 +2！${players[0].name} 摸了两张。`);
  }

  resetUnoTurnTimer(room);
  io.to(room.code).emit('uno:state', unoPublic(gs));
  players.forEach(p => io.to(p.id).emit('uno:hand', { hand: gs.hands[p.id] }));
}

function unoAction(room, socket, data) {
  const gs = room.gameState;
  if (!gs || gs.phase === 'game_over') return;
  switch (data.action) {
    case 'play_card':    unoPlayCard(room, socket, data.cardIndex); break;
    case 'draw':         unoDrawCard(room, socket); break;
    case 'pass':         unoPass(room, socket); break;
    case 'choose_color': unoChooseColor(room, socket, data.color); break;
  }
}

function unoPlayCard(room, socket, cardIndex) {
  const gs = room.gameState;
  if (socket.id !== gs.playerOrder[gs.currentPlayerIndex] || gs.phase !== 'playing') return;
  if (gs.awaitingPass && cardIndex !== gs.drawnCardIndex) return;
  const hand = gs.hands[socket.id];
  if (!Number.isInteger(cardIndex) || cardIndex < 0 || cardIndex >= hand.length) return;
  const card = hand[cardIndex];
  const topCard = gs.discardPile[gs.discardPile.length - 1];
  if (!unoCanPlay(card, topCard, gs.currentColor)) return;

  hand.splice(cardIndex, 1);
  gs.discardPile.push(card);
  if (card.color !== 'wild') gs.currentColor = card.color;
  gs.awaitingPass = false; gs.drawnCardIndex = -1;
  gs.lastAction = { type: 'play', playerId: socket.id, card };

  if (hand.length === 1) {
    gs.unoSaid[socket.id] = true;
    io.to(room.code).emit('notification', `${gs.players[socket.id]?.name} 喊出了 UNO！`);
  } else if (hand.length > 1) {
    gs.unoSaid[socket.id] = false;
  }

  io.to(socket.id).emit('uno:hand', { hand });

  if (hand.length === 0) {
    clearTurnTimer(room);
    gs.turnEndsAt = 0;
    io.to(room.code).emit('uno:state', unoPublic(gs));
    endUno(room, socket.id);
    return;
  }

  if (card.value === 'wild' || card.value === 'wild4') {
    gs.phase = 'choose_color';
    resetUnoTurnTimer(room);
    io.to(room.code).emit('uno:state', unoPublic(gs));
    io.to(socket.id).emit('uno:choose_color');
    return;
  }

  if (card.value === 'reverse') {
    gs.direction *= -1;
    gs.currentPlayerIndex = unoNextIdx(gs, gs.playerOrder.length === 2 ? 2 : 1);
  } else if (card.value === 'skip') {
    gs.currentPlayerIndex = unoNextIdx(gs, 2);
  } else if (card.value === 'draw2') {
    const nextIdx = unoNextIdx(gs, 1), nextId = gs.playerOrder[nextIdx];
    unoDrawN(gs, nextId, 2);
    io.to(nextId).emit('uno:hand', { hand: gs.hands[nextId] });
    io.to(room.code).emit('notification', `${gs.players[nextId]?.name} 摸了两张牌！`);
    gs.currentPlayerIndex = unoNextIdx(gs, 2);
  } else {
    gs.currentPlayerIndex = unoNextIdx(gs, 1);
  }

  resetUnoTurnTimer(room);
  io.to(room.code).emit('uno:state', unoPublic(gs));
}

function unoDrawCard(room, socket) {
  const gs = room.gameState;
  if (socket.id !== gs.playerOrder[gs.currentPlayerIndex] || gs.phase !== 'playing' || gs.awaitingPass) return;
  unoDrawN(gs, socket.id, 1);
  const drawnIndex = gs.hands[socket.id].length - 1;
  if (drawnIndex < 0) return;
  const drawnCard = gs.hands[socket.id][drawnIndex];
  const topCard = gs.discardPile[gs.discardPile.length - 1];
  const canPlay = unoCanPlay(drawnCard, topCard, gs.currentColor);
  gs.lastAction = { type: 'draw', playerId: socket.id };
  if (canPlay) {
    gs.awaitingPass = true;
    gs.drawnCardIndex = drawnIndex;
    io.to(socket.id).emit('uno:hand', { hand: gs.hands[socket.id], drawnIndex, canPlayDrawn: true });
  } else {
    gs.awaitingPass = false; gs.drawnCardIndex = -1;
    gs.currentPlayerIndex = unoNextIdx(gs, 1);
    io.to(socket.id).emit('uno:hand', { hand: gs.hands[socket.id], drawnIndex, canPlayDrawn: false });
  }
  resetUnoTurnTimer(room);
  io.to(room.code).emit('uno:state', unoPublic(gs));
}

function unoPass(room, socket) {
  const gs = room.gameState;
  if (socket.id !== gs.playerOrder[gs.currentPlayerIndex] || !gs.awaitingPass) return;
  gs.awaitingPass = false; gs.drawnCardIndex = -1;
  gs.currentPlayerIndex = unoNextIdx(gs, 1);
  gs.lastAction = { type: 'pass', playerId: socket.id };
  resetUnoTurnTimer(room);
  io.to(room.code).emit('uno:state', unoPublic(gs));
}

function unoChooseColor(room, socket, color) {
  const gs = room.gameState;
  if (socket.id !== gs.playerOrder[gs.currentPlayerIndex] || gs.phase !== 'choose_color') return;
  if (!UNO_COLORS.includes(color)) return;
  gs.currentColor = color;
  gs.phase = 'playing';
  gs.lastAction = { type: 'color', playerId: socket.id, color };
  const topCard = gs.discardPile[gs.discardPile.length - 1];
  if (topCard.value === 'wild4') {
    const nextIdx = unoNextIdx(gs, 1), nextId = gs.playerOrder[nextIdx];
    unoDrawN(gs, nextId, 4);
    io.to(nextId).emit('uno:hand', { hand: gs.hands[nextId] });
    io.to(room.code).emit('notification', `${gs.players[nextId]?.name} 摸了四张牌！`);
    gs.currentPlayerIndex = unoNextIdx(gs, 2);
  } else {
    gs.currentPlayerIndex = unoNextIdx(gs, 1);
  }
  resetUnoTurnTimer(room);
  io.to(room.code).emit('uno:state', unoPublic(gs));
}

function endUno(room, winnerId) {
  clearTurnTimer(room);
  const gs = room.gameState;
  gs.turnEndsAt = 0;
  gs.phase = 'game_over';
  room.status = 'ended';
  recordResult(room, [winnerId], gs.playerOrder);
  io.to(room.code).emit('uno:game_over', {
    winnerId, winnerName: gs.players[winnerId]?.name,
    scores: Object.fromEntries(gs.playerOrder.map(id => [id, gs.hands[id]?.length ?? 0])),
    players: gs.players,
  });
}

// ─────────────────────────── START ───────────────────────────

const PORT = process.env.PORT || 4000;
const MDNS_HOST = 'gamenight.local';

server.listen(PORT, '0.0.0.0', () => {
  let bonjour = null;
  if (!DISABLE_MDNS) {
    bonjour = new Bonjour();
    bonjour.publish({ name: 'GameNight', type: 'http', port: Number(PORT), host: MDNS_HOST });
  }

  console.log('\n🎮  GameNight 启动成功！\n');
  console.log(`  本地访问:    http://localhost:${PORT}`);
  if (!DISABLE_MDNS) {
    console.log(`  局域网访问:  http://${MDNS_HOST}:${PORT}  ← 把这个地址发给朋友们！`);
  }
  console.log('\n  同一 WiFi / 局域网内的设备用任意浏览器打开即可。\n');

  const shutdown = () => {
    if (bonjour) bonjour.unpublishAll(() => process.exit());
    else process.exit();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
});
