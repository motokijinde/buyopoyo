// ぶよぽよ ランキング API
// デプロイ設定：「ウェブアプリ」として公開 / 実行: 自分 / アクセス: 全員（匿名を含む）
// データはヘッダー行なし・1行目からデータ
// A: name  B: score  C: timestamp  D: sessionId

const SHEET_NAME = "rankings";
const TOP_N = 10;

function doGet(e) {
  if (e && e.parameter && e.parameter.action === "submit") {
    return handleSubmit(
      String(e.parameter.name ?? ""),
      Number(e.parameter.score),
      String(e.parameter.sessionId ?? ""),
    );
  }
  return jsonOut({ ok: true, rankings: getTop() });
}

function handleSubmit(name, score, sessionId) {
  const trimmed = String(name).trim().slice(0, 8);
  if (!trimmed || !score || !sessionId) {
    return jsonOut({ ok: false, error: "invalid_params" });
  }

  const sheet = getOrCreateSheet();
  const lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    // 二重登録チェック（1行目からデータ）
    const lastRow = sheet.getLastRow();
    if (lastRow >= 1) {
      const ids = sheet.getRange(1, 4, lastRow, 1).getValues().flat();
      if (ids.includes(sessionId)) {
        return jsonOut({ ok: false, error: "duplicate", rankings: getTop() });
      }
    }

    // TOP10チェック（先着順：同スコアは既存優先）
    const top = getTop();
    if (top.length >= TOP_N && score <= top[top.length - 1].score) {
      return jsonOut({ ok: false, error: "not_in_top10", rankings: top });
    }

    const ts = Utilities.formatDate(new Date(), "Asia/Tokyo", "yyyy-MM-dd HH:mm");
    sheet.appendRow([trimmed, score, ts, sessionId]);
    sortAndTrim(sheet);
    return jsonOut({ ok: true, rankings: getTop() });
  } finally {
    lock.releaseLock();
  }
}

function getOrCreateSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
}

function getTop() {
  const sheet = getOrCreateSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow < 1) return [];
  return sheet.getRange(1, 1, lastRow, 3).getValues()
    .filter(r => r[1] > 0)
    .sort((a, b) => b[1] - a[1] || String(a[2]).localeCompare(String(b[2])))
    .slice(0, TOP_N)
    .map((r, i) => ({ rank: i + 1, name: r[0], score: r[1], timestamp: r[2] }));
}

function sortAndTrim(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 1) return;
  const range = sheet.getRange(1, 1, lastRow, 4);
  const data = range.getValues().filter(r => r[1] > 0);
  data.sort((a, b) => b[1] - a[1] || String(a[2]).localeCompare(String(b[2])));
  range.clearContent();
  if (data.length > 0) {
    sheet.getRange(1, 1, Math.min(data.length, TOP_N), 4).setValues(data.slice(0, TOP_N));
  }
}

function jsonOut(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
