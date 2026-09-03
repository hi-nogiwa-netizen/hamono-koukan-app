import * as db from "./db.js";
import { computePriorityList, summarize } from "./priority.js";
import { formatDuration, formatDateTime } from "./schedule.js";

let products = [];
let latestScans = new Map();
let staffList = [];
let myOnlyToggleInitialized = false;
// 「担当別」タブから特定の担当者の一覧へジャンプしたときに設定される（ページ内の一時的な状態）
let viewingStaffId = null;

const OTHER_STAFF_VALUE = "__other__";

const capture = {
  product: null,
  capturedBy: "",
};

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

function switchToView(view) {
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
  ["dashboard", "staff-summary", "capture", "history", "admin"].forEach((v) => {
    document.getElementById(`view-${v}`).classList.toggle("hidden", v !== view);
  });
}

document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    // タブバーから直接移動した場合は「他の人の担当分を見る」モードを解除する
    viewingStaffId = null;
    switchToView(btn.dataset.view);
    renderDashboard();
  });
});

// ---------- ダッシュボード ----------

// 「自分」として選ばれている担当者を返す（未設定・その他の場合は null）
function getMyStaff() {
  const myId = localStorage.getItem("selectedStaffId");
  if (!myId || myId === OTHER_STAFF_VALUE) return null;
  return staffList.find((s) => s.id === myId) || null;
}

function isAssignedTo(staff, productId, machine) {
  if (!staff || !staff.assignments) return false;
  const assignment = staff.assignments.find((a) => a.productId === productId);
  if (!assignment) return false;
  if (!assignment.machines || !assignment.machines.length) return true; // 未指定＝その製品の全機が対象
  return assignment.machines.includes(machine);
}

// その製品・機械を担当している人（複数いる場合は全員）の名前を返す
function findAssignedStaffNames(productId, machine) {
  return staffList.filter((s) => isAssignedTo(s, productId, machine)).map((s) => s.name);
}

function filterRowsForStaff(rows, staff) {
  if (!staff || !staff.assignments || !staff.assignments.length) return rows;
  return rows.filter((r) => isAssignedTo(staff, r.productId, r.machine));
}

function renderWhoamiBar(myStaff) {
  const myId = localStorage.getItem("selectedStaffId");
  const label = document.getElementById("whoami-label");
  const toggleWrap = document.getElementById("my-only-toggle-wrap");

  if (myStaff) {
    label.textContent = `👤 ${myStaff.name} さん`;
  } else if (myId === OTHER_STAFF_VALUE) {
    label.textContent = `👤 ${localStorage.getItem("otherStaffName") || "設定済み"}`;
  } else {
    label.textContent = "👤 担当者が未設定です";
  }

  const hasAssignments = !!(myStaff && myStaff.assignments && myStaff.assignments.length);
  toggleWrap.classList.toggle("hidden", !hasAssignments);

  if (!myOnlyToggleInitialized) {
    const stored = localStorage.getItem("showMyOnly");
    document.getElementById("my-only-toggle").checked = stored === null ? hasAssignments : stored === "1";
    myOnlyToggleInitialized = true;
  }
}

// 「担当別」タブから他の担当者の一覧へジャンプしたときは、自分の設定（自分の担当分だけ表示等）
// には触れず、その担当者だけに絞った一覧を一時的に表示する。
function renderDashboard() {
  const allRows = computePriorityList(products, latestScans);
  const viewingStaff = viewingStaffId ? staffList.find((s) => s.id === viewingStaffId) : null;
  if (viewingStaffId && !viewingStaff) viewingStaffId = null; // 削除済みなどの場合は解除

  document.getElementById("viewing-staff-bar").classList.toggle("hidden", !viewingStaff);
  document.getElementById("whoami-bar").classList.toggle("hidden", !!viewingStaff);
  document.getElementById("my-only-toggle-wrap").classList.toggle("hidden", !!viewingStaff);

  let rows;
  let isFiltered;
  let emptyFilteredMessage;

  if (viewingStaff) {
    document.getElementById("viewing-staff-label").textContent = `👤 ${viewingStaff.name} さんの担当分`;
    rows = filterRowsForStaff(allRows, viewingStaff);
    isFiltered = true;
    emptyFilteredMessage = `${viewingStaff.name}さんの担当分の記録がありません。担当製品の設定をご確認ください。`;
  } else {
    const myStaff = getMyStaff();
    renderWhoamiBar(myStaff);
    const showMyOnly = document.getElementById("my-only-toggle").checked;
    const hasAssignments = !!(myStaff && myStaff.assignments && myStaff.assignments.length);
    isFiltered = showMyOnly && hasAssignments;
    rows = isFiltered ? filterRowsForStaff(allRows, myStaff) : allRows;
    emptyFilteredMessage = "あなたの担当分の記録がありません。担当製品の設定をご確認ください。";
  }

  const stats = summarize(rows);

  document.getElementById("summary-row").innerHTML = `
    <div class="summary-tile danger"><span class="num">${stats.danger}</span><span class="label">至急交換</span></div>
    <div class="summary-tile warning"><span class="num">${stats.warning}</span><span class="label">まもなく交換</span></div>
    <div class="summary-tile ok"><span class="num">${stats.ok}</span><span class="label">正常</span></div>
  `;

  const listEl = document.getElementById("priority-list");
  if (!rows.length) {
    listEl.innerHTML =
      isFiltered && allRows.length
        ? `<p class="empty-hint">${escapeHtml(emptyFilteredMessage)}</p>`
        : '<p class="empty-hint">まだ記録がありません。「入力」タブから使用数を入力してください。</p>';
    return;
  }

  // 「正常（交換不要）」の工具は一覧から外す。交換した直後の工具もここに含まれるため、
  // 「交換した」を押すとその工具は一覧から消えるようになる。件数自体は上のタイルで分かる。
  const displayRows = rows.filter((r) => r.level !== "ok");
  if (!displayRows.length) {
    listEl.innerHTML = '<p class="empty-hint">現在、交換が必要な工具はありません。🎉</p>';
    return;
  }
  displayRows.forEach((row, i) => {
    row.rank = i + 1;
  });
  listEl.innerHTML = displayRows
    .map((r) => {
      const pct = Math.max(0, Math.round(r.ratio * 100));
      const te = r.timeEstimate;
      const shiftFlag = te
        ? te.withinCurrentShift
          ? '<span class="today-flag">⏰ 今のシフト中に交換が必要</span>'
          : te.withinNextShift
            ? '<span class="warn-flag">🟡 次のシフトまでに交換が必要</span>'
            : '<span class="ok-flag">✅ 今のシフト中は交換不要</span>'
        : r.willRunOutToday
          ? '<span class="today-flag">本日中に寿命到達の恐れ</span>'
          : "";
      const timeLine = te
        ? `<div class="time-estimate">⏱ 残り約${escapeHtml(formatDuration(te.secondsToExhaust))}（目安 ${escapeHtml(formatDateTime(te.exhaustAt))}）</div>`
        : "";
      const assignedNames = findAssignedStaffNames(r.productId, r.machine);
      const assignedLine = assignedNames.length
        ? `<div class="assignee-line">👤 担当: ${escapeHtml(assignedNames.join("、"))}</div>`
        : '<div class="assignee-line assignee-none">👤 担当者未設定</div>';
      return `
      <div class="priority-card ${r.level}">
        <div class="priority-card-main">
          <div class="rank-badge">${r.rank}</div>
          <div class="info">
            <div class="title">${escapeHtml(r.toolNo)}　${escapeHtml(r.process)}</div>
            <div class="sub">${escapeHtml(r.productName)} / ${escapeHtml(r.machine)} / ${escapeHtml(r.maker)} ${escapeHtml(r.model)}</div>
            ${assignedLine}
            ${timeLine}
            ${shiftFlag}
          </div>
          <div class="metrics">
            <div class="ratio">残り${pct}%</div>
            <div class="counts">${r.count} / ${r.life}${r.isEstimated ? '<span class="est-badge">推定</span>' : ""}</div>
          </div>
        </div>
        <button class="exchange-btn" data-product="${escapeHtml(r.productId)}" data-machine="${escapeHtml(r.machine)}" data-tool="${escapeHtml(r.toolNo)}">✅ 交換した</button>
      </div>`;
    })
    .join("");
}

