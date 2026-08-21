// 稼働カレンダー計算。
//
// 月〜金：1直（8:00-21:00）→2直（21:00-翌8:00）の24時間稼働
// ただし金曜の2直だけは土曜4:00で終了（土曜は休みのため）
// 土曜：0:00-4:00（金曜2直の続き）のみ稼働、4:00以降は休み
// 日曜：終日休み
//
// この稼働カレンダーをもとに、「今から何秒後に工具寿命に到達するか」を、
// 休み時間を飛ばして計算する。

export const SHIFT1_START_HOUR = 8;
export const SHIFT_SWITCH_HOUR = 21;
export const SATURDAY_END_HOUR = 4;

// 指定した日時が稼働時間内かどうか
export function isOperating(date) {
  const day = date.getDay(); // 0=日,1=月,...6=土
  const h = date.getHours();
  switch (day) {
    case 0: // 日曜
      return false;
    case 6: // 土曜：4時まで（金曜2直の続き）
      return h < SATURDAY_END_HOUR;
    case 1: // 月曜：8時から
      return h >= SHIFT1_START_HOUR;
    default: // 火・水・木・金：終日稼働
      return true;
  }
}

// 現在のシフト名（"1直" / "2直" / null=休み）
export function currentShiftName(date) {
  if (!isOperating(date)) return null;
  const day = date.getDay();
  const h = date.getHours();
  if (day === 6) return "2直"; // 土曜0-4時は金曜2直の続き
  if (h >= SHIFT1_START_HOUR && h < SHIFT_SWITCH_HOUR) return "1直";
  return "2直";
}

function atTime(date, h, m = 0) {
  const d = new Date(date);
  d.setHours(h, m, 0, 0);
  return d;
}

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

// 現在の稼働区間（シフト）が終わる日時。休みの場合は null。
export function currentOperatingSegmentEnd(date) {
  if (!isOperating(date)) return null;
  const day = date.getDay();
  const h = date.getHours();

  if (day === 6) {
    // 土曜0-4時 → 4:00に終了
    return atTime(date, SATURDAY_END_HOUR);
  }
  if (h >= SHIFT1_START_HOUR && h < SHIFT_SWITCH_HOUR) {
    // 1直中 → 今日21:00に終了
    return atTime(date, SHIFT_SWITCH_HOUR);
  }
  if (h >= SHIFT_SWITCH_HOUR) {
    // 2直開始日（21:00-24:00側）
    if (day === 5) {
      // 金曜21:00開始の2直 → 翌日(土)4:00に終了
      return atTime(addDays(date, 1), SATURDAY_END_HOUR);
    }
    return atTime(addDays(date, 1), SHIFT1_START_HOUR);
  }
  // h < 8時（月曜は稼働外なのでここには来ない。火〜金の深夜帯）
  return atTime(date, SHIFT1_START_HOUR);
}

// 休み中に呼ばれた場合、次に稼働が再開する日時
export function nextOperatingStart(date) {
  const day = date.getDay();
  const h = date.getHours();
  if (day === 0) {
    // 日曜 → 翌月曜8:00
    return atTime(addDays(date, 1), SHIFT1_START_HOUR);
  }
  if (day === 6) {
    // 土曜(4時以降) → 月曜8:00（日曜を飛ばす）
    return atTime(addDays(date, 2), SHIFT1_START_HOUR);
  }
  if (day === 1 && h < SHIFT1_START_HOUR) {
    // 月曜0-8時 → 今日8:00
    return atTime(date, SHIFT1_START_HOUR);
  }
  // それ以外は基本的に稼働中のはずだが、念のためそのまま返す
  return new Date(date);
}

// 指定した開始日時から「稼働時間で」seconds 秒後の日時を計算する（休みは飛ばす）。
export function addOperatingSeconds(startDate, seconds) {
  let current = new Date(startDate);
  let remaining = Math.max(0, seconds);
  let guard = 0;
  while (remaining > 0 && guard < 500) {
    guard++;
    if (!isOperating(current)) {
      current = nextOperatingStart(current);
      continue;
    }
    const segmentEnd = currentOperatingSegmentEnd(current);
    const availableSec = (segmentEnd.getTime() - current.getTime()) / 1000;
    if (availableSec >= remaining) {
      current = new Date(current.getTime() + remaining * 1000);
      remaining = 0;
    } else {
      current = segmentEnd;
      remaining -= availableSec;
    }
  }
  return current;
}

// 秒数を「◯日◯時間◯分」のような読みやすい文字列にする
export function formatDuration(seconds) {
  if (seconds <= 0) return "まもなく";
  const totalMin = Math.round(seconds / 60);
  const days = Math.floor(totalMin / (60 * 24));
  const hours = Math.floor((totalMin % (60 * 24)) / 60);
  const mins = totalMin % 60;
  const parts = [];
  if (days > 0) parts.push(`${days}日`);
  if (hours > 0 || days > 0) parts.push(`${hours}時間`);
  parts.push(`${mins}分`);
  return parts.join("");
}

export function formatDateTime(date) {
  const weekday = ["日", "月", "火", "水", "木", "金", "土"][date.getDay()];
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${date.getMonth() + 1}/${date.getDate()}(${weekday}) ${hh}:${mm}`;
}
