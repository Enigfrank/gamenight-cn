/**
 * verify-features.js
 * 自动化端到端验收脚本：
 * 1. 房间访问密码校验（创建、错误密码拒绝、正确密码加入、密码安全隐藏）
 * 2. 房主踢人（大厅踢人、非房主踢人鉴权、局内踢人与平滑结算）
 * 3. 回合倒计时与超时托管（井字棋随机落子、五子棋 AI 托管、UNO 自动摸牌跳过）
 */

const { spawn } = require('child_process');
const { io } = require('socket.io-client');
const http = require('http');

const TEST_PORT = 49876;
const SERVER_URL = `http://127.0.0.1:${TEST_PORT}`;

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function waitForEvent(socket, eventName, timeoutMs = 7000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for event "${eventName}" (${timeoutMs}ms)`));
    }, timeoutMs);

    socket.once(eventName, (data) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

function createClient() {
  return io(SERVER_URL, {
    transports: ['websocket'],
    forceNew: true,
    reconnection: false,
  });
}

function checkPortReady(port, retries = 30, interval = 200) {
  return new Promise((resolve) => {
    let attempts = 0;
    const check = () => {
      const req = http.get(`http://127.0.0.1:${port}/`, () => {
        resolve();
      });
      req.on('error', () => {
        attempts++;
        if (attempts >= retries) {
          resolve();
        } else {
          setTimeout(check, interval);
        }
      });
    };
    check();
  });
}

