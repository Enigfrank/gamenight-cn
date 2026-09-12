// ═══════════════════ GOMOKU AI ENGINE ═══════════════════
// 纯逻辑模块：棋盘判定、棋型评分与三档难度决策，无任何 IO 依赖，便于单测。
// 棋子约定：0 空 / 1 黑（玩家）/ 2 白（AI）。

const EMPTY = 0;
const BLACK = 1;
const WHITE = 2;
const EDGE = 3; // 越界视为被封堵

const DIRS = [[1, 0], [0, 1], [1, 1], [1, -1]];

// 棋型分值：成五 > 活四 > 冲四 > 活三 > 眠三 > 活二 > 眠二 > 活一
const SCORE = {
  FIVE: 1_000_000,
  OPEN_FOUR: 100_000,
  CLOSED_FOUR: 12_000,
  OPEN_THREE: 6_000,
  SLEEP_THREE: 600,
  OPEN_TWO: 400,
  SLEEP_TWO: 60,
  OPEN_ONE: 20,
  SLEEP_ONE: 2,
};

/** 创建 size×size 空棋盘 */
function createBoard(size) {
  return Array.from({ length: size }, () => new Array(size).fill(EMPTY));
}

/** 越界判定 */
function inBounds(board, r, c) {
  return r >= 0 && c >= 0 && r < board.length && c < board.length;
}

/** 取点；越界返回 EDGE */
function cellAt(board, r, c) {
  return inBounds(board, r, c) ? board[r][c] : EDGE;
}

/**
 * 以 (r,c) 为落子点检查 p 方五连（含长连）。
 * 返回包含该点的 5 个连线坐标，供前端高亮；无五连返回 null。
 */
function checkWinAt(board, r, c, p) {
  for (const [dr, dc] of DIRS) {
    const line = [[r, c]];
    let rr = r + dr, cc = c + dc;
    while (cellAt(board, rr, cc) === p) { line.push([rr, cc]); rr += dr; cc += dc; }
    const posLen = line.length - 1;
    rr = r - dr; cc = c - dc;
    while (cellAt(board, rr, cc) === p) { line.unshift([rr, cc]); rr -= dr; cc -= dc; }
    if (line.length >= 5) {
      // 取包含落子点的连续 5 个点
      const negLen = line.length - 1 - posLen;
      const start = Math.max(0, Math.min(negLen, line.length - 5));
      return line.slice(start, start + 5);
    }
  }
  return null;
}

/**
 * 评估在 (r,c) 放置 p 子后，单一方向 (dr,dc) 上形成的最强棋型。
 * 同时识别一个间隔的跳棋型（如 XX_XX 冲四、XX_X 活三）。
 */
function evalDirection(board, r, c, dr, dc, p) {
  let count = 1;

  // 正方向连续子数
  let i = 1;
  while (cellAt(board, r + dr * i, c + dc * i) === p) i++;
  count += i - 1;
  const posEnd = cellAt(board, r + dr * i, c + dc * i);
  const posOpen = posEnd === EMPTY;

  // 负方向连续子数
  let j = 1;
  while (cellAt(board, r - dr * j, c - dc * j) === p) j++;
  count += j - 1;
  const negEnd = cellAt(board, r - dr * j, c - dc * j);
  const negOpen = negEnd === EMPTY;

  let best = shapeScore(count, (posOpen ? 1 : 0) + (negOpen ? 1 : 0));

  // 正方向跳棋型：连续段外一个空位，再接若干同色子
  if (posEnd === EMPTY && cellAt(board, r + dr * (i + 1), c + dc * (i + 1)) === p) {
    let run = 0, k = i + 1;
    while (cellAt(board, r + dr * k, c + dc * k) === p) { run++; k++; }
    const outerOpen = cellAt(board, r + dr * k, c + dc * k) === EMPTY;
    best = Math.max(best, gapShape(count, run, negOpen, outerOpen));
  }

  // 负方向跳棋型
  if (negEnd === EMPTY && cellAt(board, r - dr * (j + 1), c - dc * (j + 1)) === p) {
    let run = 0, k = j + 1;
    while (cellAt(board, r - dr * k, c - dc * k) === p) { run++; k++; }
    const outerOpen = cellAt(board, r - dr * k, c - dc * k) === EMPTY;
    best = Math.max(best, gapShape(count, run, posOpen, outerOpen));
  }

  return best;
}

