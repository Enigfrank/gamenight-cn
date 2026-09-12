// ═══════════════════ AVATARS ═══════════════════
const AVATARS = [
  { emoji: '🧙', name: '法师' },     { emoji: '🐗', name: '野猪' },
  { emoji: '🏹', name: '弓箭手' },   { emoji: '🛡️', name: '骑士' },
  { emoji: '🔮', name: '预言家' },   { emoji: '🗡️', name: '刺客' },
  { emoji: '🦊', name: '狐狸' },     { emoji: '🐺', name: '恶狼' },
  { emoji: '🦅', name: '雄鹰' },     { emoji: '🧝', name: '精灵' },
  { emoji: '🤺', name: '剑客' },     { emoji: '🧛', name: '吸血鬼' },
  { emoji: '🧟', name: '幽灵' },     { emoji: '🧜', name: '美人鱼' },
  { emoji: '🎭', name: '小丑' },     { emoji: '👑', name: '国王' },
  { emoji: '🐉', name: '神龙' },     { emoji: '🦁', name: '雄狮' },
  { emoji: '🐻', name: '大熊' },     { emoji: '🦄', name: '独角兽' },
  { emoji: '🐙', name: '章鱼' },     { emoji: '🦝', name: '浣熊' },
  { emoji: '🐧', name: '企鹅' },     { emoji: '🦋', name: '蝴蝶' },
  { emoji: '🐸', name: '青蛙' },     { emoji: '🦩', name: '火烈鸟' },
  { emoji: '🐯', name: '老虎' },     { emoji: '🦀', name: '螃蟹' },
  { emoji: '🦜', name: '鹦鹉' },     { emoji: '🐳', name: '鲸鱼' },
  { emoji: '🦈', name: '鲨鱼' },     { emoji: '🤖', name: '机器人' },
  { emoji: '🧞', name: '灯神' },     { emoji: '🦸', name: '英雄' },
  { emoji: '🐊', name: '鳄鱼' },     { emoji: '🦉', name: '猫头鹰' },
  { emoji: '🐬', name: '海豚' },     { emoji: '🦦', name: '水獭' },
  { emoji: '🐘', name: '大象' },     { emoji: '🐒', name: '猴子' },
  { emoji: '🦒', name: '长颈鹿' },   { emoji: '🦌', name: '梅花鹿' },
  { emoji: '🧪', name: '测试员' },   { emoji: '🎼', name: '指挥家' },
  { emoji: '🦟', name: '蚊子' },     { emoji: '🦓', name: '斑马' },
  { emoji: '🦏', name: '犀牛' },     { emoji: '🦙', name: '羊驼' },
  { emoji: '🦛', name: '河马' },     { emoji: '🦘', name: '袋鼠' },
  { emoji: '🦔', name: '刺猬' },     { emoji: '🐝', name: '小蜜蜂' },
  { emoji: '🦇', name: '蝙蝠' },     { emoji: '🦚', name: '孔雀' },
  { emoji: '🐨', name: '考拉' },     { emoji: '🔥', name: '烈焰' },
  { emoji: '⚡', name: '闪电' },     { emoji: '🐎', name: '骏马' },
  { emoji: '🐪', name: '骆驼' },     { emoji: '🎯', name: '神射手' },
  { emoji: '🐆', name: '猎豹' },     { emoji: '🦃', name: '火鸡' },
  { emoji: '🦢', name: '天鹅' },     { emoji: '🕊️', name: '白鸽' },
  { emoji: '🦡', name: '獾' },       { emoji: '🐇', name: '兔子' },
  { emoji: '🐿️', name: '花栗鼠' },   { emoji: '🐈', name: '猫咪' },
  { emoji: '🐕', name: '狗子' },     { emoji: '🐐', name: '山羊' },
  { emoji: '🦑', name: '鱿鱼' },     { emoji: '🦞', name: '龙虾' },
  { emoji: '🐌', name: '蜗牛' },     { emoji: '🐞', name: '瓢虫' },
  { emoji: '🦂', name: '蝎子' },     { emoji: '🕷️', name: '蜘蛛' },
  { emoji: '🦎', name: '蜥蜴' },     { emoji: '🐍', name: '蛇' },
  { emoji: '🐢', name: '乌龟' },     { emoji: '🦕', name: '腕龙' },
  { emoji: '🦖', name: '霸王龙' },   { emoji: '🧚', name: '小仙女' },
  { emoji: '👹', name: '食人魔' },   { emoji: '👺', name: '哥布林' },
  { emoji: '👻', name: '幽魂' },     { emoji: '👾', name: '外星人' },
  { emoji: '🎃', name: '南瓜' },     { emoji: '💎', name: '宝石' },
  { emoji: '🔱', name: '三叉戟' },   { emoji: '⚓', name: '船锚' },
  { emoji: '🌋', name: '火山' },     { emoji: '☄️', name: '彗星' },
  { emoji: '❄️', name: '冰霜' },     { emoji: '🌪️', name: '龙卷风' },
  { emoji: '🧲', name: '磁铁' },     { emoji: '🦠', name: '细菌' },
  { emoji: '🐓', name: '公鸡' },     { emoji: '🧸', name: '泰迪熊' },
  { emoji: '🌈', name: '彩虹' },     { emoji: '🐹', name: '仓鼠' },
];

