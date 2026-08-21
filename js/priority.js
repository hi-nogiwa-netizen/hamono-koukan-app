import { PRIORITY_THRESHOLDS } from "./masterData.js";
import { isOperating, currentOperatingSegmentEnd, addOperatingSeconds } from "./schedule.js";

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

        const numCount = Number(count);
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
          count: numCount,
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

  // 残り寿命の割合が低い(=交換が近い)順に並べ、順位を付与する
  rows.sort((a, b) => a.ratio - b.ratio);
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
