// ==========================================
// AIN2 描画・アノテーションエンジン (ain_canvas.js)
// 直線・矩形・円・文字・手書き・多角形対応
// ==========================================

let activeDrawTool = 'line';
let currentLineDash = 'solid';
let currentLineArrow = 'none';
let currentShapeDash = 'solid';
let currentTextDecor = { bold: false, italic: false, underline: false };

let drawCanvas = null;
let drawCtx = null;
let drawnShapes = [];
let redoShapes = [];
let isDrawing = false;
let startPoint = { x: 0, y: 0 };

// 手書き・多角形用の追跡バッファ
let currentPathPoints = []; 
let polygonPoints = [];     

// 1. イラスト枠挿入ポップアップ制御
function toggleCanvasInsertPopup(e) {
  e.stopPropagation();
  const popup = document.getElementById('canvasInsertPopup');
  if (popup) popup.classList.toggle('hidden');
}

function changeBoxLines(delta) {
  const input = document.getElementById('box_line_count');
  let val = Math.max(2, Math.min(50, (parseInt(input.value, 10) || 10) + delta));
  input.value = val;
}

function confirmInsertDrawingBox() {
  const popup = document.getElementById('canvasInsertPopup');
  if (popup) popup.classList.add('hidden');

  const lines = parseInt(document.getElementById('box_line_count').value, 10) || 10;
  const height = lines * 24;
  const width = Math.round(height * 1.5);

  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = '#e5e7eb';
  ctx.lineWidth = 1;
  ctx.strokeRect(0, 0, width, height);

  const blankDataUrl = c.toDataURL('image/png');
  const imgHtml = `
    <div style="margin: 6px 0;">
      <img src="${blankDataUrl}" style="width: ${width}px; max-width: 100%; display: block;" class="resizable-img rounded border border-gray-300 shadow-sm">
    </div>
    <div><br></div>
  `;
  const editorElem = document.getElementById('editor');
  editorElem.focus();
  document.execCommand('insertHTML', false, imgHtml);
  if (typeof onEditorInput === 'function') onEditorInput();

  setTimeout(() => {
    const imgs = editorElem.querySelectorAll('img');
    const newImg = imgs[imgs.length - 1];
    if (newImg) {
      targetImage = newImg;
      if (typeof updateResizerPosition === 'function') updateResizerPosition();
      selectDrawTool('line');
    }
  }, 50);
}

// 2. ツール切り替え
function selectDrawTool(tool) {
  // 多角形作成中に別ツールへ切り替えたら確定
  if (activeDrawTool === 'poly' && polygonPoints.length > 2) {
    finishPolygon();
  } else {
    polygonPoints = [];
  }

  activeDrawTool = tool;
  const tools = ['line', 'rect', 'circle', 'poly', 'pen', 'text'];
  tools.forEach(t => {
    const btn = document.getElementById(`tool_btn_${t}`);
    if (btn) {
      if (t === tool) {
        btn.className = "h-6 flex items-center justify-center bg-teal-100 border border-teal-500 rounded text-[11px] text-teal-800 font-bold shadow-inner";
      } else {
        btn.className = "h-6 flex items-center justify-center hover:bg-gray-100 rounded text-[11px] text-gray-700 border border-transparent transition-colors";
      }
    }
  });

  const optLine = document.getElementById('opt_panel_line');
  const optShape = document.getElementById('opt_panel_shape');
  const optText = document.getElementById('opt_panel_text');

  if (optLine) optLine.classList.toggle('hidden', tool !== 'line' && tool !== 'pen');
  if (optShape) optShape.classList.toggle('hidden', tool !== 'rect' && tool !== 'circle' && tool !== 'poly');
  if (optText) optText.classList.toggle('hidden', tool !== 'text');

  ensureDrawingOverlay();
}

function updateLineWidthVal(val) { document.getElementById('line_width_val').textContent = val; }
function updateShapeWidthVal(val) { document.getElementById('shape_width_val').textContent = val; }
function updateTextSizeVal(val) { document.getElementById('text_size_val').textContent = val; }

function setLineDashStyle(style) {
  currentLineDash = style;
  ['solid', 'dashed', 'dashdot'].forEach(s => {
    const btn = document.getElementById(`btn_dash_${s}`);
    if (btn) btn.className = (s === style) 
      ? "w-7 h-5 border border-teal-500 bg-teal-50 rounded flex items-center justify-center p-0.5 shadow-inner"
      : "w-7 h-5 border border-gray-300 hover:bg-gray-100 rounded flex items-center justify-center p-0.5";
  });
}

