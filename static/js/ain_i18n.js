// ==========================================
// AIN2 国際化辞書 & 自動翻訳エンジン (ain_i18n.js - 本体専用クリーン版)
// ==========================================

const I18N_MAP = {
  // --- AIN メイン画面 ＆ イラストパレット ---
  "前日へ": "Previous Day",
  "翌日へ": "Next Day",
  "前の記録へ": "Previous Log",
  "次の記録へ": "Next Log",
  "カレンダー": "Calendar",
  "ログ検索": "Find Logs",
  "メモ (Memorandum)": "Memorandum",
  "電卓 (Calculator)": "Calculator",
  "Img & Log from Fiji (Fijiから画像と操作履歴を挿入)": "Import Image & Log from Fiji",
  "Option (設定)": "Options",
  "About AIN (ロゴ・情報)": "About AIN",
  "Insert SR info (放射光条件)": "Insert SR Info",
  "リング電流取得 (OCR)": "Fetch Ring Current",
  "現在日時を挿入": "Insert Timestamp",
  "カメラ撮影 / 画像挿入": "Take/Insert Photo",
  "ログを保存": "Save Log",
  "太字": "Bold",
  "斜体": "Italic",
  "下線": "Underline",
  "取り消し線": "Strikethrough",
  "上付き文字": "Superscript",
  "下付き文字": "Subscript",
  "文字色 (赤/黒)": "Font Color",
  "マーカー": "Highlight",
  "箇条書き": "Bullet List",
  "番号付きリスト": "Numbered List",
  "枠囲み": "Box",
  "イラスト枠挿入": "Insert Canvas Box",
  "区切り線": "Separator",

  // 画面上のテキスト・ラベル・ボタン・ステータス
  "● 編集中": "● Editing",
  "保存済": "Saved",
  "未変更": "Unmodified",
  "自動保存中...": "Auto-saving...",
  "自動保存済": "Auto-saved",
  "保存失敗": "Save Failed",
  "行数:": "Lines:",
  "挿入": "Insert",
  "アカウント:": "Account:",
  "検索": "Search",
  "直線": "Line",
  "四角": "Rectangle",
  "円": "Circle",
  "多角形": "Polygon",
  "手書きペン": "Pen",
  "文字": "Text",
  "太さ": "Width",
  "線種": "Style",
  "色": "Color",
  "線太さ": "Stroke Width",
  "線色": "Stroke Color",
  "ハッチ": "Hatch",
  "塗色": "Fill Color",
  "サイズ": "Size",
  "文字色": "Text Color",
  "✓ 確定": "✓ Done",
  "なし": "None",
  "ベタ": "Solid",
  "斜線 ╱": "Diagonal ╱",
  "格子 ╳": "Cross ╳",
  "ドラッグして移動": "Drag to Move",
  "画像を削除": "Delete Image",
  "ImageJ / Fiji で開く": "Open in ImageJ / Fiji",

  // --- ✏️ Memo 画面固有の文言 ---
  "チェックマーク挿入": "Insert Checkmark",
  "箇条書きリスト": "Bullet List",
  "元に戻す (⌘+Z)": "Undo (⌘+Z)",
  "やり直し (⌘+Shift+Z)": "Redo (⌘+Shift+Z)",
  "太字 (⌘+B)": "Bold (⌘+B)",
  "斜体 (⌘+I)": "Italic (⌘+I)",
  "下線 (⌘+U)": "Underline (⌘+U)",
  "赤字切替": "Toggle Red Color",
  "箇条書きリスト (・)": "Bullet List (•)",
  "番号付きリスト (1. 2. 3.)": "Numbered List (1. 2. 3.)",
  "自動保存 (10s)": "Auto-save (10s)",
  "保存済 (.bak更新)": "Saved (.bak updated)",
  "新規メモ": "New Memo",
  "Loaded (.orig退避済)": "Loaded (backup created)",

  // カレンダー
  "日": "Sun",
  "月": "Mon",
  "火": "Tue",
  "水": "Wed",
  "木": "Thu",
  "金": "Fri",
  "土": "Sat",

  // --- 🔍 Find Log (検索モーダル) ---
  "検索ワードを入力...": "Enter keyword...",
  "キーワードを入力してSearchを押してください": "Enter a keyword and click Search",
  "ダブルクリックでログを開く": "Double-click to open log",
  "検索中...": "Searching...",
  "該当するログは見つかりませんでした": "No matching logs found",
  "検索エラーが発生しました": "Search error occurred",

  // --- ⚙️ オプションダイアログ内の項目 ---
  "⚙️ AILab Note Option": "⚙️ AILab Note Options",
  "表示言語 (Language)": "Language",
  "日本語 (Japanese)": "Japanese",
  "English (US)": "English (US)",
  "🔬 ImageJ / Fiji Path": "🔬 ImageJ / Fiji Path",
  "📄 Help File (PDFパス)": "📄 Help File (PDF Path)",
  "Font Size": "Font Size",
  "Auto Save": "Auto Save",
  "🔍 参照...": "🔍 Browse...",
  "📁 参照...": "📁 Browse...",
  "実行ファイルを選択": "Select Executable File",
  "PDFファイルを選択": "Select PDF File",
  "💾 終了時にフォルダへ差分バックアップ (Dropbox等)": "💾 Incremental Backup on Exit (Dropbox, etc.)",
  "バックアップ先フォルダを選択": "Select Backup Destination Folder",

  // Ring タブ
  "使用施設 (Active Facility)": "Active Facility",
  "SAGA-LS Image URL": "SAGA-LS Image URL",
  "SPring-8 Image URL": "SPring-8 Image URL",
  "PF Image URL": "PF Image URL",

  "改竄検知・電子署名検証（準備中）": "Tamper Verification & Signature (Coming Soon)",

  // --- 🚪 終了確認モーダル ---
  "AIN の終了": "Quit AIN",
  "編集中（未保存）のログがあります。": "You have unsaved changes in the current log.",
  "どのように終了しますか？": "How would you like to exit?",
  "破棄して終了": "Discard & Quit",
  "保存して終了": "Save & Quit",

  // 共通ボタン
  "閉じる": "Close",
  "保存": "Save",
  "キャンセル": "Cancel"
};

