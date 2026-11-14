// ==========================================
// AIN2 メインコントローラー (ain_main.js - 完全復元版)
// ==========================================
const API_BASE = `${window.location.origin}/api`;

let currentDate = new Date();
let isModified = false;
let knownLogDates = [];
let currentAccountName = "default";

let targetImage = null;
let isResizing = false;
let startX = 0, startWidth = 0;
let autoSaveTimerId = null;
let savedEditorRange = null;

let lastSyncedMtime = 0;
let isCheckingLatest = false;

// カレンダー表示用
let calDisplayYear = 2026;
let calDisplayMonth = 11;

function getDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const date = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${date}`;
}

function updateDateUI() {
  const y = currentDate.getFullYear();
  const m = String(currentDate.getMonth() + 1).padStart(2, '0');
  const d = String(currentDate.getDate()).padStart(2, '0');
  const newTitle = `${y}/${m}/${d}  AIN - AILab Note`;

  document.title = newTitle;
  fetch(`${API_BASE}/set_window_title`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: newTitle })
  }).catch(() => {});
}

let tmpSaveTimerId = null;

function scheduleTmpSave() {
  if (tmpSaveTimerId) clearTimeout(tmpSaveTimerId);
  tmpSaveTimerId = setTimeout(async () => {
    if (!isModified) return;
    const dStr = getDateStr(currentDate);
    const editor = document.getElementById('editor');
    const resizer = document.getElementById('imageResizer');
    if (!editor) return;

    // 画像選択枠のHTMLが混入しないよう一時非表示にして取得
    const resizerWasVisible = resizer && !resizer.classList.contains('hidden');
    if (resizer) resizer.classList.add('hidden');
    const content = editor.innerHTML;
    if (resizerWasVisible && resizer) resizer.classList.remove('hidden');

    try {
      const res = await fetch(`${API_BASE}/logs/tmp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date_str: dStr,
          content_html: content,
          account: currentAccountName
        })
      });
      if (res.ok) {
        const resData = await res.json();
        if (resData.mtime) {
          lastSyncedMtime = resData.mtime;
        }
      }
    } catch (e) {
      console.warn("TMP auto-save failed:", e);
    }
  }, 1500); // 入力停止から1.5秒後に退避
}

function onEditorInput() {
  isModified = true;
  const isEn = (typeof currentAppLanguage !== 'undefined' && currentAppLanguage === 'en');
  const saveStatus = document.getElementById('saveStatus');
  if (saveStatus) saveStatus.textContent = isEn ? "● Editing" : "● 編集中";
  scheduleTmpSave();
}

async function loadLogForDate(dateObj) {
  if (typeof drawnShapes !== 'undefined' && drawnShapes.length > 0) {
    commitDrawing(true);
  }
  if (typeof removeDrawingOverlay === 'function') removeDrawingOverlay();
  targetImage = null;
  const resizer = document.getElementById('imageResizer');
  if (resizer) resizer.classList.add('hidden');

  if (isModified) {
    await SB_SaveClick(false);
  }
  isModified = false;
  const isEn = (typeof currentAppLanguage !== 'undefined' && currentAppLanguage === 'en');
  const saveStatus = document.getElementById('saveStatus');
  if (saveStatus) saveStatus.textContent = isEn ? "Unmodified" : "未変更";

  currentDate = new Date(dateObj);
  updateDateUI();

  const dStr = getDateStr(currentDate);
  localStorage.setItem('ain2_last_date', dStr);
  document.getElementById('statusText').textContent = `Loading ${dStr}...`;

  try {
    const res = await fetch(`${API_BASE}/logs/${dStr}?account=${currentAccountName}`);
    const data = await res.json();
    const editor = document.getElementById('editor');

    if (data.exists && data.content_html) {
      editor.innerHTML = data.content_html;
      document.getElementById('statusText').textContent = `Loaded ${dStr}`;
      editor.style.fontSize = "";
    } else {
      const optInput = document.getElementById('opt_font_size');
      const defaultPt = (optInput && optInput.value) ? parseInt(optInput.value, 10) : 12;
      editor.innerHTML = "";
      editor.style.fontSize = `${defaultPt}pt`;
      const editSize = document.getElementById('Edit_Size');
      if (editSize) editSize.value = defaultPt;
      document.getElementById('statusText').textContent = `新規ログ (${dStr})`;
    }

    // ★ 未確定の .tmp が残っている場合の復元チェック
    try {
      const tmpRes = await fetch(`${API_BASE}/logs/tmp/${dStr}?account=${currentAccountName}`);
      const tmpData = await tmpRes.json();
      if (tmpData.exists && tmpData.content_html && tmpData.content_html !== editor.innerHTML) {
        const msg = isEn
          ? `Unsaved draft (${dStr}.tmp) was found.\nDo you want to restore it?`
          : `前回未確定の一時保存データ (${dStr}.tmp) が見つかりました。\n復元しますか？（キャンセルすると破棄します）`;
        if (confirm(msg)) {
          editor.innerHTML = tmpData.content_html;
          isModified = true;
          if (saveStatus) saveStatus.textContent = isEn ? "● Restored (Unsaved)" : "● 復元済 (未保存)";
          document.getElementById('statusText').textContent = `Restored from ${dStr}.tmp`;
          await syncBaselineMtime(dStr);
          return;
        } else {
          await fetch(`${API_BASE}/logs/tmp/${dStr}?account=${currentAccountName}`, { method: "DELETE" });
        }
      }
    } catch (tmpErr) {
      console.warn("TMP check failed:", tmpErr);
    }

  } catch (e) {
    document.getElementById('statusText').textContent = `サーバー未接続`;
  }
  isModified = false;
  if (saveStatus) saveStatus.textContent = isEn ? "Unmodified" : "未変更";
  await syncBaselineMtime(dStr);
}

async function refreshLogDates() {
  try {
    const res = await fetch(`${API_BASE}/logs_dates?account=${currentAccountName}`);
    const data = await res.json();
    knownLogDates = data.dates || [];
  } catch (e) {
    knownLogDates = [];
  }
}

async function SB_PrevClick() {
  const d = new Date(currentDate);
  d.setDate(d.getDate() - 1);
  await loadLogForDate(d);
}

async function SB_NextClick() {
  const d = new Date(currentDate);
  d.setDate(d.getDate() + 1);
  await loadLogForDate(d);
}

async function SB_FPrevClick() {
  await refreshLogDates();
  const currentDStr = getDateStr(currentDate);
  const prevDates = knownLogDates.filter(d => d < currentDStr);
  if (prevDates.length > 0) {
    const target = prevDates[prevDates.length - 1];
    const y = parseInt(target.substring(0,4)), m = parseInt(target.substring(4,6))-1, d = parseInt(target.substring(6,8));
    await loadLogForDate(new Date(y, m, d, 12, 0, 0));
  } else {
    alert("これより前のログは見つかりませんでした。");
  }
}

async function SB_FNextClick() {
  await refreshLogDates();
  const currentDStr = getDateStr(currentDate);
  const nextDates = knownLogDates.filter(d => d > currentDStr);
  if (nextDates.length > 0) {
    const target = nextDates[0];
    const y = parseInt(target.substring(0,4)), m = parseInt(target.substring(4,6))-1, d = parseInt(target.substring(6,8));
    await loadLogForDate(new Date(y, m, d, 12, 0, 0));
  } else {
    alert("これより後のログは見つかりませんでした。");
  }
}