// ═══════════════════ GLOBAL STATE ═══════════════════
const App = {
  socket: io(),
  myId: null,
  myName: '',
  roomCode: '',
  gameType: '',
  isHost: false,
  selectedGame: 'killerdoctor',
  currentSettings: {},
  myAvatar: 0,
};

// ═══════════════════ SETTINGS SCHEMA (client-side) ═══════════════════
const SETTINGS_SCHEMA = {
  scribble: [
    { id: 'drawTime', label: '绘画时间', default: 45, isTime: true,
      options: [{v:40,l:'40 秒'},{v:60,l:'60 秒'},{v:80,l:'80 秒 ★'},{v:100,l:'100 秒'},{v:120,l:'2 分钟'}] },
    { id: 'rounds', label: '游戏轮数', default: 3,
      options: [{v:2,l:'2 轮'},{v:3,l:'3 轮 ★'},{v:4,l:'4 轮'},{v:5,l:'5 轮'}] },
    { id: 'wordChoices', label: '每轮备选词数', default: 3,
      options: [{v:2,l:'2 个词'},{v:3,l:'3 个词 ★'},{v:4,l:'4 个词'}] },
  ],
  killerdoctor: [
    { id: 'discussionTime', label: '讨论时间', default: 45, isTime: true,
      options: [{v:60,l:'1 分钟'},{v:90,l:'90 秒'},{v:120,l:'2 分钟 ★'},{v:150,l:'2 分半'},{v:180,l:'3 分钟'}] },
    { id: 'votingTime', label: '投票时间', default: 45, isTime: true,
      options: [{v:30,l:'30 秒'},{v:45,l:'45 秒'},{v:60,l:'60 秒 ★'},{v:90,l:'90 秒'}] },
  ],
  tictactoe: [
    { id: 'bestOf', label: '比赛赛制', default: 0,
      options: [{v:0,l:'自由对战 ★'},{v:3,l:'三局两胜'},{v:5,l:'五局三胜'},{v:7,l:'七局四胜'}] },
  ],
  uno: [],
};

// ═══════════════════ VIEW MANAGEMENT ═══════════════════
function showView(id) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const el = document.getElementById(`view-${id}`);
  if (el) el.classList.add('active');
}

function showLoading(on) {
  document.getElementById('loading-overlay').classList.toggle('hidden', !on);
}

function toast(msg, duration = 4000, type = '') {
  const el = document.createElement('div');
  el.className = 'toast' + (type ? ` toast-${type}` : '');
  el.textContent = msg;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => el.remove(), duration);
}