async function runTests() {
  console.log('=== [1/5] 启动独立测试服务器 ===');
  const serverProc = spawn('node', ['server.js'], {
    env: { ...process.env, PORT: String(TEST_PORT), DISABLE_MDNS: '1' },
    stdio: 'pipe',
  });

  serverProc.stdout.resume();
  serverProc.stderr.on('data', d => {
    console.error(`[Server Error] ${d.toString().trim()}`);
  });

  await checkPortReady(TEST_PORT);
  console.log('✅ 测试服务器已就绪:', SERVER_URL);

  const activeSockets = [];
  function makeClient() {
    const s = createClient();
    activeSockets.push(s);
    return s;
  }

  try {
    // ==========================================
    // 场景 1: 房间密码创建与加入校验
    // ==========================================
    console.log('\n=== [2/5] 验证房间密码机制 ===');
    const host1 = makeClient();
    const guest1 = makeClient();

    await waitForEvent(host1, 'connect');
    await waitForEvent(guest1, 'connect');

    // 房主创建带密码的房间
    host1.emit('room:create', { playerName: 'Host_Pass', avatar: 0, gameType: 'tictactoe', password: 'mypassword888' });
    const createRes = await waitForEvent(host1, 'room:joined');
    console.log(`- 房间创建成功, Code: ${createRes.code}, hasPassword: ${createRes.hasPassword}`);

    if (createRes.hasPassword !== true) {
      throw new Error('断言失败: 创建带密码房间后 hasPassword 应为 true');
    }
    if (createRes.password !== undefined) {
      throw new Error('断言失败: 房间公开信息不得泄露明文密码');
    }

    // 访客不传密码加入 -> 应收到 room:error
    guest1.emit('room:join', { code: createRes.code, playerName: 'Guest_Pass', avatar: 1 });
    const errNoPass = await waitForEvent(guest1, 'room:error');
    console.log(`- 无密码加入拦截测试: 收到错误提示 "${errNoPass.msg}"`);
    if (!errNoPass.msg.includes('密码')) {
      throw new Error('断言失败: 无密码加入时应提示密码错误');
    }

    // 访客传错误密码加入 -> 应收到 room:error
    guest1.emit('room:join', { code: createRes.code, playerName: 'Guest_Pass', avatar: 1, password: 'wrong' });
    const errWrongPass = await waitForEvent(guest1, 'room:error');
    console.log(`- 错误密码加入拦截测试: 收到错误提示 "${errWrongPass.msg}"`);
    if (!errWrongPass.msg.includes('密码')) {
      throw new Error('断言失败: 错误密码加入时应提示密码错误');
    }

    // 访客传正确密码加入
    const guestLobbyPromise = waitForEvent(host1, 'lobby:update');
    guest1.emit('room:join', { code: createRes.code, playerName: 'Guest_Pass', avatar: 1, password: 'mypassword888' });
    await waitForEvent(guest1, 'room:joined');
    const lobbyUpdateAfterJoin = await guestLobbyPromise;
    console.log(`- 正确密码加入成功: 房间当前成员数 = ${lobbyUpdateAfterJoin.players.length}`);
    if (lobbyUpdateAfterJoin.players.length !== 2) {
      throw new Error('断言失败: 正确密码加入后成员数应为 2');
    }
    console.log('✅ 房间密码机制验证通过');

    // ==========================================
    // 场景 2: 大厅房主踢人与非房主鉴权
    // ==========================================
    console.log('\n=== [3/5] 验证大厅房主踢人与权限控制 ===');
    const guest1Id = guest1.id;

    // 非房主尝试踢房主
    guest1.emit('room:kick', { playerId: host1.id });
    const kickErr = await waitForEvent(guest1, 'room:error');
    console.log(`- 非房主踢人拦截测试: "${kickErr.msg}"`);
    if (!kickErr.msg.includes('只有房主才能踢出玩家')) {
      throw new Error('断言失败: 非房主踢人应被服务端拦截');
    }

    // 房主踢访客
    const kickedPromise = waitForEvent(guest1, 'room:kicked');
    const lobbyUpdatePromise = waitForEvent(host1, 'lobby:update');
    host1.emit('room:kick', { playerId: guest1Id });

    await kickedPromise;
    const lobbyData = await lobbyUpdatePromise;
    console.log(`- 访客收到 room:kicked 广播并离开`);
    console.log(`- 房主大厅更新: 剩余玩家数 = ${lobbyData.players.length}`);

    if (lobbyData.players.some(p => p.id === guest1Id)) {
      throw new Error('断言失败: 被踢玩家仍残留在房间中');
    }
    console.log('✅ 大厅房主踢人验证通过');

    // ==========================================
    // 场景 3: 井字棋回合倒计时与超时自动落子 + 局内踢人
    // ==========================================
    console.log('\n=== [4/5] 验证井字棋超时自动落子与局内踢人 ===');
    const tHost = makeClient();
    const tGuest = makeClient();
    await waitForEvent(tHost, 'connect');
    await waitForEvent(tGuest, 'connect');

    tHost.emit('room:create', { playerName: 'TTT_Host', avatar: 0, gameType: 'tictactoe' });
    const tRoom = await waitForEvent(tHost, 'room:joined');
    tGuest.emit('room:join', { code: tRoom.code, playerName: 'TTT_Guest', avatar: 1 });
    await waitForEvent(tGuest, 'room:joined');

    // 设置 turnTime = 1 秒
    tHost.emit('room:settings', { turnTime: 1 });
    await delay(300);

    // 开始游戏（有 3.2s 开局动画倒计时）
    console.log('- 触发开局，等待倒计时与初始对局状态...');
    tHost.emit('game:start');
    const tState1 = await waitForEvent(tHost, 'ttt:state', 6000);
    console.log(`- 井字棋已开局, turnEndsAt: ${tState1.turnEndsAt}, 当前执子方: ${tState1.currentTurn}`);

    if (!tState1.turnEndsAt || tState1.turnEndsAt <= Date.now()) {
      throw new Error('断言失败: 开启 1 秒倒计时后 turnEndsAt 必须为未来时间戳');
    }

    // 双方均不落子，等待 1.3 秒超时托管
    console.log('- 等待井字棋回合超时自动落子（~1.3s）...');
    const tStateAfterTimeout = await waitForEvent(tHost, 'ttt:state', 4000);
    const pieceCount = tStateAfterTimeout.board.filter(c => c !== null).length;
    console.log(`- 超时自动落子已触发, 棋盘已落子数 = ${pieceCount}, 当前轮换到: ${tStateAfterTimeout.currentTurn}`);

    if (pieceCount < 1) {
      throw new Error('断言失败: 井字棋超时后系统未自动落子');
    }

    // 局内踢人测试：房主踢出对局中的访客
    console.log('- 测试井字棋局内踢人...');
    const tGuestKickedPromise = waitForEvent(tGuest, 'room:kicked');
    const tHostStateWinPromise = waitForEvent(tHost, 'ttt:state');
    tHost.emit('room:kick', { playerId: tGuest.id });

    await tGuestKickedPromise;
    const tWinState = await tHostStateWinPromise;
    console.log(`- 被踢玩家收到 kicked, 房主收到状态: winner = ${tWinState.winner}`);
    if (!tWinState.winner) {
      throw new Error('断言失败: 局内踢出对手后应判定房主获胜');
    }
    console.log('✅ 井字棋超时托管与局内踢人验证通过');

    // ==========================================
    // 场景 4: 五子棋回合倒计时与超时 AI 托管 + 局内踢人
    // ==========================================
    console.log('\n=== [5/5] 验证五子棋超时 AI 托管与局内踢人 ===');
    const gkHost = makeClient();
    const gkGuest = makeClient();
    await waitForEvent(gkHost, 'connect');
    await waitForEvent(gkGuest, 'connect');

    gkHost.emit('room:create', { playerName: 'GK_Host', avatar: 0, gameType: 'gomoku' });
    const gkRoom = await waitForEvent(gkHost, 'room:joined');
    gkGuest.emit('room:join', { code: gkRoom.code, playerName: 'GK_Guest', avatar: 1 });
    await waitForEvent(gkGuest, 'room:joined');

    // 设置 turnTime = 1 秒
    gkHost.emit('room:settings', { turnTime: 1, mode: 'pvp' });
    await delay(300);

    // 开始游戏
    console.log('- 触发五子棋开局...');
    gkHost.emit('game:start');
    const gkState1 = await waitForEvent(gkHost, 'gk:state', 6000);
    console.log(`- 五子棋已开局, turnEndsAt: ${gkState1.turnEndsAt}, 当前先手颜色: ${gkState1.current}`);

    if (!gkState1.turnEndsAt || gkState1.turnEndsAt <= Date.now()) {
      throw new Error('断言失败: 五子棋 turnEndsAt 必须为未来时间戳');
    }

    // 监听超时落子状态
    console.log('- 等待五子棋超时 AI 托管落子（~1.3s）...');
    const gkStateAfterTimeout = await waitForEvent(gkHost, 'gk:state', 4000);
    console.log(`- 超时托管后当前执子方: ${gkStateAfterTimeout.current}, 上一步落子: ${JSON.stringify(gkStateAfterTimeout.lastMove)}`);

    if (!gkStateAfterTimeout.lastMove) {
      throw new Error('断言失败: 五子棋超时后未自动代下落子');
    }

    // 局内踢人测试
    console.log('- 测试五子棋局内踢人...');
    const gkGuestKickedPromise = waitForEvent(gkGuest, 'room:kicked');
    const gkHostWinPromise = waitForEvent(gkHost, 'gk:state');
    gkHost.emit('room:kick', { playerId: gkGuest.id });

    await gkGuestKickedPromise;
    const gkWinState = await gkHostWinPromise;
    console.log(`- 五子棋局内踢人成功: winner = ${gkWinState.winner}`);
    if (!gkWinState.winner) {
      throw new Error('断言失败: 踢除对手后应判定获胜');
    }
    console.log('✅ 五子棋超时 AI 托管与局内踢人验证通过');

    // ==========================================
    // 场景 5: UNO 回合倒计时与超时托管
    // ==========================================
    console.log('\n=== [6/6] 验证 UNO 回合倒计时与超时托管 ===');
    const unoHost = makeClient();
    const unoGuest = makeClient();
    await waitForEvent(unoHost, 'connect');
    await waitForEvent(unoGuest, 'connect');

    unoHost.emit('room:create', { playerName: 'UNO_Host', avatar: 0, gameType: 'uno' });
    const unoRoom = await waitForEvent(unoHost, 'room:joined');
    unoGuest.emit('room:join', { code: unoRoom.code, playerName: 'UNO_Guest', avatar: 1 });
    await waitForEvent(unoGuest, 'room:joined');

    // 设置 turnTime = 1 秒
    unoHost.emit('room:settings', { turnTime: 1 });
    await delay(300);

    // 开始游戏
    console.log('- 触发 UNO 开局...');
    unoHost.emit('game:start');
    const unoState1 = await waitForEvent(unoHost, 'uno:state', 6000);
    const firstPlayerId = unoState1.currentPlayerId;
    console.log(`- UNO 对局开始, 首位行动玩家: ${firstPlayerId}, turnEndsAt: ${unoState1.turnEndsAt}`);

    if (!unoState1.turnEndsAt || unoState1.turnEndsAt <= Date.now()) {
      throw new Error('断言失败: UNO turnEndsAt 必须为有效时间戳');
    }

    // 等待 1.5 秒超时托管（自动摸牌并跳过/过牌）
    console.log('- 等待 UNO 玩家思考超时托管（~1.5s）...');
    const unoState2 = await waitForEvent(unoHost, 'uno:state', 4000);
    console.log(`- 超时后当前行动玩家: ${unoState2.currentPlayerId}`);

    if (unoState2.currentPlayerId === firstPlayerId && unoState2.phase === 'playing' && !unoState2.awaitingPass) {
      throw new Error('断言失败: UNO 超时托管后未能推进回合顺位');
    }

    // 局内踢人测试：踢出访客
    console.log('- 测试 UNO 局内踢人...');
    const unoGuestKickedPromise = waitForEvent(unoGuest, 'room:kicked');
    unoHost.emit('room:kick', { playerId: unoGuest.id });
    await unoGuestKickedPromise;
    console.log('- 被踢玩家成功收到 room:kicked 事件');
    console.log('✅ UNO 超时托管与局内踢人验证通过');

    console.log('\n🎉🎉🎉 所有功能自动化验收测试全部通过！🎉🎉🎉\n');
  } finally {
    // 清理连接并关闭服务器
    activeSockets.forEach(s => s.disconnect());
    serverProc.kill();
  }
}

runTests().catch(err => {
  console.error('\n❌ 验收测试执行失败:', err);
  process.exit(1);
});