async function SB_SaveClick(showAlert = false) {
  if (typeof drawnShapes !== 'undefined' && drawnShapes.length > 0) {
    commitDrawing(false);
  }

  // 待機中の .tmp 保存タイマーがあればキャンセル（確定保存を優先）
  if (tmpSaveTimerId) {
    clearTimeout(tmpSaveTimerId);
    tmpSaveTimerId = null;
  }

  const dStr = getDateStr(currentDate);
  const editor = document.getElementById('editor');
  const resizer = document.getElementById('imageResizer');
  
  const resizerWasVisible = resizer && !resizer.classList.contains('hidden');
  if (resizer) resizer.classList.add('hidden');
  const content = editor.innerHTML;
  if (resizerWasVisible && resizer) resizer.classList.remove('hidden');

  const statusText = document.getElementById('statusText');
  const saveStatus = document.getElementById('saveStatus');
  if (statusText) statusText.textContent = `Saving ${dStr}...`;

  try {
    const res = await fetch(`${API_BASE}/logs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ 
        date_str: dStr, 
        content_html: content,
        account: currentAccountName
      })
    });
    if (!res.ok) throw new Error(`HTTP Error ${res.status}`);

    const resData = await res.json();
    if (resData.mtime) {
      lastSyncedMtime = resData.mtime;
    }

    isModified = false;
    const isEn = (typeof currentAppLanguage !== 'undefined' && currentAppLanguage === 'en');
    if (saveStatus) saveStatus.textContent = isEn ? "Saved" : "保存済";
    if (statusText) statusText.textContent = isEn ? `Saved: ${dStr}.html` : `Saved: ${dStr}.html`;
    await refreshLogDates();
  } catch (e) {
    const isEn = (typeof currentAppLanguage !== 'undefined' && currentAppLanguage === 'en');
    if (saveStatus) saveStatus.textContent = isEn ? "Save Failed" : "保存失敗";
    if (statusText) statusText.textContent = isEn ? `Save error: ${e.message}` : `保存エラー: ${e.message}`;
    if (showAlert) alert(isEn ? `Failed to save: ${e.message}` : `保存に失敗しました: ${e.message}`);
  }
}

// ==========================================
// 📅 カレンダーポップアップ制御
// ==========================================
function CB_CalClick() {
  const panel = document.getElementById('calendarPanel');
  if (!panel) return;
  panel.classList.toggle('hidden');
  if (!panel.classList.contains('hidden')) {
    calDisplayYear = currentDate.getFullYear();
    calDisplayMonth = currentDate.getMonth() + 1;
    refreshLogDates().then(() => {
      renderCalendar(calDisplayYear, calDisplayMonth);
    });
  }
}

function renderCalendar(year, month) {
  document.getElementById('calYear').value = year;
  document.getElementById('calMonth').value = month;

  const grid = document.getElementById('calGrid');
  grid.innerHTML = '';

  const firstDayIndex = new Date(year, month - 1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();

  const today = new Date();
  const isThisMonth = (today.getFullYear() === year && (today.getMonth() + 1) === month);
  const todayDate = today.getDate();

  for (let cellIndex = 0; cellIndex < 42; cellIndex++) {
    const cell = document.createElement('div');
    cell.className = "h-6 flex items-center justify-center text-xs select-none transition-colors";

    const dayNum = cellIndex - firstDayIndex + 1;
    const col = cellIndex % 7;

    if (dayNum >= 1 && dayNum <= daysInMonth) {
      cell.textContent = dayNum;
      const dayStr = String(dayNum).padStart(2, '0');
      const mStr = String(month).padStart(2, '0');
      const fullDateStr = `${year}${mStr}${dayStr}`;

      const isToday = isThisMonth && (dayNum === todayDate);
      const hasLog = knownLogDates.includes(fullDateStr);

      if (col === 0) cell.classList.add('text-red-600');
      else if (col === 6) cell.classList.add('text-blue-600');
      else cell.classList.add('text-gray-800');

      if (isToday) {
        cell.className = "h-6 flex items-center justify-center text-xs select-none font-bold bg-red-600 !text-white rounded-sm shadow-sm cursor-pointer";
      } else if (hasLog) {
        cell.className = "h-6 flex items-center justify-center text-xs select-none font-bold bg-[#fff5a8] hover:bg-[#ffe66d] border border-amber-300 rounded-sm cursor-pointer";
        if (col === 0) cell.classList.add('text-red-700');
        else if (col === 6) cell.classList.add('text-blue-700');
      } else {
        cell.classList.add('bg-[#f4fbf4]', 'hover:bg-white', 'cursor-pointer');
      }

      cell.onclick = async () => {
        const targetDate = new Date(year, month - 1, dayNum, 12, 0, 0);
        //document.getElementById('calendarPanel').classList.add('hidden');
        await loadLogForDate(targetDate);

      };
    } else {
      cell.classList.add('bg-[#e9f3e9]', 'cursor-default');
    }
    grid.appendChild(cell);
  }
}

function calPrevMonth() {
  calDisplayMonth--;
  if (calDisplayMonth < 1) { calDisplayMonth = 12; calDisplayYear--; }
  renderCalendar(calDisplayYear, calDisplayMonth);
}
function calNextMonth() {
  calDisplayMonth++;
  if (calDisplayMonth > 12) { calDisplayMonth = 1; calDisplayYear++; }
  renderCalendar(calDisplayYear, calDisplayMonth);
}
function changeCalYear(delta) {
  calDisplayYear += delta;
  renderCalendar(calDisplayYear, calDisplayMonth);
}
function changeCalMonth(delta) {
  calDisplayMonth += delta;
  if (calDisplayMonth < 1) { calDisplayMonth = 12; calDisplayYear--; }
  if (calDisplayMonth > 12) { calDisplayMonth = 1; calDisplayYear++; }
  renderCalendar(calDisplayYear, calDisplayMonth);
}

async function calGoToday() {
  const now = new Date();
  calDisplayYear = now.getFullYear();
  calDisplayMonth = now.getMonth() + 1;
  renderCalendar(calDisplayYear, calDisplayMonth);

  // カレンダーパネルを閉じて今日のログを読み込む（未保存なら自動保存も連動）
  const todayTarget = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0);
  await loadLogForDate(todayTarget);
}




// ==========================================
// ⚛️ 放射光データ (SR Info) 一括挿入モーダル (アカウント別連動版)
// ==========================================
let currentSrConfig = null;

// プルダウン選択時の連動入力
function onSelectPreset(key) {
  const sel = document.getElementById(`sel_${key}`);
  const inp = document.getElementById(`init_${key}`);
  if (sel && inp) inp.value = sel.value;
}

// モーダルオープン時の値読み込み & プルダウン初期化
async function SB_InitClick() {
  const modal = document.getElementById('modalInit');
  modal.classList.remove('hidden');

  try {
    const res = await fetch(`${API_BASE}/config?account=${encodeURIComponent(currentAccountName)}`);
    const cfg = await res.json();

    currentSrConfig = cfg.sr_info || {
      last_values: {
        facility: "SAGA-LS",
        beamline: "BL07",
        filter: "Si(111)",
        energy: "10.0",
        method: "Abs CT",
        group: ""
      },
      presets: {
        facility: ["SAGA-LS", "PF", "PF AR", "SPring-8"],
        beamline: ["BL07", "BL-14B", "BL-14C", "BL-20B"],
        filter: ["Si(111)", "Si(220)", "Ge(111)", "Metal filter", "none"],
        method: ["Abs CT", "micro CT", "Cryo micro CT", "Interferometry CT", "DEI CT", "STXM"],
        group: [""]
      }
    };

    // 既存設定の member -> group への自動マイグレーション（後方互換）
    if (!currentSrConfig.presets.group && currentSrConfig.presets.member) {
      currentSrConfig.presets.group = [...currentSrConfig.presets.member];
    }
    if (currentSrConfig.last_values.group === undefined && currentSrConfig.last_values.member !== undefined) {
      currentSrConfig.last_values.group = currentSrConfig.last_values.member;
    }

    const keys = ['facility', 'beamline', 'filter', 'method', 'group'];
    keys.forEach(key => {
      const sel = document.getElementById(`sel_${key}`);
      const inp = document.getElementById(`init_${key}`);
      if (!sel || !inp) return;

      const list = currentSrConfig.presets[key] || [];
      const lastVal = currentSrConfig.last_values[key] ?? (list[0] || '');

      sel.innerHTML = '';
      list.forEach(val => {
        const opt = document.createElement('option');
        opt.value = val;
        opt.textContent = val;
        if (val === lastVal) opt.selected = true;
        sel.appendChild(opt);
      });

      inp.value = lastVal;
    });

    const eneVal = currentSrConfig.last_values.energy || "10.0";
    const eneInput = document.getElementById('init_energy');
    if (eneInput) eneInput.value = eneVal;

  } catch (e) {
    console.error("SR Info 読み込み失敗:", e);
  }
}

function closeInitModal() {
  document.getElementById('modalInit').classList.add('hidden');
}

// OKボタン押下時: ボックス形式でノート挿入 ＋ 新規値のリスト追加 ＋ アカウント設定保存
async function insertSRInfo() {
  const fac = document.getElementById('init_facility').value.trim();
  const bl  = document.getElementById('init_beamline').value.trim();
  const fil = document.getElementById('init_filter').value.trim();
  const ene = document.getElementById('init_energy').value.trim();
  const met = document.getElementById('init_method').value.trim();
  const grp = document.getElementById('init_group').value.trim();

  // 1. ノートへボックス形式でHTML挿入
  const boxHtml = `
    <div class="box-wrapper" style="border-left: 4px solid #0d9488; background-color: #f0fdfa; padding: 10px 14px; margin: 10px 0; font-family: monospace; font-size: 12.5px; line-height: 1.6; color: #134e4a; border-radius: 4px;">
      <div style="font-weight: bold; color: #0f766e; border-bottom: 1px solid #99f6e4; padding-bottom: 3px; margin-bottom: 6px;">⚛️ Beamline & Usage Condition</div>
      <table style="border-collapse: collapse; font-size: 12px; color: #1f2937;">
        <tr><td style="padding: 1px 12px 1px 0; font-weight: bold; color: #0f766e;">Facility</td><td>: ${escapeHtml(fac)}</td></tr>
        <tr><td style="padding: 1px 12px 1px 0; font-weight: bold; color: #0f766e;">Beamline</td><td>: ${escapeHtml(bl)}</td></tr>
        <tr><td style="padding: 1px 12px 1px 0; font-weight: bold; color: #0f766e;">Energy filter</td><td>: ${escapeHtml(fil)}</td></tr>
        <tr><td style="padding: 1px 12px 1px 0; font-weight: bold; color: #0f766e;">Energy</td><td>: ${escapeHtml(ene)} keV</td></tr>
        <tr><td style="padding: 1px 12px 1px 0; font-weight: bold; color: #0f766e;">Method</td><td>: ${escapeHtml(met)}</td></tr>
        <tr><td style="padding: 1px 12px 1px 0; font-weight: bold; color: #0f766e;">Group</td><td>: ${escapeHtml(grp)}</td></tr>
      </table>
    </div>
    <div><br></div>
  `;

  const editor = document.getElementById('editor');
  editor.focus();
  document.execCommand('insertHTML', false, boxHtml);
  closeInitModal();
  onEditorInput();

  // 2. プリセット配列に新しい値が存在しなければ追加 & 前回値を更新
  if (!currentSrConfig) currentSrConfig = { presets: {}, last_values: {} };
  if (!currentSrConfig.presets) currentSrConfig.presets = {};
  if (!currentSrConfig.last_values) currentSrConfig.last_values = {};

  const pairs = [
    ['facility', fac],
    ['beamline', bl],
    ['filter', fil],
    ['method', met],
    ['group', grp]
  ];

  pairs.forEach(([key, val]) => {
    if (val) {
      if (!currentSrConfig.presets[key]) currentSrConfig.presets[key] = [];
      if (!currentSrConfig.presets[key].includes(val)) {
        currentSrConfig.presets[key].push(val);
      }
      currentSrConfig.last_values[key] = val;
    }
  });
  if (ene) currentSrConfig.last_values.energy = ene;

  // 3. サーバーへ保存（Log/{account}/config.json に即座に反映）
  try {
    await fetch(`${API_BASE}/config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        account_name: currentAccountName,
        sr_info: currentSrConfig
      })
    });
  } catch (err) {
    console.warn("SR Info 設定保存失敗:", err);
  }
}
// ==========================================
// 🔍 ログ検索モーダル制御
// ==========================================
function SB_FindClick() {
  const todayStr = currentDate.toISOString().split('T')[0];
  if (!document.getElementById('find_start_date').value) {
    document.getElementById('find_start_date').value = "2026-01-01";
    document.getElementById('find_end_date').value = todayStr;
  }

  // 🌟 モーダルを開いた時に言語を同期
  if (typeof setAppLanguage === 'function') {
    setAppLanguage(typeof currentAppLanguage !== 'undefined' ? currentAppLanguage : 'ja', false);
  }

  // 未検索状態なら初期案内メッセージを現在の言語でセット
  const tbody = document.getElementById('findResultList');
  if (tbody && (!tbody.children.length || tbody.innerText.includes("Search") || tbody.innerText.includes("キーワード"))) {
    const isEn = (typeof currentAppLanguage !== 'undefined' && currentAppLanguage === 'en');
    tbody.innerHTML = `<tr><td colspan="3" class="text-center py-6 text-gray-400 select-none">${isEn ? "Enter a keyword and click Search" : "キーワードを入力してSearchを押してください"}</td></tr>`;
  }

  document.getElementById('modalFind').classList.remove('hidden');
  setTimeout(() => document.getElementById('find_keyword').focus(), 50);
}

function closeFindModal() { 
  document.getElementById('modalFind').classList.add('hidden'); 
}

function toggleDateRangeInputs() {
  const checked = document.getElementById('find_use_range').checked;
  document.getElementById('find_start_date').disabled = !checked;
  document.getElementById('find_end_date').disabled = !checked;
}

