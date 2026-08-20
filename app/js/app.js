import * as db from "./db.js";
import { computePriorityList, summarize } from "./priority.js";
import { fileToCanvas, warpToRect, sliceGridCells, recognizeGrid } from "./ocr.js";

let products = [];
let latestScans = new Map();

const capture = {
  product: null,
  capturedBy: "",
  sourceCanvas: null,
  tappedPoints: [],
  straightCanvas: null,
  ocrResults: null,
};

const tapCanvas = document.getElementById("tap-canvas");
const tapCtx = tapCanvas.getContext("2d");

// ---------- 共通ユーティリティ ----------

let toastTimer = null;
function showToast(message, isError = false) {
  const el = document.getElementById("toast");
  el.textContent = message;
  el.classList.remove("hidden");
  el.classList.toggle("error", !!isError);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add("hidden"), 3200);
}

function setBadge(text, kind) {
  const badge = document.getElementById("connection-badge");
  badge.textContent = text;
  badge.className = `badge badge-${kind}`;
}

// ---------- タブ切り替え ----------

document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    const view = btn.dataset.view;
    ["dashboard", "capture", "history", "admin"].forEach((v) => {
      document.getElementById(`view-${v}`).classList.toggle("hidden", v !== view);
    });
  });
});

// ---------- ダッシュボード ----------

function renderDashboard() {
  const rows = computePriorityList(products, latestScans);
  const stats = summarize(rows);

  document.getElementById("summary-row").innerHTML = `
    <div class="summary-tile danger"><span class="num">${stats.danger}</span><span class="label">至急交換</span></div>
    <div class="summary-tile warning"><span class="num">${stats.warning}</span><span class="label">まもなく交換</span></div>
    <div class="summary-tile ok"><span class="num">${stats.ok}</span><span class="label">正常</span></div>
  `;

  const listEl = document.getElementById("priority-list");
  if (!rows.length) {
    listEl.innerHTML = '<p class="empty-hint">まだ記録がありません。「撮影」タブから指示表を撮影してください。</p>';
    return;
  }
  listEl.innerHTML = rows
    .map((r) => {
      const pct = Math.max(0, Math.round(r.ratio * 100));
      return `
      <div class="priority-card ${r.level}">
        <div class="rank-badge">${r.rank}</div>
        <div class="info">
          <div class="title">${escapeHtml(r.toolNo)}　${escapeHtml(r.process)}</div>
          <div class="sub">${escapeHtml(r.productName)} / ${escapeHtml(r.machine)} / ${escapeHtml(r.maker)} ${escapeHtml(r.model)}</div>
          ${r.willRunOutToday ? '<span class="today-flag">本日中に寿命到達の恐れ</span>' : ""}
        </div>
        <div class="metrics">
          <div class="ratio">残り${pct}%</div>
          <div class="counts">${r.count} / ${r.life}</div>
        </div>
      </div>`;
    })
    .join("");
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}

// ---------- 履歴 ----------

function renderHistory(scans) {
  const container = document.getElementById("history-list");
  if (!scans.length) {
    container.innerHTML = '<p class="empty-hint">まだ履歴がありません</p>';
    return;
  }
  container.innerHTML = scans
    .map((s) => {
      const product = products.find((p) => p.id === s.productId);
      const when = typeof s.capturedAt === "number" ? new Date(s.capturedAt).toLocaleString("ja-JP") : "送信中…";
      const count = s.readings ? Object.keys(s.readings).length : 0;
      return `<div class="history-item">
        <div><strong>${escapeHtml(product ? product.name : s.productId)}</strong>　${escapeHtml(s.machine)}</div>
        <div class="meta">${when}　記入者: ${escapeHtml(s.capturedBy || "-")}　${count}件の数値</div>
      </div>`;
    })
    .join("");
}

// ---------- 撮影フロー ----------

function populateProductSelect() {
  const sel = document.getElementById("product-select");
  const prevVal = sel.value;
  sel.innerHTML = products.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join("");
  if (products.some((p) => p.id === prevVal)) sel.value = prevVal;
}

function showCaptureStep(name) {
  ["select", "corners", "ocr", "review", "done"].forEach((s) => {
    document.getElementById(`capture-step-${s}`).classList.toggle("hidden", s !== name);
  });
}

