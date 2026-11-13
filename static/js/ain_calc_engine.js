// ==========================================
// AILab Note 共通計算エンジン (ain_calc_engine.js)
// ==========================================

// 素因数分解
function primeFactorize(n) {
  n = Math.round(Math.abs(n));
  if (n === 0) return "0";
  if (n === 1) return "1";

  const factors = {};
  let d = 2;
  let temp = n;

  while (d * d <= temp) {
    while (temp % d === 0) {
      factors[d] = (factors[d] || 0) + 1;
      temp = Math.floor(temp / d);
    }
    d = (d === 2) ? 3 : d + 2;
  }
  if (temp > 1) {
    factors[temp] = (factors[temp] || 0) + 1;
  }

  const formatted = Object.keys(factors).map(p => {
    const exp = factors[p];
    return exp > 1 ? `${p}^${exp}` : `${p}`;
  }).join(' * ');

  const breakdown = Object.entries(factors).map(([p, exp]) => `${p}:${exp}`).join(', ');

  return `${n} = ${formatted}  [${breakdown}]`;
}

// 数式・商余り・結晶角の評価
function safeCalculate(expr) {
  let clean = expr.toLowerCase().replace(/×/g, '*').replace(/÷/g, '/').replace(/＋/g, '+').replace(/−/g, '-').replace(/＝/g, '=').replace(/[\s\u3000]/g, ' ');
  clean = clean.replace(/\^/g, '**');

  // 0. 秒 -> 時間・分変換 (例: 6000 s -> "1h40m", 1800*2.5 s -> "1h15m")
  const secMatch = clean.match(/^\s*(.+?)\s*(?:s|sec|secs)\s*$/);
  if (secMatch) {
    const secVal = safeCalculate(secMatch[1]);
    if (typeof secVal === 'number' && !isNaN(secVal) && secVal >= 0) {
      const totalSec = Math.round(secVal);
      const h = Math.floor(totalSec / 3600);
      const m = Math.floor((totalSec % 3600) / 60);
      const s = totalSec % 60;

      let parts = [];
      if (h > 0) parts.push(`${h}h`);
      if (m > 0 || (h > 0 && s > 0)) parts.push(`${m}m`);
      if (s > 0 || parts.length === 0) parts.push(`${s}s`);
      return parts.join('');
    }
  }

  // 1. 素因数分解 factor(...)
  const factorMatch = clean.match(/^\s*factor\s*\(\s*(\d+)\s*\)\s*$/);
  if (factorMatch) {
    return primeFactorize(parseInt(factorMatch[1], 10));
  }

  // 2. div (商と余り: 180050 div 360 -> "500 ... 50")
  const divMatch = clean.match(/^\s*([0-9a-zA-Z_.)]+)\s+div\s+([0-9a-zA-Z_.(]+)\s*$/);
  if (divMatch) {
    try {
      const valA = new Function('return (' + divMatch[1] + ')')();
      const valB = new Function('return (' + divMatch[2] + ')')();
      if (valB !== 0) {
        const quotient = Math.floor(valA / valB);
        const remainder = ((valA % valB) + valB) % valB;
        return `${quotient} ... ${remainder}`;
      } else {
        return "Division by zero";
      }
    } catch (e) {}
  }

  // 3. mod 演算
  clean = clean.replace(/([0-9a-zA-Z_.)]+)\s+mod\s+([0-9a-zA-Z_.(]+)/g, '((($1)%($2)+($2))%($2))');

  clean = clean.replace(/\s+/g, '');

  const HC = 1.239841984;
  const CRYSTALS = { si111: 0.31356, si220: 0.19201, si311: 0.16375, ge111: 0.32664 };
  const xr = {
    si111: CRYSTALS.si111, si220: CRYSTALS.si220, si311: CRYSTALS.si311, ge111: CRYSTALS.ge111,
    e2w: (e) => HC / e, w2e: (w) => HC / w,
    e2ang: (e, d) => { const lambda = HC / e; const val = lambda / (2 * d); return (val <= 1 && val >= -1) ? (Math.asin(val) * 180 / Math.PI) : NaN; },
    ang2e: (deg, d) => { const lambda = 2 * d * Math.sin(deg * Math.PI / 180); return HC / lambda; }
  };

  clean = clean.replace(/\bpi\b/g, 'Math.PI').replace(/π/g, 'Math.PI').replace(/\be\b/g, 'Math.E');
  clean = clean.replace(/\bln\(/g, 'Math.log(').replace(/\blog10\(/g, 'Math.log10(').replace(/\blog\(/g, 'Math.log10(');
  clean = clean.replace(/\bsqrt\(/g, 'Math.sqrt(').replace(/\bexp\(/g, 'Math.exp(').replace(/\babs\(/g, 'Math.abs(');
  clean = clean.replace(/\bsind\(([^)]+)\)/g, 'Math.sin(($1)*Math.PI/180)').replace(/\bcosd\(([^)]+)\)/g, 'Math.cos(($1)*Math.PI/180)').replace(/\btand\(([^)]+)\)/g, 'Math.tan(($1)*Math.PI/180)');
  clean = clean.replace(/\bsin\(/g, 'Math.sin(').replace(/\bcos\(/g, 'Math.cos(').replace(/\btan\(/g, 'Math.tan(');

  const xrIdentifiers = ['e2w', 'w2e', 'e2ang', 'ang2e', 'si111', 'si220', 'si311', 'ge111'];
  for (const id of xrIdentifiers) {
    clean = clean.replace(new RegExp(`\\b${id}\\b`, 'g'), `xr.${id}`);
  }

  if (!/^[0-9+\-*/%().,MathPIEsqrtexplongadibscxrw1230floor]+$/.test(clean)) return null;
  try {
    const result = new Function('xr', `return (${clean})`)(xr);
    if (typeof result === 'number' && !isNaN(result) && isFinite(result)) {
      return parseFloat(result.toPrecision(8));
    }
  } catch (e) { return null; }
  return null;
}

// 🌟 キー入力（Enter）検知と計算・元素吸収のディスパッチャ
async function handleCalculationKeyDown(event, editorElem, apiBaseUrl = '/api', onCalculated = null, isCalcPad = false) {

  if (event.key !== 'Enter' && event.keyCode !== 13) return;
  if (event.isComposing && event.keyCode === 229) return;

  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return;

  const range = sel.getRangeAt(0);
  let textLine = "";
  let blockElem = sel.anchorNode;
  if (blockElem.nodeType === Node.TEXT_NODE) textLine = blockElem.textContent.substring(0, range.startOffset);
  else if (blockElem === editorElem) {
    const child = editorElem.childNodes[range.startOffset - 1] || editorElem.childNodes[0];
    textLine = child ? (child.textContent || "") : "";
  } else textLine = blockElem.textContent || "";

  const lastLine = textLine.split('\n').pop().trim().replace(/[\u200B-\u200D\uFEFF]/g, '');

  // 1. ヘルプチートシート (??)
  if (/^[?？]{2}$/.test(lastLine)) {
    event.preventDefault();
    const helpText = [
      `\n--- 📟 AILab Calculator & Optics CheatSheet ---`,
      `[ Motor / Math ] ?180000 div 360, ?180050 mod 360, ?factor(180000)`,
      `[ Basic Math ] ?1+1, ?2^10, ?sqrt(2), ?ln(10), ?sin(pi/6), ?sind(30)`,
      `[ X-ray Optics ] ?e2w(10), ?w2e(0.124), ?e2ang(10, si111), ?ang2e(11.4, si111)`,
      `[ Crystals ] si111, si220, si311, ge111`,
      `[ xraylib ] ?Fe(10), ?Si(17.8)`,
      `------------------------------------------------\n`
    ].join('\n');
    document.execCommand('insertText', false, helpText);
    if (onCalculated) onCalculated();
    return;
  }

// 2. 元素吸収計算 (isCalcPad なら Fe(10) でもOK)
  const xrayRegex = isCalcPad 
    ? /^[?？]?\s*([A-Za-z]{1,2})\s*[\(（]\s*([0-9]+(?:\.[0-9]+)?)\s*[）\)]$/
    : /^[?？]\s*([A-Za-z]{1,2})\s*[\(（]\s*([0-9]+(?:\.[0-9]+)?)\s*[）\)]$/;

  const xrayMatch = lastLine.match(xrayRegex);
  if (xrayMatch) {
    event.preventDefault();
    try {
      const res = await fetch(`${apiBaseUrl}/calc/xray?element=${xrayMatch[1]}&energy_kev=${xrayMatch[2]}`);
      if (res.ok) {
        const data = await res.json();
        let out = `\n${data.element}@${data.energy_kev}keV: μ=${data.mu_mm1}mm⁻¹, 1/e=${data.attenuation_len_mm}mm`;
        if (data.k_edge_kev) out += `, K-edge=${data.k_edge_kev}keV`;
        out += `\n`;
        document.execCommand('insertText', false, out);
        if (onCalculated) onCalculated();
        return;
      }
    } catch (err) {}
  }

  // 3. 一般計算・div・mod・素因数分解 (isCalcPad なら ? なしでも評価)
  let exprToCalc = null;
  if (isCalcPad) {
    // ?があってもなくてもOK。ただしすでに '=' を含む行や空行は除外
    const match = lastLine.match(/^[?？]?\s*(.+)$/);
    if (match && !match[1].includes('=') && !match[1].startsWith('#')) {
      exprToCalc = match[1];
    }
  } else {
    // メインエディタ用 (? が必須)
    const match = lastLine.match(/^[?？]\s*(.+)$/);
    if (match && !match[1].includes('=')) {
      exprToCalc = match[1];
    }
  }

  if (exprToCalc) {
    const calculated = safeCalculate(exprToCalc);
    if (calculated !== null) {
      event.preventDefault();
      if (typeof calculated === 'string' && calculated.includes('=')) {
        document.execCommand('insertText', false, `\n${calculated}\n`);
      } else {
        document.execCommand('insertText', false, ` = ${calculated}\n`);
      }
      if (onCalculated) onCalculated();
      return;
    }
  }
}