function showCountdown() {
  document.getElementById('game-countdown')?.remove();
  const overlay = document.createElement('div');
  overlay.id = 'game-countdown';
  overlay.className = 'countdown-overlay';
  document.body.appendChild(overlay);
  const steps = ['3','2','1','开始！'];
  let i = 0;
  function step() {
    overlay.innerHTML = '';
    const el = document.createElement('div');
    el.className = 'countdown-num' + (steps[i] === '开始！' ? ' go' : '');
    el.textContent = steps[i];
    overlay.appendChild(el);
    i++;
    if (i < steps.length) setTimeout(step, 800);
    else setTimeout(() => {
      overlay.style.transition = 'opacity 0.3s ease';
      overlay.style.opacity = '0';
      setTimeout(() => overlay.remove(), 300);
    }, 600);
  }
  step();
}

function showConfirm(message, onConfirm, opts = {}) {
  const { confirmText = '确认', cancelText = '取消', danger = false } = opts;
  document.getElementById('confirm-modal')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'confirm-modal';
  overlay.className = 'confirm-overlay';
  overlay.innerHTML =
    `<div class="confirm-box">` +
    `<p class="confirm-msg">${message}</p>` +
    `<div class="confirm-actions">` +
    `<button class="btn-ghost confirm-cancel">${cancelText}</button>` +
    `<button class="${danger ? 'btn-danger' : 'btn-primary'} confirm-ok">${confirmText}</button>` +
    `</div></div>`;
  document.body.appendChild(overlay);

  const cleanup = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
  const doConfirm = () => { cleanup(); onConfirm(); };

  overlay.querySelector('.confirm-cancel').addEventListener('click', cleanup);
  overlay.querySelector('.confirm-ok').addEventListener('click', doConfirm);
  overlay.addEventListener('click', e => { if (e.target === overlay) cleanup(); });

  function onKey(e) {
    if (e.key === 'Escape') cleanup();
    if (e.key === 'Enter') doConfirm();
  }
  document.addEventListener('keydown', onKey);
  overlay.querySelector('.confirm-ok').focus();
}

function showError(elId, msg) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.textContent = msg;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 4000);
}

// ═══════════════════ AVATAR ═══════════════════
const AVATAR_COLORS = ['#7c3aed','#0ea5e9','#10b981','#f97316','#ef4444','#ec4899','#8b5cf6','#14b8a6'];
function avatarColor(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xFFFFFFFF;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}
function avatarEl(name, size = 40) {
  const div = document.createElement('div');
  div.className = 'player-avatar';
  div.style.cssText = `width:${size}px;height:${size}px;background:${avatarColor(name)};font-size:${Math.round(size*0.4)}px`;
  div.textContent = (name || '?').slice(0,2).toUpperCase();
  return div;
}

// ═══════════════════ RULES MODAL ═══════════════════
function initRulesModal() {
  const modal = document.getElementById('rules-modal');
  document.getElementById('close-rules').addEventListener('click', () => modal.classList.add('hidden'));
  modal.addEventListener('click', e => { if (e.target === modal) modal.classList.add('hidden'); });

  document.querySelectorAll('.rules-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.rules-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.rules-content').forEach(c => c.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(`rules-${tab.dataset.game}`)?.classList.add('active');
    });
  });

  document.getElementById('btn-rules-home').addEventListener('click', () => {
    openRules(App.selectedGame);
  });
  document.getElementById('btn-rules-lobby').addEventListener('click', () => {
    openRules(App.gameType || App.selectedGame);
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') modal.classList.add('hidden');
  });
}