function drawSourceWithMarkers() {
  tapCtx.drawImage(capture.sourceCanvas, 0, 0);
  capture.tappedPoints.forEach((p, i) => {
    tapCtx.beginPath();
    tapCtx.arc(p.x, p.y, 12, 0, Math.PI * 2);
    tapCtx.fillStyle = "rgba(230,50,50,0.85)";
    tapCtx.fill();
    tapCtx.fillStyle = "#fff";
    tapCtx.font = "bold 18px sans-serif";
    tapCtx.textAlign = "center";
    tapCtx.textBaseline = "middle";
    tapCtx.fillText(String(i + 1), p.x, p.y);
  });
  if (capture.tappedPoints.length === 4) {
    tapCtx.strokeStyle = "rgba(230,50,50,0.9)";
    tapCtx.lineWidth = 3;
    tapCtx.beginPath();
    capture.tappedPoints.forEach((p, i) => (i === 0 ? tapCtx.moveTo(p.x, p.y) : tapCtx.lineTo(p.x, p.y)));
    tapCtx.closePath();
    tapCtx.stroke();
  }
}

function canvasPointFromEvent(evt) {
  const rect = tapCanvas.getBoundingClientRect();
  const scaleX = tapCanvas.width / rect.width;
  const scaleY = tapCanvas.height / rect.height;
  return { x: (evt.clientX - rect.left) * scaleX, y: (evt.clientY - rect.top) * scaleY };
}

tapCanvas.addEventListener("click", (evt) => {
  if (capture.tappedPoints.length >= 4) return;
  capture.tappedPoints.push(canvasPointFromEvent(evt));
  drawSourceWithMarkers();
  document.getElementById("btn-corners-confirm").disabled = capture.tappedPoints.length !== 4;
});

function updateOcrProgress(done, total) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  document.getElementById("ocr-progress-bar").style.width = `${pct}%`;
  document.getElementById("ocr-progress-text").textContent = `${done} / ${total}`;
}

async function runOcr() {
  showCaptureStep("ocr");
  updateOcrProgress(0, 1);
  const product = capture.product;
  const rowLabels = product.tools.map((t) => t.no);
  const colLabels = product.machines;
  const straightW = colLabels.length * 160;
  const straightH = rowLabels.length * 70;

  try {
    capture.straightCanvas = warpToRect(capture.sourceCanvas, capture.tappedPoints, straightW, straightH);
    const cells = sliceGridCells(capture.straightCanvas, rowLabels.length, colLabels.length, rowLabels, colLabels);
    capture.ocrResults = await recognizeGrid(cells, updateOcrProgress);
    setReviewStepMode("ocr");
    buildEntryTable(capture.ocrResults);
    showCaptureStep("review");
  } catch (e) {
    showToast("認識に失敗しました: " + e.message, true);
    showCaptureStep("corners");
  }
}

function setReviewStepMode(mode) {
  const title = document.getElementById("review-step-title");
  const hint = document.getElementById("review-step-hint");
  if (mode === "manual") {
    title.textContent = "工具指示表に使用数を入力";
    hint.textContent =
      "各NC機の欄に現在の使用数を入力してください。前回の値が最初から入っています。変更がない機械はそのままで構いません。";
  } else {
    title.textContent = "内容を確認・修正して送信";
    hint.textContent = "AIによる読み取り結果です。数字が違う場合は必ず修正してください。信頼度が低いセルは赤枠で表示されます。";
  }
}