function setShapeDashStyle(style) {
  currentShapeDash = style;
  ['solid', 'dashed', 'dashdot'].forEach(s => {
    const btn = document.getElementById(`btn_sdash_${s}`);
    if (btn) btn.className = (s === style) 
      ? "w-7 h-5 border border-teal-500 bg-teal-50 rounded flex items-center justify-center p-0.5 shadow-inner"
      : "w-7 h-5 border border-gray-300 hover:bg-gray-100 rounded flex items-center justify-center p-0.5";
  });
}

function setLineArrow(type) {
  currentLineArrow = type;
  ['none', 'right', 'left', 'both'].forEach(t => {
    const btn = document.getElementById(`btn_arr_${t}`);
    if (!btn) return;
    const isR = t !== 'both' ? 'border-r border-gray-300' : '';
    btn.className = (t === type)
      ? `w-6 h-4 bg-teal-100 text-teal-800 font-bold ${isR} flex items-center justify-center text-[10px] shadow-inner`
      : `w-6 h-4 hover:bg-gray-100 text-gray-600 ${isR} flex items-center justify-center text-[10px]`;
  });
}

function toggleTextDecor(type) {
  currentTextDecor[type] = !currentTextDecor[type];
  const btn = document.getElementById(`btn_tdecor_${type === 'bold' ? 'b' : (type === 'italic' ? 'i' : 'u')}`);
  if (btn) {
    if (currentTextDecor[type]) btn.classList.add('bg-teal-100', 'text-teal-800', 'font-extrabold', 'shadow-inner');
    else btn.classList.remove('bg-teal-100', 'text-teal-800', 'font-extrabold', 'shadow-inner');
  }
}

// 3. 描画オーバーレイ制御
function ensureDrawingOverlay() {
  if (!targetImage) return;

  if (!drawCanvas) {
    drawCanvas = document.createElement('canvas');
    drawCanvas.style.position = 'absolute';
    drawCanvas.style.top = '0';
    drawCanvas.style.left = '0';
    drawCanvas.style.width = '100%';
    drawCanvas.style.height = '100%';
    drawCanvas.style.cursor = 'crosshair';
    drawCanvas.style.zIndex = '10';
    drawCanvas.style.touchAction = 'none';

    const resizer = document.getElementById('imageResizer');
    if (resizer) resizer.appendChild(drawCanvas);
    drawCtx = drawCanvas.getContext('2d');

    drawCanvas.addEventListener('pointerdown', onDrawStart);
    window.addEventListener('pointermove', onDrawMove);
    window.addEventListener('pointerup', onDrawEnd);
    drawCanvas.addEventListener('dblclick', onDrawDblClick);
  }

  const w = targetImage.offsetWidth || 300;
  const h = targetImage.offsetHeight || 200;
  drawCanvas.width = w;
  drawCanvas.height = h;
  redrawOverlay();
}

function removeDrawingOverlay() {
  if (drawCanvas) {
    drawCanvas.removeEventListener('pointerdown', onDrawStart);
    window.removeEventListener('pointermove', onDrawMove);
    window.removeEventListener('pointerup', onDrawEnd);
    drawCanvas.removeEventListener('dblclick', onDrawDblClick);
    drawCanvas.remove();
    drawCanvas = null;
    drawCtx = null;
  }
  drawnShapes = [];
  redoShapes = [];
  polygonPoints = [];
}

function getCanvasPos(e) {
  const rect = drawCanvas.getBoundingClientRect();
  const scaleX = drawCanvas.width / rect.width;
  const scaleY = drawCanvas.height / rect.height;
  return {
    x: (e.clientX - rect.left) * scaleX,
    y: (e.clientY - rect.top) * scaleY
  };
}

