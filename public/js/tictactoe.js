const TicTacToe = (() => {
  let mySymbol = null;
  let state = null;
  let isTournament = false;
  let prevBoard = Array(9).fill(null);
  let timerInterval = null;
  // 经典/系列赛对局方离场后置位：隐藏“下一局/新对决”，与服务端 tttNewGame 人数守卫对应
  let opponentLeft = false;

  function stopTimer() {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
  }

  function getTimerSuffix() {
    if (!state || state.winner || state.matchWinner || !state.turnEndsAt || state.turnEndsAt <= 0) return '';
    const rem = Math.max(0, Math.ceil((state.turnEndsAt - Date.now()) / 1000));
    return rem > 0 ? ` (${rem}s)` : ' (超时托管中…)';
  }

  function updateStatusText() {
    const status = document.getElementById('ttt-status');
    if (!status || !state || state.winner || state.matchWinner) return;
    const timerStr = getTimerSuffix();
    if (!mySymbol) {
      status.textContent = `👁 ${isTournament ? '本局观战中' : '观战中'}`;
    } else if (state.currentTurn === App.myId) {
      status.textContent = `轮到你了！你是 ${mySymbol === 'X' ? '✕' : '○'}${timerStr}`;
    } else {
      const other = state.currentTurn === state.players.X.id ? state.players.X : state.players.O;
      status.textContent = `等 ${other.name} 落子……${timerStr}`;
    }
  }

  function init() {
    document.querySelectorAll('.ttt-cell').forEach(cell => {
      cell.addEventListener('click', () => {
        if (!state || !state.board || state.winner || state.matchWinner) return;
        if (state.currentTurn !== App.myId) return;
        App.socket.emit('game:action', { action: 'move', index: +cell.dataset.i });
      });
    });

    document.getElementById('btn-ttt-again').addEventListener('click', () => {
      App.socket.emit('game:action', { action: 'new_game' });
    });
    document.getElementById('btn-ttt-new-match').addEventListener('click', () => {
      App.socket.emit('game:restart');
    });
    document.getElementById('btn-ttt-lobby').addEventListener('click', () => {
      App.socket.emit('game:back_to_lobby');
    });
    document.getElementById('ttt-leave').addEventListener('click', () => {
      showConfirm('确定要退出吗？退出后会离开房间。', () => location.reload(), { confirmText: '退出', danger: true });
    });

    App.socket.on('ttt:tournament_state', onTournamentState);
    App.socket.on('ttt:tournament_over', onTournamentOver);
  }

  function onSymbol({ symbol }) {
    mySymbol = symbol;
    if (!isTournament) {
      document.getElementById('ttt-spectating').classList.toggle('hidden', !!symbol);
    }
  }

  function onState(s) {
    state = s;
    isTournament = s.mode === 'tournament';
    if (!s.board) return; // tournament between matches
    // 全新一局（空棋盘、未结算）到达时复位离场标记
    if (!s.winner && s.board.every(c => c === null)) opponentLeft = false;
    renderBoard();
    if (!isTournament) {
      renderScores();
    }
    renderStatus();
    document.getElementById('ttt-spectating').classList.toggle('hidden', isTournament || !!mySymbol);
  }

  function onTournamentState(data) {
    isTournament = true;
    document.getElementById('ttt-tournament-info').classList.remove('hidden');
    document.getElementById('ttt-match-label').classList.add('hidden');

    // Show waiting message if no active match
    const hasActive = data.currentPlayerIds.length > 0;
    if (!hasActive) {
      document.getElementById('ttt-status').textContent = '⏳ 锦标赛马上开始……';
      document.getElementById('ttt-result').classList.add('hidden');
    }

    const p1 = data.allPlayers[data.currentPlayerIds[0]];
    const p2 = data.allPlayers[data.currentPlayerIds[1]];
    const roundLabel = getTournamentRoundLabel(data.currentRound, data.rounds.length);
    document.getElementById('ttt-match-info').textContent =
      hasActive ? `${roundLabel}：${p1?.name ?? '?'} vs ${p2?.name ?? '?'}` : '正在排对阵表……';

    renderBracket(data.rounds, data.allPlayers, data.currentRound, data.currentMatch);

    // Show spectating badge for non-active players
    const amPlaying = data.currentPlayerIds.includes(App.myId);
    document.getElementById('ttt-spectating').classList.toggle('hidden', amPlaying || !hasActive);
  }

  function onTournamentOver({ winner, rounds, allPlayers }) {
    isTournament = true;
    document.getElementById('ttt-board').style.opacity = '0.3';
    document.getElementById('ttt-result').classList.remove('hidden');
    const isMe = winner?.id === App.myId;
    document.getElementById('ttt-result-text').innerHTML =
      `🏆 锦标赛冠军：<strong>${isMe ? '就是你！' : escHtml(winner?.name || '?')}</strong>`;
    document.getElementById('ttt-host-only').style.display = App.isHost ? 'flex' : 'none';
    document.getElementById('btn-ttt-again').classList.remove('hidden');
    document.getElementById('btn-ttt-again').textContent = '再来一届';
    document.getElementById('btn-ttt-new-match').classList.add('hidden');

    renderBracket(rounds, allPlayers, -1, -1);
    document.getElementById('ttt-match-info').textContent = '🏁 锦标赛圆满结束！';
  }

  function onPlayerLeft({ name }) {
    opponentLeft = true;
    // 服务端先广播 ttt:state 再发 player_left，需在此直接收起续局按钮
    document.getElementById('btn-ttt-again').classList.add('hidden');
    document.getElementById('btn-ttt-new-match').classList.add('hidden');
    toast(`${name} 退出了游戏。`);
  }

  function getTournamentRoundLabel(roundIdx, totalRounds) {
    if (roundIdx < 0) return '决赛';
    if (roundIdx === totalRounds - 1) return '决赛';
    if (roundIdx === totalRounds - 2 && totalRounds > 2) return '半决赛';
    return `第 ${roundIdx + 1} 轮`;
  }

  function renderBracket(rounds, allPlayers, currentRound, currentMatch) {
    const bracket = document.getElementById('ttt-bracket');
    bracket.innerHTML = '';
    rounds.forEach((matches, ri) => {
      const col = document.createElement('div');
      col.className = 'bracket-round bracket-round-slide';
      col.style.animationDelay = `${ri * 0.12}s`;
      const label = document.createElement('div');
      label.className = 'bracket-round-label';
      label.textContent = getTournamentRoundLabel(ri, rounds.length);
      col.appendChild(label);

      matches.forEach((match, mi) => {
        if (match.isBye && !match.winner) return; // skip unresolvable byes
        const card = document.createElement('div');
        const isActive = ri === currentRound && mi === currentMatch;
        card.className = 'bracket-match' + (isActive ? ' active' : '');

        const makeSlot = (playerId) => {
          const slot = document.createElement('div');
          const isWinner = match.winner === playerId;
          slot.className = 'bm-player' + (isWinner ? ' winner' : '') + (!playerId ? ' tbd' : '');
          slot.textContent = playerId ? (allPlayers[playerId]?.name || '?') : '待定';
          if (playerId === App.myId) {
            const tag = document.createElement('span');
            tag.className = 'bm-you'; tag.textContent = ' (你)';
            slot.appendChild(tag);
          }
          return slot;
        };

        const vs = document.createElement('div');
        vs.className = 'bm-vs'; vs.textContent = match.isBye ? '— 轮空 —' : 'vs';

        col.appendChild(card);
        card.appendChild(makeSlot(match.p1));
        card.appendChild(vs);
        card.appendChild(makeSlot(match.p2));
      });

      bracket.appendChild(col);
    });
  }

  function renderBoard() {
    const cells = document.querySelectorAll('.ttt-cell');
    document.getElementById('ttt-board').style.opacity = '1';
    cells.forEach((cell, i) => {
      const val = state.board[i];
      const isNew = val && !prevBoard[i];
      cell.textContent = val === 'X' ? '✕' : val === 'O' ? '○' : '';
      cell.className = 'ttt-cell' + (val ? ' taken' : '') + (val === 'X' ? ' x-cell' : val === 'O' ? ' o-cell' : '');
      if (state.winLine?.includes(i)) cell.classList.add('win-cell');
      if (isNew) {
        cell.classList.remove('ttt-cell-pop');
        void cell.offsetWidth;
        cell.classList.add('ttt-cell-pop');
      }
    });
    prevBoard = [...(state.board || Array(9).fill(null))];
  }

  function renderScoreKickBtn(cardId, playerId, playerName) {
    const card = document.getElementById(cardId);
    if (!card) return;
    card.querySelectorAll('.ttt-kick-btn').forEach(b => b.remove());
    if (!App.isHost || playerId === App.myId) return;
    const btn = document.createElement('button');
    btn.className = 'btn-host-ctrl btn-kick-ctrl ttt-kick-btn';
    btn.title = `踢出 ${playerName}`;
    btn.textContent = '🚫';
    btn.addEventListener('click', () => {
      showConfirm(`把 ${playerName} 踢出房间？`, () => App.socket.emit('room:kick', { playerId }), { confirmText: '踢出', danger: true });
    });
    card.appendChild(btn);
  }

  const bestOfLabel = n => ({ 3: '三局两胜', 5: '五局三胜', 7: '七局四胜' })[n] || '自由对战';

  function renderScores() {
    const { players, scores, bestOf } = state;
    document.getElementById('ttt-name-X').textContent = players.X.name + (players.X.id === App.myId ? ' (你)' : '');
    document.getElementById('ttt-name-O').textContent = players.O.name + (players.O.id === App.myId ? ' (你)' : '');
    document.getElementById('ttt-pts-X').textContent = scores[players.X.id] || 0;
    document.getElementById('ttt-pts-O').textContent = scores[players.O.id] || 0;
    document.getElementById('ttt-score-X').classList.toggle('active-turn', state.currentTurn === players.X.id && !state.winner);
    document.getElementById('ttt-score-O').classList.toggle('active-turn', state.currentTurn === players.O.id && !state.winner);
    renderScoreKickBtn('ttt-score-X', players.X.id, players.X.name);
    renderScoreKickBtn('ttt-score-O', players.O.id, players.O.name);
    const matchLabel = document.getElementById('ttt-match-label');
    if (matchLabel) {
      matchLabel.textContent = bestOf > 0 ? bestOfLabel(bestOf) : '自由对战';
      matchLabel.classList.toggle('hidden', false);
    }
  }

  function renderScoresTournament() {
    if (!state.players) return;
    const { players } = state;
    document.getElementById('ttt-name-X').textContent = players.X.name + (players.X.id === App.myId ? ' (你)' : '');
    document.getElementById('ttt-name-O').textContent = players.O.name + (players.O.id === App.myId ? ' (你)' : '');
    document.getElementById('ttt-pts-X').textContent = '—';
    document.getElementById('ttt-pts-O').textContent = '—';
    document.getElementById('ttt-score-X').classList.toggle('active-turn', state.currentTurn === players.X.id && !state.winner);
    document.getElementById('ttt-score-O').classList.toggle('active-turn', state.currentTurn === players.O.id && !state.winner);
    renderScoreKickBtn('ttt-score-X', players.X.id, players.X.name);
    renderScoreKickBtn('ttt-score-O', players.O.id, players.O.name);
  }

  function renderStatus() {
    const result = document.getElementById('ttt-result');
    const status = document.getElementById('ttt-status');

    if (isTournament) {
      renderScoresTournament();
      if (state.winner) {
        stopTimer();
        if (state.winner === 'draw') {
          result.classList.remove('hidden');
          document.getElementById('ttt-result-text').textContent = "平局！🤝 马上重赛……";
          document.getElementById('ttt-host-only').style.display = 'none';
          document.getElementById('btn-ttt-again').classList.add('hidden');
          document.getElementById('btn-ttt-new-match').classList.add('hidden');
        } else {
          const winnerPlayer = state.players[state.winnerSymbol];
          result.classList.remove('hidden');
          document.getElementById('ttt-result-text').textContent =
            winnerPlayer.id === App.myId ? '这局你赢了！✅' : `${winnerPlayer.name} 赢下了这一局！✅`;
          document.getElementById('ttt-host-only').style.display = 'none';
          document.getElementById('btn-ttt-again').classList.add('hidden');
          document.getElementById('btn-ttt-new-match').classList.add('hidden');
        }
        status.textContent = '';
      } else {
        result.classList.add('hidden');
        updateStatusText();
        if (!timerInterval && state.turnEndsAt > 0) {
          timerInterval = setInterval(updateStatusText, 1000);
        }
      }
      return;
    }

    // Classic mode
    const hostOnly = document.getElementById('ttt-host-only');
    const newMatchBtn = document.getElementById('btn-ttt-new-match');
    const newGameBtn = document.getElementById('btn-ttt-again');
    if (state.matchWinner) {
      stopTimer();
      result.classList.remove('hidden');
      const mw = state.players.X.id === state.matchWinner ? state.players.X : state.players.O;
      const isMe = state.matchWinner === App.myId;
      document.getElementById('ttt-result-text').textContent = isMe
        ? `🏆 你赢下了整场比赛！（${bestOfLabel(state.bestOf)}）`
        : `🏆 ${mw.name} 赢下了整场比赛！（${bestOfLabel(state.bestOf)}）`;
      hostOnly.style.display = App.isHost ? 'flex' : 'none';
      newMatchBtn.classList.toggle('hidden', opponentLeft);
      newGameBtn.classList.add('hidden');
      status.textContent = '';
    } else if (state.winner) {
      stopTimer();
      result.classList.remove('hidden');
      let msg;
      if (state.winner === 'draw') {
        msg = '平局啦！🤝';
        const board = document.getElementById('ttt-board');
        board.classList.remove('ttt-shake'); void board.offsetWidth; board.classList.add('ttt-shake');
      } else {
        const winnerPlayer = state.players[state.winnerSymbol];
        msg = winnerPlayer.id === App.myId ? '你赢啦！🎉' : `${winnerPlayer.name} 赢了！`;
      }
      document.getElementById('ttt-result-text').textContent = msg;
      hostOnly.style.display = App.isHost ? 'flex' : 'none';
      newMatchBtn.classList.add('hidden');
      newGameBtn.classList.toggle('hidden', opponentLeft);
      status.textContent = '';
    } else {
      result.classList.add('hidden');
      updateStatusText();
      if (!timerInterval && state.turnEndsAt > 0) {
        timerInterval = setInterval(updateStatusText, 1000);
      }
    }
  }

  return { init, onSymbol, onState, onPlayerLeft, teardown: stopTimer };
})();