function openRules(gameType) {
  const modal = document.getElementById('rules-modal');
  modal.classList.remove('hidden');
  // Activate correct tab
  const tab = document.querySelector(`.rules-tab[data-game="${gameType}"]`);
  if (tab) {
    document.querySelectorAll('.rules-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.rules-content').forEach(c => c.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(`rules-${gameType}`)?.classList.add('active');
  }
}

// ═══════════════════ LOBBY SETTINGS ═══════════════════
function initSettings() {
  const toggleBtn = document.getElementById('btn-settings-toggle');
  const body = document.getElementById('lobby-settings-body');
  const chevron = document.getElementById('settings-chevron');

  toggleBtn.addEventListener('click', () => {
    const open = !body.classList.contains('hidden');
    body.classList.toggle('hidden', open);
    chevron.classList.toggle('open', !open);
  });

  document.getElementById('btn-save-settings').addEventListener('click', saveSettings);
}

function renderSettings(gameType, settings, isHost) {
  const schema = SETTINGS_SCHEMA[gameType] || [];
  const fields = document.getElementById('lobby-settings-fields');
  fields.innerHTML = '';

  schema.forEach(field => {
    const currentVal = settings?.[field.id] ?? field.default;
    const wrap = document.createElement('div');
    wrap.className = 'settings-field';

    const label = document.createElement('label');
    label.textContent = field.label;
    wrap.appendChild(label);

    if (isHost && field.isTime) {
      const input = document.createElement('input');
      input.type = 'number';
      input.id = `setting-${field.id}`;
      input.min = 10;
      input.max = 600;
      input.value = currentVal;
      input.placeholder = '单位：秒（10–600）';
      input.className = 'custom-time-input';
      wrap.appendChild(input);
    } else if (isHost) {
      const sel = document.createElement('select');
      sel.id = `setting-${field.id}`;
      field.options.forEach(opt => {
        const o = document.createElement('option');
        o.value = opt.v;
        o.textContent = opt.l;
        if (+opt.v === +currentVal) o.selected = true;
        sel.appendChild(o);
      });
      wrap.appendChild(sel);
    } else {
      const val = document.createElement('div');
      val.className = 'settings-val';
      if (field.isTime) {
        val.textContent = `${currentVal} 秒`;
      } else {
        const opt = field.options.find(o => +o.v === +currentVal);
        val.textContent = opt ? opt.l.replace(' ★','') : currentVal;
      }
      wrap.appendChild(val);
    }

    fields.appendChild(wrap);
  });

  document.getElementById('settings-host-actions').classList.toggle('hidden', !isHost || schema.length === 0);
  document.getElementById('settings-saved-msg').classList.add('hidden');
}

function saveSettings() {
  const schema = SETTINGS_SCHEMA[App.gameType] || [];
  const newSettings = {};
  schema.forEach(field => {
    const el = document.getElementById(`setting-${field.id}`);
    if (!el) return;
    if (field.isTime) {
      const val = parseInt(el.value, 10);
      if (!isNaN(val) && val >= 10 && val <= 600) {
        newSettings[field.id] = val;
      } else {
        showError('home-error', `${field.label}：请输入 10 到 600 之间的秒数。`);
      }
    } else {
      newSettings[field.id] = el.value;
    }
  });
  App.socket.emit('room:settings', newSettings);
  const msg = document.getElementById('settings-saved-msg');
  msg.classList.remove('hidden');
  setTimeout(() => msg.classList.add('hidden'), 2000);
}

// ═══════════════════ AVATAR PICKER ═══════════════════
function selectAvatar(idx) {
  App.myAvatar = idx;
  localStorage.setItem('gn_avatar', idx);
  document.querySelectorAll('.avatar-opt').forEach((btn, i) => {
    btn.classList.toggle('selected', i === idx);
  });
  const av = AVATARS[idx];
  const previewEmoji = document.getElementById('avatar-preview-emoji');
  if (previewEmoji) {
    previewEmoji.textContent = av.emoji;
    document.getElementById('avatar-preview-name').textContent = av.name;
  }
}

function openAvatarModal() {
  document.getElementById('avatar-modal').classList.remove('hidden');
  document.querySelectorAll('.avatar-opt')[App.myAvatar]?.scrollIntoView({ block: 'center' });
}

function closeAvatarModal() {
  document.getElementById('avatar-modal').classList.add('hidden');
}

function getRandomFreeAvatar() {
  return Math.floor(Math.random() * AVATARS.length);
}

function initAvatarPicker() {
  const saved = parseInt(localStorage.getItem('gn_avatar') || '-1', 10);
  const savedOk = saved >= 0 && saved < AVATARS.length;
  App.myAvatar = savedOk ? saved : getRandomFreeAvatar();

  const grid = document.getElementById('avatar-picker');
  AVATARS.forEach((av, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'avatar-opt' + (i === App.myAvatar ? ' selected' : '');
    btn.textContent = av.emoji;
    btn.title = av.name;
    btn.addEventListener('click', () => { selectAvatar(i); closeAvatarModal(); });
    grid.appendChild(btn);
  });

  selectAvatar(App.myAvatar);

  document.getElementById('btn-change-avatar').addEventListener('click', openAvatarModal);
  document.getElementById('avatar-modal-close').addEventListener('click', closeAvatarModal);
  document.getElementById('avatar-modal-backdrop').addEventListener('click', closeAvatarModal);
}

// ═══════════════════ HOME SCREEN ═══════════════════
function initHome() {
  const urlParams = new URLSearchParams(window.location.search);
  const urlCode = urlParams.get('code');
  const urlGame = urlParams.get('game');
  if (urlCode) {
    document.getElementById('inp-code').value = urlCode.toUpperCase();
    document.getElementById('btn-create').closest('.home-card').remove();
    document.querySelector('.home-or').remove();
  }
  if (urlGame) {
    document.querySelectorAll('.game-card').forEach(card => {
      if (card.dataset.game !== urlGame) card.remove();
    });
    const activeCard = document.querySelector(`.game-card[data-game="${urlGame}"]`);
    if (activeCard) {
      activeCard.classList.add('selected', 'game-card-locked');
      document.querySelector('.game-selector h2').textContent = '正在加入游戏';
    }
  }

  const savedName = localStorage.getItem('gn_name') || '';
  if (savedName) {
    document.getElementById('inp-name').value = savedName;
  }

  document.getElementById('inp-name').addEventListener('input', (e) => {
    localStorage.setItem('gn_name', e.target.value.trim());
  });

  document.querySelectorAll('.game-card').forEach(card => {
    card.addEventListener('click', () => {
      document.querySelectorAll('.game-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      App.selectedGame = card.dataset.game;
    });
  });
  document.querySelector('[data-game="killerdoctor"]').classList.add('selected');
  App.selectedGame = 'killerdoctor';

  document.getElementById('btn-create')?.addEventListener('click', () => {
    const name = document.getElementById('inp-name').value.trim();
    if (!name) { showError('home-error', '先给自己起个名字吧！'); return; }
    App.myName = name;
    showLoading(true);
    App.socket.emit('room:create', { gameType: App.selectedGame, playerName: name, avatar: App.myAvatar });
  });

  document.getElementById('btn-join').addEventListener('click', doJoin);
  document.getElementById('inp-code').addEventListener('keydown', e => { if (e.key === 'Enter') doJoin(); });
  document.getElementById('inp-name').addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      const code = document.getElementById('inp-code').value.trim();
      if (code) doJoin(); else document.getElementById('btn-create')?.click();
    }
  });
}