// 4. マウス/タッチ イベント処理
function onDrawStart(e) {
  if (e.target !== drawCanvas) return;
  const pos = getCanvasPos(e);
  startPoint = pos;

  if (activeDrawTool === 'poly') {
    // 多角形モード: 始点近くをクリックしたら閉じる
    if (polygonPoints.length > 2) {
      const p0 = polygonPoints[0];
      if (Math.hypot(pos.x - p0.x, pos.y - p0.y) < 15) {
        finishPolygon();
        return;
      }
    }
    polygonPoints.push(pos);
    redrawOverlay();
    return;
  }

  isDrawing = true;

  if (activeDrawTool === 'pen') {
    currentPathPoints = [pos];
  } else if (activeDrawTool === 'text') {
    isDrawing = false;
    const textVal = prompt("記入するテキストを入力してください:");
    if (textVal) {
      drawnShapes.push({
        type: 'text',
        x: startPoint.x,
        y: startPoint.y,
        text: textVal,
        size: parseInt(document.getElementById('text_size_range').value, 10),
        color: document.getElementById('text_color').value,
        bold: currentTextDecor.bold,
        italic: currentTextDecor.italic,
        underline: currentTextDecor.underline
      });
      redoShapes = [];
      redrawOverlay();
    }
  }
}

function onDrawMove(e) {
  if (!drawCanvas) return;
  const currentPos = getCanvasPos(e);

  if (activeDrawTool === 'poly' && polygonPoints.length > 0) {
    redrawOverlay();
    // 多角形作成中の仮線を描画
    drawCtx.save();
    drawCtx.strokeStyle = document.getElementById('shape_stroke_color').value;
    drawCtx.lineWidth = parseInt(document.getElementById('shape_width').value, 10);
    drawCtx.setLineDash([4, 4]);
    drawCtx.beginPath();
    drawCtx.moveTo(polygonPoints[polygonPoints.length - 1].x, polygonPoints[polygonPoints.length - 1].y);
    drawCtx.lineTo(currentPos.x, currentPos.y);
    drawCtx.stroke();
    drawCtx.restore();
    return;
  }

  if (!isDrawing) return;

  if (activeDrawTool === 'pen') {
    currentPathPoints.push(currentPos);
    redrawOverlay();
    renderSingleShape(drawCtx, {
      type: 'pen',
      points: currentPathPoints,
      width: parseInt(document.getElementById('line_width').value, 10),
      color: document.getElementById('line_color').value
    });
  } else {
    redrawOverlay();
    renderSingleShape(drawCtx, createCurrentShapeObject(currentPos));
  }
}

function onDrawEnd(e) {
  if (!isDrawing || !drawCanvas || activeDrawTool === 'poly') return;
  isDrawing = false;
  const endPos = getCanvasPos(e);

  if (activeDrawTool === 'pen') {
    if (currentPathPoints.length > 1) {
      drawnShapes.push({
        type: 'pen',
        points: [...currentPathPoints],
        width: parseInt(document.getElementById('line_width').value, 10),
        color: document.getElementById('line_color').value
      });
      redoShapes = [];
    }
    currentPathPoints = [];
  } else if (Math.hypot(endPos.x - startPoint.x, endPos.y - startPoint.y) > 3) {
    drawnShapes.push(createCurrentShapeObject(endPos));
    redoShapes = [];
  }
  redrawOverlay();
}

function onDrawDblClick(e) {
  if (activeDrawTool === 'poly' && polygonPoints.length > 2) {
    finishPolygon();
  }
}

function finishPolygon() {
  if (polygonPoints.length < 3) {
    polygonPoints = [];
    redrawOverlay();
    return;
  }
  drawnShapes.push({
    type: 'poly',
    points: [...polygonPoints],
    width: parseInt(document.getElementById('shape_width').value, 10),
    dash: currentShapeDash,
    strokeColor: document.getElementById('shape_stroke_color').value,
    hatch: document.getElementById('shape_hatch').value,
    fillColor: document.getElementById('shape_fill_color').value
  });
  polygonPoints = [];
  redoShapes = [];
  redrawOverlay();
}