/** 连续棋型打分：子数 + 开放端数量 */
function shapeScore(count, openEnds) {
  if (count >= 5) return SCORE.FIVE;
  if (openEnds === 0) return 0;
  switch (count) {
    case 4: return openEnds === 2 ? SCORE.OPEN_FOUR : SCORE.CLOSED_FOUR;
    case 3: return openEnds === 2 ? SCORE.OPEN_THREE : SCORE.SLEEP_THREE;
    case 2: return openEnds === 2 ? SCORE.OPEN_TWO : SCORE.SLEEP_TWO;
    default: return openEnds === 2 ? SCORE.OPEN_ONE : SCORE.SLEEP_ONE;
  }
}

/**
 * 跳棋型打分：连续段 + 空格 + 另一段（空格被填后连成一体）。
 * total 为填上空格后的总子数，两端是否开放决定棋型等级。
 */
function gapShape(count, gapRun, endAOpen, endBOpen) {
  const total = count + gapRun + 1;
  const openEnds = (endAOpen ? 1 : 0) + (endBOpen ? 1 : 0);
  if (openEnds === 0) return 0;
  if (total >= 5) return SCORE.CLOSED_FOUR; // 唯一成五点，等同冲四
  if (total === 4) return openEnds === 2 ? SCORE.OPEN_THREE : SCORE.SLEEP_THREE;
  if (total === 3) return openEnds === 2 ? SCORE.OPEN_TWO : SCORE.SLEEP_TWO;
  return openEnds === 2 ? SCORE.OPEN_ONE : SCORE.SLEEP_ONE;
}

/**
 * 评估在空点 (r,c) 落 p 子的总价值（四方向求和，天然奖励双活三等复合威胁），
 * 附带极小的中心权重以引导开局走法。
 */
function evalPoint(board, r, c, p) {
  let score = 0;
  for (const [dr, dc] of DIRS) score += evalDirection(board, r, c, dr, dc, p);
  const center = (board.length - 1) / 2;
  const dist = Math.abs(r - center) + Math.abs(c - center);
  score += Math.max(0, board.length - dist) * 0.2;
  return score;
}

/**
 * 候选点：距任意棋子切比雪夫距离不超过 radius 的空点。
 * 空棋盘返回 null（由调用方走天元）。
 */
function candidateMoves(board, radius = 2) {
  const n = board.length;
  const result = [];
  let hasStone = false;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (board[r][c] === EMPTY) continue;
      hasStone = true;
      for (let dr = -radius; dr <= radius; dr++) {
        for (let dc = -radius; dc <= radius; dc++) {
          const nr = r + dr, nc = c + dc;
          if (inBounds(board, nr, nc) && board[nr][nc] === EMPTY) {
            board[nr][nc] = -1; // 临时标记去重
            result.push([nr, nc]);
          }
        }
      }
    }
  }
  // 还原临时标记
  result.forEach(([r, c]) => { board[r][c] = EMPTY; });
  return hasStone ? result : null;
}

/** 临时落子后取分再还原 */
function scoreAt(board, r, c, p) {
  board[r][c] = p;
  const score = evalPoint(board, r, c, p);
  board[r][c] = EMPTY;
  return score;
}

/**
 * AI 决策入口。
 * @param {number[][]} board 当前棋盘
 * @param {'easy'|'normal'|'hard'} difficulty 难度
 * @param {number} aiPiece AI 棋子颜色（默认白 2）
 * @returns {{r:number,c:number}} 落子坐标
 */