function doJoin() {
  const name = document.getElementById('inp-name').value.trim();
  const code = document.getElementById('inp-code').value.trim().toUpperCase();
  if (!name) { showError('home-error', '先给自己起个名字吧！'); return; }
  if (!code) { showError('home-error', '请输入房间代码！'); return; }
  App.myName = name;
  showLoading(true);
  App.socket.emit('room:join', { code, playerName: name, avatar: App.myAvatar });
}

// ═══════════════════ CLIPBOARD ═══════════════════
function copyText(text, msg) {
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(() => toast(msg)).catch(() => fallbackCopy(text, msg));
  } else {
    fallbackCopy(text, msg);
  }
}

function fallbackCopy(text, msg) {
  const el = document.createElement('textarea');
  el.value = text;
  el.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
  document.body.appendChild(el);
  el.focus(); el.select();
  try { document.execCommand('copy'); toast(msg); }
  catch { toast('复制失败，请手动输入房间代码：' + text, 4000, 'error'); }
  el.remove();
}

// ═══════════════════ LOBBY ═══════════════════
function initLobby() {
  document.getElementById('btn-copy').addEventListener('click', () => {
    copyText(App.roomCode, '房间代码已复制！');
  });

  document.getElementById('btn-share').addEventListener('click', () => {
    const url = `${window.location.origin}${window.location.pathname}?code=${App.roomCode}&game=${App.gameType}`;
    copyText(url, '邀请链接已复制！');
  });

  document.getElementById('btn-leave').addEventListener('click', () => location.reload());
  document.getElementById('btn-start').addEventListener('click', () => App.socket.emit('game:start'));
}

