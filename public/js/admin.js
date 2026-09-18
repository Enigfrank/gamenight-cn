// ═══════════════════ GameNight 管理后台 ═══════════════════
// 登录 → 在线房间列表 → 加入房间广播频道观战（只读）。
// 数据来源两类：
//   1. 服务端低频推送的 admin:rooms（房间列表）
//   2. 加入房间频道后收到的一切房间级公开广播事件
//      （UNO 手牌 / 杀手身份 / Scribble 秘密词均为点对点下发，此处天然收不到）
// 管理员密码仅保存在 sessionStorage，关闭浏览器即失效。

(() => {
  'use strict';

  const GAME_NAMES = { tictactoe: '井字棋', gomoku: '五子棋', killerdoctor: '谁是杀手', scribble: '你画我猜', uno: 'UNO' };
  const STATUS_NAMES = { lobby: '大厅中', playing: '游戏中', ended: '已结束' };
  const KD_ROLE_NAMES = { killer: '杀手', doctor: '医生', villager: '村民' };
  const KD_PHASE_NAMES = {
    role_reveal: '分发身份中…', night: '黑夜行动', night_resolution: '结算夜晚…',
    day_discussion: '白天讨论', voting: '投票中', vote_resolution: '票选结算…', game_over: '对局结束',
  };
  const UNO_COLOR_NAMES = { red: '红色', yellow: '黄色', green: '绿色', blue: '蓝色', wild: '万能' };
  const PWD_KEY = 'gn_admin_pwd';
  const FEED_LIMIT = 120;

  const socket = io();

  const state = {
    authed: false,
    rooms: [],
    watching: null, // 当前观战房间 code
  };

  // 大厅玩家列表缓存：playing 期间玩家断线也会触发 lobby:update 广播，
  // 此时只更新缓存、不打断当前游戏面板，返回大厅后再用缓存渲染。
  let lobbyPlayers = [];

  // 各游戏最近一次公开状态（供 1 秒状态栏刷新倒计时用）
  let tttState = null;
  let gkState = null;
  let unoState = null;
  let scbPlayers = []; // [{ id, name, score }]

  // ─── DOM 工具 ───
  const $ = id => document.getElementById(id);

  /** HTML 文本转义：所有他人可控字符串（昵称/消息等）写入 innerHTML 前必须经过它 */
  function escHtml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function el(tag, cls, text) {
    const d = document.createElement(tag);
    if (cls) d.className = cls;
    if (text !== undefined) d.textContent = text;
    return d;
  }

  function fmtTime(ts) {
    const d = new Date(ts);
    const p = n => String(n).padStart(2, '0');
    return `${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  function fmtClock() {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }

  function showView(name) {
    document.querySelectorAll('.admin-view').forEach(v => v.classList.remove('active'));
    $(`view-${name}`).classList.add('active');
  }

  function toast(msg) {
    const t = el('div', 'admin-toast', msg);
    document.body.appendChild(t);
    requestAnimationFrame(() => t.classList.add('show'));
    setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 4000);
  }

  /** 回合倒计时后缀（各游戏通用） */
  function timerSuffix(turnEndsAt) {
    if (!turnEndsAt || turnEndsAt <= 0) return '';
    const rem = Math.max(0, Math.ceil((turnEndsAt - Date.now()) / 1000));
    return rem > 0 ? `（${rem}s）` : '（超时托管中…）';
  }

  // ═══════════════════ 登录 ═══════════════════

  function tryLogin(pwd) {
    socket.emit('admin:login', { password: pwd });
  }

  socket.on('admin:login_result', ({ ok, msg, rooms }) => {
    if (!ok) {
      state.authed = false;
      try { sessionStorage.removeItem(PWD_KEY); } catch (e) {}
      const err = $('admin-login-error');
      err.textContent = msg || '登录失败。';
      err.classList.remove('hidden');
      showView('login');
      return;
    }
    state.authed = true;
    try { sessionStorage.setItem(PWD_KEY, $('admin-pwd').value.trim()); } catch (e) {}
    showView('panel');
    renderRooms(rooms || []);
    // 断线重连后恢复之前的观战
    if (state.watching) socket.emit('admin:watch', { code: state.watching });
  });

  // ═══════════════════ 房间列表 ═══════════════════

  function renderRooms(rooms) {
    state.rooms = rooms || [];
    $('admin-room-count').textContent = String(state.rooms.length);
    $('admin-rooms-empty').classList.toggle('hidden', state.rooms.length > 0);
    $('admin-rooms-section').classList.toggle('hidden', !!state.watching);
    $('admin-spectate').classList.toggle('hidden', !state.watching);

    const tbody = $('admin-rooms-body');
    tbody.innerHTML = '';
    state.rooms.forEach(r => {
      const tr = document.createElement('tr');
      tr.innerHTML =
        `<td class="admin-code-cell"><span class="admin-code">${escHtml(r.code)}</span>` +
        `${r.hasPassword ? ' <svg class="icon icon-lock" aria-label="密码保护"><use href="#i-lock"/></svg>' : ''}</td>` +
        `<td>${escHtml(GAME_NAMES[r.gameType] || r.gameType)}</td>` +
        `<td><span class="admin-status st-${escHtml(r.status)}">${escHtml(STATUS_NAMES[r.status] || r.status)}</span></td>` +
        `<td title="${escHtml((r.players || []).join('、'))}">${r.playerCount} 人</td>` +
        `<td class="muted">${r.createdAt ? fmtTime(r.createdAt) : '—'}</td>` +
        `<td><button class="btn-primary btn-sm" data-code="${escHtml(r.code)}">观战</button></td>`;
      tbody.appendChild(tr);
    });
  }

  socket.on('admin:rooms', ({ rooms }) => {
    // 观战中的房间已销毁 → 自动退出观战
    if (state.watching && !(rooms || []).some(r => r.code === state.watching)) {
      leaveWatch('房间已关闭，已返回列表。');
      renderRooms(rooms || []);
      return;
    }
    // 同步头部状态徽章
    if (state.watching) {
      const cur = (rooms || []).find(r => r.code === state.watching);
      if (cur) updateWatchStatusBadge(cur.status);
    }
    renderRooms(rooms || []);
  });

  // ═══════════════════ 观战生命周期 ═══════════════════

  const PANEL_IDS = {
    lobby: 'sp-lobby', tictactoe: 'sp-ttt', gomoku: 'sp-gk',
    killerdoctor: 'sp-kd', scribble: 'sp-scb', uno: 'sp-uno',
  };

  function showPanel(game) {
    Object.values(PANEL_IDS).forEach(id => $(id).classList.add('hidden'));
    $(PANEL_IDS[game] || 'sp-lobby').classList.remove('hidden');
  }

  function updateWatchStatusBadge(status) {
    const badge = $('sp-status');
    badge.textContent = STATUS_NAMES[status] || status || '—';
    badge.className = `admin-status st-${status || 'lobby'}`;
  }

  /** 清空各游戏面板的残留画面，避免串房观战时看到上一局的棋盘/画布 */
  function resetPanels() {
    tttState = null; gkState = null; unoState = null; scbPlayers = [];
    [...$('ttt-sp-board').children].forEach(c => {
      c.textContent = '';
      c.className = 'ttt-cell';
    });
    $('gk-sp-board').innerHTML = '';
    gkMirror = [];
    scbClear();
    $('sp-feed').innerHTML = '';
    $('kd-sp-history').innerHTML = '';
    $('kd-sp-phase').textContent = '';
    $('ttt-sp-sub').textContent = '';
  }

  function enterSpectate(snap) {
    state.watching = snap.code;
    lobbyPlayers = snap.players || [];
    $('sp-code').textContent = snap.code;
    $('sp-game').textContent = GAME_NAMES[snap.gameType] || snap.gameType;
    updateWatchStatusBadge(snap.status);
    resetPanels();

    if (snap.status === 'lobby' || !hasGamePayload(snap)) {
      showPanel('lobby');
      renderLobbyPanel(snap.players, snap.status === 'lobby' ? '' : '对局正在启动…');
    } else {
      showPanel(snap.gameType);
    }
    if (snap.ttt) renderTtt(snap.ttt);
    if (snap.tttTournament) renderTttTournament(snap.tttTournament);
    if (snap.gk) renderGk(snap.gk);
    if (snap.uno) renderUno(snap.uno);
    if (snap.scribble) renderScbSnapshot(snap.scribble);
    if (snap.kd) renderKdSnapshot(snap.kd);

    renderRooms(state.rooms);
    addFeed('开始观战');
  }

  function hasGamePayload(snap) {
    return Boolean(snap.ttt || snap.gk || snap.uno || snap.scribble || snap.kd);
  }

  function leaveWatch(msg) {
    if (state.watching) socket.emit('admin:unwatch');
    state.watching = null;
    renderRooms(state.rooms);
    if (msg) toast(msg);
  }

  socket.on('admin:watch_result', ({ ok, msg, snapshot }) => {
    if (!ok) { toast(msg || '无法进入该房间。'); return; }
    enterSpectate(snapshot);
  });

  // ═══════════════════ 大厅面板 ═══════════════════

  function renderLobbyPanel(players, hint) {
    const box = $('sp-lobby-players');
    box.innerHTML = '';
    (players || []).forEach(p => box.appendChild(el('div', 'admin-chip', p.name)));
    if (!box.children.length) box.appendChild(el('div', 'admin-chip muted', '暂无玩家'));
    $('sp-lobby-hint').textContent = hint || '';
  }

  // ═══════════════════ 井字棋 ═══════════════════

  function tttName(s, id) {
    if (!s || !s.players) return '?';
    if (s.players.X?.id === id) return s.players.X.name;
    if (s.players.O?.id === id) return s.players.O.name;
    return '?';
  }

  function updateTttStatus() {
    const s = tttState;
    if (!s || $('sp-ttt').classList.contains('hidden')) return; // 面板隐藏时无需刷新
    let text = '';
    if (s.matchWinner) text = `${tttName(s, s.matchWinner)} 赢下整场系列赛`;
    else if (s.winner === 'draw') text = '平局';
    else if (s.winner) text = `${tttName(s, s.winner)} 赢得本局`;
    else if (s.board) {
      const cur = s.currentTurn === s.players?.X?.id ? s.players?.X : s.players?.O;
      text = `轮到 ${cur?.name ?? '?'} 落子${timerSuffix(s.turnEndsAt)}`;
    }
    if (text) $('ttt-sp-status').textContent = text;
  }

  function renderTtt(s) {
    tttState = s;
    showPanel('tictactoe');
    if (!s.board) { // 锦标赛比赛间隙
      $('ttt-sp-status').textContent = '比赛间隙…';
      return;
    }
    const cells = $('ttt-sp-board').children;
    for (let i = 0; i < 9; i++) {
      const c = cells[i];
      const v = s.board[i];
      c.textContent = v === 'X' ? '✕' : v === 'O' ? '○' : '';
      c.classList.toggle('taken', !!v);
      c.classList.toggle('x-cell', v === 'X');
      c.classList.toggle('o-cell', v === 'O');
      c.classList.toggle('win-cell', !!s.winLine && s.winLine.includes(i));
    }
    if (s.players) {
      $('ttt-sp-name-x').textContent = s.players.X?.name ?? '—';
      $('ttt-sp-name-o').textContent = s.players.O?.name ?? '—';
      $('ttt-sp-pts-x').textContent = s.scores?.[s.players.X?.id] ?? 0;
      $('ttt-sp-pts-o').textContent = s.scores?.[s.players.O?.id] ?? 0;
      $('ttt-sp-card-x').classList.toggle('active-turn', !s.winner && s.currentTurn === s.players.X?.id);
      $('ttt-sp-card-o').classList.toggle('active-turn', !s.winner && s.currentTurn === s.players.O?.id);
    }
    updateTttStatus();
  }

  function renderTttTournament(d) {
    showPanel('tictactoe');
    const active = d.currentPlayerIds || [];
    const hasActive = active.length > 0;
    const p1 = d.allPlayers?.[active[0]];
    const p2 = d.allPlayers?.[active[1]];
    const total = d.rounds?.length ?? 0;
    $('ttt-sp-sub').textContent = hasActive
      ? `淘汰赛 第 ${d.currentRound + 1}/${total} 轮：${p1?.name ?? '?'} vs ${p2?.name ?? '?'}`
      : '淘汰赛：正在排对阵…';
  }

  socket.on('ttt:state', renderTtt);
  socket.on('ttt:tournament_state', renderTttTournament);
  socket.on('ttt:tournament_over', ({ winner }) => {
    tttState = null; // 冠军已定，阻止 1 秒状态刷新用旧对局数据覆盖结果文案
    $('ttt-sp-status').textContent = `锦标赛冠军：${winner?.name ?? '?'}`;
    addFeed(`井字棋锦标赛结束，冠军：${winner?.name ?? '?'}`, 'hl');
  });
  socket.on('ttt:player_left', ({ name }) => addFeed(`${name} 退出了对局`));

  // ═══════════════════ 五子棋 ═══════════════════

  let gkMirror = [];

  /** 各棋盘规格的星位（0 基坐标） */
  function gkStarPoints(n) {
    const set = new Set();
    const add = (r, c) => set.add(`${r},${c}`);
    if (n === 19) {
      [3, 9, 15].forEach(r => [3, 9, 15].forEach(c => add(r, c)));
    } else if (n === 15) {
      add(3, 3); add(3, 11); add(11, 3); add(11, 11); add(7, 7);
    } else {
      add(3, 3); add(3, 9); add(9, 3); add(9, 9); add(6, 6);
    }
    return set;
  }

  function buildGkBoard(n) {
    const boardEl = $('gk-sp-board');
    boardEl.dataset.size = String(n);
    boardEl.innerHTML = '';
    boardEl.classList.add('gk-locked'); // 观战只读，禁用悬停预览
    const stars = gkStarPoints(n);
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const cell = el('div', 'gk-cell');
        if (stars.has(`${r},${c}`)) cell.appendChild(el('span', 'gk-star-dot'));
        boardEl.appendChild(cell);
      }
    }
    gkMirror = Array.from({ length: n }, () => new Array(n).fill(0));
  }

  function updateGkStatus() {
    const s = gkState;
    if (!s || $('sp-gk').classList.contains('hidden')) return; // 面板隐藏时无需刷新
    let text = '';
    if (s.winner === 'draw') text = '棋盘已满，平局';
    else if (s.winner) {
      const w = s.players?.[s.winner];
      text = `${w?.name ?? '?'} 五连获胜`;
    } else {
      const cur = s.players?.[s.current];
      text = cur?.isAI ? 'AI 思考中…' : `轮到 ${cur?.name ?? '?'} 落子${timerSuffix(s.turnEndsAt)}`;
    }
    $('gk-sp-status').textContent = text;
  }

  function renderGk(s) {
    gkState = s;
    showPanel('gomoku');
    const boardEl = $('gk-sp-board');
    if (gkMirror.length !== s.size) buildGkBoard(s.size);
    for (let r = 0; r < s.size; r++) {
      for (let c = 0; c < s.size; c++) {
        const cell = boardEl.children[r * s.size + c];
        const piece = s.board[r][c];
        if (piece !== gkMirror[r][c]) {
          gkMirror[r][c] = piece;
          cell.classList.remove('gk-black', 'gk-white');
          cell.querySelectorAll('.gk-stone').forEach(e => e.remove());
          if (piece === 1 || piece === 2) {
            cell.classList.add(piece === 1 ? 'gk-black' : 'gk-white');
            cell.appendChild(el('span', 'gk-stone gk-stone-pop'));
          }
        }
        cell.classList.toggle('gk-last', !!s.lastMove && s.lastMove[0] === r && s.lastMove[1] === c && !s.winLine);
        cell.classList.toggle('gk-win', !!s.winLine && s.winLine.some(([wr, wc]) => wr === r && wc === c));
      }
    }
    $('gk-sp-name-black').textContent = s.players?.black?.name ?? '黑棋';
    $('gk-sp-name-white').textContent = s.players?.white?.name ?? '白棋';
    $('gk-sp-pts-black').textContent = s.scores?.[s.players?.black?.id] ?? 0;
    $('gk-sp-pts-white').textContent = s.scores?.[s.players?.white?.id] ?? 0;
    $('gk-sp-card-black').classList.toggle('active-turn', !s.winner && s.current === 'black');
    $('gk-sp-card-white').classList.toggle('active-turn', !s.winner && s.current === 'white');
    updateGkStatus();
  }

  socket.on('gk:state', renderGk);
  socket.on('gk:player_left', ({ name }) => addFeed(`${name} 退出了对局`));

  // ═══════════════════ 谁是杀手 ═══════════════════

  /** 渲染存活/出局玩家；条目可附角色名（仅对局结束后身份公开时传入） */
  function renderKdPlayers(living, dead) {
    const aliveEl = $('kd-sp-alive');
    aliveEl.innerHTML = '';
    (living || []).forEach(p => aliveEl.appendChild(el('div', 'admin-chip', p.role ? `${p.name}（${KD_ROLE_NAMES[p.role] || p.role}）` : p.name)));
    if (!aliveEl.children.length) aliveEl.appendChild(el('div', 'admin-chip muted', '—'));
    const deadEl = $('kd-sp-dead');
    deadEl.innerHTML = '';
    (dead || []).forEach(p => deadEl.appendChild(el('div', 'admin-chip dead', p.role ? `${p.name}（${KD_ROLE_NAMES[p.role] || p.role}）` : p.name)));
    if (!deadEl.children.length) deadEl.appendChild(el('div', 'admin-chip muted', '—'));
  }

  function renderKdHistory(history) {
    const box = $('kd-sp-history');
    box.innerHTML = '';
    (history || []).forEach(h => {
      const reason = h.reason === 'vote'
        ? `被投出局（${KD_ROLE_NAMES[h.role] || h.role}）`
        : '夜晚遇害';
      box.appendChild(el('div', 'admin-log-row', `第 ${h.round} 轮 · ${h.name} ${reason}`));
    });
    if (!box.children.length) box.appendChild(el('div', 'admin-log-row muted', '暂无记录'));
  }

  function renderKdSnapshot(d) {
    showPanel('killerdoctor');
    $('kd-sp-phase').textContent = `第 ${d.round} 轮 · ${KD_PHASE_NAMES[d.phase] || d.phase}`;
    renderKdPlayers(d.livingPlayers, d.deadPlayers);
    renderKdHistory(d.history);
  }

  socket.on('kd:night_start', ({ round, livingPlayers, deadPlayers }) => {
    showPanel('killerdoctor');
    $('kd-sp-phase').textContent = `第 ${round} 夜 · 黑夜行动`;
    renderKdPlayers(livingPlayers, deadPlayers);
    addFeed(`第 ${round} 夜降临`);
  });
  socket.on('kd:night_result', ({ message, livingPlayers, deadPlayers }) => {
    $('kd-sp-phase').textContent = '黎明 · 结算夜晚';
    renderKdPlayers(livingPlayers, deadPlayers);
    if (message) addFeed(message, 'hl');
  });
  socket.on('kd:day_start', ({ round, livingPlayers, deadPlayers }) => {
    showPanel('killerdoctor');
    $('kd-sp-phase').textContent = `第 ${round} 轮 · 白天讨论`;
    renderKdPlayers(livingPlayers, deadPlayers);
    addFeed(`第 ${round} 轮白天讨论开始`);
  });
  socket.on('kd:voting_start', ({ livingPlayers, deadPlayers }) => {
    $('kd-sp-phase').textContent = '全员投票中';
    renderKdPlayers(livingPlayers, deadPlayers);
    addFeed('投票阶段开始');
  });
  socket.on('kd:night_progress', ({ confirmed, total }) => {
    addFeed(`夜晚行动：${confirmed}/${total} 已提交`);
  });
  socket.on('kd:vote_result', ({ message, livingPlayers, deadPlayers, voteDetails }) => {
    $('kd-sp-phase').textContent = '票选结果';
    renderKdPlayers(livingPlayers, deadPlayers);
    if (message) addFeed(message, 'hl');
    if (voteDetails?.length) {
      const detail = voteDetails.map(v => `${v.name} ${v.votes} 票`).join('，');
      addFeed(`票数：${detail}`);
    }
  });
  socket.on('kd:game_over', ({ winner, reason, allPlayers, history }) => {
    showPanel('killerdoctor');
    $('kd-sp-phase').textContent = `对局结束 · ${winner === 'villagers' ? '村民获胜' : '杀手获胜'} · ${reason}`;
    // 结束后身份全部公开，按存活状态分类并标注角色
    renderKdPlayers(
      (allPlayers || []).filter(p => p.alive),
      (allPlayers || []).filter(p => !p.alive),
    );
    renderKdHistory(history);
    addFeed(`对局结束：${winner === 'villagers' ? '村民获胜' : '杀手获胜'} —— ${reason}`, 'hl');
  });

  // ═══════════════════ Scribble（你画我猜） ═══════════════════

  const SCB_W = 800, SCB_H = 500;

  function scbCtx() { return $('scb-sp-canvas').getContext('2d'); }

  function scbClear() { scbCtx().clearRect(0, 0, SCB_W, SCB_H); }

  /** 重放一条笔画指令（与主站远程绘制逻辑一致；fill 指令字段为归一化 x/y） */
  function scbDraw(stroke) {
    if (!stroke) return;
    const ctx = scbCtx();
    switch (stroke.type) {
      case 'begin': {
        scbRemote = { color: stroke.color, size: stroke.size, active: true };
        ctx.beginPath();
        ctx.moveTo(stroke.nx * SCB_W, stroke.ny * SCB_H);
        break;
      }
      case 'point': {
        if (!scbRemote.active) return;
        ctx.strokeStyle = scbRemote.color;
        ctx.lineWidth = scbRemote.size;
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.lineTo(stroke.nx * SCB_W, stroke.ny * SCB_H);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(stroke.nx * SCB_W, stroke.ny * SCB_H);
        break;
      }
      case 'end':
        scbRemote.active = false;
        ctx.beginPath();
        break;
      case 'fill':
        scbFloodFill(Math.round(stroke.x * SCB_W), Math.round(stroke.y * SCB_H), stroke.color);
        break;
    }
  }
  let scbRemote = { color: '#000', size: 5, active: false };

  function scbFloodFill(startX, startY, fillColor) {
    const ctx = scbCtx();
    const imgData = ctx.getImageData(0, 0, SCB_W, SCB_H);
    const data = imgData.data;
    const idx = (startY * SCB_W + startX) * 4;
    if (idx < 0 || idx >= data.length) return;
    const target = [data[idx], data[idx + 1], data[idx + 2], data[idx + 3]];
    const fill = scbHexToRgba(fillColor);
    if (target[0] === fill[0] && target[1] === fill[1] && target[2] === fill[2]) return;
    const stack = [[startX, startY]];
    const visited = new Set();
    while (stack.length) {
      const [cx, cy] = stack.pop();
      if (cx < 0 || cy < 0 || cx >= SCB_W || cy >= SCB_H) continue;
      const key = cy * SCB_W + cx;
      if (visited.has(key)) continue;
      visited.add(key);
      const i = key * 4;
      if (Math.abs(data[i] - target[0]) > 30 || Math.abs(data[i + 1] - target[1]) > 30 || Math.abs(data[i + 2] - target[2]) > 30) continue;
      data[i] = fill[0]; data[i + 1] = fill[1]; data[i + 2] = fill[2]; data[i + 3] = 255;
      stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
    }
    ctx.putImageData(imgData, 0, 0);
  }

  function scbHexToRgba(hex) {
    return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16), 255];
  }

  function renderScbScores(players, scores) {
    scbPlayers = players || scbPlayers;
    const box = $('scb-sp-scores');
    box.innerHTML = '';
    const src = (scbPlayers || []).map(p => ({ name: p.name, score: (scores?.[p.id]) ?? p.score ?? 0 }));
    src.sort((a, b) => b.score - a.score);
    src.forEach(p => box.appendChild(el('div', 'admin-chip', `${p.name} · ${p.score} 分`)));
    if (!box.children.length) box.appendChild(el('div', 'admin-chip muted', '—'));
  }

  function renderScbSnapshot(d) {
    showPanel('scribble');
    scbClear();
    (d.drawingData || []).forEach(scbDraw);
    $('scb-sp-word').textContent = d.masked || '— — —';
    $('scb-sp-round').textContent = `第 ${d.round}/${d.maxRounds} 轮 · ${d.phase === 'drawing' ? '作画中' : d.phase === 'choosing' ? '画师选词中' : d.phase === 'round_end' ? '本回合结束' : d.phase === 'game_over' ? '对局结束' : ''}`;
    renderScbScores(d.players, d.scores);
  }

  socket.on('scribble:game_start', ({ players, maxRounds }) => {
    showPanel('scribble');
    scbClear();
    scbPlayers = players || [];
    $('scb-sp-word').textContent = '— — —';
    $('scb-sp-round').textContent = `共 ${maxRounds} 轮`;
    renderScbScores(players, null);
    addFeed('你画我猜开始');
  });
  socket.on('scribble:turn_start', ({ drawerName, round, maxRounds, scores, players }) => {
    showPanel('scribble');
    scbClear();
    $('scb-sp-word').textContent = '画师选词中…';
    $('scb-sp-round').textContent = `第 ${round}/${maxRounds} 轮 · 画师：${drawerName ?? '?'}`;
    renderScbScores(players, scores);
    addFeed(`轮到 ${drawerName ?? '?'} 作画`);
  });
  socket.on('scribble:draw_start', ({ masked }) => {
    $('scb-sp-word').textContent = masked || '— — —';
  });
  socket.on('scribble:draw', ({ stroke }) => scbDraw(stroke));
  socket.on('scribble:clear', scbClear);
  socket.on('scribble:guess_event', ({ playerName, correct, scores }) => {
    if (correct) { addFeed(`${playerName} 猜对了！`, 'hl'); renderScbScores(null, scores); }
  });
  socket.on('scribble:round_end', ({ word, scores, players, allGuessed }) => {
    $('scb-sp-word').textContent = `答案：${word ?? '—'}`;
    renderScbScores(players, scores);
    addFeed(`本回合结束${allGuessed ? '（全员猜中）' : ''}，答案是「${word ?? '?'}」`, 'hl');
  });
  socket.on('scribble:game_over', ({ scores, players, winner }) => {
    renderScbScores(players, scores);
    $('scb-sp-round').textContent = '对局结束';
    addFeed(`你画我猜结束，冠军：${winner?.name ?? '?'}`, 'hl');
  });

  // ═══════════════════ UNO ═══════════════════

  function unoLabel(card) {
    const labels = { skip: '跳过', reverse: '反转', draw2: '+2', wild: '万能', wild4: '+4' };
    return labels[card.value] ?? card.value;
  }
  const unoIsDigit = v => v >= '0' && v <= '9';

  function updateUnoStatus() {
    const s = unoState;
    if (!s || $('sp-uno').classList.contains('hidden')) return; // 面板隐藏时无需刷新
    let text = '';
    if (s.phase === 'game_over') text = '对局已结束';
    else if (s.phase === 'choose_color') text = `${s.players?.[s.currentPlayerId]?.name ?? '?'} 正在选颜色${timerSuffix(s.turnEndsAt)}`;
    else text = `轮到 ${s.players?.[s.currentPlayerId]?.name ?? '?'} 出牌${timerSuffix(s.turnEndsAt)}`;
    $('uno-sp-status').textContent = text;
  }

  function renderUno(s) {
    unoState = s;
    showPanel('uno');
    const discard = $('uno-sp-discard');
    if (s.discardTop) {
      discard.className = `uno-card uno-card-big card-${s.discardTop.color}` + (unoIsDigit(s.discardTop.value) ? '' : ' val-text');
      discard.textContent = unoLabel(s.discardTop);
    } else {
      discard.className = 'uno-card uno-card-big';
      discard.textContent = '';
    }
    const dot = $('uno-sp-color-dot');
    dot.className = `uno-color-dot${['red', 'yellow', 'green', 'blue'].includes(s.currentColor) ? ` dot-${s.currentColor}` : ''}`;
    $('uno-sp-color-name').textContent = UNO_COLOR_NAMES[s.currentColor] || '—';
    $('uno-sp-deck-count').textContent = s.deckCount ?? 0;

    const list = $('uno-sp-players');
    list.innerHTML = '';
    (s.playerOrder || []).forEach(id => {
      const chip = el('div', 'admin-chip' + (s.currentPlayerId === id && s.phase !== 'game_over' ? ' active' : ''));
      chip.textContent = `${s.players?.[id]?.name ?? '?'} · ${s.cardCounts?.[id] ?? 0} 张`;
      if (s.unoSaid?.[id]) chip.appendChild(el('span', 'admin-uno-mark', 'UNO!'));
      list.appendChild(chip);
    });
    if (!list.children.length) list.appendChild(el('div', 'admin-chip muted', '—'));
    updateUnoStatus();
  }

  socket.on('uno:state', renderUno);
  socket.on('uno:game_over', ({ winnerName, scores, players }) => {
    if (unoState) unoState.phase = 'game_over';
    updateUnoStatus();
    const list = $('uno-sp-players');
    list.innerHTML = '';
    Object.entries(scores || {}).sort((a, b) => a[1] - b[1]).forEach(([id, count]) => {
      list.appendChild(el('div', 'admin-chip' + (count === 0 ? ' active' : ''),
        `${players?.[id]?.name ?? '?'} · ${count === 0 ? '获胜！' : `剩 ${count} 张`}`));
    });
    addFeed(`UNO 对局结束，${winnerName ?? '?'} 获胜`, 'hl');
  });

  // ═══════════════════ 通用房间事件 ═══════════════════

  socket.on('lobby:update', data => {
    if (!state.watching) return;
    lobbyPlayers = data.players || [];
    if (!$('sp-lobby').classList.contains('hidden')) renderLobbyPanel(lobbyPlayers, '');
  });

  socket.on('game:starting', () => addFeed('对局开始', 'hl'));
  socket.on('game:back_to_lobby', () => {
    showPanel('lobby');
    renderLobbyPanel(lobbyPlayers, '');
    addFeed('对局结束，返回大厅', 'hl');
  });
  socket.on('notification', msg => addFeed(String(msg)));
  socket.on('chat:message', ({ playerName, message }) => {
    addFeed(`${playerName ?? '?'}：${message ?? ''}`, 'chat');
  });

  // ═══════════════════ 事件流 ═══════════════════

  function addFeed(text, cls = '') {
    const box = $('sp-feed');
    const row = el('div', `admin-log-row ${cls}`.trim());
    const time = el('span', 'admin-log-time', fmtClock());
    row.appendChild(time);
    row.appendChild(document.createTextNode(text));
    box.appendChild(row);
    while (box.children.length > FEED_LIMIT) box.removeChild(box.firstChild);
    box.scrollTop = box.scrollHeight;
  }

  // ═══════════════════ 连接状态与初始化 ═══════════════════

  socket.on('connect', () => {
    $('admin-conn').classList.remove('offline');
    $('admin-conn').classList.add('online');
    $('admin-conn').title = '连接正常';
    // 会话内自动重新登录（断线重连 / 页面刷新）
    let saved = '';
    try { saved = sessionStorage.getItem(PWD_KEY) || ''; } catch (e) {}
    if (saved && !state.authed) {
      $('admin-pwd').value = saved;
      tryLogin(saved);
    }
  });

  socket.on('disconnect', () => {
    $('admin-conn').classList.remove('online');
    $('admin-conn').classList.add('offline');
    $('admin-conn').title = '连接已断开，自动重连中…';
    // 重连后是新 socket，需重新走登录 + 观战流程
    state.authed = false;
  });

  function init() {
    $('admin-login-btn').addEventListener('click', () => {
      const pwd = $('admin-pwd').value.trim();
      if (!pwd) {
        const err = $('admin-login-error');
        err.textContent = '请输入管理员密码。';
        err.classList.remove('hidden');
        return;
      }
      tryLogin(pwd);
    });
    $('admin-pwd').addEventListener('keydown', e => { if (e.key === 'Enter') $('admin-login-btn').click(); });
    $('admin-back').addEventListener('click', () => leaveWatch());
    $('admin-rooms-body').addEventListener('click', e => {
      const btn = e.target.closest('button[data-code]');
      if (btn) socket.emit('admin:watch', { code: btn.dataset.code });
    });

    // 观战期间每秒刷新带倒计时的状态文本
    setInterval(() => {
      if (!state.watching) return;
      updateTttStatus();
      updateGkStatus();
      updateUnoStatus();
    }, 1000);
  }

  document.addEventListener('DOMContentLoaded', init);
})();