// ocrResults が null の場合は「表に直接入力」モード（前回値を初期値として編集する）
function buildEntryTable(ocrResults) {
  const product = capture.product;
  const table = document.getElementById("review-table");
  const resultMap = new Map();
  if (ocrResults) ocrResults.forEach((r) => resultMap.set(`${r.row}:${r.col}`, r));

  const headHtml = `<thead><tr><th>工具</th>${product.machines.map((m) => `<th>${escapeHtml(m)}</th>`).join("")}</tr></thead>`;

  const bodyRows = product.tools
    .map((tool, rIdx) => {
      const cells = product.machines
        .map((machine, cIdx) => {
          const ocr = resultMap.get(`${rIdx}:${cIdx}`);
          const prevScan = latestScans.get(`${product.id}::${machine}`);
          const prevVal = prevScan && prevScan.readings ? prevScan.readings[tool.no] : undefined;
          const hasPrev = prevVal !== undefined && prevVal !== null && prevVal !== "";
          const lowConf = ocr && ocr.text && ocr.confidence < 60 ? "low-confidence" : "";
          // OCRモード：読み取り結果を初期値にし、前回値は参考表示のみ
          // 手入力モード：前回値をそのまま初期値にして編集してもらう
          const initialValue = ocr ? ocr.text : hasPrev ? String(prevVal) : "";
          const prevHtml = ocr && hasPrev ? `<span class="prev-hint">前回:${escapeHtml(prevVal)}</span>` : "";
          return `<td>
            <input type="text" inputmode="numeric" class="${lowConf}" data-tool="${escapeHtml(tool.no)}" data-machine="${escapeHtml(machine)}" value="${escapeHtml(initialValue)}" />
            ${prevHtml}
          </td>`;
        })
        .join("");
      return `<tr><td class="row-head">${escapeHtml(tool.no)} ${escapeHtml(tool.process)}</td>${cells}</tr>`;
    })
    .join("");

  table.innerHTML = headHtml + `<tbody>${bodyRows}</tbody>`;
}

function startManualEntry() {
  const productId = document.getElementById("product-select").value;
  if (!productId) {
    showToast("製品を選択してください", true);
    return;
  }
  capture.product = products.find((p) => p.id === productId);
  capture.capturedBy = document.getElementById("capturedBy-input").value.trim();
  localStorage.setItem("capturedBy", capture.capturedBy);
  if (!capture.product) {
    showToast("製品を選択してください", true);
    return;
  }
  capture.ocrResults = null;
  setReviewStepMode("manual");
  buildEntryTable(null);
  showCaptureStep("review");
}

async function submitReview() {
  const product = capture.product;
  const inputs = document.querySelectorAll("#review-table input");
  const byMachine = {};
  inputs.forEach((inp) => {
    const val = inp.value.trim();
    if (val === "") return;
    const machine = inp.dataset.machine;
    const tool = inp.dataset.tool;
    if (!byMachine[machine]) byMachine[machine] = {};
    byMachine[machine][tool] = Number(val);
  });

  const machinesWithData = Object.keys(byMachine);
  if (!machinesWithData.length) {
    showToast("数値が入力されていません", true);
    return;
  }

  const submitBtn = document.getElementById("btn-review-submit");
  submitBtn.disabled = true;
  try {
    for (const machine of machinesWithData) {
      await db.submitScan({
        productId: product.id,
        machine,
        capturedBy: capture.capturedBy,
        readings: byMachine[machine],
      });
    }
    showCaptureStep("done");
  } catch (e) {
    showToast("送信に失敗しました: " + e.message, true);
  } finally {
    submitBtn.disabled = false;
  }
}

function resetCaptureFlow() {
  capture.sourceCanvas = null;
  capture.tappedPoints = [];
  capture.straightCanvas = null;
  capture.ocrResults = null;
  showCaptureStep("select");
}

function wireCaptureEvents() {
  document.getElementById("btn-take-photo").addEventListener("click", () => {
    const productId = document.getElementById("product-select").value;
    if (!productId) {
      showToast("製品を選択してください", true);
      return;
    }
    document.getElementById("file-input").click();
  });

  document.getElementById("btn-manual-entry").addEventListener("click", startManualEntry);

  document.getElementById("file-input").addEventListener("change", async (evt) => {
    const file = evt.target.files[0];
    evt.target.value = "";
    if (!file) return;

    const productId = document.getElementById("product-select").value;
    capture.product = products.find((p) => p.id === productId);
    capture.capturedBy = document.getElementById("capturedBy-input").value.trim();
    localStorage.setItem("capturedBy", capture.capturedBy);
    if (!capture.product) {
      showToast("製品を選択してください", true);
      return;
    }

    capture.sourceCanvas = await fileToCanvas(file);
    capture.tappedPoints = [];
    tapCanvas.width = capture.sourceCanvas.width;
    tapCanvas.height = capture.sourceCanvas.height;
    drawSourceWithMarkers();
    document.getElementById("btn-corners-confirm").disabled = true;
    showCaptureStep("corners");
  });

  document.getElementById("btn-corners-reset").addEventListener("click", () => {
    capture.tappedPoints = [];
    drawSourceWithMarkers();
    document.getElementById("btn-corners-confirm").disabled = true;
  });

  document.getElementById("btn-corners-confirm").addEventListener("click", runOcr);
  document.getElementById("btn-review-cancel").addEventListener("click", resetCaptureFlow);
  document.getElementById("btn-review-submit").addEventListener("click", submitReview);
  document.getElementById("btn-done-restart").addEventListener("click", resetCaptureFlow);
}

