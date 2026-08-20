import { PRIORITY_THRESHOLDS } from "./masterData.js";

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

// products: [{id, name, machines:[...], dailyQty, tools:[{no, process, maker, model, processCount, life}]}]
// latestScans: Map<`${productId}::${machine}`, {capturedAt, capturedBy, readings:{toolNo:count}}>
export function computePriorityList(products, latestScans) {
  const rows = [];

  for (const product of products) {
    for (const machine of product.machines) {
      const scan = latestScans.get(`${product.id}::${machine}`);
      if (!scan) continue;

      for (const tool of product.tools) {
        const count = scan.readings ? scan.readings[tool.no] : undefined;
        if (count === undefined || count === null || count === "") continue;

        const numCount = Number(count);
        const remaining = tool.life - numCount;
        const ratio = tool.life > 0 ? remaining / tool.life : 0;
        const dailyConsumption = (product.dailyQty || 0) * (tool.processCount || 1);
        const remainingAfterToday = remaining - dailyConsumption;

        rows.push({
          productId: product.id,
          productName: product.name,
          machine,
          toolNo: tool.no,
          process: tool.process,
          maker: tool.maker,
          model: tool.model,
          life: tool.life,
          count: numCount,
          remaining,
          ratio,
          level: levelFor(ratio),
          willRunOutToday: remainingAfterToday < 0,
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
