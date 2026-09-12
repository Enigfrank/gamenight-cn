const UNO = (() => {
  let state = null;
  let myHand = [];
  let drawnCardIndex = -1;
  const COLOR_NAMES = { red: '红色', yellow: '黄色', green: '绿色', blue: '蓝色', wild: '万能' };

  // ─── Init ───────────────────────────────────────────────────

  function init() {
    document.getElementById('uno-btn-exit').addEventListener('click', () => {
      showConfirm('要离开游戏吗？', () => App.socket.emit('game:back_to_lobby'), { confirmText: '离开' });
    });
    document.getElementById('uno-btn-draw').addEventListener('click', () => {
      App.socket.emit('game:action', { action: 'draw' });
    });
    document.getElementById('uno-btn-pass').addEventListener('click', () => {
      App.socket.emit('game:action', { action: 'pass' });
    });
    document.getElementById('uno-deck-card').addEventListener('click', () => {
      if (!state || state.currentPlayerId !== App.myId || state.phase !== 'playing' || state.awaitingPass) return;
      App.socket.emit('game:action', { action: 'draw' });
    });
    document.querySelectorAll('.uno-color-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        App.socket.emit('game:action', { action: 'choose_color', color: btn.dataset.color });
        document.getElementById('uno-color-chooser').classList.add('hidden');
      });
    });
    document.getElementById('uno-btn-again').addEventListener('click', () => App.socket.emit('game:restart'));
    document.getElementById('uno-btn-lobby').addEventListener('click', () => App.socket.emit('game:back_to_lobby'));
  }

  // ─── Socket handlers ────────────────────────────────────────

  function onState(newState) {
    const wasMyTurn = state?.currentPlayerId === App.myId;
    const isMyTurn = newState.currentPlayerId === App.myId;
    state = newState;
    if (wasMyTurn && !isMyTurn) drawnCardIndex = -1;
    document.getElementById('uno-gameover').classList.add('hidden');
    const me = state.players?.[App.myId];
    document.getElementById('uno-my-avatar').textContent = AVATARS[me?.avatar ?? App.myAvatar]?.emoji ?? '';
    document.getElementById('uno-my-name').textContent = me?.name ?? App.myName ?? '';
    render();
  }

  function onHand({ hand, drawnIndex, canPlayDrawn }) {
    myHand = hand || [];
    if (drawnIndex !== undefined) drawnCardIndex = canPlayDrawn ? drawnIndex : -1;
    renderHand();
  }

  function onChooseColor() {
    document.getElementById('uno-color-chooser').classList.remove('hidden');
  }

  function onGameOver({ winnerId, winnerName, scores, players }) {
    document.getElementById('uno-gameover-title').textContent =
      winnerId === App.myId ? '你赢啦！🎉' : `${winnerName} 赢啦！`;

    const scoresEl = document.getElementById('uno-gameover-scores');
    scoresEl.innerHTML = '';
    const sorted = Object.entries(scores).sort((a, b) => a[1] - b[1]);
    const medals = ['🥇', '🥈', '🥉'];
    sorted.forEach(([id, count], i) => {
      const row = document.createElement('div');
      row.className = 'uno-score-row' + (id === winnerId ? ' winner' : '');
      row.innerHTML =
        `<span class="uno-score-rank">${medals[i] || (i + 1) + '.'}</span>` +
        `<span class="uno-score-name">${escHtml(players[id]?.name || '?')}</span>` +
        `<span class="uno-score-val">${count === 0 ? '获胜！' : '还剩 ' + count + ' 张牌'}</span>`;
      scoresEl.appendChild(row);
    });

    document.getElementById('uno-gameover').classList.remove('hidden');
    document.getElementById('uno-btn-again').classList.toggle('hidden', !App.isHost);
    document.getElementById('uno-btn-lobby').classList.toggle('hidden', !App.isHost);
  }

  // ─── Render ─────────────────────────────────────────────────

  function render() {
    if (!state) return;
    const isMyTurn = state.currentPlayerId === App.myId;
    const phase = state.phase;

    const statusEl = document.getElementById('uno-status');
    if (phase === 'choose_color') {
      const chooser = state.players[state.currentPlayerId]?.name || '?';
      statusEl.textContent = isMyTurn ? '选一个颜色……' : `${chooser} 正在选颜色……`;
      statusEl.style.color = '';
    } else if (isMyTurn) {
      statusEl.textContent = state.awaitingPass ? '打出刚摸的牌，或者选择过' : '轮到你了！';
      statusEl.style.color = 'var(--green)';
    } else {
      statusEl.textContent = `轮到 ${state.players[state.currentPlayerId]?.name || '?'} 出牌`;
      statusEl.style.color = '';
    }

    renderDiscardCard();

    const dot = document.getElementById('uno-color-dot');
    dot.className = `uno-color-dot dot-${state.currentColor}`;
    document.getElementById('uno-color-name').textContent =
      state.currentColor.charAt(0).toUpperCase() + state.currentColor.slice(1);

    document.getElementById('uno-deck-count').textContent = state.deckCount;
    document.getElementById('uno-deck-card').classList.toggle('deck-drawable',
      isMyTurn && phase === 'playing' && !state.awaitingPass);

    const canDraw = isMyTurn && phase === 'playing' && !state.awaitingPass;
    const canPass = isMyTurn && phase === 'playing' && state.awaitingPass;
    document.getElementById('uno-btn-draw').classList.toggle('hidden', !canDraw);
    document.getElementById('uno-btn-pass').classList.toggle('hidden', !canPass);

    renderOpponents();
    renderHand();
  }

  function renderDiscardCard() {
    const el = document.getElementById('uno-discard-card');
    if (!state?.discardTop) { el.className = 'uno-card uno-card-big'; el.textContent = ''; return; }
    const card = state.discardTop;
    el.className = `uno-card uno-card-big card-${card.color}`;
    el.classList.toggle('val-text', !isDigit(card.value));
    el.textContent = cardLabel(card);
  }

  function renderOpponents() {
    if (!state) return;
    const el = document.getElementById('uno-opponents');
    el.innerHTML = '';
    state.playerOrder.forEach(id => {
      if (id === App.myId) return;
      const player = state.players[id];
      const count = state.cardCounts[id] ?? 0;

      const div = document.createElement('div');
      div.className = 'uno-opponent' + (state.currentPlayerId === id ? ' active' : '');

      const nameRow = document.createElement('div');
      nameRow.className = 'uno-opp-name';
      nameRow.textContent = player?.name || '?';
      if (state.unoSaid?.[id]) {
        const badge = document.createElement('span');
        badge.className = 'uno-uno-badge';
        badge.textContent = 'UNO!';
        nameRow.appendChild(badge);
      }

      const cardsRow = document.createElement('div');
      cardsRow.className = 'uno-opp-cards';
      const shown = Math.min(count, 14);
      for (let i = 0; i < shown; i++) {
        const c = document.createElement('div');
        c.className = 'uno-mini-card';
        cardsRow.appendChild(c);
      }
      if (count > 14) {
        const more = document.createElement('span');
        more.className = 'uno-mini-more';
        more.textContent = `+${count - 14}`;
        cardsRow.appendChild(more);
      }

      const countLabel = document.createElement('div');
      countLabel.className = 'uno-opp-count';
      countLabel.textContent = `${count} 张牌`;

      div.appendChild(nameRow);
      div.appendChild(cardsRow);
      div.appendChild(countLabel);
      el.appendChild(div);
    });
  }

  function renderHand() {
    const el = document.getElementById('uno-hand');
    el.innerHTML = '';
    if (!state) return;

    if (drawnCardIndex >= myHand.length) drawnCardIndex = -1;

    const isMyTurn = state.currentPlayerId === App.myId;
    const phase = state.phase;

    myHand.forEach((card, i) => {
      const cardEl = document.createElement('div');
      cardEl.className = `uno-card card-${card.color}`;
      cardEl.classList.toggle('val-text', !isDigit(card.value));
      cardEl.textContent = cardLabel(card);

      const playable = isMyTurn && phase === 'playing' && clientCanPlay(card);
      const restricted = state.awaitingPass && i !== drawnCardIndex;

      if (i === drawnCardIndex) cardEl.classList.add('just-drawn');

      if (playable && !restricted) {
        cardEl.classList.add('playable');
        cardEl.addEventListener('click', () => {
          drawnCardIndex = -1;
          App.socket.emit('game:action', { action: 'play_card', cardIndex: i });
        });
      } else {
        cardEl.classList.add('dimmed');
      }

      el.appendChild(cardEl);
    });
  }

  // ─── Helpers ────────────────────────────────────────────────

  function clientCanPlay(card) {
    if (!state || state.phase !== 'playing') return false;
    if (card.color === 'wild') return true;
    if (card.color === state.currentColor) return true;
    if (state.discardTop && card.value === state.discardTop.value) return true;
    return false;
  }

  function cardLabel(card) {
    const labels = { skip: '跳过', reverse: '反转', draw2: '+2', wild: '万能', wild4: '+4' };
    return labels[card.value] ?? card.value;
  }

  function isDigit(v) { return v >= '0' && v <= '9'; }

  return { init, onState, onHand, onChooseColor, onGameOver };
})();
