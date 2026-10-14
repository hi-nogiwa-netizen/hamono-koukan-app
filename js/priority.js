import { PRIORITY_THRESHOLDS } from "./masterData.js";
import {
  isOperating,
  currentOperatingSegmentEnd,
  addOperatingSeconds,
  operatingSecondsElapsed,
  nextShiftEnd,
} from "./schedule.js";

// 残り寿命の割合からレベル判定（danger=至急交換 / warning=次のシフトで交換 / ok=正常）
export function levelFor(ratio) {
  if (ratio <= PRIORITY_THRESHOLDS.danger) return "danger";
  if (ratio <= PRIORITY_THRESHOLDS.warning) return "warning";
  return "ok";
}

export const LEVEL_LABEL = {
  danger: "至急交換",
  warning: "次のシフトで交換",
  ok: "正常",
};

function machineName(machine) {
  return typeof machine === "string" ? machine : machine.name;
}

// 同じキーが複数あるときは最初の1件だけを残す。
// 製品マスタに同じ工具No・同じNC機名が重複していても、同じ工具が二重に数えられたり、
// 入力表で別の欄の古い値に上書きされたりしないようにするため。
export function uniqueByKey(list, keyFn) {
  const seen = new Set();
  return (list || []).filter((item) => {
    const key = keyFn(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// 2回以上出てくるキー（重複しているキー）の一覧を返す
export function findDuplicateKeys(list, keyFn) {
  const count = new Map();
  (list || []).forEach((item) => {
    const key = keyFn(item);
    count.set(key, (count.get(key) || 0) + 1);
  });
  return Array.from(count.entries())
    .filter(([, n]) => n > 1)
    .map(([key]) => key);
}

const SECONDS_PER_DAY = 24 * 60 * 60;

// ---- 入力した使用数の有効期限 ----
// 工具ごとの使用数を「確認した（入力した）時刻」。scan.readingTimes[工具No] があればそれ、
// なければ scan.capturedAt。「交換した」や一部だけの入力で作り直された記録でも、変えていない
// 工具は元の入力時刻を引き継ぐため、他の工具の操作で期限が延びることはない。
export function readingTime(scan, toolNo) {
  if (!scan) return undefined;
  const t = scan.readingTimes ? scan.readingTimes[toolNo] : undefined;
  return typeof t === "number" ? t : scan.capturedAt;
}

// 入力時刻から見て「次の直」が終わる日時。ここを過ぎた使用数は自動的にリセット（＝データなし）される。
export function readingExpiresAt(enteredAt) {
  return typeof enteredAt === "number" ? nextShiftEnd(new Date(enteredAt)) : null;
}

export function isReadingExpired(enteredAt, now = new Date()) {
  const expiresAt = readingExpiresAt(enteredAt);
  return !!expiresAt && now.getTime() >= expiresAt.getTime();
}

function machineCycleTimeSec(machine) {
  return typeof machine === "string" ? null : machine.cycleTimeSec || null;
}

// 確認済みの使用数（confirmedCount）に、記録時刻（capturedAt）からの経過稼働時間ぶんの
// 推定使用数を加算する。サイクルタイム未設定・記録時刻不明などの場合はそのまま返す。
// 「交換した」ボタン（他の工具の使用数だけを引き継いで新しいscanを作る処理）でも、
// この関数を使って各工具の“今の推定値”を新しい基準値にすることで、カウンターが
// 一瞬巻き戻って見える問題を避けている。
export function estimateCurrentCount(confirmedCount, cycleTimeSec, capturedAt, tool, now = new Date()) {
  if (!cycleTimeSec || typeof capturedAt !== "number") {
    return { numCount: confirmedCount, isEstimated: false };
  }
  const elapsedSec = operatingSecondsElapsed(new Date(capturedAt), now);
  if (elapsedSec <= 0) {
    return { numCount: confirmedCount, isEstimated: false };
  }
  const estimatedAdditional = (elapsedSec / cycleTimeSec) * (tool.processCount || 1);
  return { numCount: confirmedCount + estimatedAdditional, isEstimated: estimatedAdditional >= 1 };
}

// products: [{id, name, machines:[{name, cycleTimeSec}], dailyQty, tools:[{no, process, maker, model, processCount, life}]}]
// latestScans: Map<`${productId}::${machine}`, {capturedAt, capturedBy, readings:{toolNo:count}}>
// now: 現在時刻（テスト用に差し替え可能）
export function computePriorityList(products, latestScans, now = new Date()) {
  const rows = [];
  const currentShiftEnd = isOperating(now) ? currentOperatingSegmentEnd(now) : null;
  const nextShiftEnd = currentShiftEnd ? currentOperatingSegmentEnd(currentShiftEnd) : null;

  for (const product of products) {
    // 同じNC機名・同じ工具Noが重複している場合は最初の1件だけを使う
    const machineList = uniqueByKey(product.machines, machineName);
    const toolList = uniqueByKey(product.tools, (t) => t.no);
    for (const machine of machineList) {
      const name = machineName(machine);
      const cycleTimeSec = machineCycleTimeSec(machine);
      const scan = latestScans.get(`${product.id}::${name}`);
      if (!scan) continue;

      for (const tool of toolList) {
        const count = scan.readings ? scan.readings[tool.no] : undefined;
        if (count === undefined || count === null || count === "") continue;

        // 入力してから「次の直」が終わった使用数は自動的にリセット（＝データなし）にする。
        // 全工具に数字を入れる人の「交換不要な工具の数値」や、「交換した」の押し忘れが
        // いつまでも残らないようにするため。
        const enteredAt = readingTime(scan, tool.no);
        if (isReadingExpired(enteredAt, now)) continue;

        const confirmedCount = Number(count);

        // サイクルタイムが分かっている機械は、最後に記録した時刻から今までの
        // 「稼働していた時間」をもとに、今どれくらい使われているはずかを推定し、
        // カウンターを自動的に進める（人が入力し直さなくても、時間経過とともに増えていく）。
        const { numCount, isEstimated } = estimateCurrentCount(confirmedCount, cycleTimeSec, enteredAt, tool, now);

        const remaining = tool.life - numCount;
        const ratio = tool.life > 0 ? remaining / tool.life : 0;
        const dailyConsumption = (product.dailyQty || 0) * (tool.processCount || 1);
        const remainingAfterToday = remaining - dailyConsumption;

        // サイクルタイムが設定されている機械は、稼働カレンダー（1直/2直・土日休み）を
        // 踏まえて「あと何秒で寿命に到達するか」を計算する。
        let timeEstimate = null;
        if (cycleTimeSec) {
          const remainingCycles = Math.max(0, remaining) / (tool.processCount || 1);
          const secondsToExhaust = remainingCycles * cycleTimeSec;
          const exhaustAt = addOperatingSeconds(now, secondsToExhaust);
          timeEstimate = {
            exhaustAt,
            secondsToExhaust,
            withinCurrentShift: currentShiftEnd ? exhaustAt.getTime() <= currentShiftEnd.getTime() : false,
            withinNextShift: nextShiftEnd ? exhaustAt.getTime() <= nextShiftEnd.getTime() : false,
          };
        }

        // サイクルタイムがある場合は、割合ではなく時間ベースの判定を優先する
        // （割合だけで「至急交換」なのに、時間ベースでは「今のシフト中は不要」といった
        //   矛盾した表示になるのを避けるため）。ただし寿命を使い切っている場合は
        //   時間の見積もりに関わらず常に至急扱いにする。
        //
        // 「交換した」を押した直後（またはカウンターを0付近で入力した直後）は、
        // 寿命が短い工具だと時間ベースの見積もりだけでは「今のシフト中に交換が必要」
        // と判定されてしまい、交換したはずの工具が優先順位から消えないことがある。
        // 使用がほぼ0（1サイクル未満）のうちは、時間の見積もりに関わらず常に正常
        // 扱いにする。時間経過とともにカウンターが実際に進み始めれば、通常どおり
        // 時間ベースの判定に戻る。
        let level;
        if (numCount < 1) {
          level = "ok";
        } else if (timeEstimate) {
          if (remaining <= 0) {
            level = "danger";
          } else if (timeEstimate.withinCurrentShift) {
            level = "danger";
          } else if (timeEstimate.withinNextShift) {
            level = "warning";
          } else {
            level = "ok";
          }
        } else {
          level = levelFor(ratio);
        }

        // 並び順に使う「寿命に到達するまでの稼働時間（秒）」。短いほど先に交換が必要になる。
        //   サイクルタイムがある機械：(残りカウンター ÷ 1サイクルのカウント数) × 1サイクルの時間
        //   サイクルタイムが無い機械：マスタの「1日あたり生産数」から概算（1日=24時間稼働として換算）
        // 寿命を超えている工具はマイナスの値になる（超えている分が大きいほど先頭に来る）。
        // 同じ単位の1つの数値にそろえているので、サイクルタイムの有無が混在していても順序が矛盾しない。
        let sortSeconds = null;
        let sortBasis = null;
        if (cycleTimeSec) {
          sortSeconds = (remaining / (tool.processCount || 1)) * cycleTimeSec;
          sortBasis = "cycle";
        } else if (dailyConsumption > 0) {
          sortSeconds = (remaining / dailyConsumption) * SECONDS_PER_DAY;
          sortBasis = "daily";
        }

        rows.push({
          productId: product.id,
          productName: product.name,
          machine: name,
          toolNo: tool.no,
          process: tool.process,
          maker: tool.maker,
          model: tool.model,
          life: tool.life,
          count: Math.round(numCount),
          confirmedCount,
          isEstimated,
          remaining,
          ratio,
          level,
          willRunOutToday: remainingAfterToday < 0,
          timeEstimate,
          sortSeconds,
          sortBasis,
          capturedAt: enteredAt,
          capturedBy: scan.capturedBy,
          expiresAt: readingExpiresAt(enteredAt),
        });
      }
    }
  }

  // 表示バッジ（level）と番号の並び順が食い違わないよう、まずlevel（危険度）でグループ分けする。
  // 同じグループ内では、寿命に到達するまでの時間（sortSeconds：サイクルタイム×残りカウンター）が
  // 短い工具ほど先（1番）に並べる。寿命を超えている工具（マイナス）は、超えている分が大きい順に先頭。
  // 時間を計算できない工具（サイクルタイムも1日の生産数も未設定）は最後に、残り割合が低い順で並べる。
  // ※ 秒と割合は単位が違って比較できず順序が循環してしまうため、「時間を計算できる／できない」で
  //   先にグループ分けし、同じ単位同士だけを比較している。
  const LEVEL_ORDER = { danger: 0, warning: 1, ok: 2 };
  rows.sort((a, b) => {
    const levelDiff = LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level];
    if (levelDiff !== 0) return levelDiff;
    const aHasTime = a.sortSeconds === null ? 1 : 0;
    const bHasTime = b.sortSeconds === null ? 1 : 0;
    if (aHasTime !== bHasTime) return aHasTime - bHasTime;
    if (a.sortSeconds !== null && b.sortSeconds !== null && a.sortSeconds !== b.sortSeconds) {
      return a.sortSeconds - b.sortSeconds;
    }
    return a.ratio - b.ratio;
  });
  rows.forEach((row, index) => {
    row.rank = index + 1;
  });

  return rows;
}

export function summarize(rows) {
  return {
    danger: rows.filter((r) => r.level === "danger").length,
    warning: rows.filter((r) => r.level === "warning").length,
    ok: rows.filter((r) => r.level === "ok").length,
    total: rows.length,
  };
}
