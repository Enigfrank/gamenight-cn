const KillerDoctor = (() => {
  let myRole = null;
  let roleVisible = true;
  let timerInterval = null;
  let tensionShown = false;
  let ambientInterval = null;

  const ROLE_INFO = {
    killer:   { icon: '🔪', color: '#ef4444', desc: '每晚秘密淘汰一名玩家，白天小心别暴露。' },
    doctor:   { icon: '💉', color: '#10b981', desc: '每晚秘密守护一名玩家，守护村庄的希望。' },
    villager: { icon: '🧑', color: '#94a3b8', desc: '找出杀手并投票把他淘汰，别让村庄沦陷。' },
  };
  const ROLE_NAMES = { killer: '杀手', doctor: '医生', villager: '村民' };
  const roleLabel = r => ROLE_NAMES[r] || '—';

  function getAvatar(p) {
    return AVATARS[p?.avatar ?? 0] || AVATARS[0];
  }

  function init() {
    document.getElementById('kd-toggle-role').addEventListener('click', toggleRole);

    document.getElementById('kd-chat-input').addEventListener('keydown', e => {
      if (e.key === 'Enter') sendChat();
    });
    document.getElementById('kd-chat-send').addEventListener('click', sendChat);
    document.getElementById('kd-btn-again').addEventListener('click', () => App.socket.emit('game:restart'));
    document.getElementById('kd-btn-lobby').addEventListener('click', () => App.socket.emit('game:back_to_lobby'));
    document.getElementById('kd-btn-exit').addEventListener('click', () => {
      showConfirm('确定要退出吗？退出后会离开房间。', () => location.reload(), { confirmText: '退出', danger: true });
    });

    App.socket.on('kd:night_start', onNightStart);
    App.socket.on('kd:night_progress', ({ confirmed, total }) => {
      const el = document.getElementById('kd-night-progress');
      el.textContent = `已行动 ${confirmed} / ${total} 人`;
      el.classList.remove('hidden');
    });
    App.socket.on('kd:action_confirmed', onActionConfirmed);
    App.socket.on('kd:night_result', onNightResult);
    App.socket.on('kd:day_start', onDayStart);
    App.socket.on('kd:voting_start', onVotingStart);
    App.socket.on('kd:vote_update', onVoteUpdate);
    App.socket.on('kd:vote_confirmed', onVoteConfirmed);
    App.socket.on('kd:vote_result', onVoteResult);
    App.socket.on('kd:game_over', onGameOver);
    App.socket.on('chat:message', onChatMessage);
  }

  function setPhase(phase) {
    document.querySelectorAll('.kd-phase').forEach(p => p.classList.remove('active'));
    const el = document.getElementById(`kd-phase-${phase}`);
    if (el) el.classList.add('active');
    clearInterval(timerInterval);
  }

  function startTimer(elId, seconds) {
    clearInterval(timerInterval);
    const el = document.getElementById(elId);
    let remaining = seconds;
    function tick() {
      const m = Math.floor(remaining / 60);
      const s = remaining % 60;
      el.textContent = `${m}:${s.toString().padStart(2,'0')}`;
      el.classList.toggle('danger', remaining <= 15);
      remaining--;
      if (remaining < 0) clearInterval(timerInterval);
    }
    tick();
    timerInterval = setInterval(tick, 1000);
  }

  function toggleRole() {
    roleVisible = !roleVisible;
    const card = document.getElementById('kd-role-card');
    const roleNameEl = document.getElementById('kd-role-name');
    const charEl = document.getElementById('kd-role-character');
    const descEl = document.getElementById('kd-role-desc');
    const btn = document.getElementById('kd-toggle-role');
    if (roleVisible) {
      const info = ROLE_INFO[myRole] || {};
      roleNameEl.textContent = `${info.icon || ''} ${roleLabel(myRole)}`;
      charEl.classList.remove('hidden');
      descEl.classList.remove('hidden');
      card.classList.remove('hidden-role');
      btn.textContent = '隐藏';
    } else {
      roleNameEl.textContent = '🂠 身份隐藏';
      charEl.classList.add('hidden');
      descEl.classList.add('hidden');
      card.classList.add('hidden-role');
      btn.textContent = '显示';
    }
  }

  function setRole(role, alive = true) {
    myRole = role;
    const info = ROLE_INFO[role] || {};
    const av = AVATARS[App.myAvatar ?? 0] || AVATARS[0];
    const card = document.getElementById('kd-role-card');
    card.dataset.role = role;
    document.getElementById('kd-role-name').textContent = `${info.icon || ''} ${roleLabel(role)}`;
    document.getElementById('kd-role-desc').textContent = info.desc || '';
    document.getElementById('kd-role-character').textContent = `${av.emoji} ${av.name}`;
    document.getElementById('kd-you-status').textContent = alive ? '🟢 存活' : '💀 已死亡';
    roleVisible = false;
    card.classList.add('hidden-role');
    document.getElementById('kd-role-name').textContent = '🂠 身份隐藏';
    document.getElementById('kd-role-character').classList.add('hidden');
    document.getElementById('kd-role-desc').classList.add('hidden');
    document.getElementById('kd-toggle-role').textContent = '显示';
  }

  function renderPlayerList(living, dead) {
    const list = document.getElementById('kd-player-list');
    list.innerHTML = '';
    const aliveCount = (living || []).length;
    list.classList.toggle('kd-tension', aliveCount === 3);
    if (aliveCount === 3 && !tensionShown && myRole !== null) {
      tensionShown = true;
      toast('⚠️ 只剩最后 3 人了——杀手马上就能赢！', 4000, 'warning');
    }
    const all = [...(living || []).map(p => ({...p, alive: true})), ...(dead || []).map(p => ({...p, alive: false}))];
    all.forEach(p => {
      const item = document.createElement('div');
      item.className = 'kd-player-item' + (p.alive ? '' : ' dead');
      const av = getAvatar(p);
      const charIcon = document.createElement('div');
      charIcon.className = 'player-char-icon';
      charIcon.textContent = av.emoji;
      charIcon.title = av.name;
      const nameWrap = document.createElement('div');
      nameWrap.className = 'player-name-wrap';
      nameWrap.textContent = p.name;
      if (p.id === App.myId) {
        const tag = document.createElement('span');
        tag.className = 'you-tag'; tag.textContent = ' (你)';
        nameWrap.appendChild(tag);
      }
      item.appendChild(charIcon);
      item.appendChild(nameWrap);
      if (!p.alive) { const skull = document.createElement('span'); skull.textContent = '💀'; item.appendChild(skull); }
      if (App.isHost && p.id !== App.myId) {
        const kickBtn = document.createElement('button');
        kickBtn.className = 'btn-host-ctrl btn-kick-ctrl kd-kick-btn';
        kickBtn.title = `踢出 ${p.name}`;
        kickBtn.textContent = '🚫';
        kickBtn.addEventListener('click', e => {
          e.stopPropagation();
          showConfirm(`把 ${p.name} 踢出房间？`, () => App.socket.emit('room:kick', { playerId: p.id }), { confirmText: '踢出', danger: true });
        });
        item.appendChild(kickBtn);
      }
      list.appendChild(item);
    });
  }

  function addHistory(entry) {
    const hist = document.getElementById('kd-history');
    const item = document.createElement('div');
    item.className = 'history-item';
    item.textContent = entry;
    hist.insertBefore(item, hist.firstChild);
  }

  const ANIM_CONFIG = {
    kill:          { emojis: ['🩸','💀','🔪','💔','🩸'],          count: 20, dir: 'fall', bg: 'rgba(180,20,20,0.6)',    icon: '💀', text: '杀手出手了！',           dur: 2400 },
    save:          { emojis: ['✨','💚','⭐','💫','🌟'],          count: 18, dir: 'rise', bg: 'rgba(10,140,80,0.55)',  icon: '💚', text: '医生神救援！',           dur: 2400 },
    peace:         { emojis: ['⭐','🌟','💤','🌙'],               count: 10, dir: 'rise', bg: 'rgba(40,40,120,0.5)',   icon: '🌙', text: '一夜平安……',             dur: 2400 },
    night:         { emojis: ['🌙','⭐','✨','💫','🌟'],          count: 16, dir: 'fall', bg: 'rgba(8,8,48,0.72)',     icon: '🌙', text: '夜幕降临……',             dur: 2000 },
    day:           { emojis: ['☀️','🌸','🐦','✨','🌻'],         count: 14, dir: 'rise', bg: 'rgba(255,175,25,0.38)', icon: '🌅', text: '天亮了',                 dur: 2000 },
    killer_caught: { emojis: ['🎉','🎊','🏆','⚔️','✨','🌟'],    count: 28, dir: 'rise', bg: 'rgba(20,100,220,0.55)', icon: '🎉', text: '抓到杀手了！',           dur: 2800 },
    innocent_out:  { emojis: ['😢','💔','🪦','😭','🕊️'],         count: 15, dir: 'fall', bg: 'rgba(70,50,90,0.6)',    icon: '😢', text: '错杀了好人……',           dur: 2200 },
    villagers_win: { emojis: ['🎉','🎊','🌟','🏆','🎈','✨'],    count: 35, dir: 'rise', bg: 'rgba(16,120,70,0.55)',  icon: '🏆', text: '村民阵营获胜！',         dur: 3500 },
    killer_wins:   { emojis: ['💀','🔪','😈','🌑','👁️','🩸'],    count: 30, dir: 'fall', bg: 'rgba(90,0,0,0.72)',     icon: '😈', text: '杀手阵营获胜！',         dur: 3500 },
  };

  function showNightAnimation(type) {
    const cfg = ANIM_CONFIG[type] || ANIM_CONFIG.peace;
    const overlay = document.createElement('div');
    overlay.className = `kd-anim-overlay kd-anim-${type}`;
    overlay.style.background = cfg.bg;

    // Particle rain / rise
    const particles = document.createElement('div');
    particles.className = 'kd-particles';
    for (let i = 0; i < cfg.count; i++) {
      const p = document.createElement('span');
      p.className = `kd-particle kd-particle-${cfg.dir}`;
      p.textContent = cfg.emojis[Math.floor(Math.random() * cfg.emojis.length)];
      p.style.cssText = [
        `left:${Math.random() * 100}%`,
        `animation-delay:${(Math.random() * 1.8).toFixed(2)}s`,
        `animation-duration:${(1.4 + Math.random() * 1.6).toFixed(2)}s`,
        `font-size:${(0.9 + Math.random() * 1.6).toFixed(1)}rem`,
        `opacity:${(0.7 + Math.random() * 0.3).toFixed(2)}`,
      ].join(';');
      particles.appendChild(p);
    }

    const main = document.createElement('div');
    main.className = 'kd-anim-main';

    const icon = document.createElement('div');
    icon.className = 'kd-anim-icon';
    icon.textContent = cfg.icon;

    const text = document.createElement('div');
    text.className = 'kd-anim-text';
    text.textContent = cfg.text;

    main.appendChild(icon);
    main.appendChild(text);
    overlay.appendChild(particles);
    overlay.appendChild(main);
    document.getElementById('view-killerdoctor').appendChild(overlay);

    // Fade out then remove
    setTimeout(() => {
      overlay.style.transition = 'opacity 0.4s ease';
      overlay.style.opacity = '0';
      setTimeout(() => overlay.remove(), 400);
    }, cfg.dur || 2400);
  }

  function startAmbient() {
    stopAmbient();
    ambientInterval = setInterval(() => {
      const s = document.createElement('span');
      s.className = 'kd-ambient-star';
      s.textContent = ['⭐','✨','💫','🌟'][Math.floor(Math.random() * 4)];
      s.style.cssText = `left:${(Math.random()*95).toFixed(1)}%;animation-duration:${(5+Math.random()*4).toFixed(1)}s`;
      document.body.appendChild(s);
      setTimeout(() => s.remove(), 10000);
    }, 700);
  }

  function stopAmbient() {
    clearInterval(ambientInterval);
    ambientInterval = null;
    document.querySelectorAll('.kd-ambient-star').forEach(s => s.remove());
  }

  function showActionBurst(elId, emojis) {
    const el = document.getElementById(elId);
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    for (let i = 0; i < 6; i++) {
      const span = document.createElement('span');
      span.className = 'kd-action-burst-particle';
      span.textContent = emojis[i % emojis.length];
      const angle = (i / 6) * Math.PI * 2;
      const dist = 50 + Math.random() * 25;
      span.style.cssText = [
        `left:${cx}px`, `top:${cy}px`,
        `--dx:${(Math.cos(angle)*dist).toFixed(0)}px`,
        `--dy:${(Math.sin(angle)*dist).toFixed(0)}px`,
      ].join(';');
      document.body.appendChild(span);
      setTimeout(() => span.remove(), 850);
    }
  }

  function showVoteDropAnim(btn) {
    const rect = btn.getBoundingClientRect();
    const el = document.createElement('span');
    el.className = 'kd-vote-drop';
    el.textContent = '🗳️';
    el.style.left = `${rect.left + rect.width / 2}px`;
    el.style.top  = `${rect.top}px`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 900);
  }

  function onRoleAssigned({ role, allPlayers }) {
    tensionShown = false;
    stopAmbient();
    setRole(role);
    renderPlayerList(allPlayers, []);
    setPhase('reveal');
    document.getElementById('kd-chat-messages').innerHTML = '';
    document.getElementById('kd-history').innerHTML = '';
    // Card flip reveal animation
    const card = document.getElementById('kd-role-card');
    card.classList.remove('kd-card-flip');
    void card.offsetWidth;
    card.classList.add('kd-card-flip');
  }

  function onReconnect({ role, phase, alive, avatar }) {
    if (avatar !== undefined) App.myAvatar = avatar;
    setRole(role, alive);
    setPhase(phase === 'night' ? 'night' :
             phase === 'night_resolution' ? 'night-result' :
             phase === 'day_discussion' ? 'discussion' :
             phase === 'voting' ? 'voting' :
             phase === 'vote_resolution' ? 'vote-result' :
             phase === 'game_over' ? 'gameover' : 'reveal');
  }

  function onNightStart({ round, livingPlayers, deadPlayers }) {
    renderPlayerList(livingPlayers, deadPlayers);
    addHistory(`第 ${round} 夜开始了`);
    document.getElementById('kd-night-title').textContent = `第 ${round} 夜`;
    document.getElementById('kd-night-subtitle').textContent = '村庄陷入沉睡……';
    const isAlive = livingPlayers.some(p => p.id === App.myId);
    const nightAction = document.getElementById('kd-night-action');
    nightAction.classList.remove('hidden');
    document.getElementById('kd-action-done').classList.add('hidden');
    document.getElementById('kd-villager-awake').classList.add('hidden');
    document.getElementById('kd-night-timer').classList.add('hidden');
    document.getElementById('kd-night-progress').classList.add('hidden');
    const grid = document.getElementById('kd-action-targets');
    grid.innerHTML = '';
    if (isAlive) {
      document.getElementById('kd-action-title').textContent = '🔪 选好今晚的目标';
      document.getElementById('kd-action-desc').textContent = '点一名玩家，今晚就把 TA 淘汰。';
      livingPlayers.forEach(t => {
        const btn = makeTargetBtn(t, () => {
          grid.querySelectorAll('.target-btn').forEach(b => b.classList.remove('selected'));
          btn.classList.add('selected');
          grid.querySelectorAll('.target-btn').forEach(b => b.disabled = true);
          App.socket.emit('game:action', { action: 'night_kill', targetId: t.id });
        });
        grid.appendChild(btn);
      });
    } else {
      document.getElementById('kd-action-title').textContent = '🌙 黑夜阶段';
      document.getElementById('kd-action-desc').textContent = '你已经出局，安静围观吧。';
    }
    setPhase('night');
    startTimer('kd-night-timer', 45);
    showNightAnimation('night');
    startAmbient();
  }

  function makeTargetBtn(t, onClick) {
    const btn = document.createElement('button');
    btn.className = 'target-btn';
    const charEl = document.createElement('div');
    charEl.className = 'target-char';
    charEl.textContent = getAvatar(t).emoji;
    const nameEl = document.createElement('span');
    nameEl.textContent = t.name;
    btn.appendChild(charEl);
    btn.appendChild(nameEl);
    btn.addEventListener('click', onClick);
    return btn;
  }

  function onActionConfirmed({ action }) {
    const isKill = action === 'night_kill';
    document.getElementById('kd-action-done').textContent = isKill ? '✓ 已选定目标' : '✓ 已提交守护';
    document.getElementById('kd-action-done').classList.remove('hidden');
    document.getElementById('kd-action-desc').textContent = '等其他玩家行动…';
    document.querySelectorAll('#kd-action-targets .target-btn').forEach(b => b.disabled = true);
    showActionBurst('kd-action-done', isKill ? ['🔪','💀','🩸'] : ['💉','💚','✨']);
  }

  function onNightResult({ message, died, saved, livingPlayers, deadPlayers }) {
    stopAmbient();
    renderPlayerList(livingPlayers, deadPlayers);
    if (died) {
      addHistory(`${died.name} 昨晚遇害了。`);
      document.getElementById('kd-you-status').textContent = died.id === App.myId ? '💀 已死亡' : document.getElementById('kd-you-status').textContent;
      showNightAnimation('kill');
    } else if (saved) {
      addHistory('医生出手相救——昨晚无人死亡。');
      showNightAnimation('save');
    } else {
      addHistory('一夜平安无事。');
      showNightAnimation('peace');
    }
    document.getElementById('kd-night-msg').textContent = message;

    const victimEl = document.getElementById('kd-night-victim');
    if (died) {
      victimEl.innerHTML = `<span class="victim-char">${getAvatar(died).emoji}</span><span class="victim-name">${died.name} 倒下了</span>`;
      victimEl.className = 'night-victim-display victim-dead';
    } else if (saved) {
      victimEl.innerHTML = `<span class="victim-char">💚</span><span class="victim-name">被医生守护住了</span>`;
      victimEl.className = 'night-victim-display victim-saved';
    } else {
      victimEl.innerHTML = '';
      victimEl.className = 'night-victim-display';
    }

    setPhase('night-result');
  }

  function onDayStart({ round, duration, livingPlayers, deadPlayers }) {
    renderPlayerList(livingPlayers, deadPlayers);
    document.getElementById('kd-day-title').textContent = `第 ${round} 天 —— 自由讨论`;
    document.getElementById('kd-chat-messages').innerHTML = '';
    const isAlive = livingPlayers.some(p => p.id === App.myId);
    document.getElementById('kd-chat-input').disabled = !isAlive;
    document.getElementById('kd-chat-send').disabled = !isAlive;
    setPhase('discussion');
    startTimer('kd-day-timer', duration);
    showNightAnimation('day');
  }

  function onVotingStart({ duration, livingPlayers, deadPlayers }) {
    renderPlayerList(livingPlayers, deadPlayers);
    const isAlive = livingPlayers.some(p => p.id === App.myId);
    document.getElementById('kd-dead-notice').classList.toggle('hidden', isAlive);
    document.getElementById('kd-voted-notice').classList.add('hidden');
    const grid = document.getElementById('kd-vote-targets');
    grid.innerHTML = '';
    livingPlayers.filter(p => p.id !== App.myId).forEach(t => {
      const btn = document.createElement('button');
      btn.className = 'vote-btn';
      btn.disabled = !isAlive;
      const charEl = document.createElement('div');
      charEl.className = 'vote-char';
      charEl.textContent = getAvatar(t).emoji;
      const nameEl = document.createElement('div');
      nameEl.textContent = t.name;
      btn.appendChild(charEl);
      btn.appendChild(nameEl);
      btn.addEventListener('click', () => {
        if (!isAlive) return;
        showVoteDropAnim(btn);
        grid.querySelectorAll('.vote-btn').forEach(b => { b.classList.remove('voted'); b.disabled = true; });
        btn.classList.add('voted');
        App.socket.emit('game:action', { action: 'vote', targetId: t.id });
      });
      grid.appendChild(btn);
    });
    const prog = document.getElementById('kd-vote-progress');
    prog.textContent = '等大家投票……';
    setPhase('voting');
    startTimer('kd-vote-timer', duration);
  }

  function onVoteUpdate({ cast, total }) {
    document.getElementById('kd-vote-progress').textContent = `已有 ${cast} / ${total} 人投票`;
  }

  function onVoteConfirmed({ targetName }) {
    document.getElementById('kd-voted-notice').textContent = `✓ 你投给了 ${targetName}`;
    document.getElementById('kd-voted-notice').classList.remove('hidden');
  }

  function onVoteResult({ tied, eliminated, message, voteDetails, livingPlayers, deadPlayers }) {
    renderPlayerList(livingPlayers, deadPlayers);
    document.getElementById('kd-elim-msg').textContent = message;

    if (eliminated) {
      showNightAnimation(eliminated.role === 'killer' ? 'killer_caught' : 'innocent_out');
      addHistory(`${eliminated.name} 被投票出局（${roleLabel(eliminated.role)}）`);
      if (eliminated.id === App.myId) {
        document.getElementById('kd-you-status').textContent = '💀 已出局';
      }
      const reveal = document.getElementById('kd-elim-reveal');
      reveal.className = `role-reveal-card ${eliminated.role}`;
      reveal.innerHTML = `<div class="reveal-char">${getAvatar(eliminated).emoji}</div><div class="reveal-role">${ROLE_INFO[eliminated.role]?.icon || ''} ${roleLabel(eliminated.role)}</div><div>${eliminated.name} 居然是${roleLabel(eliminated.role)}！</div>`;
      reveal.classList.remove('hidden');
      document.getElementById('kd-elim-icon').textContent = eliminated.role === 'killer' ? '⚰️' : '😢';
      document.getElementById('kd-elim-title').textContent = eliminated.role === 'killer' ? '抓到杀手了！' : '错杀了好人';
    } else {
      document.getElementById('kd-elim-reveal').classList.add('hidden');
      document.getElementById('kd-elim-icon').textContent = tied ? '🤝' : '⚖️';
      document.getElementById('kd-elim-title').textContent = '本轮无人出局';
      addHistory('平票，没有人出局。');
    }

    const detail = document.getElementById('kd-vote-detail');
    detail.innerHTML = '';
    (voteDetails || []).sort((a,b) => b.votes - a.votes).forEach((v, idx) => {
      const d = document.createElement('div');
      d.className = 'vote-detail-item vote-reveal-stagger';
      d.style.animationDelay = `${idx * 0.35}s`;
      d.innerHTML = `${getAvatar(v).emoji} ${v.name}: <span class="vote-count">${v.votes} 票</span>`;
      detail.appendChild(d);
    });

    const nextLabel = document.getElementById('kd-next-label');
    nextLabel.textContent = '下一轮马上开始……';
    nextLabel.classList.remove('hidden');

    setPhase('vote-result');
  }

  function onGameOver({ winner, reason, allPlayers, history }) {
    stopAmbient();
    const isVillagers = winner === 'villagers';
    const isAbandoned = winner === 'abandoned';
    document.getElementById('kd-win-icon').textContent = isAbandoned ? '🚪' : (isVillagers ? '🏘️' : '🔪');
    document.getElementById('kd-win-title').textContent = isAbandoned ? '游戏散场了' : (isVillagers ? '村民阵营获胜！' : '杀手阵营获胜！');
    document.getElementById('kd-win-reason').textContent = reason;
    document.getElementById('kd-btn-again').style.display = App.isHost ? 'inline-block' : 'none';
    document.getElementById('kd-btn-lobby').style.display = App.isHost ? 'inline-block' : 'none';
    setPhase('gameover');
    if (!isAbandoned) showNightAnimation(isVillagers ? 'villagers_win' : 'killer_wins');
    setTimeout(() => {
      document.querySelectorAll('.final-player-card').forEach(card => {
        if (card.querySelector('.fp-role.killer')) card.classList.add('kd-killer-spotlight');
      });
    }, 3900);

    const grid = document.getElementById('kd-final-players');
    grid.innerHTML = '';
    allPlayers.forEach(p => {
      const info = ROLE_INFO[p.role] || {};
      const card = document.createElement('div');
      card.className = 'final-player-card' + (p.alive ? '' : ' dead');
      card.innerHTML = `<div class="fp-char">${getAvatar(p).emoji}</div><div class="fp-name">${p.name}${p.id === App.myId ? ' (你)' : ''}</div><div class="fp-role ${p.role}">${info.icon || ''} ${roleLabel(p.role)}</div><div style="font-size:.75rem;color:var(--muted)">${p.alive ? '活到最后' : '已出局'}</div>`;
      grid.appendChild(card);
    });

    const hist = document.getElementById('kd-final-history');
    hist.innerHTML = '';
    (history || []).forEach(h => {
      const d = document.createElement('div');
      d.textContent = h.reason === 'vote' ? `第 ${h.round} 天：${h.name} 被投票出局（${roleLabel(h.role)}）` : `第 ${h.round} 夜：${h.name} 遇害`;
      hist.appendChild(d);
    });
  }

  function onChatMessage({ playerName, message }) {
    if (App.gameType !== 'killerdoctor') return;
    const messages = document.getElementById('kd-chat-messages');
    const msg = document.createElement('div');
    msg.className = 'chat-msg';
    msg.innerHTML = `<span class="msg-name" style="color:${avatarColor(playerName)}">${playerName}:</span><span class="msg-text">${escHtml(message)}</span>`;
    messages.appendChild(msg);
    messages.scrollTop = messages.scrollHeight;
  }

  function sendChat() {
    const input = document.getElementById('kd-chat-input');
    const msg = input.value.trim();
    if (!msg) return;
    App.socket.emit('chat:send', { message: msg });
    input.value = '';
  }

  function escHtml(s) {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  return { init, onRoleAssigned, onReconnect };
})();