function chooseMove(board, difficulty = 'normal', aiPiece = WHITE) {
  const n = board.length;
  const humanPiece = aiPiece === WHITE ? BLACK : WHITE;
  const center = Math.floor(n / 2);

  const candidates = candidateMoves(board, 2);
  if (!candidates) return { r: center, c: center };

  // 候选评分：进攻分（自己落子）与防守分（对手落子），防守略加权
  const scored = candidates.map(([r, c]) => {
    const off = scoreAt(board, r, c, aiPiece);
    const def = scoreAt(board, r, c, humanPiece);
    return { r, c, off, def, value: Math.max(off, def * 1.05) };
  });

  // 紧急应对 1：自己能成五，直接取胜
  const winMove = scored
    .filter(s => s.off >= SCORE.FIVE)
    .sort((a, b) => b.off - a.off)[0];
  if (winMove) return { r: winMove.r, c: winMove.c };

  // 紧急应对 2：对手下一手成五，必须封堵（多个堵点选进攻价值最高的）
  const blocks = scored.filter(s => s.def >= SCORE.FIVE).sort((a, b) => b.off - a.off);
  if (blocks.length) return { r: blocks[0].r, c: blocks[0].c };

  if (difficulty === 'easy') return chooseEasy(board, scored);
  if (difficulty === 'hard') return chooseHard(board, scored, aiPiece, humanPiece);
  return chooseGreedy(scored);
}

/** 简单：多数回合在邻点随机落子，少数回合走最优，仅成五/防成五由上层兜底 */
function chooseEasy(board, scored) {
  const near = scored.filter(({ r, c }) => {
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (cellAt(board, r + dr, c + dc) !== EMPTY && cellAt(board, r + dr, c + dc) > 0) return true;
      }
    }
    return false;
  });
  const pool = near.length ? near : scored;
  if (Math.random() < 0.6) {
    const pick = pool[Math.floor(Math.random() * pool.length)];
    return { r: pick.r, c: pick.c };
  }
  return chooseGreedy(pool);
}

/** 普通：单层贪心取最高分；0.5% 分差内视为同分随机选择，避免走法僵化 */
function chooseGreedy(scored) {
  const max = Math.max(...scored.map(s => s.value));
  const tied = scored.filter(s => s.value >= max * 0.995);
  const best = tied[Math.floor(Math.random() * tied.length)];
  return { r: best.r, c: best.c };
}

/**
 * 困难：两层极小化极大（AI 落子 → 对手最强回应），
 * 候选按启发式裁剪到前 ROOT_KEEP / REPLY_KEEP，保证大棋盘上毫秒级完成。
 */
function chooseHard(board, scored, aiPiece, humanPiece) {
  const ROOT_KEEP = 8;
  const REPLY_KEEP = 6;

  const roots = [...scored].sort((a, b) => b.value - a.value).slice(0, ROOT_KEEP);
  let best = roots[0];
  let bestValue = -Infinity;

  for (const move of roots) {
    board[move.r][move.c] = aiPiece;
    let value;
    if (checkWinAt(board, move.r, move.c, aiPiece)) {
      value = SCORE.FIVE * 2;
    } else {
      // 对手在该局面下的最强反击分（越高对 AI 越不利）
      const replies = candidateMoves(board, 2) || [];
      let worst = 0;
      const replyScores = replies
        .map(([r, c]) => ({ r, c, v: scoreAt(board, r, c, humanPiece) }))
        .sort((a, b) => b.v - a.v)
        .slice(0, REPLY_KEEP);
      for (const reply of replyScores) {
        board[reply.r][reply.c] = humanPiece;
        worst = Math.max(worst, checkWinAt(board, reply.r, reply.c, humanPiece)
          ? SCORE.FIVE * 2
          : evalPoint(board, reply.r, reply.c, humanPiece));
        board[reply.r][reply.c] = EMPTY;
      }
      // 本手进攻价值减去对手最强反击价值
      value = move.off - worst * 0.9;
    }
    board[move.r][move.c] = EMPTY;

    if (value > bestValue) { bestValue = value; best = move; }
  }
  return { r: best.r, c: best.c };
}

module.exports = {
  EMPTY, BLACK, WHITE, DIRS, SCORE,
  createBoard, checkWinAt, evalPoint, candidateMoves, chooseMove,
};