// ---------- マスタ管理 ----------

function mkField(label, value, opts = {}) {
  const wrap = document.createElement("div");
  wrap.className = "admin-field";
  const l = document.createElement("label");
  l.textContent = label;
  const input = document.createElement("input");
  input.type = opts.type || "text";
  input.value = value;
  if (opts.readonly) input.disabled = true;
  wrap.append(l, input);
  return { wrap, input };
}

function mkCell(value, type = "text") {
  const inp = document.createElement("input");
  inp.type = type;
  inp.value = value;
  return inp;
}

function buildAdminProductCard(product) {
  const card = document.createElement("div");
  card.className = "admin-product-card";

  const title = document.createElement("h3");
  title.textContent = product.name;
  card.appendChild(title);

  const idField = mkField("製品ID（変更不可）", product.id, { readonly: true });
  const nameField = mkField("製品名", product.name);
  const machinesField = mkField("機械名（カンマ区切り）", (product.machines || []).join(","));
  const dailyField = mkField("1日あたり生産数", product.dailyQty ?? 400, { type: "number" });
  [idField, nameField, machinesField, dailyField].forEach((f) => card.appendChild(f.wrap));

  const toolsWrap = document.createElement("div");
  toolsWrap.className = "tools-editor";
  const header = document.createElement("div");
  header.className = "tool-row-header";
  header.innerHTML = "<div>No</div><div>加工工程</div><div>メーカー</div><div>型式</div><div>工程数</div><div>寿命</div><div></div>";
  toolsWrap.appendChild(header);

  const rows = [];
  function addToolRow(tool) {
    const row = document.createElement("div");
    row.className = "tool-row-grid";
    const entry = {
      noInp: mkCell(tool ? tool.no : ""),
      procInp: mkCell(tool ? tool.process : ""),
      makerInp: mkCell(tool ? tool.maker : ""),
      modelInp: mkCell(tool ? tool.model : ""),
      pcInp: mkCell(tool ? tool.processCount : 1, "number"),
      lifeInp: mkCell(tool ? tool.life : 0, "number"),
    };
    const delBtn = document.createElement("button");
    delBtn.className = "icon-btn";
    delBtn.textContent = "✕";
    delBtn.addEventListener("click", () => {
      row.remove();
      const idx = rows.indexOf(entry);
      if (idx >= 0) rows.splice(idx, 1);
    });
    row.append(entry.noInp, entry.procInp, entry.makerInp, entry.modelInp, entry.pcInp, entry.lifeInp, delBtn);
    toolsWrap.appendChild(row);
    rows.push(entry);
  }
  (product.tools || []).forEach(addToolRow);
  card.appendChild(toolsWrap);

  const addRowBtn = document.createElement("button");
  addRowBtn.className = "secondary-btn";
  addRowBtn.textContent = "＋ 工具を追加";
  addRowBtn.addEventListener("click", () => addToolRow(null));
  card.appendChild(addRowBtn);

  const actions = document.createElement("div");
  actions.className = "admin-actions";

  const saveBtn = document.createElement("button");
  saveBtn.className = "primary-btn";
  saveBtn.textContent = "保存";
  saveBtn.addEventListener("click", async () => {
    const updated = {
      id: product.id,
      name: nameField.input.value.trim() || product.id,
      machines: machinesField.input.value.split(",").map((s) => s.trim()).filter(Boolean),
      dailyQty: Number(dailyField.input.value) || 0,
      tools: rows
        .map((r) => ({
          no: r.noInp.value.trim(),
          process: r.procInp.value.trim(),
          maker: r.makerInp.value.trim(),
          model: r.modelInp.value.trim(),
          processCount: Number(r.pcInp.value) || 1,
          life: Number(r.lifeInp.value) || 0,
        }))
        .filter((t) => t.no),
    };
    try {
      await db.saveProduct(updated);
      showToast("保存しました");
    } catch (e) {
      showToast("保存に失敗しました: " + e.message, true);
    }
  });

  const delBtn = document.createElement("button");
  delBtn.className = "secondary-btn";
  delBtn.textContent = "製品を削除";
  delBtn.addEventListener("click", async () => {
    if (!confirm(`「${product.name}」を削除しますか？`)) return;
    try {
      await db.deleteProduct(product.id);
      showToast("削除しました");
    } catch (e) {
      showToast("削除に失敗しました: " + e.message, true);
    }
  });

  actions.append(saveBtn, delBtn);
  card.appendChild(actions);
  return card;
}

