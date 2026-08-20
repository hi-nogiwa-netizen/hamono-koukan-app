import { firebaseConfig, isConfigured, SHARED_LOGIN_EMAIL } from "./firebase-config.js";
import {
  initializeApp,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getDatabase,
  ref,
  set,
  remove,
  push,
  get,
  onValue,
  query,
  orderByChild,
  limitToLast,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js";

// Cloud Firestore はプロジェクトに請求先アカウント（クレジットカード）の登録が必須になったため、
// カード登録なしで使える Firebase Realtime Database を使用している。
// データの持ち方は変わる（JSONツリー構造）が、app.js から見たこのファイルの関数の使い方は
// Firestore版と同じになるようにしてあるので、他のファイルは変更していない。

let app = null;
let dbInstance = null;
let authInstance = null;

export function isReady() {
  return isConfigured();
}

function getApp() {
  if (!isConfigured()) {
    throw new Error("Firebase未設定です。app/js/firebase-config.js を編集してください。");
  }
  if (!app) {
    app = initializeApp(firebaseConfig);
  }
  return app;
}

function getDb() {
  if (!dbInstance) {
    dbInstance = getDatabase(getApp());
  }
  return dbInstance;
}

// ---- 認証（共通パスコード） ----
// Realtime Databaseへは認証済みユーザーしかアクセスできない前提（README参照）。
// そのため、この層より前にデータ・マスタデータへアクセスしてはいけない。

function getAuthInstance() {
  if (!authInstance) {
    authInstance = getAuth(getApp());
  }
  return authInstance;
}

export async function signInWithPasscode(passcode) {
  await signInWithEmailAndPassword(getAuthInstance(), SHARED_LOGIN_EMAIL, passcode);
}

export function onAuthChange(callback) {
  return onAuthStateChanged(getAuthInstance(), callback);
}

export async function signOutUser() {
  await signOut(getAuthInstance());
}

// ---- 製品・工具マスタ ----
// masterData.js（実際の工具寿命データを含む）は、認証済みになるまで
// ネットワークから取得しないよう、ここで初めて動的importする。

export async function ensureSeedData() {
  const db = getDb();
  const snap = await get(ref(db, "products"));
  if (snap.exists()) return;
  const { SEED_PRODUCTS } = await import("./masterData.js");
  for (const product of SEED_PRODUCTS) {
    await set(ref(db, `products/${product.id}`), product);
  }
}

export function subscribeProducts(onChange) {
  const db = getDb();
  return onValue(ref(db, "products"), (snap) => {
    const val = snap.val() || {};
    const products = Object.keys(val).map((id) => ({ id, ...val[id] }));
    onChange(products);
  });
}

export async function saveProduct(product) {
  const db = getDb();
  await set(ref(db, `products/${product.id}`), product);
}

export async function deleteProduct(productId) {
  const db = getDb();
  await remove(ref(db, `products/${productId}`));
}

// ---- スキャン結果（撮影→OCR確認後に保存する使用数記録） ----

export async function submitScan({ productId, machine, capturedBy, readings }) {
  const db = getDb();
  await push(ref(db, "scans"), {
    productId,
    machine,
    capturedBy: capturedBy || "不明",
    readings,
    capturedAt: serverTimestamp(),
  });
}

function scanEntriesFromSnapshot(snap) {
  const val = snap.val() || {};
  return Object.keys(val).map((id) => ({ id, ...val[id] }));
}

// 全スキャンを購読し、(productId::machine)ごとの最新値だけを渡す
export function subscribeLatestScans(onChange, maxEntries = 2000) {
  const db = getDb();
  const scansQuery = query(ref(db, "scans"), orderByChild("capturedAt"), limitToLast(maxEntries));
  return onValue(scansQuery, (snap) => {
    const scans = scanEntriesFromSnapshot(snap);
    const latest = new Map();
    scans.forEach((scan) => {
      const key = `${scan.productId}::${scan.machine}`;
      const existing = latest.get(key);
      if (!existing || (scan.capturedAt || 0) > (existing.capturedAt || 0)) {
        latest.set(key, scan);
      }
    });
    onChange(latest);
  });
}

export function subscribeScanHistory(onChange, maxEntries = 50) {
  const db = getDb();
  const scansQuery = query(ref(db, "scans"), orderByChild("capturedAt"), limitToLast(maxEntries));
  return onValue(scansQuery, (snap) => {
    const scans = scanEntriesFromSnapshot(snap).sort((a, b) => (b.capturedAt || 0) - (a.capturedAt || 0));
    onChange(scans);
  });
}
