import { PRIORITY_THRESHOLDS } from "./masterData.js";
import { isOperating, currentOperatingSegmentEnd, addOperatingSeconds, operatingSecondsElapsed } from "./schedule.js";

// 残り寿命の割合からレベル判定（danger=至急交換 / warning=まもなく交換 / ok=正常）
export function levelFor(ratio) {
  if (ratio <= PRIORITY_THRESHOLDS.danger) return "danger";
  if (ratio <= PRIORITY_THRESHOLDS.warning) return "warning";
  return "ok";
}

export const LEVEL_LABEL = {
  danger: "至急交換",
  warning: "まもなく交換",
  ok: "正常",
};

function machineName(machine) {
  return typeof machine === "string" ? machine : machine.name;
}

function machineCycleTimeSec(machine) {
  return typeof machine === "string" ? null : machine.cycleTimeSec || null;
}

// products: [{id, name, machines:[{name, cycleTimeSec}], dailyQty, tools:[{no, process, maker, model, processCount, life}]}]
// latestScans: Map<`${productId}::${machine}`, {capturedAt, capturedBy, readings:{toolNo:count}}>
// now: 現在時刻（テスト用に差し替え可能）
export function computePriorityList(products, latestScans, now = new Date()) {
  const rows = [];
  const currentShiftEnd = isOperating(now) ? currentOperatingSegmentEnd(now) : null;
  const nextShiftEnd = currentShiftEnd ? currentOperatingSegmentEnd(currentShiftEnd) : null;

  for (const product of products) {
    for (const machine of product.machines || []) {
      const name = machineName(machine);
      const cycleTimeSec = machineCycleTimeSec(machine);
      const scan = latestScans.get(`${product.id}::${name}`);
      if (!scan) continue;

      for (const tool of product.tools) {
        const count = scan.readings ? scan.readings[tool.no] : undefined;
        if (count === undefined || count === null || count === "") continue;

        const confirmedCount = Number(count);

        // サイクルタイムが分かっている機械は、最後に記録した時刻から今までの
        // 「稼働していた時間」をもとに、今どれくらい使われているはずかを推定し、
        // カウンターを自動的に進める（人が入力し直さなくても、時間経過とともに増えていく）。
        let numCount = confirmedCount;
        let isEstimated = false;
        if (cycleTimeSec && typeof scan.capturedAt === "number") {
          const elapsedSec = operatingSecondsElapsed(new Date(scan.capturedAt), now);
          if (elapsedSec > 0) {
            const estimatedAdditional = (elapsedSec / cycleTimeSec) * (tool.processCount || 1);
            numCount = confirmedCount + estimatedAdditional;
            isEstimated = estimatedAdditional >= 1;
          }
        }

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
        let level;
        if (timeEstimate) {
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
          capturedAt: scan.capturedAt,
          capturedBy: scan.capturedBy,
        });
      }
    }
  }

  // 表示バッジ（level）と番号の並び順が食い違わないよう、まずlevel（危険度）でグループ分けする。
  // 同じグループ内では、(1)時間の見積もりがある行を先に、(2)見積もりがある同士は早く尽きる順、
  // (3)見積もりがない同士は割合が低い順、で並べる。
  // ※ 見積もり(秒)と割合を直接比較すると単位が違うため、順序が矛盾する（AがBより先、BがCより先、
  //   なのにCがAより先、のような循環）ことがあるので、必ず「見積もりの有無」でグループを分けてから
  //   同じ単位同士だけを比較するようにしている。
  const LEVEL_ORDER = { danger: 0, warning: 1, ok: 2 };
  rows.sort((a, b) => {
    const levelDiff = LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level];
    if (levelDiff !== 0) return levelDiff;
    const aHasEstimate = a.timeEstimate ? 0 : 1;
    const bHasEstimate = b.timeEstimate ? 0 : 1;
    if (aHasEstimate !== bHasEstimate) return aHasEstimate - bHasEstimate;
    if (a.timeEstimate && b.timeEstimate) {
      return a.timeEstimate.secondsToExhaust - b.timeEstimate.secondsToExhaust;
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