async function executeSearch() {
  const kw = document.getElementById('find_keyword').value;
  const useRange = document.getElementById('find_use_range').checked;
  const startDate = document.getElementById('find_start_date').value;
  const endDate = document.getElementById('find_end_date').value;

  const isEn = (typeof currentAppLanguage !== 'undefined' && currentAppLanguage === 'en');

  document.getElementById('findStatus').textContent = "Searching...";
  const tbody = document.getElementById('findResultList');
  tbody.innerHTML = `<tr><td colspan="3" class="text-center py-4 text-gray-400">${isEn ? "Searching..." : "検索中..."}</td></tr>`;

  try {
    const res = await fetch(`${API_BASE}/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        keyword: kw,
        use_date_range: useRange,
        start_date: startDate,
        end_date: endDate,
        account: currentAccountName
      })
    });
    const data = await res.json();
    const results = data.results || [];

    tbody.innerHTML = '';
    if (results.length === 0) {
      tbody.innerHTML = `<tr><td colspan="3" class="text-center py-6 text-gray-400">${isEn ? "No matching logs found" : "該当するログは見つかりませんでした"}</td></tr>`;
      document.getElementById('findStatus').textContent = "0 items";
      return;
    }

    results.forEach(item => {
      const tr = document.createElement('tr');
      tr.className = "hover:bg-blue-50 cursor-pointer select-none";
      tr.ondblclick = async () => {
        const y = parseInt(item.raw_date.substring(0, 4), 10);
        const m = parseInt(item.raw_date.substring(4, 6), 10) - 1;
        const d = parseInt(item.raw_date.substring(6, 8), 10);
        closeFindModal();
        await loadLogForDate(new Date(y, m, d, 12, 0, 0));
      };

      tr.innerHTML = `
        <td class="py-1 px-2 font-bold text-gray-800 border-r border-gray-100 whitespace-nowrap">${item.date}</td>
        <td class="py-1 px-2 text-gray-500 border-r border-gray-100 whitespace-nowrap">${item.time}</td>
        <td class="py-1 px-2 text-gray-700 truncate max-w-[240px]" title="${item.preview}">${item.preview}</td>
      `;
      tbody.appendChild(tr);
    });

    document.getElementById('findStatus').textContent = `${results.length} items found`;
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="3" class="text-center py-4 text-red-500">${isEn ? "Search error occurred" : "検索エラーが発生しました"}</td></tr>`;
    document.getElementById('findStatus').textContent = "Error";
  }
}

// ==========================================
// 📷 画像キャプチャ / 選択挿入
// ==========================================
function triggerImageCapture() {
  const fileInput = document.getElementById('cameraInput');
  fileInput.value = '';
  fileInput.click();
}

async function handleImageSelected(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;

  const statusElem = document.getElementById('statusText');
  if (statusElem) statusElem.textContent = "画像を最適化中...";

  try {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const maxDim = 1200;
        let w = img.width, h = img.height;
        if (w > maxDim || h > maxDim) {
          if (w > h) { h = Math.round((h * maxDim) / w); w = maxDim; }
          else { w = Math.round((w * maxDim) / h); h = maxDim; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        const compressedBase64 = canvas.toDataURL('image/jpeg', 0.8);

        const now = new Date();
        const timeStr = `${now.getFullYear()}/${String(now.getMonth()+1).padStart(2,'0')}/${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;

        const editor = document.getElementById('editor');
        editor.focus();
        const imgHtml = `
          <div style="margin: 6px 0;">
            <img src="${compressedBase64}" style="width: 360px; max-width: 100%; display: block; margin-bottom: 2px;" class="resizable-img rounded shadow-sm">
            <div style="font-size: 11px; color: #6b7280; font-family: monospace; line-height: 1.4;">📷 [${timeStr}] </div>
          </div>
          <div><br></div>
        `;
        document.execCommand('insertHTML', false, imgHtml);
        onEditorInput();
        if (statusElem) statusElem.textContent = "画像挿入完了";
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  } catch (err) {
    alert("画像の取り込みに失敗しました: " + err.message);
  }
}

// ==========================================
// フォントサイズ変更（拡大・縮小・ネスト解消対応）
// ==========================================
function changeSelectionFontSize(delta) {
  const editor = document.getElementById('editor');
  const editSize = document.getElementById('Edit_Size');
  if (!editor || !editSize) return;

  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return;

  let currentPt = parseInt(editSize.value, 10) || 12;
  const newPt = Math.max(6, Math.min(72, currentPt + delta));
  editSize.value = newPt;

  const range = sel.getRangeAt(0);

  if (!range.collapsed) {
    // 🌟 選択範囲内の既存の font-size 指定をすべて上書き・統合
    const span = document.createElement("span");
    span.style.fontSize = `${newPt}pt`;
    span.style.display = "inline";

    try {
      const fragment = range.extractContents();
      // 内側に残っている古い font-size を持つ要素のスタイルを削除
      const oldStyledElems = fragment.querySelectorAll('[style*="font-size"]');
      oldStyledElems.forEach(el => {
        el.style.fontSize = '';
        if (!el.getAttribute('style')) el.removeAttribute('style');
      });

      span.appendChild(fragment);
      range.insertNode(span);

      // 適用した span 全体を再選択
      sel.removeAllRanges();
      const newRange = document.createRange();
      newRange.selectNodeContents(span);
      sel.addRange(newRange);
      onEditorInput();
    } catch (e) {
      console.warn("Font size change error:", e);
    }
  } else {
    // 選択なし（キャレットのみ）の場合、直後の入力文字に効く空spanを挿入
    const span = document.createElement("span");
    span.style.fontSize = `${newPt}pt`;
    span.innerHTML = '&#8203;'; // ゼロ幅スペース
    range.insertNode(span);

    range.setStart(span.firstChild, 1);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  }
}

function SB_SizeUpClick() { changeSelectionFontSize(1); }
function SB_SizeDownClick() { changeSelectionFontSize(-1); }

// ==========================================
// 書式ツール ＆ タグ判定（上付き・下付き対応）
// ==========================================
function isInsideTag(node, tagName) {
  if (!node) return false;
  const editor = document.getElementById('editor');
  let curr = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
  while (curr && curr !== editor) {
    if (curr.tagName && curr.tagName.toLowerCase() === tagName.toLowerCase()) return true;
    curr = curr.parentElement;
  }
  return false;
}

function getAncestorTag(node, tagName) {
  const editor = document.getElementById('editor');
  let curr = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
  while (curr && curr !== editor) {
    if (curr.tagName && curr.tagName.toLowerCase() === tagName.toLowerCase()) return curr;
    curr = curr.parentElement;
  }
  return null;
}

function toggleSubSuper(type) {
  const editor = document.getElementById('editor');
  editor.focus();
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return;

  const tagTarget = (type === 'subscript') ? 'sub' : 'sup';
  const existingTag = getAncestorTag(sel.anchorNode, tagTarget);

  if (existingTag) {
    const parent = existingTag.parentNode;
    while (existingTag.firstChild) parent.insertBefore(existingTag.firstChild, existingTag);
    parent.removeChild(existingTag);
  } else {
    const oppositeTag = (type === 'subscript') ? 'sup' : 'sub';
    const existingOpposite = getAncestorTag(sel.anchorNode, oppositeTag);
    if (existingOpposite) {
      const parent = existingOpposite.parentNode;
      while (existingOpposite.firstChild) parent.insertBefore(existingOpposite.firstChild, existingOpposite);
      parent.removeChild(existingOpposite);
    }
    document.execCommand(type, false, null);
  }

  updateToolbarFormatState();
  onEditorInput();
}

function SB_BoldClick() { document.execCommand('bold', false, null); updateToolbarFormatState(); onEditorInput(); }
function SB_ItalicClick() { document.execCommand('italic', false, null); updateToolbarFormatState(); onEditorInput(); }
function SB_UnderLineClick() { document.execCommand('underline', false, null); updateToolbarFormatState(); onEditorInput(); }
function SB_StrikeClick() { document.execCommand('strikeThrough', false, null); updateToolbarFormatState(); onEditorInput(); }

function SB_SuperScriptClick() { toggleSubSuper('superscript'); }
function SB_SubScriptClick() { toggleSubSuper('subscript'); }

function SB_ListClick() { document.execCommand('insertUnorderedList', false, null); onEditorInput(); }
function SB_OrderedListClick() { document.execCommand('insertOrderedList', false, null); onEditorInput(); }
function SB_SeparateClick() { document.execCommand('insertText', false, '********************************\n'); onEditorInput(); }

// ==========================================
// 🎨 文字色カラーマップ制御
// ==========================================
let savedColorRange = null;

function saveSelectionForColor() {
  const editor = document.getElementById('editor');
  const sel = window.getSelection();
  if (editor && sel && sel.rangeCount > 0 && editor.contains(sel.anchorNode)) {
    savedColorRange = sel.getRangeAt(0).cloneRange();
  }
}

function toggleColorPalette(e) {
  if (e) e.stopPropagation();
  const popup = document.getElementById('colorPalettePopup');
  if (!popup) return;

  if (popup.classList.contains('hidden')) {
    saveSelectionForColor();
    popup.classList.remove('hidden');
  } else {
    popup.classList.add('hidden');
  }
}

function closeColorPalette() {
  const popup = document.getElementById('colorPalettePopup');
  if (popup && !popup.classList.contains('hidden')) {
    popup.classList.add('hidden');
  }
}

function applyTextColor(colorHex, shouldClose = true) {
  const editor = document.getElementById('editor');
  if (editor) {
    editor.focus();
    // ネイティブカラーピッカー操作で選択範囲が外れていたら復元
    if (savedColorRange) {
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(savedColorRange);
    }
  }

  document.execCommand('foreColor', false, colorHex);

  // 適用後の選択範囲を再記憶（連続ドラッグ変更用）
  saveSelectionForColor();

  // ボタン下部のインジケーターバーを選択色に更新
  const bar = document.getElementById('btn_color_bar');
  if (bar) bar.style.backgroundColor = colorHex;

  if (shouldClose) {
    closeColorPalette();
  }
  updateToolbarFormatState();
  onEditorInput();
}

function resetTextColor() {
  const editor = document.getElementById('editor');
  if (editor) editor.focus();

  const isDark = document.body.classList.contains('dark-mode');
  const defaultColor = isDark ? '#d4d4d4' : '#111827';
  document.execCommand('foreColor', false, defaultColor);

  const bar = document.getElementById('btn_color_bar');
  if (bar) bar.style.backgroundColor = defaultColor;

  closeColorPalette();
  updateToolbarFormatState();
  onEditorInput();
}

// ==========================================
// 🖊 マーカー（ハイライト）カラーマップ制御
// ==========================================
function toggleHighlightPalette(e) {
  if (e) e.stopPropagation();
  closeColorPalette(); // 文字色パレットが開いていれば閉じる
  const popup = document.getElementById('highlightPalettePopup');
  if (!popup) return;

  if (popup.classList.contains('hidden')) {
    saveSelectionForColor();
    popup.classList.remove('hidden');
  } else {
    popup.classList.add('hidden');
  }
}

function closeHighlightPalette() {
  const popup = document.getElementById('highlightPalettePopup');
  if (popup && !popup.classList.contains('hidden')) {
    popup.classList.add('hidden');
  }
}

function applyHighlightColor(colorHex, shouldClose = true) {
  const editor = document.getElementById('editor');
  if (editor) {
    editor.focus();
    if (savedColorRange) {
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(savedColorRange);
    }
  }

  document.execCommand('hiliteColor', false, colorHex);
  saveSelectionForColor();

  const bar = document.getElementById('btn_highlight_bar');
  if (bar) bar.style.backgroundColor = colorHex;

  if (shouldClose) {
    closeHighlightPalette();
  }
  updateToolbarFormatState();
  onEditorInput();
}

function resetHighlightColor() {
  const editor = document.getElementById('editor');
  if (editor) editor.focus();

  document.execCommand('hiliteColor', false, 'transparent');

  const bar = document.getElementById('btn_highlight_bar');
  if (bar) bar.style.backgroundColor = 'transparent';

  closeHighlightPalette();
  updateToolbarFormatState();
  onEditorInput();
}

// パレット外クリックで閉じる（文字色・マーカー両方対応）
document.addEventListener('click', (e) => {
  const colorWrapper = document.getElementById('colorPickerWrapper');
  if (colorWrapper && !colorWrapper.contains(e.target)) {
    closeColorPalette();
  }
  const hlWrapper = document.getElementById('highlightPickerWrapper');
  if (hlWrapper && !hlWrapper.contains(e.target)) {
    closeHighlightPalette();
  }
  const boxWrapper = document.getElementById('boxPickerWrapper');
  if (boxWrapper && !boxWrapper.contains(e.target)) {
    closeBoxPalette();
  }
});

function updateToolbarFormatState() {
  const editor = document.getElementById('editor');
  const sel = window.getSelection();
  if (!sel || !sel.anchorNode || !editor.contains(sel.anchorNode)) return;

  // カーソル位置の実際のフォントサイズと文字色をツールバーに反映
  try {
    let node = sel.anchorNode;
    if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;
    if (node && editor.contains(node)) {
      const computed = window.getComputedStyle(node);

      // 1. フォントサイズの反映
      const pxVal = parseFloat(computed.fontSize);
      if (pxVal) {
        const ptVal = Math.round(pxVal * 0.75);
        const editSize = document.getElementById('Edit_Size');
        if (editSize && ptVal) {
          editSize.value = ptVal;
        }
      }

      // 2. 文字色のリアルタイム反映（Aボタンの下線バー）
      if (computed.color) {
        const colorBar = document.getElementById('btn_color_bar');
        if (colorBar) {
          colorBar.style.backgroundColor = computed.color;
        }
      }

      // 3. ★ マーカー色のリアルタイム反映（🖊ボタンの下線バー）
      const hlBar = document.getElementById('btn_highlight_bar');
      if (hlBar) {
        let detectedBg = 'transparent';
        let curr = node;
        while (curr && curr !== editor) {
          const bg = window.getComputedStyle(curr).backgroundColor;
          if (bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)') {
            detectedBg = bg;
            break;
          }
          curr = curr.parentElement;
        }
        hlBar.style.backgroundColor = detectedBg;
      }
      
      // 4. ★ ボックス色のリアルタイム反映（▭ボタンの下線バー）
      const boxBar = document.getElementById('btn_box_bar');
      if (boxBar) {
        let detectedBoxColor = (typeof currentBoxBorderColor !== 'undefined') ? currentBoxBorderColor : '#0d9488';
        let curr = node;
        while (curr && curr !== editor) {
          if (curr.classList && curr.classList.contains('box-wrapper')) {
            const bColor = window.getComputedStyle(curr).borderLeftColor;
            if (bColor && bColor !== 'transparent' && bColor !== 'rgba(0, 0, 0, 0)') {
              detectedBoxColor = bColor;
            }
            break;
          }
          curr = curr.parentElement;
        }
        boxBar.style.backgroundColor = detectedBoxColor;
      }      

    }
  } catch (e) {}

  const setBtnActive = (btnId, isActive) => {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    if (isActive) {
      btn.classList.add('bg-sky-200', 'text-sky-950', 'ring-1', 'ring-sky-400');
      btn.classList.remove('hover:bg-gray-300');
    } else {
      btn.classList.remove('bg-sky-200', 'text-sky-950', 'ring-1', 'ring-sky-400');
      btn.classList.add('hover:bg-gray-300');
    }
  };

  setBtnActive('btn_bold', document.queryCommandState('bold'));
  setBtnActive('btn_italic', document.queryCommandState('italic'));
  setBtnActive('btn_underline', document.queryCommandState('underline'));
  setBtnActive('btn_strike', document.queryCommandState('strikeThrough'));
  setBtnActive('btn_superscript', document.queryCommandState('superscript') || isInsideTag(sel.anchorNode, 'sup'));
  setBtnActive('btn_subscript', document.queryCommandState('subscript') || isInsideTag(sel.anchorNode, 'sub'));
}

async function SB_RingCurrentClick() {
  const statusElem = document.getElementById('statusText');
  if (statusElem) statusElem.textContent = "リング電流値を取得中(OCR)...";
  const now = new Date();
  const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  try {
    const res = await fetch(`${API_BASE}/ring_current?account=${currentAccountName}`);
    const data = await res.json();
    const currentVal = data.current || "---.- mA";
    const facility = data.facility || "Ring";

    const editor = document.getElementById('editor');
    editor.focus();
    document.execCommand('insertText', false, `[${timeStr} ${facility}:${currentVal}] `);
    if (statusElem) statusElem.textContent = `${facility} 電流取得完了: ${currentVal}`;
  } catch (e) {
    const editor = document.getElementById('editor');
    editor.focus();
    document.execCommand('insertText', false, `[${timeStr} Ring: ---.- mA] `);
    if (statusElem) statusElem.textContent = `取得失敗`;
  }
  onEditorInput();
}

// ==========================================
// ⏰ タイムスタンプ [HH:MM] 挿入
// ==========================================
function SB_TimeClick() {
  const now = new Date();
  const y = now.getFullYear();
  const mo = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const h = String(now.getHours()).padStart(2, '0');
  const m = String(now.getMinutes()).padStart(2, '0');
  const timeStr = `[${y}/${mo}/${d} ${h}:${m}] `;

  const editor = document.getElementById('editor');
  if (editor) {
    editor.focus();
    document.execCommand('insertText', false, timeStr);
    onEditorInput();
  }
}

// ==========================================
// ▭ ボックス（枠囲み）カラーマップ制御
// ==========================================
let currentBoxBorderColor = '#0d9488';
let currentBoxBgColor = '#f0fdfa';

function getCurrentBoxWrapper() {
  const editor = document.getElementById('editor');
  const sel = window.getSelection();
  if (!editor || !sel || !sel.rangeCount) return null;
  let node = sel.anchorNode;
  if (!node || !editor.contains(node)) return null;

  let curr = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  while (curr && curr !== editor) {
    if (curr.classList && curr.classList.contains('box-wrapper')) return curr;
    curr = curr.parentElement;
  }
  return null;
}

function toggleBoxPalette(e) {
  if (e) e.stopPropagation();
  closeColorPalette();
  closeHighlightPalette();
  const popup = document.getElementById('boxPalettePopup');
  if (!popup) return;

  if (popup.classList.contains('hidden')) {
    saveSelectionForColor();
    popup.classList.remove('hidden');
  } else {
    popup.classList.add('hidden');
  }
}

function closeBoxPalette() {
  const popup = document.getElementById('boxPalettePopup');
  if (popup && !popup.classList.contains('hidden')) {
    popup.classList.add('hidden');
  }
}

function applyBoxColor(borderColor, bgColor, shouldClose = true) {
  const editor = document.getElementById('editor');
  if (!editor) return;
  editor.focus();

  if (savedColorRange) {
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(savedColorRange);
  }

  currentBoxBorderColor = borderColor;
  currentBoxBgColor = bgColor;

  const bar = document.getElementById('btn_box_bar');
  if (bar) bar.style.backgroundColor = borderColor;

  // すでにボックス内にカーソルがある場合は、そのボックスの色だけを変更
  const existingBox = getCurrentBoxWrapper();
  if (existingBox) {
    existingBox.style.borderLeftColor = borderColor;
    existingBox.style.backgroundColor = bgColor;
    if (shouldClose) closeBoxPalette();
    onEditorInput();
    return;
  }

  // 新規ボックスを作成して挿入
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return;
  const range = sel.getRangeAt(0);

  const box = document.createElement('div');
  box.className = 'box-wrapper';
  box.style.cssText = `border-left: 4px solid ${borderColor}; background-color: ${bgColor}; padding: 8px 12px; margin: 8px 0; font-family: monospace; font-size: 13px; line-height: 1.5; color: #1f2937; border-radius: 2px;`;

  if (range.collapsed) {
    box.innerHTML = 'テキストを入力...';
    range.insertNode(box);
  } else {
    box.appendChild(range.extractContents());
    range.insertNode(box);
  }

  // 作成したボックスの直後にカーソルを合わせ、色ピッカー連続操作にも対応
  const newRange = document.createRange();
  newRange.selectNodeContents(box);
  sel.removeAllRanges();
  sel.addRange(newRange);
  saveSelectionForColor();

  if (shouldClose) closeBoxPalette();
  onEditorInput();
}

// 🎨 カスタムカラー選択時は、選んだ濃色から淡いパステル背景色を自動計算
function applyCustomBoxColor(hexColor, shouldClose = true) {
  const r = parseInt(hexColor.slice(1, 3), 16);
  const g = parseInt(hexColor.slice(3, 5), 16);
  const b = parseInt(hexColor.slice(5, 7), 16);
  // 白(255)を92%ブレンドして読みやすい淡色背景を生成
  const lr = Math.round(r + (255 - r) * 0.92);
  const lg = Math.round(g + (255 - g) * 0.92);
  const lb = Math.round(b + (255 - b) * 0.92);
  const lightBg = `#${lr.toString(16).padStart(2, '0')}${lg.toString(16).padStart(2, '0')}${lb.toString(16).padStart(2, '0')}`;

  applyBoxColor(hexColor, lightBg, shouldClose);
}

function unwrapCurrentBox() {
  const editor = document.getElementById('editor');
  if (editor) editor.focus();

  const existingBox = getCurrentBoxWrapper();
  if (existingBox) {
    const parent = existingBox.parentNode;
    while (existingBox.firstChild) {
      parent.insertBefore(existingBox.firstChild, existingBox);
    }
    parent.removeChild(existingBox);
    onEditorInput();
  }
  closeBoxPalette();
}

function toggleDarkMode() {
  document.body.classList.toggle('dark-mode');
  const isDark = document.body.classList.contains('dark-mode');
  localStorage.setItem('ain2_theme_dark', isDark ? 'true' : 'false');
  const btn = document.getElementById('btn_theme');
  if (btn) btn.textContent = isDark ? '☀️' : '🌓';
}

// ==========================================
// 画像リサイズ ＆ ドラッグ移動
// ==========================================
function updateResizerPosition() {
  if (!targetImage) return;
  const resizer = document.getElementById('imageResizer');
  const editor = document.getElementById('editor');
  const rect = targetImage.getBoundingClientRect();
  const parentRect = editor.parentElement.getBoundingClientRect();

  resizer.style.left = `${rect.left - parentRect.left + editor.parentElement.scrollLeft}px`;
  resizer.style.top = `${rect.top - parentRect.top + editor.parentElement.scrollTop}px`;
  resizer.style.width = `${rect.width}px`;
  resizer.style.height = `${rect.height}px`;
  resizer.classList.remove('hidden');
}

function deleteSelectedImage() {
  if (!targetImage) return;
  const editorElem = document.getElementById('editor');
  editorElem.focus();
  const sel = window.getSelection();
  const range = document.createRange();
  range.selectNode(targetImage);
  sel.removeAllRanges();
  sel.addRange(range);
  document.execCommand('delete', false, null);
  targetImage = null;
  const resizer = document.getElementById('imageResizer');
  if (resizer) resizer.classList.add('hidden');
  onEditorInput();
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>"']/g, m => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[m]));
}

// ==========================================
// アカウント管理
// ==========================================
function updateAccountAvatarBadge(accountName) {
  const badge = document.getElementById('account_avatar_badge');
  if (!badge) return;

  const name = (accountName && typeof accountName === 'string') ? accountName.trim() : 'default';
  badge.textContent = name.charAt(0).toUpperCase();

  // アカウント名の文字列から安定したカラーパレットを自動割り当て
  const palette = ['#0d9488', '#2563eb', '#059669', '#d97706', '#7c3aed'];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  badge.style.backgroundColor = palette[Math.abs(hash) % palette.length];
}

async function loadAccountsList() {
  const sel = document.getElementById('sel_account');
  if (!sel) return;

  try {
    const res = await fetch(`${API_BASE}/accounts`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    // undefined や null、空文字を除外してフィルタリング
    const rawAccounts = Array.isArray(data.accounts) ? data.accounts : ["default"];
    const accounts = rawAccounts.filter(acc => 
      acc && typeof acc === "string" && acc !== "undefined" && acc !== "null"
    );

    if (accounts.length === 0) accounts.push("default");

    let current = data.current_account;
    if (!current || current === "undefined" || current === "null" || !accounts.includes(current)) {
      current = accounts[0];
    }
    currentAccountName = current;
    updateAccountAvatarBadge(currentAccountName);

    sel.innerHTML = '';
    accounts.forEach(acc => {
      const opt = document.createElement('option');
      opt.value = acc;
      opt.textContent = acc;
      if (acc === currentAccountName) opt.selected = true;
      sel.appendChild(opt);
    });

    if (!data.max_reached) {
      const newOpt = document.createElement('option');
      newOpt.value = "__NEW__";
      newOpt.textContent = "+ 新規作成...";
      sel.appendChild(newOpt);
    }
  } catch (e) {
    console.error("Accounts load failed:", e);
    currentAccountName = "default";
    sel.innerHTML = `
      <option value="default" selected>default</option>
      <option value="__NEW__">+ 新規作成...</option>
    `;
  }
}

async function handleAccountChange(selectedVal) {
  if (selectedVal === "__NEW__") {
    document.getElementById('sel_account').value = currentAccountName;
    openNewAccountModal();
    return;
  }
  if (selectedVal === currentAccountName) return;

  if (isModified) await SB_SaveClick(false);

  try {
    const res = await fetch(`${API_BASE}/accounts/switch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ account: selectedVal })
    });
    if (!res.ok) throw new Error("切替に失敗しました");
    currentAccountName = selectedVal;
    updateAccountAvatarBadge(currentAccountName);
    await refreshLogDates();
    await loadLogForDate(currentDate);
    document.getElementById('statusText').textContent = `アカウント切替: ${selectedVal}`;
  } catch (e) {
    alert(e.message);
    document.getElementById('sel_account').value = currentAccountName;
  }
}

function openNewAccountModal() {
  const input = document.getElementById('input_new_account');
  input.value = '';
  document.getElementById('modalNewAccount').classList.remove('hidden');
  setTimeout(() => input.focus(), 50);
}

function closeNewAccountModal() {
  document.getElementById('modalNewAccount').classList.add('hidden');
}

async function submitNewAccount() {
  const val = document.getElementById('input_new_account').value.trim();
  if (!val) return;

  try {
    const res = await fetch(`${API_BASE}/accounts/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ account: val })
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || "作成失敗");
    }
    closeNewAccountModal();
    await loadAccountsList();
    await refreshLogDates();
    await loadLogForDate(currentDate);
  } catch (e) {
    alert(e.message);
  }
}

// ==========================================
// 独立ウィンドウ連携 (Memo, Calc, Proto, Eli)
// ==========================================
async function openSubWindow(endpoint, fallbackUrl, winName) {
  try {
    await fetch(`${API_BASE}${endpoint}`, { method: "POST" });
  } catch (e) {
    window.open(fallbackUrl, winName);
  }
}

function SB_MemoClick() { openSubWindow('/open_memo_window', '/memo', 'AIN_Memo'); }
function SB_CalcClick() { openSubWindow('/open_calc_window', '/calc', 'AIN_Calc'); }


// ==========================================
// ⚙️ オプションダイアログ制御（履歴管理＆APIキー完全保持版）
// ==========================================

async function openOptionModal() {
  try {
    const res = await fetch(`${API_BASE}/config?account=${encodeURIComponent(currentAccountName)}`);
    const cfg = await res.json();

    // General
    document.getElementById('opt_font_size').value = cfg.default_font_size || 12;
    document.getElementById('opt_auto_save_min').value = cfg.auto_save_interval_min || 5;
    document.getElementById('opt_imagej_path').value = cfg.imagej_path || '';
    document.getElementById('opt_help_file').value = cfg.help_file || './AIN2_Manual_JP.pdf';

    const langSel = document.getElementById('opt_language');
    if (langSel) langSel.value = cfg.language || 'ja';

    document.getElementById('opt_backup_on_exit').checked = !!cfg.backup_on_exit;
    document.getElementById('opt_backup_dest_dir').value = cfg.backup_dest_dir || '';

    // Ring（古い opt_ring_url_sagals 等への代入は削除し、新形式リストへ渡す）
    let ringFacilities = cfg.ring_facilities;
    if (!Array.isArray(ringFacilities) || ringFacilities.length === 0) {
      ringFacilities = [
        { name: "SAGA-LS", url: cfg.ring_url_sagals || "https://www.saga-ls.jp/acc/accstatus.jpg" },
        { name: "SPring-8", url: cfg.ring_url_spring8 || "https://spring8.jp/status/sr_status_en.png" },
        { name: "PF", url: cfg.ring_url_pf || "https://www-pfring.kek.jp/PF/status/pf_status.png" }
      ];
    }
    renderRingFacilityList(ringFacilities, cfg.ring_facility || "SAGA-LS");

  } catch (e) {
    console.warn("Config load failed", e);
    renderRingFacilityList(null, "SAGA-LS");
  }

  document.getElementById('modalOption').classList.remove('hidden');
  if (typeof setAppLanguage === 'function') {
    setAppLanguage(typeof currentAppLanguage !== 'undefined' ? currentAppLanguage : 'ja', false);
  }
  updateRingTabI18n();
}

function closeOptionModal() {
  document.getElementById('modalOption').classList.add('hidden');
}

async function saveOptionModal() {
  const autoSaveMin = Math.max(1, parseInt(document.getElementById('opt_auto_save_min').value, 10) || 5);
  const langEl = document.getElementById('opt_language');
  const selectedLang = (langEl && langEl.value) ? langEl.value : 'ja';

  const ringRows = document.querySelectorAll('#ringFacilityListContainer .ring-facility-row');
  const ringFacilities = [];
  ringRows.forEach(row => {
    const name = row.querySelector('.ring-fac-name').value.trim();
    const url = row.querySelector('.ring-fac-url').value.trim();
    if (name) {
      ringFacilities.push({ name, url });
    }
  });

  const activeRingName = document.getElementById('opt_ring_facility').value;
  const activeRingObj = ringFacilities.find(f => f.name === activeRingName) || ringFacilities[0] || { name: "", url: "" };

  const cfg = {
    account_name: currentAccountName,
    language: selectedLang,
    imagej_path: document.getElementById('opt_imagej_path').value.trim(),
    help_file: document.getElementById('opt_help_file').value.trim(),
    default_font_size: parseInt(document.getElementById('opt_font_size').value, 10),
    auto_save_interval_min: autoSaveMin,

    backup_on_exit: document.getElementById('opt_backup_on_exit').checked,
    backup_dest_dir: document.getElementById('opt_backup_dest_dir').value.trim(),

    // Ring 新形式（リスト）＆ 選択中施設のURLを直接参照用にも保存
    ring_facility: activeRingObj.name,
    ring_url: activeRingObj.url,
    ring_facilities: ringFacilities
  };

  try {
    const res = await fetch(`${API_BASE}/config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cfg)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    if (typeof window.setAppLanguage === 'function') {
      window.setAppLanguage(selectedLang);
    }

    alert(selectedLang === 'en' ? "Settings saved." : "設定を保存しました。");
    closeOptionModal();
  } catch (e) {
    alert("設定の保存に失敗しました: " + e.message);
  }
}


// ==========================================
// 💍 Ring 施設リスト動的編集ヘルパー（SAGA-LS 固定 ＋ 追加施設編集・日英対応）
// ==========================================
const FIXED_SAGA_LS = {
  name: "SAGA-LS",
  url: "https://www.saga-ls.jp/acc/accstatus.jpg"
};

const DEFAULT_EXTRA_FACILITIES = [
  { name: "SPring-8", url: "https://spring8.jp/status/sr_status_en.png" },
  { name: "PF", url: "https://www-pfring.kek.jp/PF/status/pf_status.png" }
];

function updateRingTabI18n() {
  const isEn = (typeof currentAppLanguage !== 'undefined' && currentAppLanguage === 'en');

  const lblActive = document.getElementById('lbl_ring_active');
  if (lblActive) lblActive.textContent = isEn ? "💍 Active Facility" : "💍 使用施設 (Active Facility)";

  const lblTitle = document.getElementById('lbl_ring_list_title');
  if (lblTitle) lblTitle.textContent = isEn ? "Registered Facilities (Name / Status Image URL)" : "登録施設リスト（施設名 / ステータス画像URL）";

  const btnAdd = document.getElementById('btn_add_ring_facility');
  if (btnAdd) btnAdd.textContent = isEn ? "+ Add Facility" : "+ 施設を追加";

  // 既に描画済みの追加行の placeholder / title も更新
  document.querySelectorAll('#ringFacilityListContainer .ring-fac-name:not([readonly])').forEach(inp => {
    inp.placeholder = isEn ? "Name (e.g. ESRF)" : "施設名 (例: ESRF)";
  });
  document.querySelectorAll('#ringFacilityListContainer .ring-del-btn').forEach(btn => {
    btn.title = isEn ? "Remove" : "削除";
  });
  document.querySelectorAll('#ringFacilityListContainer .ring-lock-icon').forEach(sp => {
    sp.title = isEn ? "SAGA-LS Default (Fixed)" : "SAGA-LS 標準固定";
  });
}

function renderRingFacilityList(facilities, activeName) {
  const container = document.getElementById('ringFacilityListContainer');
  if (!container) return;
  container.innerHTML = '';

  // 1行目: SAGA-LS を固定で追加
  addRingFacilityRow(FIXED_SAGA_LS.name, FIXED_SAGA_LS.url, false, true);

  // 2行目以降: SAGA-LS 以外の施設を描画
  const extras = (Array.isArray(facilities) && facilities.length > 0)
    ? facilities.filter(item => item.name !== FIXED_SAGA_LS.name)
    : JSON.parse(JSON.stringify(DEFAULT_EXTRA_FACILITIES));

  extras.forEach((item) => {
    addRingFacilityRow(item.name, item.url, false, false);
  });

  syncActiveRingFacilitySelect(activeName || FIXED_SAGA_LS.name);
  updateRingTabI18n();
}

function addRingFacilityRow(name = "", url = "", shouldSync = true, isFixed = false) {
  const container = document.getElementById('ringFacilityListContainer');
  if (!container) return;

  const isEn = (typeof currentAppLanguage !== 'undefined' && currentAppLanguage === 'en');
  const row = document.createElement('div');
  row.className = isFixed
    ? "ring-facility-row flex items-center space-x-1 bg-teal-50/70 p-1 rounded border border-teal-300"
    : "ring-facility-row flex items-center space-x-1 bg-white p-1 rounded border border-gray-300";

  if (isFixed) {
    const lockTip = isEn ? "SAGA-LS Default (Fixed)" : "SAGA-LS 標準固定";
    row.innerHTML = `
      <input type="text" readonly value="${escapeHtml(name)}"
        class="ring-fac-name w-24 border border-teal-200 bg-teal-100/60 text-teal-900 rounded px-1.5 py-0.5 text-xs font-bold outline-none cursor-default">
      <input type="text" readonly value="${escapeHtml(url)}"
        class="ring-fac-url flex-1 border border-teal-200 bg-teal-100/60 text-teal-800 rounded px-1.5 py-0.5 text-xs font-mono outline-none cursor-default">
      <span title="${lockTip}" class="ring-lock-icon w-5 h-5 flex items-center justify-center text-teal-600 text-[11px] select-none">🔒</span>
    `;
  } else {
    const namePh = isEn ? "Name (e.g. ESRF)" : "施設名 (例: ESRF)";
    const delTip = isEn ? "Remove" : "削除";
    row.innerHTML = `
      <input type="text" placeholder="${namePh}" value="${escapeHtml(name)}"
        oninput="syncActiveRingFacilitySelect()"
        class="ring-fac-name w-24 border border-gray-300 rounded px-1.5 py-0.5 text-xs font-bold outline-none focus:border-teal-500">
      <input type="text" placeholder="https://.../status.png" value="${escapeHtml(url)}"
        class="ring-fac-url flex-1 border border-gray-300 rounded px-1.5 py-0.5 text-xs font-mono outline-none focus:border-teal-500">
      <button type="button" onclick="removeRingFacilityRow(this)" title="${delTip}"
        class="ring-del-btn w-5 h-5 flex items-center justify-center text-gray-400 hover:text-red-600 hover:bg-red-50 rounded font-bold text-xs">✕</button>
    `;
  }

  container.appendChild(row);
  if (shouldSync) {
    syncActiveRingFacilitySelect();
    container.scrollTop = container.scrollHeight;
  }
}

function removeRingFacilityRow(btn) {
  const row = btn.closest('.ring-facility-row');
  if (row) {
    row.remove();
    syncActiveRingFacilitySelect();
  }
}

function syncActiveRingFacilitySelect(preferredActive = null) {
  const sel = document.getElementById('opt_ring_facility');
  const container = document.getElementById('ringFacilityListContainer');
  if (!sel || !container) return;

  const currentVal = preferredActive !== null ? preferredActive : sel.value;
  const nameInputs = container.querySelectorAll('.ring-fac-name');

  sel.innerHTML = '';
  let matched = false;

  nameInputs.forEach(inp => {
    const val = inp.value.trim();
    if (!val) return;
    const opt = document.createElement('option');
    opt.value = val;
    opt.textContent = val;
    if (val === currentVal) {
      opt.selected = true;
      matched = true;
    }
    sel.appendChild(opt);
  });

  if (!matched && sel.options.length > 0) {
    sel.options[0].selected = true;
  }
}
// ==========================================
// 🚀 アプリケーション統合初期化リスナー (DOMContentLoaded)
// ==========================================
window.addEventListener('DOMContentLoaded', () => {
  const editor = document.getElementById('editor');
  const resizer = document.getElementById('imageResizer');
  const handle = document.getElementById('resizeHandle');
  const dragHandle = document.getElementById('dragHandle');

  // 1. テーマ（ダークモード）復元
  if (localStorage.getItem('ain2_theme_dark') === 'true') {
    document.body.classList.add('dark-mode');
    const btn = document.getElementById('btn_theme');
    if (btn) btn.textContent = '☀️';
  }

  // 2. アカウント・ログ日付・初期ログの読み込み
  loadAccountsList().then(() => {
    refreshLogDates().then(() => {
      const saved = localStorage.getItem('ain2_last_date');
      if (saved && saved.length === 8) {
        const y = parseInt(saved.substring(0, 4), 10);
        const m = parseInt(saved.substring(4, 6), 10) - 1;
        const d = parseInt(saved.substring(6, 8), 10);
        currentDate = new Date(y, m, d, 12, 0, 0);
      }
      updateDateUI();
      loadLogForDate(currentDate);
    });
  });

  // 3. 設定の取得（自動保存タイマー ＆ 言語の適用）
  fetch(`${API_BASE}/config?account=${currentAccountName}`)
    .then(res => res.json())
    .then(cfg => {
      const autoSaveMin = cfg.auto_save_interval_min || 5;
      setupAutoSaveTimer(autoSaveMin);

      if (cfg.language && typeof setAppLanguage === 'function') {
        setAppLanguage(cfg.language);
      }
    })
    .catch(() => {
      setupAutoSaveTimer(5);
    });

  // 4. エディタ：書式状態・キャレット位置の監視
  if (editor) {
    const onCaretOrSelectChange = () => {
      updateToolbarFormatState();
      // Fiji/挿入用のカーソル位置記録
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0 && editor.contains(sel.anchorNode)) {
        lastEditorSelectionRange = sel.getRangeAt(0).cloneRange();
      }
    };

    editor.addEventListener('mouseup', onCaretOrSelectChange);
    editor.addEventListener('keyup', onCaretOrSelectChange);
    editor.addEventListener('click', onCaretOrSelectChange);
    editor.addEventListener('focus', onCaretOrSelectChange);

    document.addEventListener('selectionchange', () => {
      const activeEl = document.activeElement;
      if (editor === activeEl || editor.contains(activeEl)) {
        updateToolbarFormatState();
      }
    });

    // 画像選択・描画確定
    editor.onclick = function(e) {
      if (resizer && resizer.contains(e.target)) return;

      if (e.target.tagName === 'IMG') {
        if (targetImage && targetImage !== e.target && typeof drawnShapes !== 'undefined' && drawnShapes.length > 0) {
          if (confirm("未確定の描画があります。画像に反映しますか？")) {
            commitDrawing(false);
          }
        }
        targetImage = e.target;
        updateResizerPosition();
        if (typeof selectDrawTool === 'function') {
          selectDrawTool(activeDrawTool || 'line');
        }
        return;
      }

      if (typeof drawnShapes !== 'undefined' && drawnShapes.length > 0) {
        if (confirm("描画がまだ確定されていません。画像に反映しますか？")) {
          commitDrawing(true);
        }
        return;
      }

      if (typeof removeDrawingOverlay === 'function') removeDrawingOverlay();
      targetImage = null;
      if (resizer) resizer.classList.add('hidden');
    };

    // 画像圧縮ヘルパー（旧AIN.htmlから復元）
    function compressImageFile(file, maxDimension = 1200, quality = 0.8) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
          const img = new Image();
          img.onload = () => {
            let width = img.width;
            let height = img.height;
            if (width > maxDimension || height > maxDimension) {
              if (width > height) {
                height = Math.round((height * maxDimension) / width);
                width = maxDimension;
              } else {
                width = Math.round((width * maxDimension) / height);
                height = maxDimension;
              }
            }
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            canvas.getContext('2d').drawImage(img, 0, 0, width, height);
            resolve(canvas.toDataURL('image/jpeg', quality));
          };
          img.onerror = reject;
          img.src = e.target.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
    }

    // 画像貼り付け (Paste)
    editor.addEventListener('paste', async (e) => {
      const clipboardData = e.clipboardData || window.clipboardData;
      if (!clipboardData) return;

      let imageBlob = null;
      if (clipboardData.items) {
        for (const item of clipboardData.items) {
          if (item.type.indexOf('image') === 0) {
            imageBlob = item.getAsFile();
            break;
          }
        }
      }
      if (!imageBlob && clipboardData.files && clipboardData.files.length > 0) {
        if (clipboardData.files[0].type.indexOf('image') === 0) {
          imageBlob = clipboardData.files[0];
        }
      }

      if (imageBlob) {
        e.preventDefault();
        try {
          const compressedBase64 = await compressImageFile(imageBlob, 1200, 0.8);
          editor.focus();
          const imgHtml = `<img src="${compressedBase64}" style="width: 320px; max-width: 100%; display: inline-block; margin: 4px 0;" class="resizable-img rounded shadow-sm">`;
          document.execCommand('insertHTML', false, imgHtml);
          onEditorInput();
        } catch (err) {
          console.error("Paste compression error:", err);
        }
      }
    });

    // 計算キー監視 (Cmd+Enter / Ctrl+Enter)
    editor.addEventListener('keydown', (e) => {
      if (typeof handleCalculationKeyDown === 'function') {
        handleCalculationKeyDown(e, editor, API_BASE, onEditorInput);
      }
    });

    // ブラウザ標準のドラッグ抑止
    editor.addEventListener('dragstart', (e) => {
      e.preventDefault();
      return false;
    });
  }

  // 5. 画像リサイズハンドル制御
  if (handle) {
    handle.addEventListener('mousedown', (e) => {
      if (!targetImage) return;
      e.preventDefault();
      e.stopPropagation();
      isResizing = true;
      startX = e.clientX;
      startWidth = targetImage.offsetWidth;
      document.body.style.userSelect = 'none';
    });

    window.addEventListener('mousemove', (e) => {
      if (!isResizing || !targetImage) return;
      const deltaX = e.clientX - startX;
      targetImage.style.width = `${Math.max(50, startWidth + deltaX)}px`;
      targetImage.style.height = 'auto';
      updateResizerPosition();
    });

    window.addEventListener('mouseup', () => {
      if (isResizing) {
        isResizing = false;
        document.body.style.userSelect = '';
        onEditorInput();
      }
    });
  }

  const deleteBtn = document.getElementById('deleteImageBtn');
  if (deleteBtn) {
    deleteBtn.onclick = (e) => {
      e.stopPropagation();
      deleteSelectedImage();
    };
  }

  // 5-2. 選択中画像のクリップボードコピー (Cmd+C / Ctrl+C)
  window.addEventListener('keydown', (e) => {
    if (!targetImage) return;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'c') {
      // エディタ内で文字が範囲選択されている場合は通常のテキストコピーを優先
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed && sel.toString().trim().length > 0) return;

      e.preventDefault();
      e.stopPropagation();

      try {
        // WebKitのユーザージェスチャー制限を回避するため、ClipboardItemにPromiseを直接渡す
        const pngBlobPromise = new Promise((resolve, reject) => {
          const canvas = document.createElement('canvas');
          canvas.width = targetImage.naturalWidth || targetImage.width;
          canvas.height = targetImage.naturalHeight || targetImage.height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(targetImage, 0, 0);
          canvas.toBlob((blob) => {
            if (blob) resolve(blob);
            else reject(new Error('PNG変換に失敗しました'));
          }, 'image/png');
        });

        navigator.clipboard.write([
          new ClipboardItem({ 'image/png': pngBlobPromise })
        ]).then(() => {
          const statusElem = document.getElementById('statusText');
          if (statusElem) statusElem.textContent = "📋 画像をクリップボードにコピーしました";
        }).catch((err) => {
          console.error("Clipboard write error:", err);
          alert("画像のコピーに失敗しました: " + err.message);
        });
      } catch (err) {
        console.error("Image copy error:", err);
      }
    }
  }, true);

  // ウィンドウがアクティブになった時・タブ復帰時に最新ログを確認
  window.addEventListener('focus', checkLatestLogOnActivate);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      checkLatestLogOnActivate();
    }
  });
  // 離席して戻った直後にエディタをクリックした時もチェック
  if (editor) {
    editor.addEventListener('pointerdown', checkLatestLogOnActivate);
  }

  // 6. 画像ドラッグ移動制御 (dragHandle)
  if (dragHandle && editor) {
    dragHandle.addEventListener('mousedown', (e) => {
      if (!targetImage) return;
      e.preventDefault();
      e.stopPropagation();

      let container = targetImage;
      let p = targetImage.parentElement;
      while (p && p !== editor) {
        if (p.tagName === 'DIV' && (p.style.margin || p.textContent.includes('📷'))) {
          container = p;
          break;
        }
        p = p.parentElement;
      }

      isMovingImage = true;
      movingBlockElem = container;
      movingBlockElem.style.opacity = '0.35';
      if (resizer) resizer.classList.add('hidden');
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'grabbing';
    });

    window.addEventListener('mousemove', (e) => {
      if (!isMovingImage || !movingBlockElem) return;
      e.preventDefault();

      let range = null;
      if (document.caretRangeFromPoint) {
        range = document.caretRangeFromPoint(e.clientX, e.clientY);
      } else if (document.caretPositionFromPoint) {
        const pos = document.caretPositionFromPoint(e.clientX, e.clientY);
        range = document.createRange();
        range.setStart(pos.offsetNode, pos.offset);
        range.collapse(true);
      }

      if (range && editor.contains(range.startContainer)) {
        if (!movingBlockElem.contains(range.startContainer)) {
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
        }
      }
    });

    window.addEventListener('mouseup', (e) => {
      if (!isMovingImage || !movingBlockElem) return;
      isMovingImage = false;
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      movingBlockElem.style.opacity = '1.0';

      let range = null;
      if (document.caretRangeFromPoint) {
        range = document.caretRangeFromPoint(e.clientX, e.clientY);
      } else if (document.caretPositionFromPoint) {
        const pos = document.caretPositionFromPoint(e.clientX, e.clientY);
        range = document.createRange();
        range.setStart(pos.offsetNode, pos.offset);
        range.collapse(true);
      }

      if (range && editor.contains(range.startContainer)) {
        if (!movingBlockElem.contains(range.startContainer)) {
          range.insertNode(movingBlockElem);
          targetImage = movingBlockElem.querySelector('img') || movingBlockElem;
          updateResizerPosition();
          onEditorInput();
        } else {
          updateResizerPosition();
        }
      } else {
        updateResizerPosition();
      }
      movingBlockElem = null;
    });
  }

  let loadedAddinsCache = [];

  async function loadDynamicAddins() {
    const container = document.getElementById('dynamic-addin-container');
    if (!container) return;

    try {
      const res = await fetch(`${API_BASE}/addins/list`);
      const data = await res.json();
      loadedAddinsCache = data.addins || [];
      renderDynamicAddinIcons();
    } catch (err) {
      console.warn("Failed to load add-ins:", err);
    }
  }

  function renderDynamicAddinIcons() {
    const container = document.getElementById('dynamic-addin-container');
    if (!container) return;
    container.innerHTML = '';

    const isEn = (typeof currentAppLanguage !== 'undefined' && currentAppLanguage === 'en');

    loadedAddinsCache.forEach(addin => {
      const btn = document.createElement('button');
      btn.className = "w-8 h-8 flex items-center justify-center hover:bg-sky-100 rounded transition-colors group relative";
      
      // 言語に応じたツールチップ
      const tip = isEn ? (addin.tooltip_en || addin.name_en || addin.name) 
                      : (addin.tooltip_ja || addin.name);
      btn.title = tip;

      if (addin.icon_svg) {
        btn.innerHTML = addin.icon_svg;
      } else if (addin.icon_img) {
        btn.innerHTML = `<img src="/addin_view/${addin.id}/${addin.icon_img}" class="w-5 h-5 object-contain">`;
      } else {
        btn.textContent = "🧩";
      }

      btn.onclick = () => {
        openSubWindow(`/addin/${addin.id}/open_window`, `/addin_page/${addin.id}`, `AIN_${addin.id}`);
      };

      container.appendChild(btn);
    });
  }

  // 🌟 言語変更ブロードキャストを受信したら、アドインのアイコンツールチップも即時更新
  const addinI18nChannel = new BroadcastChannel('ain_i18n_channel');
  addinI18nChannel.onmessage = (e) => {
    if (e.data && e.data.action === 'change_lang') {
      renderDynamicAddinIcons();
    }
  };
  loadDynamicAddins();
});

// ==========================================
// 🧩 汎用アドイン連携ブリッジ (ain_addin_bridge)
// ==========================================
const addinBridgeChannel = new BroadcastChannel('ain_addin_bridge');
addinBridgeChannel.onmessage = (event) => {
  const data = event.data;
  if (!data || !data.action) return;

  const editor = document.getElementById('editor');
  if (!editor) return;

  // 1. アドインから整形済みHTMLをカーソル位置へ挿入
  if (data.action === 'insert_html' && data.html) {
    editor.focus();
    document.execCommand('insertHTML', false, data.html);
    onEditorInput();
  }
  // 2. アドインからプレーンテキストをカーソル位置へ挿入
  else if (data.action === 'insert_text' && data.text) {
    editor.focus();
    document.execCommand('insertText', false, data.text);
    onEditorInput();
  }
  // 3. アドインからの要求に応じて、現在エディタで選択中のテキストを返す（Eli等向け汎用機能）
  else if (data.action === 'request_selection') {
    const sel = window.getSelection();
    let selectedText = "";
    if (sel && sel.rangeCount > 0 && editor.contains(sel.anchorNode)) {
      selectedText = sel.toString().trim();
    }
    addinBridgeChannel.postMessage({
      action: 'response_selection',
      request_id: data.request_id || null,
      text: selectedText
    });
  }
};

// ==========================================
// ✥ 画像のドラッグ移動 ＆ 🔬 Fiji 起動制御（安定版）
// ==========================================
let isMovingImage = false;
let movingBlockElem = null;

// B. 🔬 Fiji 起動関数
async function launchImageJForSelectedImage(e) {
  if (e) {
    e.preventDefault();
    e.stopPropagation();
  }
  if (!targetImage) return;

  const sessionId = "ain_ij_" + Date.now();
  targetImage.setAttribute("data-ij-session", sessionId);
  const statusText = document.getElementById('statusText');
  if (statusText) statusText.textContent = "ImageJ/Fiji を起動中...";

  try {
    let imageDataUrl = targetImage.src;
    if (!imageDataUrl.startsWith("data:image/")) {
      const canvas = document.createElement("canvas");
      canvas.width = targetImage.naturalWidth || targetImage.width;
      canvas.height = targetImage.naturalHeight || targetImage.height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(targetImage, 0, 0);
      imageDataUrl = canvas.toDataURL("image/png");
    }

    const res = await fetch(`${API_BASE}/imagej/open`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: sessionId,
        image_data: imageDataUrl,
        account: currentAccountName
      })
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.detail || `HTTP ${res.status}`);
    }

    if (statusText) statusText.textContent = "Fiji起動完了 (AINは自由にご使用いただけます)";
  } catch (err) {
    alert("ImageJの起動に失敗しました:\n" + err.message);
    if (statusText) statusText.textContent = "ImageJ起動エラー";
    targetImage.removeAttribute("data-ij-session");
  }
}

// ==========================================
// 🔬 Fiji (ImageJ) から画像＆履歴ログを取り込み
// ==========================================
let lastEditorSelectionRange = null;


// 左サイドバーの Fiji アイコンクリック時の処理
async function insertFijiResultAtCursor() {
  const editorElem = document.getElementById('editor');
  const statusText = document.getElementById('statusText');
  if (statusText) statusText.textContent = "Fijiから最新画像と操作ログを取得中...";

  try {
    const acc = (typeof currentAccountName === "string" && currentAccountName.trim()) 
      ? currentAccountName.trim() 
      : "default";

    // サーバーから最新同期画像とRecorderログを取得
    const res = await fetch(`${API_BASE}/imagej/fetch_active?account=${encodeURIComponent(acc)}`);
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.detail || `HTTP ${res.status}`);
    }

    const data = await res.json();
    editorElem.focus();

    // 🌟 記憶していたカーソル位置を復元（なければ末尾）
    const sel = window.getSelection();
    sel.removeAllRanges();
    if (lastEditorSelectionRange && editorElem.contains(lastEditorSelectionRange.commonAncestorContainer)) {
      sel.addRange(lastEditorSelectionRange);
    } else {
      const range = document.createRange();
      range.selectNodeContents(editorElem);
      range.collapse(false); // 末尾へ
      sel.addRange(range);
    }

    const timeStr = data.timestamp || "Processed";

// 🌟 タイトルと操作履歴を1つの緑枠内にまとめた形式
    const insertHtml = `
      <div style="margin: 12px 0;">
        <!-- 操作履歴ログ枠（タイトル・履歴を一体化） -->
        <div class="box-wrapper" style="border-left: 4px solid #059669; background-color: #f0fdf4; padding: 8px 12px; margin: 0 0 8px 0; font-family: monospace; font-size: 11px; line-height: 1.5; color: #166534; white-space: pre-wrap; border-radius: 2px;"><b>🔬 ImageJ (Fiji) Result [${timeStr}]</b>
<b>[History Log]</b>
${escapeHtml(data.log_text || "（操作ログなし）")}</div>

        <!-- 最終画像 -->
        <div style="margin: 0; padding: 0;">
          <img src="${data.image_data}" style="width: 380px; max-width: 100%; display: block; margin: 0;" class="resizable-img rounded shadow-sm">
        </div>
      </div>
      <div><br></div>
    `;


    document.execCommand('insertHTML', false, insertHtml);
    onEditorInput();

    if (statusText) statusText.textContent = "Fijiの処理結果を取り込みました";
  } catch (err) {
    console.error("Fiji fetch error:", err);
    alert("Fijiからの取り込みに失敗しました:\n" + err.message);
    if (statusText) statusText.textContent = "取り込み失敗";
  }
}
// ==========================================
// ⏱️ 自動保存タイマー制御
// ==========================================
function setupAutoSaveTimer(intervalMinutes = 5) {
  if (autoSaveTimerId) {
    clearInterval(autoSaveTimerId);
    autoSaveTimerId = null;
  }

  const mins = Math.max(1, parseInt(intervalMinutes, 10) || 5);
  const intervalMs = mins * 60 * 1000;

  autoSaveTimerId = setInterval(async () => {
    if (isModified) {
      const isEn = (typeof currentAppLanguage !== 'undefined' && currentAppLanguage === 'en');
      const saveStatus = document.getElementById('saveStatus');
      if (saveStatus) saveStatus.textContent = isEn ? "Auto-saving..." : "自動保存中...";
      await SB_SaveClick(false);
      if (saveStatus) saveStatus.textContent = isEn ? "Auto-saved" : "自動保存済";
    }
  }, intervalMs);
}

// ==========================================
// ⚙️ オプションダイアログ制御
// ==========================================

function switchOptionTab(tabName) {
  ['General', 'Ring'].forEach(t => {
    const pane = document.getElementById(`tab_${t}`);
    const btn = document.getElementById(`tabBtn_${t}`);
    if (pane) pane.classList.add('hidden');
    if (btn) {
      btn.classList.remove('bg-[#eae6ea]', 'border-t', 'border-l', 'border-r', 'border-gray-400', 'font-bold');
      btn.classList.add('bg-gray-200', 'border-b', 'border-gray-300', 'text-gray-600');
    }
  });

  const activePane = document.getElementById(`tab_${tabName}`);
  const activeBtn = document.getElementById(`tabBtn_${tabName}`);
  if (activePane) activePane.classList.remove('hidden');
  if (activeBtn) {
    activeBtn.classList.add('bg-[#eae6ea]', 'border-t', 'border-l', 'border-r', 'border-gray-400', 'font-bold');
    activeBtn.classList.remove('bg-gray-200', 'border-b', 'border-gray-300', 'text-gray-600');
  }

  if (typeof setAppLanguage === 'function') {
    setAppLanguage(typeof currentAppLanguage !== 'undefined' ? currentAppLanguage : 'ja', false);
  }

  updateRingTabI18n();
}

async function pickHelpFile() {
  try {
    const res = await fetch(`${API_BASE}/select_file`, { method: "POST" });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.detail || errData.error || `HTTP ${res.status}`);
    }
    const data = await res.json();
    if (data.file) {
      document.getElementById('opt_help_file').value = data.file;
    }
  } catch (e) {
    console.error("pickHelpFile Error:", e);
    alert("ファイル選択ダイアログの呼び出しに失敗しました:\n" + e.message);
  }
}

async function pickBackupFolder() {
  const isEn = (typeof currentAppLanguage !== 'undefined' && currentAppLanguage === 'en');
  try {
    const res = await fetch(`${API_BASE}/select_folder`, { method: "POST" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.folder) {
      document.getElementById('opt_backup_dest_dir').value = data.folder.replace(/\/$/, '');
    }
  } catch (e) {
    alert(isEn ? "Failed to open folder selection dialog." : "フォルダ選択ダイアログの呼び出しに失敗しました。");
  }
}

async function pickImageJPath() {
  try {
    const res = await fetch(`${API_BASE}/select_app_file`, { method: "POST" });
    const data = await res.json();
    if (data.file) {
      document.getElementById('opt_imagej_path').value = data.file;
    }
  } catch (e) {
    alert("ファイル選択ダイアログの呼び出しに失敗しました。");
  }
}

// ==========================================
// ℹ️ About (ロゴ表示) モーダル制御
// ==========================================
function SB_InfoClick() {
  document.getElementById('modalAbout').classList.remove('hidden');
}

function closeAboutModal() {
  document.getElementById('modalAbout').classList.add('hidden');
}

async function openHelpFromAbout() {
  try {
    await fetch(`${API_BASE}/open_help`);
  } catch (e) {
    alert("ヘルプPDFを開けませんでした。");
  }
}


// ==========================================
// 🚪 終了ダイアログ制御
// ==========================================
function openQuitModal() {
  if (typeof setAppLanguage === 'function') {
    setAppLanguage(typeof currentAppLanguage !== 'undefined' ? currentAppLanguage : 'ja', false);
  }
  const modal = document.getElementById('modalQuit');
  if (modal) modal.classList.remove('hidden');
}

function closeQuitModal() {
  const modal = document.getElementById('modalQuit');
  if (modal) modal.classList.add('hidden');
  const editor = document.getElementById('editor');
  if (editor) editor.focus();
}

async function confirmQuitWithSave() {
  if (typeof drawnShapes !== 'undefined' && drawnShapes.length > 0) {
    commitDrawing(true);
  }
  const isEn = (typeof currentAppLanguage !== 'undefined' && currentAppLanguage === 'en');
  const statusText = document.getElementById('statusText');
  if (statusText) statusText.textContent = isEn ? "Saving and backing up..." : "保存およびバックアップ中...";
  await SB_SaveClick(false);
  isModified = false;
  try {
    await fetch(`${API_BASE}/app_quit`, { method: "POST" });
  } catch (e) {}
  window.close();
}

async function confirmQuitWithoutSave() {
  isModified = false;
  const isEn = (typeof currentAppLanguage !== 'undefined' && currentAppLanguage === 'en');
  const statusText = document.getElementById('statusText');
  if (statusText) statusText.textContent = isEn ? "Closing and backing up..." : "終了処理およびバックアップ中...";
  try {
    await fetch(`${API_BASE}/app_quit`, { method: "POST" });
  } catch (e) {}
  window.close();
}



async function syncBaselineMtime(dStr) {
  try {
    const res = await fetch(`${API_BASE}/logs/status/${dStr}?account=${currentAccountName}`);
    const st = await res.json();
    lastSyncedMtime = st.mtime || 0;
  } catch (e) {
    lastSyncedMtime = 0;
  }
}

async function checkLatestLogOnActivate() {
  if (isCheckingLatest || isResizing || isMovingImage) return;
  isCheckingLatest = true;

  const dStr = getDateStr(currentDate);
  const isEn = (typeof currentAppLanguage !== 'undefined' && currentAppLanguage === 'en');

  try {
    const res = await fetch(`${API_BASE}/logs/status/${dStr}?account=${currentAccountName}`);
    const st = await res.json();

    // ファイルが存在しない、または最終同期タイムスタンプと同じなら何もしない
    if (!st.mtime || st.mtime === lastSyncedMtime) {
      return;
    }

    // タイムスタンプが異なっている（外部/別端末で新しいファイルが書かれた）場合
    let newHtml = null;
    if (st.source === "tmp") {
      const tmpRes = await fetch(`${API_BASE}/logs/tmp/${dStr}?account=${currentAccountName}`);
      const tmpData = await tmpRes.json();
      if (tmpData.exists) newHtml = tmpData.content_html;
    } else if (st.source === "html") {
      const htmlRes = await fetch(`${API_BASE}/logs/${dStr}?account=${currentAccountName}`);
      const htmlData = await htmlRes.json();
      if (htmlData.exists) newHtml = htmlData.content_html;
    }

    const editor = document.getElementById('editor');
    if (newHtml === null || !editor || newHtml === editor.innerHTML) {
      lastSyncedMtime = st.mtime;
      return;
    }

    // 編集中（未保存）の入力が衝突する場合のみ確認ダイアログを出す
    //if (isModified) {
    //  const confirmMsg = isEn
    //    ? "A newer version of this log was updated elsewhere.\nDiscard current unsaved edits and load the latest version?"
    //    : "別の場所または端末で更新された最新ログが見つかりました。\n現在の編集内容を破棄して最新版を読み込みますか？";
    //  const ok = confirm(confirmMsg);
    //  if (!ok) {
    //    lastSyncedMtime = st.mtime;
    //    return;
    //  }
    //}

    // 最新版をエディタへ反映
    editor.innerHTML = newHtml;
    lastSyncedMtime = st.mtime;
    isModified = (st.source === "tmp");

    const saveStatus = document.getElementById('saveStatus');
    const statusText = document.getElementById('statusText');
    if (saveStatus) {
      saveStatus.textContent = isModified
        ? (isEn ? "● Synced (Draft .tmp)" : "● 同期済 (未確定tmp)")
        : (isEn ? "Synced" : "同期済");
    }
    if (statusText) {
      const now = new Date();
      const ts = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
      statusText.textContent = isEn ? `Loaded latest log (${ts})` : `最新ログを反映しました (${ts})`;
    }
  } catch (e) {
    console.warn("Latest log check error:", e);
  } finally {
    isCheckingLatest = false;
  }
}