// 担当者ごとに、担当製品・NC機の範囲で交換待ちの工具数をまとめて表示する（「担当別」タブ）
function renderStaffSummary() {
  const container = document.getElementById("staff-summary-list");
  if (!container) return;

  const staffWithAssignments = staffList.filter((s) => s.assignments && s.assignments.length);
  if (!staffWithAssignments.length) {
    container.innerHTML =
      '<p class="empty-hint">担当製品・NC機が登録されている担当者がいません。「マスタ管理」タブの担当者管理から登録してください。</p>';
    return;
  }

  const allRows = computePriorityList(products, latestScans);
  const summaries = staffWithAssignments.map((staff) => ({
    staff,
    stats: summarize(filterRowsForStaff(allRows, staff)),
  }));

  // 至急交換が多い人ほど上に表示する
  summaries.sort((a, b) => b.stats.danger - a.stats.danger || b.stats.warning - a.stats.warning);

  container.innerHTML = summaries
    .map(
      ({ staff, stats }) => `
      <button type="button" class="staff-summary-card" data-staff-id="${escapeHtml(staff.id)}">
        <div class="staff-summary-name">👤 ${escapeHtml(staff.name)}</div>
        <div class="staff-summary-counts">
          <span class="count-chip danger">🔴 至急 ${stats.danger}</span>
          <span class="count-chip warning">🟡 まもなく ${stats.warning}</span>
          <span class="count-chip ok">🟢 正常 ${stats.ok}</span>
        </div>
      </button>`
    )
    .join("");
}

// 「担当別」タブで担当者の名前を押すと、その人の担当分だけに絞った優先順位一覧へジャンプする
function viewStaffPriorities(staffId) {
  viewingStaffId = staffId;
  switchToView("dashboard");
  renderDashboard();
}

function wireStaffSummaryEvents() {
  document.getElementById("staff-summary-list").addEventListener("click", (evt) => {
    const card = evt.target.closest(".staff-summary-card");
    if (!card) return;
    viewStaffPriorities(card.dataset.staffId);
  });

  document.getElementById("btn-viewing-staff-close").addEventListener("click", () => {
    viewingStaffId = null;
    renderDashboard();
  });
}

// 「交換した」ボタン：担当者を一覧から選んでもらい、その工具・機械の使用数だけを0に戻して送信する。
// 同じ機械の他の工具の値は、直前の最新値をそのまま引き継ぐ（消えないようにする）。

let pendingExchange = null;

function openExchangeModal(productId, machine, toolNo) {
  pendingExchange = { productId, machine, toolNo };
  document.getElementById("exchange-modal-title").textContent = `${toolNo}（${machine}）を交換済みにする`;

  const sel = document.getElementById("exchange-staff-select");
  const otherInput = document.getElementById("exchange-other-input");
  const options = ['<option value="">選択してください</option>']
    .concat(staffList.map((s) => `<option value="${s.id}">${escapeHtml(s.name)}</option>`))
    .concat([`<option value="${OTHER_STAFF_VALUE}">その他（自由入力）</option>`]);
  sel.innerHTML = options.join("");

  const savedStaffId = localStorage.getItem("selectedStaffId");
  if (savedStaffId && (staffList.some((s) => s.id === savedStaffId) || savedStaffId === OTHER_STAFF_VALUE)) {
    sel.value = savedStaffId;
  }
  if (sel.value === OTHER_STAFF_VALUE) {
    otherInput.classList.remove("hidden");
    otherInput.value = localStorage.getItem("otherStaffName") || "";
  } else {
    otherInput.classList.add("hidden");
  }

  document.getElementById("exchange-modal").classList.remove("hidden");
}

function closeExchangeModal() {
  pendingExchange = null;
  document.getElementById("exchange-modal").classList.add("hidden");
}