const REVERSE_MAP = {};
Object.entries(I18N_MAP).forEach(([ja, en]) => {
  REVERSE_MAP[en] = ja;
});

var currentAppLanguage = "ja";
const i18nChannel = new BroadcastChannel('ain_i18n_channel');

function setAppLanguage(targetLang, broadcast = true) {
  currentAppLanguage = targetLang || "ja";
  const isEn = (currentAppLanguage === "en");
  const dict = isEn ? I18N_MAP : REVERSE_MAP;

  // 1. ツールチップ (title および data-hint) 置換
  document.querySelectorAll('[title], [data-hint]').forEach(el => {
    const rawTitle = el.getAttribute('title');
    if (rawTitle && dict[rawTitle]) {
      el.setAttribute('title', dict[rawTitle]);
    }
    const rawHint = el.getAttribute('data-hint');
    if (rawHint && dict[rawHint]) {
      el.setAttribute('data-hint', dict[rawHint]);
    }
  });

  // 2. テキストノード単位で全要素を走査
  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT,
    null,
    false
  );

  let node;
  while ((node = walker.nextNode())) {
    const parentTag = node.parentElement ? node.parentElement.tagName.toLowerCase() : "";
    if (parentTag === "script" || parentTag === "style" || parentTag === "textarea") continue;

    const trimmed = node.nodeValue.trim();
    if (dict[trimmed]) {
      node.nodeValue = node.nodeValue.replace(trimmed, dict[trimmed]);
    }
  }

  // 3. input / textarea のプレースホルダー置換
  document.querySelectorAll('input[placeholder], textarea[placeholder]').forEach(el => {
    const ph = el.getAttribute('placeholder');
    if (dict[ph]) {
      el.setAttribute('placeholder', dict[ph]);
    }
  });

  document.documentElement.lang = currentAppLanguage;

  if (broadcast) {
    i18nChannel.postMessage({ action: 'change_lang', lang: currentAppLanguage });
  }
}

i18nChannel.onmessage = (event) => {
  if (event.data && event.data.action === 'change_lang') {
    setAppLanguage(event.data.lang, false);
  }
};