function createCurrentShapeObject(endPos) {
  if (activeDrawTool === 'line') {
    return {
      type: 'line',
      x1: startPoint.x, y1: startPoint.y,
      x2: endPos.x, y2: endPos.y,
      width: parseInt(document.getElementById('line_width').value, 10),
      dash: currentLineDash,
      arrow: currentLineArrow,
      color: document.getElementById('line_color').value
    };
  } else if (activeDrawTool === 'rect') {
    return {
      type: 'rect',
      x: Math.min(startPoint.x, endPos.x),
      y: Math.min(startPoint.y, endPos.y),
      w: Math.abs(endPos.x - startPoint.x),
      h: Math.abs(endPos.y - startPoint.y),
      width: parseInt(document.getElementById('shape_width').value, 10),
      dash: currentShapeDash,
      strokeColor: document.getElementById('shape_stroke_color').value,
      hatch: document.getElementById('shape_hatch').value,
      fillColor: document.getElementById('shape_fill_color').value
    };
  } else if (activeDrawTool === 'circle') {
    return {
      type: 'circle',
      cx: (startPoint.x + endPos.x) / 2,
      cy: (startPoint.y + endPos.y) / 2,
      rx: Math.abs(endPos.x - startPoint.x) / 2,
      ry: Math.abs(endPos.y - startPoint.y) / 2,
      width: parseInt(document.getElementById('shape_width').value, 10),
      dash: currentShapeDash,
      strokeColor: document.getElementById('shape_stroke_color').value,
      hatch: document.getElementById('shape_hatch').value,
      fillColor: document.getElementById('shape_fill_color').value
    };
  }
}

// 5. レンダリング関数
function redrawOverlay() {
  if (!drawCtx) return;
  drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
  drawnShapes.forEach(shape => renderSingleShape(drawCtx, shape));

  // 多角形の作成中プレビュー
  if (polygonPoints.length > 0) {
    drawCtx.save();
    drawCtx.strokeStyle = document.getElementById('shape_stroke_color').value;
    drawCtx.lineWidth = parseInt(document.getElementById('shape_width').value, 10);
    drawCtx.beginPath();
    drawCtx.moveTo(polygonPoints[0].x, polygonPoints[0].y);
    for (let i = 1; i < polygonPoints.length; i++) {
      drawCtx.lineTo(polygonPoints[i].x, polygonPoints[i].y);
    }
    drawCtx.stroke();

    // 頂点のマーク
    polygonPoints.forEach((p, idx) => {
      drawCtx.fillStyle = idx === 0 ? '#10b981' : '#3b82f6';
      drawCtx.beginPath();
      drawCtx.arc(p.x, p.y, 4, 0, Math.PI * 2);
      drawCtx.fill();
    });
    drawCtx.restore();
  }
}

