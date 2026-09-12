// 五子棋 AI 引擎的基础用例：胜负判定、紧急取胜/封堵、三档决策冒烟。
// Run with: node test-gomoku.js

const assert = require('assert');
const GK = require('./gomoku-ai');
const { createBoard, checkWinAt, chooseMove, EMPTY, BLACK, WHITE } = GK;

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

// ── 胜负判定 ──
test('横向五连可判胜', () => {
  const b = createBoard(15);
  for (let c = 3; c <= 7; c++) b[5][c] = BLACK;
  assert.deepStrictEqual(checkWinAt(b, 5, 7, BLACK), [[5, 3], [5, 4], [5, 5], [5, 6], [5, 7]]);
});

test('斜线五连可判胜', () => {
  const b = createBoard(15);
  for (let i = 0; i < 5; i++) b[i][i] = WHITE;
  assert.ok(checkWinAt(b, 2, 2, WHITE));
});

test('四连不判胜', () => {
  const b = createBoard(15);
  for (let c = 3; c <= 6; c++) b[5][c] = BLACK;
  assert.strictEqual(checkWinAt(b, 5, 6, BLACK), null);
});

test('长连（六连）按五连处理', () => {
  const b = createBoard(15);
  for (let c = 3; c <= 8; c++) b[5][c] = BLACK;
  assert.strictEqual(checkWinAt(b, 5, 5, BLACK).length, 5);
});

// ── AI 紧急应对 ──
test('AI 有成五点时直接取胜', () => {
  const b = createBoard(15);
  for (let c = 4; c <= 7; c++) b[7][c] = WHITE;
  const m = chooseMove(b, 'normal', WHITE);
  assert.ok(m.c === 3 || m.c === 8, `应落在成五端点，实际 (${m.r},${m.c})`);
});

test('对手活四时 AI 必须封堵（任意难度）', () => {
  for (const diff of ['easy', 'normal', 'hard']) {
    const b = createBoard(15);
    for (let c = 4; c <= 7; c++) b[7][c] = BLACK; // 两端皆空的活四
    const m = chooseMove(b, diff, WHITE);
    assert.ok(m.r === 7 && (m.c === 3 || m.c === 8),
      `${diff} 难度应封堵活四端点，实际 (${m.r},${m.c})`);
  }
});

test('对手冲四（单端）时 AI 封堵唯一成五点', () => {
  const b = createBoard(15);
  b[7][0] = WHITE; // 堵死左端
  for (let c = 1; c <= 4; c++) b[7][c] = BLACK; // 黑四，唯一成五点 c=5
  const m = chooseMove(b, 'hard', WHITE);
  assert.ok(m.r === 7 && m.c === 5, `应堵 (7,5)，实际 (${m.r},${m.c})`);
});

test('AI 能识别跳四棋型 (XX_XX) 并成五', () => {
  const b = createBoard(15);
  b[7][3] = WHITE; b[7][4] = WHITE; b[7][6] = WHITE; b[7][7] = WHITE;
  const m = chooseMove(b, 'hard', WHITE);
  assert.ok(m.r === 7 && m.c === 5, `应填跳四缺口 (7,5)，实际 (${m.r},${m.c})`);
});

test('困难难度会提前封堵活三演进', () => {
  // 黑活三 _XXX_，白若不理，黑下一手成活四
  const b = createBoard(15);
  b[7][4] = BLACK; b[7][5] = BLACK; b[7][6] = BLACK;
  const m = chooseMove(b, 'hard', WHITE);
  // 堵在活三两端或直接压制关键点均为合理防守，要求至少贴着三子区域
  assert.ok(m.r === 7 && m.c >= 3 && m.c <= 7, `困难应防守活三区域，实际 (${m.r},${m.c})`);
});

// ── 决策冒烟 ──
test('空棋盘各难度均落天元且在界内空位', () => {
  for (const diff of ['easy', 'normal', 'hard']) {
    const b = createBoard(15);
    const m = chooseMove(b, diff, WHITE);
    assert.strictEqual(b[m.r][m.c], EMPTY);
    assert.strictEqual(m.r, 7);
    assert.strictEqual(m.c, 7);
  }
});

test('19 路困难难度决策可快速返回合法落点', () => {
  const b = createBoard(19);
  // 模拟中盘：随机撒 20 手黑白交替
  const spots = [];
  for (let r = 4; r < 15; r++) for (let c = 4; c < 15; c++) spots.push([r, c]);
  spots.sort(() => Math.random() - 0.5);
  for (let i = 0; i < 20; i++) b[spots[i][0]][spots[i][1]] = i % 2 === 0 ? BLACK : WHITE;
  const t0 = Date.now();
  const m = chooseMove(b, 'hard', WHITE);
  const cost = Date.now() - t0;
  assert.ok(b[m.r][m.c] === EMPTY && m.r >= 0 && m.c >= 0 && m.r < 19 && m.c < 19);
  assert.ok(cost < 500, `困难决策耗时 ${cost}ms 超过 500ms`);
});

test('连续对弈 60 手 AI 不报错且无越界/重复落子', () => {
  const b = createBoard(13);
  for (let turn = 0; turn < 60; turn++) {
    const piece = turn % 2 === 0 ? BLACK : WHITE;
    let m;
    if (piece === WHITE) {
      m = chooseMove(b, 'normal', WHITE);
    } else {
      // 模拟黑方：用白引擎顶替随机策略之外的合法走法
      m = chooseMove(b, 'easy', BLACK);
    }
    assert.strictEqual(b[m.r][m.c], EMPTY, `第 ${turn} 手落在已占点`);
    b[m.r][m.c] = piece;
    if (checkWinAt(b, m.r, m.c, piece)) break;
  }
});

console.log(`\n五子棋 AI：${passed} 项用例全部通过 ✅`);
