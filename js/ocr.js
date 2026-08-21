// 手書き数字グリッドのOCR処理。
// 1. 撮影した写真の中から「使用数を書く数字欄」の四隅をユーザーにタップしてもらう
// 2. 四隅から射影変換（ホモグラフィ）で長方形に補正する
// 3. 行数×列数（工具の数×機械の数）で均等に分割してセル画像を作る
// 4. 各セルをTesseract.js（無料・端末内で完結）で数字認識する
//
// Tesseract.js は index.html で <script src=".../tesseract.min.js"> により
// グローバル `Tesseract` として読み込まれている前提。

function solveLinearSystem(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let maxRow = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[maxRow][col])) maxRow = r;
    }
    [M[col], M[maxRow]] = [M[maxRow], M[col]];
    const pivot = M[col][col];
    if (Math.abs(pivot) < 1e-12) continue;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = M[r][col] / pivot;
      for (let c = col; c <= n; c++) {
        M[r][c] -= factor * M[col][c];
      }
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

function computeHomography(from, to) {
  const A = [];
  const b = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = from[i];
    const { x: X, y: Y } = to[i];
    A.push([x, y, 1, 0, 0, 0, -x * X, -y * X]);
    b.push(X);
    A.push([0, 0, 0, x, y, 1, -x * Y, -y * Y]);
    b.push(Y);
  }
  const h = solveLinearSystem(A, b);
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

function applyHomography(h, x, y) {
  const w = h[6] * x + h[7] * y + 1;
  return {
    x: (h[0] * x + h[1] * y + h[2]) / w,
    y: (h[3] * x + h[4] * y + h[5]) / w,
  };
}

// tappedPoints: 元画像上でユーザーがタップした4点 [左上,右上,右下,左下]
// straightWidth/Height: 補正後の出力サイズ
export function warpToRect(sourceCanvas, tappedPoints, straightWidth, straightHeight) {
  const rectCorners = [
    { x: 0, y: 0 },
    { x: straightWidth, y: 0 },
    { x: straightWidth, y: straightHeight },
    { x: 0, y: straightHeight },
  ];
  // 出力(長方形)→入力(写真)への変換を作ることで、出力画素ごとに1回のサンプリングで済む
  const H = computeHomography(rectCorners, tappedPoints);

  const sw = sourceCanvas.width;
  const sh = sourceCanvas.height;
  const srcData = sourceCanvas.getContext("2d").getImageData(0, 0, sw, sh).data;

  const outCanvas = document.createElement("canvas");
  outCanvas.width = straightWidth;
  outCanvas.height = straightHeight;
  const outCtx = outCanvas.getContext("2d");
  const outImageData = outCtx.createImageData(straightWidth, straightHeight);
  const outData = outImageData.data;

  for (let Y = 0; Y < straightHeight; Y++) {
    for (let X = 0; X < straightWidth; X++) {
      const { x, y } = applyHomography(H, X, Y);
      const sx = Math.round(x);
      const sy = Math.round(y);
      const outIdx = (Y * straightWidth + X) * 4;
      if (sx >= 0 && sx < sw && sy >= 0 && sy < sh) {
        const srcIdx = (sy * sw + sx) * 4;
        outData[outIdx] = srcData[srcIdx];
        outData[outIdx + 1] = srcData[srcIdx + 1];
        outData[outIdx + 2] = srcData[srcIdx + 2];
        outData[outIdx + 3] = 255;
      } else {
        outData[outIdx + 3] = 255; // 範囲外は白扱い
        outData[outIdx] = outData[outIdx + 1] = outData[outIdx + 2] = 255;
      }
    }
  }
  outCtx.putImageData(outImageData, 0, 0);
  return outCanvas;
}

// 行数×列数で均等分割してセルごとの小さいcanvasを作る
export function sliceGridCells(straightCanvas, rowCount, colCount, rowLabels, colLabels) {
  const w = straightCanvas.width;
  const h = straightCanvas.height;
  const cellW = w / colCount;
  const cellH = h / rowCount;
  const cells = [];
  for (let r = 0; r < rowCount; r++) {
    for (let c = 0; c < colCount; c++) {
      const padX = cellW * 0.1;
      const padY = cellH * 0.12;
      const cw = Math.max(1, Math.round(cellW - padX * 2));
      const ch = Math.max(1, Math.round(cellH - padY * 2));
      const cellCanvas = document.createElement("canvas");
      cellCanvas.width = cw;
      cellCanvas.height = ch;
      const ctx = cellCanvas.getContext("2d");
      ctx.drawImage(
        straightCanvas,
        c * cellW + padX,
        r * cellH + padY,
        cellW - padX * 2,
        cellH - padY * 2,
        0,
        0,
        cw,
        ch
      );
      cells.push({
        row: r,
        col: c,
        rowLabel: rowLabels ? rowLabels[r] : r,
        colLabel: colLabels ? colLabels[c] : c,
        canvas: cellCanvas,
      });
    }
  }
  return cells;
}

// グレースケール化＋二値化して手書き数字の輪郭を強調する
export function preprocessForOcr(cellCanvas) {
  const ctx = cellCanvas.getContext("2d");
  const { width, height } = cellCanvas;
  if (width < 2 || height < 2) return cellCanvas;
  const imgData = ctx.getImageData(0, 0, width, height);
  const d = imgData.data;
  const gray = new Float32Array(width * height);
  let sum = 0;
  for (let i = 0, px = 0; i < gray.length; i++, px += 4) {
    const g = 0.299 * d[px] + 0.587 * d[px + 1] + 0.114 * d[px + 2];
    gray[i] = g;
    sum += g;
  }
  const mean = sum / gray.length;
  const threshold = mean * 0.82;
  for (let i = 0, px = 0; i < gray.length; i++, px += 4) {
    const v = gray[i] < threshold ? 0 : 255;
    d[px] = d[px + 1] = d[px + 2] = v;
  }
  ctx.putImageData(imgData, 0, 0);
  return cellCanvas;
}

let workerPromise = null;
async function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      const worker = await Tesseract.createWorker("eng");
      await worker.setParameters({
        tessedit_char_whitelist: "0123456789",
        tessedit_pageseg_mode: "7",
      });
      return worker;
    })();
  }
  return workerPromise;
}

export async function recognizeCell(cellCanvas) {
  const worker = await getWorker();
  const { data } = await worker.recognize(cellCanvas);
  const digits = (data.text || "").replace(/[^0-9]/g, "");
  return { text: digits, confidence: data.confidence };
}

// cells を順番にOCRし、進捗をコールバックで通知する
export async function recognizeGrid(cells, onProgress) {
  const results = [];
  for (let i = 0; i < cells.length; i++) {
    preprocessForOcr(cells[i].canvas);
    const r = await recognizeCell(cells[i].canvas);
    results.push({ ...cells[i], ...r });
    if (onProgress) onProgress(i + 1, cells.length);
  }
  return results;
}

export async function fileToCanvas(file, maxDim = 1600) {
  const bitmap = await createImageBitmap(file);
  let { width, height } = bitmap;
  if (Math.max(width, height) > maxDim) {
    const scale = maxDim / Math.max(width, height);
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d").drawImage(bitmap, 0, 0, width, height);
  return canvas;
}