function wireExchangeModal() {
  const sel = document.getElementById("exchange-staff-select");
  const otherInput = document.getElementById("exchange-other-input");

  sel.addEventListener("change", () => {
    otherInput.classList.toggle("hidden", sel.value !== OTHER_STAFF_VALUE);
  });

  document.getElementById("exchange-modal-cancel").addEventListener("click", closeExchangeModal);

  document.getElementById("exchange-modal-confirm").addEventListener("click", async () => {
    if (!pendingExchange) return;
    const staff = staffList.find((s) => s.id === sel.value);
    const name = sel.value === OTHER_STAFF_VALUE ? otherInput.value.trim() : staff ? staff.name : "";
    if (!name) {
      showToast("担当者を選択（または入力）してください", true);
      return;
    }
    if (sel.value === OTHER_STAFF_VALUE) {
      localStorage.setItem("otherStaffName", name);
    }
    localStorage.setItem("selectedStaffId", sel.value);

    const { productId, machine, toolNo } = pendingExchange;
    const scan = latestScans.get(`${productId}::${machine}`);
    const readings = { ...(scan && scan.readings ? scan.readings : {}) };
    readings[toolNo] = 0;

    const confirmBtn = document.getElementById("exchange-modal-confirm");
    confirmBtn.disabled = true;
    try {
      await db.submitScan({ productId, machine, capturedBy: name, readings });
      showToast(`${toolNo} を交換済みにしました`);
      closeExchangeModal();
    } catch (e) {
      showToast("更新に失敗しました: " + e.message, true);
    } finally {
      confirmBtn.disabled = false;
    }
  });
}

function wirePriorityListEvents() {
  document.getElementById("priority-list").addEventListener("click", (evt) => {
    const btn = evt.target.closest(".exchange-btn");
    if (!btn) return;
    openExchangeModal(btn.dataset.product, btn.dataset.machine, btn.dataset.tool);
  });
}

// ---------- 「あなた」の設定（優先順位タブの絞り込み用） ----------

function openWhoamiModal() {
  const sel = document.getElementById("whoami-select");
  const otherInput = document.getElementById("whoami-other-input");
  const options = ['<option value="">選択してください</option>']
    .concat(staffList.map((s) => `<option value="${s.id}">${escapeHtml(s.name)}</option>`))
    .concat([`<option value="${OTHER_STAFF_VALUE}">その他（自由入力）</option>`]);
  sel.innerHTML = options.join("");

  const saved = localStorage.getItem("selectedStaffId");
  if (saved && (staffList.some((s) => s.id === saved) || saved === OTHER_STAFF_VALUE)) {
    sel.value = saved;
  }
  otherInput.classList.toggle("hidden", sel.value !== OTHER_STAFF_VALUE);
  if (sel.value === OTHER_STAFF_VALUE) {
    otherInput.value = localStorage.getItem("otherStaffName") || "";
  }
  document.getElementById("whoami-modal").classList.remove("hidden");
}

function closeWhoamiModal() {
  document.getElementById("whoami-modal").classList.add("hidden");
}

// 未設定・未案内であれば、初回に一度だけ「あなたを選択」を促す
function maybePromptWhoami() {
  if (localStorage.getItem("selectedStaffId")) return;
  if (localStorage.getItem("whoamiPromptDismissed")) return;
  if (!staffList.length) return;
  if (!document.getElementById("whoami-modal").classList.contains("hidden")) return;
  openWhoamiModal();
}