function renderAdmin() {
  const container = document.getElementById("admin-product-list");
  container.innerHTML = "";
  products.forEach((product) => container.appendChild(buildAdminProductCard(product)));
}

function wireAdminEvents() {
  document.getElementById("btn-admin-new-product").addEventListener("click", () => {
    const id = prompt("新しい製品ID（英数字、後から変更不可）を入力してください");
    if (!id || !id.trim()) return;
    const blank = { id: id.trim(), name: id.trim(), machines: ["NC1"], dailyQty: 400, tools: [] };
    document.getElementById("admin-product-list").prepend(buildAdminProductCard(blank));
  });

  document.getElementById("btn-signout").addEventListener("click", async () => {
    if (!confirm("ログアウトしますか？")) return;
    try {
      await db.signOutUser();
    } catch (e) {
      showToast("ログアウトに失敗しました: " + e.message, true);
    }
  });
}

// ---------- ログインゲート ----------
// パスコードで認証されるまで、Realtime Database・マスタデータには一切アクセスしない。

function showGate() {
  document.getElementById("auth-gate").classList.remove("hidden");
}

function hideGate() {
  document.getElementById("auth-gate").classList.add("hidden");
}

function wireAuthGate() {
  const input = document.getElementById("passcode-input");
  const errorEl = document.getElementById("passcode-error");
  const btn = document.getElementById("btn-passcode-submit");

  async function submit() {
    const passcode = input.value.trim();
    if (!passcode) return;
    btn.disabled = true;
    errorEl.classList.add("hidden");
    try {
      await db.signInWithPasscode(passcode);
      input.value = "";
    } catch (e) {
      errorEl.textContent =
        e.code === "auth/too-many-requests"
          ? "試行回数が多すぎます。しばらく待ってから再試行してください。"
          : "パスコードが違います";
      errorEl.classList.remove("hidden");
    } finally {
      btn.disabled = false;
    }
  }

  btn.addEventListener("click", submit);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") submit();
  });
}

// ---------- 初期化 ----------

let unsubProducts = null;
let unsubScans = null;
let unsubHistory = null;

async function startApp() {
  try {
    await db.ensureSeedData();
    setBadge("オンライン", "ok");
  } catch (e) {
    setBadge("接続エラー", "error");
    showToast("Firebaseへの接続に失敗しました: " + e.message, true);
  }

  unsubProducts = db.subscribeProducts((p) => {
    products = p.slice().sort((a, b) => a.name.localeCompare(b.name, "ja"));
    populateProductSelect();
    renderDashboard();
    renderAdmin();
  });

  unsubScans = db.subscribeLatestScans((m) => {
    latestScans = m;
    renderDashboard();
  });

  unsubHistory = db.subscribeScanHistory((scans) => {
    renderHistory(scans);
  });
}

function stopApp() {
  if (unsubProducts) unsubProducts();
  if (unsubScans) unsubScans();
  if (unsubHistory) unsubHistory();
  unsubProducts = unsubScans = unsubHistory = null;

  products = [];
  latestScans = new Map();
  populateProductSelect();
  renderDashboard();
  document.getElementById("history-list").innerHTML = "";
  document.getElementById("admin-product-list").innerHTML = "";
  resetCaptureFlow();
}

async function init() {
  const savedName = localStorage.getItem("capturedBy");
  if (savedName) document.getElementById("capturedBy-input").value = savedName;

  wireCaptureEvents();
  wireAdminEvents();
  wireAuthGate();

  if (!db.isReady()) {
    document.getElementById("setup-notice").classList.remove("hidden");
    hideGate();
    setBadge("未設定", "error");
    return;
  }

  db.onAuthChange((user) => {
    if (user) {
      hideGate();
      startApp();
    } else {
      showGate();
      stopApp();
      setBadge("未ログイン", "muted");
    }
  });
}

init();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}