function renderSingleShape(ctx, shape) {
  if (!shape) return;
  ctx.save();

  if (shape.dash === 'dashed') ctx.setLineDash([6, 6]);
  else if (shape.dash === 'dashdot') ctx.setLineDash([12, 4, 3, 4]);
  else ctx.setLineDash([]);

  if (shape.type === 'line') {
    ctx.strokeStyle = shape.color;
    ctx.lineWidth = shape.width;
    ctx.beginPath();
    ctx.moveTo(shape.x1, shape.y1);
    ctx.lineTo(shape.x2, shape.y2);
    ctx.stroke();

    if (shape.arrow === 'right' || shape.arrow === 'both') {
      drawArrow(ctx, shape.x1, shape.y1, shape.x2, shape.y2, shape.color, shape.width);
    }
    if (shape.arrow === 'left' || shape.arrow === 'both') {
      drawArrow(ctx, shape.x2, shape.y2, shape.x1, shape.y1, shape.color, shape.width);
    }
  } else if (shape.type === 'pen') {
    if (shape.points.length > 1) {
      ctx.strokeStyle = shape.color;
      ctx.lineWidth = shape.width;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(shape.points[0].x, shape.points[0].y);
      for (let i = 1; i < shape.points.length; i++) {
        ctx.lineTo(shape.points[i].x, shape.points[i].y);
      }
      ctx.stroke();
    }
  } else if (shape.type === 'rect') {
    applyHatch(ctx, shape.hatch, shape.fillColor);
    if (shape.hatch !== 'none') ctx.fillRect(shape.x, shape.y, shape.w, shape.h);
    ctx.strokeStyle = shape.strokeColor;
    ctx.lineWidth = shape.width;
    ctx.strokeRect(shape.x, shape.y, shape.w, shape.h);
  } else if (shape.type === 'circle') {
    applyHatch(ctx, shape.hatch, shape.fillColor);
    ctx.beginPath();
    ctx.ellipse(shape.cx, shape.cy, shape.rx, shape.ry, 0, 0, 2 * Math.PI);
    if (shape.hatch !== 'none') ctx.fill();
    ctx.strokeStyle = shape.strokeColor;
    ctx.lineWidth = shape.width;
    ctx.stroke();
  } else if (shape.type === 'poly') {
    if (shape.points && shape.points.length > 2) {
      ctx.beginPath();
      ctx.moveTo(shape.points[0].x, shape.points[0].y);
      for (let i = 1; i < shape.points.length; i++) {
        ctx.lineTo(shape.points[i].x, shape.points[i].y);
      }
      ctx.closePath();
      applyHatch(ctx, shape.hatch, shape.fillColor);
      if (shape.hatch !== 'none') ctx.fill();
      ctx.strokeStyle = shape.strokeColor;
      ctx.lineWidth = shape.width;
      ctx.stroke();
    }
  } else if (shape.type === 'text') {
    const fontStyle = shape.italic ? 'italic ' : '';
    const fontWeight = shape.bold ? 'bold ' : '';
    ctx.font = `${fontStyle}${fontWeight}${shape.size}px sans-serif`;
    ctx.fillStyle = shape.color;
    ctx.fillText(shape.text, shape.x, shape.y);

    if (shape.underline) {
      const m = ctx.measureText(shape.text);
      ctx.strokeStyle = shape.color;
      ctx.lineWidth = Math.max(1, shape.size / 12);
      ctx.beginPath();
      ctx.moveTo(shape.x, shape.y + 2);
      ctx.lineTo(shape.x + m.width, shape.y + 2);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawArrow(ctx, fromX, fromY, toX, toY, color, width) {
  const angle = Math.atan2(toY - fromY, toX - fromX);
  const len = Math.max(10, width * 4);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(toX, toY);
  ctx.lineTo(toX - len * Math.cos(angle - Math.PI / 6), toY - len * Math.sin(angle - Math.PI / 6));
  ctx.lineTo(toX - len * Math.cos(angle + Math.PI / 6), toY - len * Math.sin(angle + Math.PI / 6));
  ctx.closePath();
  ctx.fill();
}

function applyHatch(ctx, hatchType, color) {
  if (hatchType === 'solid') {
    ctx.fillStyle = color;
  } else if (hatchType === 'diagonal' || hatchType === 'cross') {
    const pCanvas = document.createElement('canvas');
    pCanvas.width = 12;
    pCanvas.height = 12;
    const pCtx = pCanvas.getContext('2d');
    pCtx.strokeStyle = color;
    pCtx.lineWidth = 1.5;
    pCtx.beginPath();
    pCtx.moveTo(0, 12); pCtx.lineTo(12, 0);
    if (hatchType === 'cross') {
      pCtx.moveTo(0, 0); pCtx.lineTo(12, 12);
    }
    pCtx.stroke();
    ctx.fillStyle = ctx.createPattern(pCanvas, 'repeat');
  }
}

// 6. Undo ＆ Redo
function undoLastShape() {
  if (drawnShapes.length === 0) return;
  const last = drawnShapes.pop();
  redoShapes.push(last);
  redrawOverlay();
}

function redoLastShape() {
  if (redoShapes.length === 0) return;
  const restored = redoShapes.pop();
  drawnShapes.push(restored);
  redrawOverlay();
}

// 7. 画像への確定（焼き込み）
function commitDrawing(closeAfterCommit = false) {
  if (!targetImage || drawnShapes.length === 0) {
    if (closeAfterCommit) {
      removeDrawingOverlay();
      targetImage = null;
      const resizer = document.getElementById('imageResizer');
      if (resizer) resizer.classList.add('hidden');
    }
    return;
  }

  const w = drawCanvas.width;
  const h = drawCanvas.height;
  const mergeCanvas = document.createElement('canvas');
  mergeCanvas.width = w;
  mergeCanvas.height = h;
  const mCtx = mergeCanvas.getContext('2d');

  const baseImg = new Image();
  baseImg.onload = () => {
    mCtx.drawImage(baseImg, 0, 0, w, h);
    drawnShapes.forEach(shape => renderSingleShape(mCtx, shape));

    targetImage.src = mergeCanvas.toDataURL('image/png');
    if (typeof onEditorInput === 'function') onEditorInput();

    drawnShapes = [];
    redoShapes = [];
    polygonPoints = [];
    redrawOverlay();

    if (closeAfterCommit) {
      removeDrawingOverlay();
      targetImage = null;
      const resizer = document.getElementById('imageResizer');
      if (resizer) resizer.classList.add('hidden');
    } else {
      if (typeof updateResizerPosition === 'function') updateResizerPosition();
      selectDrawTool(activeDrawTool);
    }
  };
  baseImg.src = targetImage.src;
}