function wireWhoamiModal() {
  const sel = document.getElementById("whoami-select");
  const otherInput = document.getElementById("whoami-other-input");

  sel.addEventListener("change", () => {
    otherInput.classList.toggle("hidden", sel.value !== OTHER_STAFF_VALUE);
  });

  document.getElementById("whoami-modal-skip").addEventListener("click", () => {
    localStorage.setItem("whoamiPromptDismissed", "1");
    closeWhoamiModal();
  });

  document.getElementById("whoami-modal-confirm").addEventListener("click", () => {
    if (!sel.value) {
      showToast("担当者を選択してください", true);
      return;
    }
    if (sel.value === OTHER_STAFF_VALUE) {
      const name = otherInput.value.trim();
      if (!name) {
        showToast("お名前を入力してください", true);
        return;
      }
      localStorage.setItem("otherStaffName", name);
    }
    localStorage.setItem("selectedStaffId", sel.value);
    localStorage.setItem("whoamiPromptDismissed", "1");
    closeWhoamiModal();
    renderDashboard();
  });

  document.getElementById("btn-whoami-change").addEventListener("click", openWhoamiModal);

  document.getElementById("my-only-toggle").addEventListener("change", () => {
    localStorage.setItem("showMyOnly", document.getElementById("my-only-toggle").checked ? "1" : "0");
    renderDashboard();
  });
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

// ---------- 入力フロー ----------

function populateProductSelect() {
  const sel = document.getElementById("product-select");
  const prevVal = sel.value;
  sel.innerHTML = products.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join("");
  if (products.some((p) => p.id === prevVal)) sel.value = prevVal;
}

// 担当者に設定された担当製品(1つ目)を、製品欄の初期値として使う。
// 担当者は複数の製品を担当できるので、これはあくまで初期選択であり、
// 製品欄はいつでも手動で変更できる。
function applyStaffProductDefault(staff) {
  const firstAssignment = staff && staff.assignments && staff.assignments[0];
  if (firstAssignment && firstAssignment.productId && products.some((p) => p.id === firstAssignment.productId)) {
    document.getElementById("product-select").value = firstAssignment.productId;
  }
}

// 担当者選択：登録済みの担当者一覧＋「その他（自由入力）」を選択肢にする。
// 選んだ担当者に担当製品が設定されていれば、製品欄を自動でそちらに合わせる。
function populateStaffSelect() {
  const sel = document.getElementById("staff-select");
  const otherInput = document.getElementById("capturedBy-other-input");
  const prevVal = sel.value;

  const options = ['<option value="">選択してください</option>']
    .concat(staffList.map((s) => `<option value="${s.id}">${escapeHtml(s.name)}</option>`))
    .concat([`<option value="${OTHER_STAFF_VALUE}">その他（自由入力）</option>`]);
  sel.innerHTML = options.join("");

  const savedStaffId = localStorage.getItem("selectedStaffId");
  if (staffList.some((s) => s.id === prevVal) || prevVal === OTHER_STAFF_VALUE) {
    sel.value = prevVal;
  } else if (savedStaffId && (staffList.some((s) => s.id === savedStaffId) || savedStaffId === OTHER_STAFF_VALUE)) {
    sel.value = savedStaffId;
  }

  if (sel.value === OTHER_STAFF_VALUE) {
    otherInput.classList.remove("hidden");
    const savedOther = localStorage.getItem("otherStaffName");
    if (savedOther && !otherInput.value) otherInput.value = savedOther;
  } else {
    otherInput.classList.add("hidden");
    applyStaffProductDefault(staffList.find((s) => s.id === sel.value));
  }
}

function getSelectedStaff() {
  const staffId = document.getElementById("staff-select").value;
  if (!staffId || staffId === OTHER_STAFF_VALUE) return null;
  return staffList.find((s) => s.id === staffId) || null;
}

// 現在選ばれている担当者・製品の組み合わせから、担当NC機の絞り込みリストを返す。
// 担当者未選択、担当製品にその製品の登録がない、登録があっても機械が未指定（＝全機対象）の
// 場合は null（絞り込みなし＝全機表示）を返す。
function getMachineFilterForSelection() {
  const staff = getSelectedStaff();
  if (!staff || !staff.assignments) return null;
  const productId = document.getElementById("product-select").value;
  const assignment = staff.assignments.find((a) => a.productId === productId);
  return assignment && assignment.machines && assignment.machines.length ? assignment.machines : null;
}

function currentCapturedByName() {
  const sel = document.getElementById("staff-select");
  if (sel.value === OTHER_STAFF_VALUE) {
    return document.getElementById("capturedBy-other-input").value.trim();
  }
  const staff = staffList.find((s) => s.id === sel.value);
  return staff ? staff.name : "";
}

function requireCapturedBy() {
  const name = currentCapturedByName();
  if (!name) {
    showToast("担当者を選択（または入力）してください", true);
    return null;
  }
  return name;
}

function wireStaffSelect() {
  const staffSelect = document.getElementById("staff-select");
  const otherInput = document.getElementById("capturedBy-other-input");

  staffSelect.addEventListener("change", () => {
    localStorage.setItem("selectedStaffId", staffSelect.value);
    if (staffSelect.value === OTHER_STAFF_VALUE) {
      otherInput.classList.remove("hidden");
      otherInput.focus();
      return;
    }
    otherInput.classList.add("hidden");
    applyStaffProductDefault(staffList.find((s) => s.id === staffSelect.value));
  });

  otherInput.addEventListener("input", () => {
    localStorage.setItem("otherStaffName", otherInput.value);
  });
}

function showCaptureStep(name) {
  ["select", "review", "done"].forEach((s) => {
    document.getElementById(`capture-step-${s}`).classList.toggle("hidden", s !== name);
  });
}

function machineNames(product) {
  return (product.machines || []).map((m) => (typeof m === "string" ? m : m.name));
}

// machineFilter を渡すと、その機械の列だけを表示する
// （担当者に担当NC機が登録されている場合、入力の手間を減らすため）。
function buildEntryTable(machineFilter) {
  const product = capture.product;
  const table = document.getElementById("review-table");

  const allMachines = machineNames(product);
  const useFilter = machineFilter && machineFilter.length;
  const machines = useFilter ? allMachines.filter((m) => machineFilter.includes(m)) : allMachines;

  const headHtml = `<thead><tr><th>工具</th>${machines.map((m) => `<th>${escapeHtml(m)}</th>`).join("")}</tr></thead>`;

  const bodyRows = product.tools
    .map((tool) => {
      const cells = machines
        .map((machine) => {
          const prevScan = latestScans.get(`${product.id}::${machine}`);
          const prevVal = prevScan && prevScan.readings ? prevScan.readings[tool.no] : undefined;
          const hasPrev = prevVal !== undefined && prevVal !== null && prevVal !== "";
          const initialValue = hasPrev ? String(prevVal) : "";
          return `<td>
            <input type="text" inputmode="numeric" data-tool="${escapeHtml(tool.no)}" data-machine="${escapeHtml(machine)}" value="${escapeHtml(initialValue)}" />
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
  const name = requireCapturedBy();
  if (!name) return;
  capture.product = products.find((p) => p.id === productId);
  if (!capture.product) {
    showToast("製品を選択してください", true);
    return;
  }
  capture.capturedBy = name;

  const machineFilter = getMachineFilterForSelection();

  buildEntryTable(machineFilter);
  showCaptureStep("review");
}

async function submitReview() {
  const product = capture.product;
  const inputs = Array.from(document.querySelectorAll("#review-table input"));

  // 「変更があった機械」だけを送信対象にする。変更＝値を入力した、または元々
  // 表示されていた値を消した、のいずれか（inp.defaultValue は表の初期表示値）。
  // これにより、消した工具（空欄）はその機械の送信内容から除外され「データなし」
  // 扱いになる。逆に、何も触っていない機械はそもそも送信されないため、既存データが
  // 誤って消えることもない。
  const machinesChanged = new Set();
  inputs.forEach((inp) => {
    if (inp.value.trim() !== inp.defaultValue.trim()) {
      machinesChanged.add(inp.dataset.machine);
    }
  });

  if (!machinesChanged.size) {
    showToast("変更がありません", true);
    return;
  }

  const byMachine = {};
  machinesChanged.forEach((m) => {
    byMachine[m] = {};
  });
  inputs.forEach((inp) => {
    const machine = inp.dataset.machine;
    if (!machinesChanged.has(machine)) return;
    const val = inp.value.trim();
    if (val === "") return; // 空欄＝この工具は今回「データなし」扱い
    byMachine[machine][inp.dataset.tool] = Number(val);
  });

  const machines = Array.from(machinesChanged);

  const submitBtn = document.getElementById("btn-review-submit");
  submitBtn.disabled = true;
  try {
    for (const machine of machines) {
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
  showCaptureStep("select");
}

function wireCaptureEvents() {
  document.getElementById("btn-manual-entry").addEventListener("click", startManualEntry);
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

// Excelなどからコピーした表を行×列の2次元配列にする（タブ区切り優先、なければカンマ区切り）。
// 列の意味はここでは決め打ちにせず、貼り付け後の画面でユーザーに選んでもらう。
// （ふりがな用の非表示列が混ざっていたり、列の並び順がシートごとに違うことがあるため）
function parseGridText(text) {
  return text
    .split(/\r\n|\r|\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => (line.includes("\t") ? line.split("\t") : line.split(",")).map((c) => c.trim()));
}

// ---------- 工具の一括貼り付け（列マッピング方式） ----------

const BULK_PASTE_FIELD_OPTIONS = [
  ["", "使用しない"],
  ["no", "工具No"],
  ["process", "加工工程"],
  ["maker", "メーカー"],
  ["model", "型式"],
  ["processCount", "工程数"],
  ["life", "寿命"],
];

let bulkPasteAddToolRow = null;
let bulkPasteGrid = [];
let bulkPasteColumnSelects = [];

function openBulkPasteModal(addToolRowFn) {
  bulkPasteAddToolRow = addToolRowFn;
  bulkPasteGrid = [];
  bulkPasteColumnSelects = [];
  document.getElementById("bulk-paste-textarea").value = "";
  document.getElementById("bulk-paste-error").classList.add("hidden");
  document.getElementById("bulk-paste-step1").classList.remove("hidden");
  document.getElementById("bulk-paste-step2").classList.add("hidden");
  document.getElementById("bulk-paste-modal").classList.remove("hidden");
}

function showBulkPasteError(message) {
  const el = document.getElementById("bulk-paste-error");
  el.textContent = message;
  el.classList.remove("hidden");
  showToast(message, true);
}

function closeBulkPasteModal() {
  bulkPasteAddToolRow = null;
  document.getElementById("bulk-paste-modal").classList.add("hidden");
}

// 貼り付けられた表を解析し、列ごとにマッピング用セレクトを並べたプレビュー表を作る
function buildBulkPasteMappingTable(grid) {
  const table = document.getElementById("bulk-paste-preview-table");
  table.innerHTML = "";
  if (!grid.length) return [];

  const colCount = Math.max(...grid.map((row) => row.length));
  const mappingSelects = [];

  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  for (let c = 0; c < colCount; c++) {
    const th = document.createElement("th");
    const sel = document.createElement("select");
    sel.className = "column-map-select";
    sel.innerHTML = BULK_PASTE_FIELD_OPTIONS.map(([v, label]) => `<option value="${v}">${label}</option>`).join("");
    th.appendChild(sel);
    headRow.appendChild(th);
    mappingSelects.push(sel);
  }
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  const previewLimit = 8;
  grid.slice(0, previewLimit).forEach((row) => {
    const tr = document.createElement("tr");
    for (let c = 0; c < colCount; c++) {
      const td = document.createElement("td");
      td.textContent = row[c] !== undefined ? row[c] : "";
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  });
  if (grid.length > previewLimit) {
    const moreRow = document.createElement("tr");
    const moreTd = document.createElement("td");
    moreTd.colSpan = colCount;
    moreTd.className = "hint-text";
    moreTd.textContent = `他 ${grid.length - previewLimit} 行（プレビューは省略、追加自体はすべて行われます）`;
    moreRow.appendChild(moreTd);
    tbody.appendChild(moreRow);
  }
  table.appendChild(tbody);

  return mappingSelects;
}

function wireBulkPasteModal() {
  document.getElementById("bulk-paste-cancel-1").addEventListener("click", closeBulkPasteModal);

  document.getElementById("bulk-paste-analyze-btn").addEventListener("click", () => {
    const text = document.getElementById("bulk-paste-textarea").value;
    bulkPasteGrid = parseGridText(text);
    if (!bulkPasteGrid.length) {
      showToast("貼り付けられた内容を読み取れませんでした", true);
      return;
    }
    document.getElementById("bulk-paste-error").classList.add("hidden");
    bulkPasteColumnSelects = buildBulkPasteMappingTable(bulkPasteGrid);
    document.getElementById("bulk-paste-step1").classList.add("hidden");
    document.getElementById("bulk-paste-step2").classList.remove("hidden");
  });

  document.getElementById("bulk-paste-back-btn").addEventListener("click", () => {
    document.getElementById("bulk-paste-step2").classList.add("hidden");
    document.getElementById("bulk-paste-step1").classList.remove("hidden");
  });

  document.getElementById("bulk-paste-confirm-btn").addEventListener("click", () => {
    document.getElementById("bulk-paste-error").classList.add("hidden");
    const fieldToCol = {};
    bulkPasteColumnSelects.forEach((sel, idx) => {
      if (sel.value) fieldToCol[sel.value] = idx;
    });
    if (fieldToCol.no === undefined) {
      showBulkPasteError("「工具No」に対応する列を選んでください（プルダウンが並んだ表の一番上の行です）");
      return;
    }
    const hasHeader = document.getElementById("bulk-paste-has-header").checked;
    const dataRows = hasHeader ? bulkPasteGrid.slice(1) : bulkPasteGrid;
    const tools = dataRows
      .map((row) => ({
        no: (row[fieldToCol.no] || "").trim(),
        process: fieldToCol.process !== undefined ? (row[fieldToCol.process] || "").trim() : "",
        maker: fieldToCol.maker !== undefined ? (row[fieldToCol.maker] || "").trim() : "",
        model: fieldToCol.model !== undefined ? (row[fieldToCol.model] || "").trim() : "",
        processCount: fieldToCol.processCount !== undefined ? Number(row[fieldToCol.processCount]) || 1 : 1,
        life: fieldToCol.life !== undefined ? Number(row[fieldToCol.life]) || 0 : 0,
      }))
      .filter((t) => t.no);

    if (!tools.length) {
      showBulkPasteError("追加できる工具がありませんでした（見出し行のチェックが正しいか確認してください）");
      return;
    }
    if (!bulkPasteAddToolRow) {
      showToast("追加先が見つかりませんでした。画面を開き直してください", true);
      return;
    }
    tools.forEach((t) => bulkPasteAddToolRow(t));
    showToast(`${tools.length}件の工具を追加しました（保存を押すまで確定しません）`);
    closeBulkPasteModal();
  });
}

function buildAdminProductCard(product) {
  const card = document.createElement("div");
  card.className = "admin-product-card";
  card.dataset.recordId = product.id || "";
  card.dataset.recordName = product.name || product.id || "";

  const header = document.createElement("div");
  header.className = "admin-card-header";
  const selectCb = document.createElement("input");
  selectCb.type = "checkbox";
  selectCb.className = "admin-card-select";
  const title = document.createElement("h3");
  title.textContent = product.name;
  header.append(selectCb, title);
  card.appendChild(header);

  const idField = mkField("製品ID（変更不可）", product.id, { readonly: true });
  const nameField = mkField("製品名", product.name);
  const dailyField = mkField("1日あたり生産数", product.dailyQty ?? 400, { type: "number" });
  [idField, nameField, dailyField].forEach((f) => card.appendChild(f.wrap));

  const machinesWrap = document.createElement("div");
  machinesWrap.className = "tools-editor";
  const machinesLabel = document.createElement("label");
  machinesLabel.className = "field-label";
  machinesLabel.textContent = "対象NC機・サイクルタイム";
  machinesWrap.appendChild(machinesLabel);
  const machinesHeader = document.createElement("div");
  machinesHeader.className = "machine-row-header";
  machinesHeader.innerHTML = "<div>NC機名</div><div>サイクルタイム(秒)</div><div></div>";
  machinesWrap.appendChild(machinesHeader);

  const machineRows = [];
  function addMachineRow(machine) {
    const row = document.createElement("div");
    row.className = "machine-row-grid";
    const entry = {
      nameInp: mkCell(machine ? (typeof machine === "string" ? machine : machine.name) : ""),
      cycleInp: mkCell(machine && typeof machine !== "string" && machine.cycleTimeSec != null ? machine.cycleTimeSec : "", "number"),
    };
    entry.cycleInp.placeholder = "任意";
    const delBtn = document.createElement("button");
    delBtn.className = "icon-btn";
    delBtn.textContent = "✕";
    delBtn.addEventListener("click", () => {
      row.remove();
      const idx = machineRows.indexOf(entry);
      if (idx >= 0) machineRows.splice(idx, 1);
    });
    row.append(entry.nameInp, entry.cycleInp, delBtn);
    machinesWrap.appendChild(row);
    machineRows.push(entry);
  }
  (product.machines || []).forEach(addMachineRow);
  card.appendChild(machinesWrap);

  const addMachineBtn = document.createElement("button");
  addMachineBtn.className = "secondary-btn";
  addMachineBtn.textContent = "＋ NC機を追加";
  addMachineBtn.addEventListener("click", () => addMachineRow(null));
  card.appendChild(addMachineBtn);

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

  const bulkOpenBtn = document.createElement("button");
  bulkOpenBtn.className = "secondary-btn";
  bulkOpenBtn.textContent = "📋 Excel等から一括追加";
  bulkOpenBtn.addEventListener("click", () => openBulkPasteModal(addToolRow));
  card.appendChild(bulkOpenBtn);

  // このカード自身は保存ボタンを持たず、「製品の変更をまとめて保存」から呼び出される。
  card.getData = () => ({
    id: product.id,
    name: nameField.input.value.trim() || product.id,
    machines: machineRows
      .map((r) => ({
        name: r.nameInp.value.trim(),
        cycleTimeSec: r.cycleInp.value === "" ? null : Number(r.cycleInp.value) || null,
      }))
      .filter((m) => m.name),
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
  });

  const actions = document.createElement("div");
  actions.className = "admin-actions";

  const dupBtn = document.createElement("button");
  dupBtn.className = "secondary-btn";
  dupBtn.textContent = "複製";
  dupBtn.addEventListener("click", () => {
    const newId = prompt(
      `「${product.name}」の内容（NC機・工具一覧）をコピーして新しい製品を作ります。\n新しい製品ID（英数字、後から変更不可）を入力してください`
    );
    if (!newId || !newId.trim()) return;
    if (products.some((p) => p.id === newId.trim())) {
      showToast("そのIDは既に使われています", true);
      return;
    }
    const clone = {
      id: newId.trim(),
      name: `${product.name}のコピー`,
      machines: (product.machines || []).map((m) =>
        typeof m === "string" ? { name: m, cycleTimeSec: null } : { ...m }
      ),
      dailyQty: product.dailyQty ?? 400,
      tools: (product.tools || []).map((t) => ({ ...t })),
    };
    document.getElementById("admin-product-list").prepend(buildAdminProductCard(clone));
    showToast("複製しました。内容を確認して「変更をまとめて保存」を押してください");
  });

  actions.append(dupBtn);
  card.appendChild(actions);
  return card;
}

function renderAdmin() {
  const container = document.getElementById("admin-product-list");
  container.innerHTML = "";
  products.forEach((product) => {
    try {
      container.appendChild(buildAdminProductCard(product));
    } catch (e) {
      // 1件のデータ不備で、以降の製品カードまで描画されなくなるのを防ぐ
      const errCard = document.createElement("div");
      errCard.className = "admin-product-card";
      errCard.innerHTML = `<p class="hint-text">「${escapeHtml(product.name || product.id)}」の表示中にエラーが発生しました: ${escapeHtml(e.message)}</p>`;
      container.appendChild(errCard);
    }
  });
}

// 担当者は複数の製品を担当できる。assignments は
// [{ productId, machines: [担当NC機名,...] }, ...] の配列。
// machinesが空配列の場合は「その製品の全機が対象」の意味になる。
function buildAdminStaffCard(staffMember) {
  const card = document.createElement("div");
  card.className = "admin-product-card";
  card.dataset.recordId = staffMember.id || "";
  card.dataset.recordName = staffMember.name || "(新規担当者)";

  const header = document.createElement("div");
  header.className = "admin-card-header";
  const selectCb = document.createElement("input");
  selectCb.type = "checkbox";
  selectCb.className = "admin-card-select";
  const title = document.createElement("h3");
  title.textContent = staffMember.name || "(新規担当者)";
  header.append(selectCb, title);
  card.appendChild(header);

  const nameField = mkField("氏名", staffMember.name || "");
  card.appendChild(nameField.wrap);

  const assignmentsLabel = document.createElement("label");
  assignmentsLabel.className = "field-label";
  assignmentsLabel.textContent = "担当製品・担当NC機（複数登録できます）";
  card.appendChild(assignmentsLabel);

  const assignmentsWrap = document.createElement("div");
  card.appendChild(assignmentsWrap);

  const assignmentEntries = [];

  function addAssignmentBlock(assignment) {
    const block = document.createElement("div");
    block.className = "assignment-block";

    const top = document.createElement("div");
    top.className = "assignment-block-top";
    const productSelect = document.createElement("select");
    productSelect.innerHTML =
      '<option value="">製品を選択</option>' +
      products.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join("");
    if (assignment && assignment.productId) productSelect.value = assignment.productId;
    const removeBtn = document.createElement("button");
    removeBtn.className = "icon-btn";
    removeBtn.textContent = "✕";
    top.append(productSelect, removeBtn);
    block.appendChild(top);

    const checkboxGroup = document.createElement("div");
    checkboxGroup.className = "checkbox-group";
    block.appendChild(checkboxGroup);

    const machineHint = document.createElement("p");
    machineHint.className = "hint-text";
    machineHint.textContent = "担当NC機（何も選ばなければその製品の全機が対象になります）";
    block.insertBefore(machineHint, checkboxGroup);

    function renderMachines() {
      const product = products.find((p) => p.id === productSelect.value);
      const machineList = product ? machineNames(product) : [];
      const selected = new Set((assignment && assignment.machines) || []);
      checkboxGroup.innerHTML = "";
      if (!machineList.length) {
        checkboxGroup.innerHTML = '<span class="hint-text">製品を選ぶとNC機の一覧が表示されます</span>';
        return;
      }
      machineList.forEach((m) => {
        const label = document.createElement("label");
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.value = m;
        cb.checked = selected.has(m);
        label.append(cb, document.createTextNode(m));
        checkboxGroup.appendChild(label);
      });
    }
    renderMachines();
    productSelect.addEventListener("change", renderMachines);

    const entry = { productSelect, checkboxGroup };
    removeBtn.addEventListener("click", () => {
      block.remove();
      const idx = assignmentEntries.indexOf(entry);
      if (idx >= 0) assignmentEntries.splice(idx, 1);
    });

    assignmentsWrap.appendChild(block);
    assignmentEntries.push(entry);
  }

  const existingAssignments =
    staffMember.assignments && staffMember.assignments.length ? staffMember.assignments : [null];
  existingAssignments.forEach(addAssignmentBlock);

  const addAssignmentBtn = document.createElement("button");
  addAssignmentBtn.className = "secondary-btn";
  addAssignmentBtn.textContent = "＋ 担当製品を追加";
  addAssignmentBtn.addEventListener("click", () => addAssignmentBlock(null));
  card.appendChild(addAssignmentBtn);

  // このカード自身は保存・削除ボタンを持たず、下部の「まとめて保存」「選択して削除」から扱う。
  card.getData = () => ({
    id: staffMember.id || null,
    name: nameField.input.value.trim(),
    assignments: assignmentEntries
      .map((e) => ({
        productId: e.productSelect.value,
        machines: Array.from(e.checkboxGroup.querySelectorAll("input:checked")).map((cb) => cb.value),
      }))
      .filter((a) => a.productId),
  });
  card.applyCreatedId = (id) => {
    staffMember.id = id;
    card.dataset.recordId = id;
  };

  return card;
}

function renderAdminStaff() {
  const container = document.getElementById("admin-staff-list");
  container.innerHTML = "";
  staffList.forEach((s) => {
    try {
      container.appendChild(buildAdminStaffCard(s));
    } catch (e) {
      const errCard = document.createElement("div");
      errCard.className = "admin-product-card";
      errCard.innerHTML = `<p class="hint-text">「${escapeHtml(s.name || s.id)}」の表示中にエラーが発生しました: ${escapeHtml(e.message)}</p>`;
      container.appendChild(errCard);
    }
  });
}

async function handleSignOut() {
  if (!confirm("ログアウトしますか？")) return;
  try {
    await db.signOutUser();
  } catch (e) {
    showToast("ログアウトに失敗しました: " + e.message, true);
  }
}

// ---------- マスタ管理：まとめて保存／選択して削除 ----------
// 各カードは自分の保存・削除ボタンを持たない。一覧の下にあるボタン1つで、
// 表示されている全カードの内容をまとめて保存する（変更した分だけ選んで押す手間をなくす）。

async function saveAllCards(listId, buttonId, label) {
  const container = document.getElementById(listId);
  const cards = Array.from(container.children).filter((c) => typeof c.getData === "function");
  if (!cards.length) {
    showToast(`保存する${label}がありません`, true);
    return;
  }
  const btn = document.getElementById(buttonId);
  btn.disabled = true;
  let okCount = 0;
  const failed = [];
  for (const card of cards) {
    const data = card.getData();
    try {
      if (listId === "admin-product-list") {
        await db.saveProduct(data);
      } else if (data.id) {
        await db.saveStaff(data);
      } else {
        if (!data.name) throw new Error("氏名を入力してください");
        const created = await db.addStaff({ name: data.name, assignments: data.assignments });
        card.applyCreatedId(created.id);
      }
      okCount++;
    } catch (e) {
      failed.push(`${data.name || data.id}: ${e.message}`);
    }
  }
  btn.disabled = false;
  if (failed.length) {
    showToast(`${okCount}件保存しました。失敗: ${failed.join(" / ")}`, true);
  } else {
    showToast(`${okCount}件保存しました`);
  }
}

async function deleteSelectedCards(listId, cardClass, deleteFn, label) {
  const container = document.getElementById(listId);
  const checked = Array.from(container.querySelectorAll(".admin-card-select:checked"));
  if (!checked.length) {
    showToast(`削除する${label}を選択してください`, true);
    return;
  }
  const cards = checked.map((cb) => cb.closest(`.${cardClass}`));
  const names = cards.map((c) => c.dataset.recordName || c.dataset.recordId || "?");
  if (!confirm(`選択した${cards.length}件を削除しますか？\n${names.join("、")}`)) return;

  for (const card of cards) {
    const id = card.dataset.recordId;
    try {
      if (id) await deleteFn(id);
      card.remove();
    } catch (e) {
      showToast(`「${card.dataset.recordName}」の削除に失敗しました: ${e.message}`, true);
    }
  }
  showToast("削除しました");
}

function wireSelectAllToggle(buttonId, listId) {
  document.getElementById(buttonId).addEventListener("click", () => {
    const boxes = Array.from(document.querySelectorAll(`#${listId} .admin-card-select`));
    if (!boxes.length) return;
    const allChecked = boxes.every((cb) => cb.checked);
    boxes.forEach((cb) => (cb.checked = !allChecked));
  });
}

function wireAdminEvents() {
  document.querySelectorAll(".admin-subtab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".admin-subtab-btn").forEach((b) => b.classList.toggle("active", b === btn));
      const view = btn.dataset.adminView;
      document.getElementById("admin-view-staff").classList.toggle("hidden", view !== "staff");
      document.getElementById("admin-view-product").classList.toggle("hidden", view !== "product");
    });
  });

  document.getElementById("btn-admin-new-product").addEventListener("click", () => {
    const id = prompt("新しい製品ID（英数字、後から変更不可）を入力してください");
    if (!id || !id.trim()) return;
    const blank = { id: id.trim(), name: id.trim(), machines: [{ name: "NC1", cycleTimeSec: null }], dailyQty: 400, tools: [] };
    document.getElementById("admin-product-list").prepend(buildAdminProductCard(blank));
  });

  document.getElementById("btn-admin-new-staff").addEventListener("click", () => {
    const blank = { id: null, name: "", assignments: [] };
    document.getElementById("admin-staff-list").prepend(buildAdminStaffCard(blank));
  });

  document.getElementById("btn-admin-save-product").addEventListener("click", () =>
    saveAllCards("admin-product-list", "btn-admin-save-product", "製品")
  );
  document.getElementById("btn-admin-save-staff").addEventListener("click", () =>
    saveAllCards("admin-staff-list", "btn-admin-save-staff", "担当者")
  );

  document.getElementById("btn-admin-delete-product").addEventListener("click", () =>
    deleteSelectedCards("admin-product-list", "admin-product-card", db.deleteProduct, "製品")
  );
  document.getElementById("btn-admin-delete-staff").addEventListener("click", () =>
    deleteSelectedCards("admin-staff-list", "admin-product-card", db.deleteStaff, "担当者")
  );

  wireSelectAllToggle("btn-admin-select-all-product", "admin-product-list");
  wireSelectAllToggle("btn-admin-select-all-staff", "admin-staff-list");

  document.getElementById("btn-signout").addEventListener("click", handleSignOut);
}

