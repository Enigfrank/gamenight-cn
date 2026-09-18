// ═══════════════════ GOMOKU CLIENT ═══════════════════
// 五子棋房间模块：交叉点棋盘渲染、回合门禁（含 AI 思考态）、比分与结算。
// 权威状态全部来自服务端 gk:state；本模块只负责呈现与上报落子。

const Gomoku = (() => {
  const PIECE_BLACK = 1;
  const PIECE_WHITE = 2;

  let myColor = null; // 'black' | 'white' | null（观战）
  let state = null;
  let mirror = [];   // 已渲染棋盘快照，用于增量更新
  let timerInterval = null;
  // 人人对局一方离场后置位：隐藏“下一局”，与服务端 gkNewGame 人数守卫对应
  let opponentLeft = false;

  function stopTimer() {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
  }

  function getTimerSuffix() {
    if (!state || state.winner || !state.turnEndsAt || state.turnEndsAt <= 0) return '';
    const currentPlayer = state.players[state.current];
    if (currentPlayer?.isAI) return '';
    const rem = Math.max(0, Math.ceil((state.turnEndsAt - Date.now()) / 1000));
    return rem > 0 ? ` (${rem}s)` : ' (超时托管中…)';
  }

  function updateStatusText() {
    const status = document.getElementById('gk-status');
    const thinking = document.getElementById('gk-thinking');
    if (!status || !state || state.winner) return;

    const currentPlayer = state.players[state.current];
    const timerStr = getTimerSuffix();

    if (!myColor) {
      thinking.classList.add('hidden');
      status.textContent = `观战中${timerStr}`;
    } else if (currentPlayer.isAI) {
      thinking.classList.remove('hidden');
      status.textContent = 'AI 思考中…';
    } else if (state.current === myColor) {
      thinking.classList.add('hidden');
      status.textContent = (myColor === 'black' ? '轮到你落子（黑棋先手）' : '轮到你落子（白棋）') + timerStr;
    } else {
      thinking.classList.add('hidden');
      status.textContent = `等待 ${currentPlayer.name} 落子…` + timerStr;
    }
  }

  /** 各棋盘规格的星位（0 基坐标） */
  function starPoints(n) {
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

  function init() {
    document.getElementById('gk-board').addEventListener('click', onBoardClick);
    document.getElementById('btn-gk-again').addEventListener('click', () => {
      App.socket.emit('game:action', { action: 'new_game' });
    });
    document.getElementById('btn-gk-lobby').addEventListener('click', () => {
      App.socket.emit('game:back_to_lobby');
    });
    document.getElementById('gk-leave').addEventListener('click', () => {
      showConfirm('确定要退出吗？退出后会离开房间。', () => location.reload(), { confirmText: '退出', danger: true });
    });
  }

  function onColor({ color }) {
    myColor = color;
    document.getElementById('gk-spectating').classList.toggle('hidden', !!color);
    // gk:state 可能先于 gk:color 到达，收到颜色后需补一次渲染以解除锁定态
    if (state) render();
  }

  function onPlayerLeft({ name }) {
    if (state && state.mode !== 'pve') {
      opponentLeft = true;
      // 服务端先广播 gk:state 再发 player_left，需在此直接收起“下一局”
      document.getElementById('btn-gk-again').classList.add('hidden');
    }
    toast(`${name} 退出了游戏。`);
  }

  function onState(s) {
    state = s;
    // 全新一局（未落子、未结算）到达时复位离场标记
    if (!s.winner && s.moves === 0) opponentLeft = false;
    const boardEl = document.getElementById('gk-board');
    if (mirror.length !== s.size) buildBoard(s.size);
    boardEl.classList.toggle('gk-me-black', myColor === 'black');
    boardEl.classList.toggle('gk-me-white', myColor === 'white');
    render();
  }

  /** 按尺寸（重）建棋盘交叉点 */
  function buildBoard(n) {
    const boardEl = document.getElementById('gk-board');
    boardEl.dataset.size = String(n);
    boardEl.innerHTML = '';
    const stars = starPoints(n);
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const cell = document.createElement('button');
        cell.type = 'button';
        cell.className = 'gk-cell';
        cell.dataset.r = r;
        cell.dataset.c = c;
        if (stars.has(`${r},${c}`)) {
          const dot = document.createElement('span');
          dot.className = 'gk-star-dot';
          cell.appendChild(dot);
        }
        const preview = document.createElement('span');
        preview.className = 'gk-preview';
        cell.appendChild(preview);
        boardEl.appendChild(cell);
      }
    }
    mirror = Array.from({ length: n }, () => new Array(n).fill(0));
  }

  /** 当前是否允许本地玩家落子（AI 思考/非己方回合/已结束时全部封禁） */
  function canPlay() {
    return !!state && !state.winner && myColor === state.current;
  }

  function onBoardClick(e) {
    const cell = e.target.closest('.gk-cell');
    if (!cell || !canPlay()) return;
    App.socket.emit('game:action', { action: 'gk_move', r: +cell.dataset.r, c: +cell.dataset.c });
  }

  /** 增量渲染棋子，并刷新最后落子/五连高亮 */
  function render() {
    const boardEl = document.getElementById('gk-board');
    const cells = boardEl.children;
    const n = state.size;

    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const cell = cells[r * n + c];
        const piece = state.board[r][c];
        if (piece !== mirror[r][c]) {
          mirror[r][c] = piece;
          if (piece === PIECE_BLACK || piece === PIECE_WHITE) {
            cell.classList.add(piece === PIECE_BLACK ? 'gk-black' : 'gk-white');
            const stone = document.createElement('span');
            stone.className = 'gk-stone gk-stone-pop';
            cell.appendChild(stone);
          } else {
            // 新局/重开时清除上一局残留棋子
            cell.classList.remove('gk-black', 'gk-white');
            cell.querySelectorAll('.gk-stone').forEach(el => el.remove());
          }
        }
        cell.classList.toggle('gk-last',
          !!state.lastMove && state.lastMove[0] === r && state.lastMove[1] === c && !state.winLine);
        cell.classList.toggle('gk-win',
          !!state.winLine && state.winLine.some(([wr, wc]) => wr === r && wc === c));
      }
    }

    boardEl.classList.toggle('gk-locked', !canPlay());
    renderScores();
    renderStatus();
  }

  function playerLabel(player) {
    return player.name + (player.id === App.myId ? ' (你)' : '');
  }

  function renderScoreKickBtn(cardId, player) {
    const card = document.getElementById(cardId);
    if (!card) return;
    card.querySelectorAll('.gk-kick-btn').forEach(b => b.remove());
    if (!App.isHost || !player || player.isAI || player.id === App.myId) return;
    const btn = document.createElement('button');
    btn.className = 'btn-host-ctrl btn-kick-ctrl gk-kick-btn';
    btn.title = `踢出 ${player.name}`;
    btn.textContent = '🚫';
    btn.addEventListener('click', () => {
      showConfirm(`把 ${player.name} 踢出房间？`, () => App.socket.emit('room:kick', { playerId: player.id }), { confirmText: '踢出', danger: true });
    });
    card.appendChild(btn);
  }

  function renderScores() {
    const { players, scores } = state;
    document.getElementById('gk-name-black').textContent = playerLabel(players.black);
    document.getElementById('gk-name-white').textContent = playerLabel(players.white);
    document.getElementById('gk-ai-tag').classList.toggle('hidden', !players.white.isAI);
    document.getElementById('gk-pts-black').textContent = scores[players.black.id] || 0;
    document.getElementById('gk-pts-white').textContent = scores[players.white.id] || 0;
    document.getElementById('gk-score-black').classList.toggle('active-turn', state.current === 'black' && !state.winner);
    document.getElementById('gk-score-white').classList.toggle('active-turn', state.current === 'white' && !state.winner);
    renderScoreKickBtn('gk-score-black', players.black);
    renderScoreKickBtn('gk-score-white', players.white);

    const sizeLabel = `${state.size} × ${state.size}`;
    const modeLabel = state.mode === 'pve'
      ? `人机对战 · ${{ easy: '简单', normal: '普通', hard: '困难' }[state.difficulty] || '普通'}`
      : '人人对战';
    document.getElementById('gk-match-label').textContent = `${sizeLabel} · ${modeLabel} · 第 ${state.gameCount} 局`;
  }

  function renderStatus() {
    const status = document.getElementById('gk-status');
    const thinking = document.getElementById('gk-thinking');
    const result = document.getElementById('gk-result');

    if (state.winner) {
      stopTimer();
      thinking.classList.add('hidden');
      status.textContent = '';
      result.classList.remove('hidden');
      result.querySelector('#gk-result-text').textContent = resultText();
      document.getElementById('gk-host-only').style.display = App.isHost ? 'flex' : 'none';
      document.getElementById('btn-gk-again').classList.toggle('hidden', opponentLeft);
      return;
    }

    result.classList.add('hidden');
    updateStatusText();
    const currentPlayer = state.players[state.current];
    if (!timerInterval && state.turnEndsAt > 0 && !currentPlayer?.isAI) {
      timerInterval = setInterval(updateStatusText, 1000);
    }
  }

  /** 结算文案：区分玩家胜 / AI 胜 / 对方胜 / 平局 / 观战视角 */
  function resultText() {
    if (state.winner === 'draw') return '棋盘已满，平局！';
    const winner = state.players[state.winner];
    if (winner.id === App.myId) return '你赢了！五连达成 🏆';
    if (winner.isAI) return 'AI 五连获胜，再来一局扳回来！';
    if (!myColor) return `${winner.name} 五连获胜 🏆`;
    return `${winner.name} 赢了这一局。`;
  }

  return { init, onState, onColor, onPlayerLeft, teardown: stopTimer };
})();