function renderLobby({ players, code, gameType, hostId, minPlayers, settings, sessionStats }) {
  App.roomCode = code;
  App.isHost = hostId === App.myId;
  App.currentSettings = settings || {};

  const gameNames = { tictactoe: '井字棋', killerdoctor: '谁是杀手', scribble: '你画我猜', uno: 'UNO' };
  document.getElementById('lobby-title').textContent = gameNames[gameType] || '游戏大厅';
  document.getElementById('lobby-code').textContent = code;

  const grid = document.getElementById('lobby-players');
  grid.innerHTML = '';
  players.forEach((p, idx) => {
    const card = document.createElement('div');
    card.className = 'lobby-player-card' + (p.isHost ? ' is-host' : '') + ' lobby-card-enter';
    card.style.animationDelay = `${idx * 0.07}s`;
    const av = document.createElement('div');
    av.className = 'lobby-player-emoji';
    av.textContent = AVATARS[p.avatar ?? 0].emoji;
    card.appendChild(av);
    const nameEl = document.createElement('div');
    nameEl.className = 'lobby-player-name';
    nameEl.textContent = p.name + (p.id === App.myId ? ' (你)' : '');
    card.appendChild(nameEl);
    if (p.isHost) { const cr = document.createElement('div'); cr.className = 'host-crown'; cr.textContent = '👑 房主'; card.appendChild(cr); }
    if (App.isHost && p.id !== App.myId) {
      const controls = document.createElement('div');
      controls.className = 'host-controls';
      const transferBtn = document.createElement('button');
      transferBtn.className = 'btn-host-ctrl';
      transferBtn.title = '转让房主';
      transferBtn.textContent = '👑';
      transferBtn.addEventListener('click', () => {
        showConfirm(`把房主转让给 ${p.name}？`, () => App.socket.emit('room:transfer_host', { playerId: p.id }), { confirmText: '转让' });
      });
      const kickBtn = document.createElement('button');
      kickBtn.className = 'btn-host-ctrl btn-kick-ctrl';
      kickBtn.title = '踢出玩家';
      kickBtn.textContent = '🚫';
      kickBtn.addEventListener('click', () => {
        showConfirm(`把 ${p.name} 踢出房间？`, () => App.socket.emit('room:kick', { playerId: p.id }), { confirmText: '踢出', danger: true });
      });
      controls.appendChild(transferBtn);
      controls.appendChild(kickBtn);
      card.appendChild(controls);
    }
    grid.appendChild(card);
  });

  const enough = players.length >= minPlayers;
  document.getElementById('lobby-status').textContent = enough
    ? `${players.length} 人已就位，房主可以开始啦！`
    : `等人来齐…（当前 ${players.length} 人，至少 ${minPlayers} 人）`;

  const startBtn = document.getElementById('btn-start');
  startBtn.disabled = !enough || !App.isHost;
  startBtn.textContent = App.isHost ? '开始游戏' : '等房主开始…';

  renderSettings(gameType, settings, App.isHost);
  renderSessionStats(sessionStats);
}

function renderSessionStats(stats) {
  const el = document.getElementById('lobby-session-stats');
  if (!stats || !Object.keys(stats).length) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  const body = el.querySelector('.stats-body');
  body.innerHTML = '';
  const sorted = Object.values(stats).sort((a, b) => b.wins - a.wins || b.gamesPlayed - a.gamesPlayed);
  const medals = ['🥇', '🥈', '🥉'];
  sorted.forEach((s, i) => {
    const row = document.createElement('div');
    row.className = 'stats-row';
    row.innerHTML = `<span class="stats-rank">${medals[i] || (i + 1) + '.'}</span>` +
      `<span class="stats-name">${s.name}</span>` +
      `<span class="stats-record">${s.wins} 胜 / ${s.gamesPlayed} 场</span>`;
    body.appendChild(row);
  });
}