function wireHeaderActions() {
  document.getElementById("btn-header-refresh").addEventListener("click", () => {
    window.location.reload();
  });
  document.getElementById("btn-header-signout").addEventListener("click", handleSignOut);
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
let unsubStaff = null;

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
    populateStaffSelect();
    renderDashboard();
    renderStaffSummary();
    renderAdmin();
    renderAdminStaff();
  });

  unsubScans = db.subscribeLatestScans((m) => {
    latestScans = m;
    renderDashboard();
    renderStaffSummary();
  });

  unsubHistory = db.subscribeScanHistory((scans) => {
    renderHistory(scans);
  });

  unsubStaff = db.subscribeStaff((s) => {
    staffList = s.slice().sort((a, b) => a.name.localeCompare(b.name, "ja"));
    populateStaffSelect();
    renderAdminStaff();
    renderDashboard();
    renderStaffSummary();
    maybePromptWhoami();
  });
}

function stopApp() {
  if (unsubProducts) unsubProducts();
  if (unsubScans) unsubScans();
  if (unsubHistory) unsubHistory();
  if (unsubStaff) unsubStaff();
  unsubProducts = unsubScans = unsubHistory = unsubStaff = null;

  products = [];
  latestScans = new Map();
  staffList = [];
  populateProductSelect();
  populateStaffSelect();
  renderDashboard();
  renderStaffSummary();
  document.getElementById("history-list").innerHTML = "";
  document.getElementById("admin-product-list").innerHTML = "";
  document.getElementById("admin-staff-list").innerHTML = "";
  resetCaptureFlow();
}

async function init() {
  wireCaptureEvents();
  wireAdminEvents();
  wireAuthGate();
  wireStaffSelect();
  wirePriorityListEvents();
  wireExchangeModal();
  wireWhoamiModal();
  wireBulkPasteModal();
  wireHeaderActions();
  wireStaffSummaryEvents();

  // サイクルタイムから推定した使用数は時間とともに増えていくため、優先順位タブを
  // 見ている間は定期的に再計算・再描画してカウンターが進んでいくようにする。
  setInterval(() => {
    if (!document.getElementById("view-dashboard").classList.contains("hidden")) {
      renderDashboard();
    }
  }, 15000);

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

// オフラインキャッシュ(Service Worker)は、更新が反映されない不具合の原因になっていたため
// 廃止した。もし既に登録されている端末があれば、app/sw.js 側の後片付け処理で自動的に
// 解除・キャッシュ削除される。ここでは新しく登録しない。
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.getRegistrations().then((regs) => {
    regs.forEach((reg) => reg.unregister());
  });
}