// ═══════════════════ SOCKET EVENTS ═══════════════════
App.socket.on('connect', () => { App.myId = App.socket.id; });

App.socket.on('room:joined', ({ code, isHost, gameType }) => {
  showLoading(false);
  App.roomCode = code;
  App.isHost = isHost;
  App.gameType = gameType;
  showView('lobby');
});

App.socket.on('room:error', ({ msg }) => {
  showLoading(false);
  showError('home-error', msg);
  toast(msg, 5000, 'error');
});

App.socket.on('lobby:update', data => {
  App.gameType = data.gameType;
  renderLobby(data);
});

App.socket.on('lobby:settings', settings => {
  App.currentSettings = settings;
  renderSettings(App.gameType, settings, App.isHost);
  if (!App.isHost) toast('房主改了游戏设置');
});

App.socket.on('notification', msg => toast(msg));
App.socket.on('game:starting', () => showCountdown());
App.socket.on('game:back_to_lobby', () => showView('lobby'));

App.socket.on('room:kicked', () => {
  showView('home');
  showLoading(false);
  toast('你被移出了房间。', 4000, 'error');
});

// Game start triggers
App.socket.on('kd:role_assigned', data  => { showView('killerdoctor'); KillerDoctor.onRoleAssigned(data); });
App.socket.on('ttt:state',        data  => { showView('tictactoe');    TicTacToe.onState(data); });
App.socket.on('ttt:symbol',       data  =>   TicTacToe.onSymbol(data));
App.socket.on('ttt:player_left',  data  =>   TicTacToe.onPlayerLeft(data));
App.socket.on('ttt:tournament_state', data => { showView('tictactoe'); });  // handled inside TicTacToe module
App.socket.on('scribble:game_start', data => { showView('scribble');  Scribble.onStart(data); });
App.socket.on('scribble:reconnect',  data => { showView('scribble');  Scribble.onReconnect(data); });
App.socket.on('uno:state',       data  => { showView('uno');         UNO.onState(data); });
App.socket.on('uno:hand',        data  =>   UNO.onHand(data));
App.socket.on('uno:choose_color',()    =>   UNO.onChooseColor());
App.socket.on('uno:game_over',   data  =>   UNO.onGameOver(data));
App.socket.on('kd:reconnect',    data  => {
  if (data.avatar !== undefined) App.myAvatar = data.avatar;
  showView('killerdoctor');
  KillerDoctor.onReconnect(data);
});

// ═══════════════════ THEME ═══════════════════
const THEME_KEY = 'gamenight-theme';

/** 将主题应用到根节点，按需持久化并同步切换按钮图标与提示文案 */
function applyTheme(theme, persist) {
  document.documentElement.setAttribute('data-theme', theme);
  if (persist) {
    try { localStorage.setItem(THEME_KEY, theme); } catch (e) {}
  }
  const icon = document.getElementById('theme-icon-use');
  if (icon) icon.setAttribute('href', theme === 'dark' ? '#i-sun' : '#i-moon');
  const btn = document.getElementById('btn-theme-toggle');
  if (btn) {
    const label = theme === 'dark' ? '切换到浅色模式' : '切换到深色模式';
    btn.title = label;
    btn.setAttribute('aria-label', label);
  }
}

/** 初始化黑夜模式：读取本地偏好（默认浅色）并绑定右上角切换按钮 */
function initTheme() {
  let theme = 'light';
  try { theme = localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light'; } catch (e) {}
  applyTheme(theme, false);
  document.getElementById('btn-theme-toggle')?.addEventListener('click', () => {
    applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark', true);
  });
}

// ═══════════════════ INIT ═══════════════════
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initAvatarPicker();
  initHome();
  initLobby();
  initRulesModal();
  initSettings();
  TicTacToe.init();
  KillerDoctor.init();
  Scribble.init();
  UNO.init();
});
