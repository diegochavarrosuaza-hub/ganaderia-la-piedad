// charts.js — gráficas SVG hechas a mano (sin librerías)
// Especificaciones: barras ≤24px con punta redondeada 4px y base recta,
// línea 2px, punto final ≥8px con anillo del color de la superficie,
// grillas hairline sólidas, texto siempre en tintas (nunca color de serie).
import { esc, fmtMoneyCorto, fmtMoney } from './util.js';

const INK_MUTED = 'var(--ink-muted)';
const GRID = 'var(--gridline)';
const BASE = 'var(--baseline)';
const SERIE = 'var(--chart-series)';

// Escala "bonita" para los ticks del eje Y (números redondos)
function nice(max, ticks = 4) {
  if (max <= 0) return { max: 1, step: 1 };
  const raw = max / ticks;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  let step = pow;
  for (const m of [1, 2, 2.5, 5, 10]) {
    if (raw <= m * pow) { step = m * pow; break; }
  }
  return { max: Math.ceil(max / step) * step, step };
}

// Barra con punta superior redondeada (4px) y base recta
function barPath(x, y, w, h, r = 4) {
  if (h <= 0.5) return '';
  r = Math.min(r, w / 2, h);
  return `M${x},${y + h} L${x},${y + r} Q${x},${y} ${x + r},${y}
          L${x + w - r},${y} Q${x + w},${y} ${x + w},${y + r} L${x + w},${y + h} Z`;
}

/*
 * Gráfica de columnas de una sola serie (magnitud por mes).
 * data: [{ label, value, tip }] — tip es el texto del tooltip.
 * Etiqueta directa solo en el máximo y el último punto (selectivo).
 */
export function columnChart(data, { money = true, height = 240 } = {}) {
  if (!data.length) return '<div class="empty-note">Sin datos aún.</div>';
  const W = 680, H = height;
  const padL = 56, padR = 10, padT = 22, padB = 26;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const maxVal = Math.max(...data.map(d => d.value), 0);
  const { max, step } = nice(maxVal || 1);
  const y = v => padT + plotH - (v / max) * plotH;

  const n = data.length;
  const band = plotW / n;
  const bw = Math.min(24, band * 0.62);           // ≤24px de grosor
  const fmtV = money ? fmtMoneyCorto : (v => String(Math.round(v)));

  // Grillas + ticks Y
  let grid = '';
  for (let v = 0; v <= max + 0.001; v += step) {
    const yy = y(v);
    grid += `<line x1="${padL}" y1="${yy}" x2="${W - padR}" y2="${yy}"
             stroke="${v === 0 ? BASE : GRID}" stroke-width="1"/>`;
    grid += `<text x="${padL - 7}" y="${yy + 3.5}" text-anchor="end"
             font-size="10.5" fill="${INK_MUTED}">${esc(fmtV(v))}</text>`;
  }

  const iMax = data.reduce((im, d, i) => d.value > data[im].value ? i : im, 0);
  let bars = '', labels = '';
  data.forEach((d, i) => {
    const cx = padL + band * i + band / 2;
    const bx = cx - bw / 2;
    const by = y(d.value);
    const h = padT + plotH - by;
    bars += `<path d="${barPath(bx, by, bw, h)}" fill="${SERIE}"
             data-tip="${esc(d.tip || d.label + ': ' + (money ? fmtMoney(d.value) : d.value))}"/>`;
    // Zona de hover más ancha que la barra (objetivo táctil)
    bars += `<rect x="${padL + band * i}" y="${padT}" width="${band}" height="${plotH}"
             fill="transparent" data-tip="${esc(d.tip || d.label + ': ' + (money ? fmtMoney(d.value) : d.value))}"/>`;
    // Etiqueta del eje X (si hay muchas, una de cada dos)
    if (n <= 8 || i % 2 === (n - 1) % 2) {
      labels += `<text x="${cx}" y="${H - 8}" text-anchor="middle"
                 font-size="10.5" fill="${INK_MUTED}">${esc(d.label)}</text>`;
    }
    // Etiqueta directa selectiva: solo el máximo y el último
    if ((i === iMax || i === n - 1) && d.value > 0) {
      labels += `<text x="${cx}" y="${by - 6}" text-anchor="middle" font-size="10.5"
                 font-weight="600" fill="var(--ink-secondary)">${esc(fmtV(d.value))}</text>`;
    }
  });

  return `<div class="chart-box"><svg viewBox="0 0 ${W} ${H}" role="img">${grid}${bars}${labels}</svg></div>`;
}

/*
 * Barras horizontales por categoría (HTML, no SVG): etiqueta + barra + valor.
 * data: [{ label, value }]
 */
export function hbarChart(data, { money = true } = {}) {
  if (!data.length) return '<div class="empty-note">Sin datos aún.</div>';
  const max = Math.max(...data.map(d => d.value), 1);
  const fmtV = money ? fmtMoneyCorto : (v => String(v));
  const fmtTip = money ? fmtMoney : (v => String(v));
  return '<div class="hbar-list">' + data.map(d => `
    <div class="hbar-item" data-tip="${esc(d.label + ': ' + fmtTip(d.value))}">
      <div class="hbar-label" title="${esc(d.label)}">${esc(d.label)}</div>
      <div class="hbar-track"><div class="hbar-fill" style="width:${Math.max(1, (d.value / max) * 100)}%"></div></div>
      <div class="hbar-val">${esc(fmtV(d.value))}</div>
    </div>`).join('') + '</div>';
}

/*
 * Sparkline de una serie (peso de un ternero en el tiempo).
 * points: [{ x(label), y(valor) }] — línea 2px + punto final con anillo.
 */
export function sparkline(points, { width = 220, height = 48, unidad = ' kg' } = {}) {
  if (points.length < 2) return '';
  const W = width, H = height, pad = 6;
  const ys = points.map(p => p.y);
  const min = Math.min(...ys), max = Math.max(...ys);
  const span = (max - min) || 1;
  const px = i => pad + (i / (points.length - 1)) * (W - pad * 2 - 34);
  const py = v => pad + (1 - (v - min) / span) * (H - pad * 2);
  const d = points.map((p, i) => (i ? 'L' : 'M') + px(i).toFixed(1) + ',' + py(p.y).toFixed(1)).join(' ');
  const lx = px(points.length - 1), ly = py(ys[ys.length - 1]);
  return `<svg viewBox="0 0 ${W} ${H}" style="width:${W}px;max-width:100%;height:auto;" role="img">
    <path d="${d}" fill="none" stroke="${SERIE}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${lx}" cy="${ly}" r="4" fill="${SERIE}" stroke="var(--chart-surface)" stroke-width="2"/>
    <text x="${lx + 7}" y="${ly + 3.5}" font-size="10.5" font-weight="600"
          fill="var(--ink-secondary)">${esc(String(ys[ys.length - 1]) + unidad)}</text>
  </svg>`;
}

// ── Tooltip compartido (hover y tap) ──────────────────────────────
export function attachTooltips(container) {
  const tip = document.getElementById('chart-tooltip');
  const show = (target, ev) => {
    const texto = target.getAttribute('data-tip');
    if (!texto) return;
    tip.innerHTML = esc(texto).replace(/\n/g, '<br>');
    tip.hidden = false;
    const x = Math.min(ev.clientX + 12, window.innerWidth - tip.offsetWidth - 8);
    const y = Math.max(8, ev.clientY - tip.offsetHeight - 10);
    tip.style.left = x + 'px';
    tip.style.top = y + 'px';
  };
  container.addEventListener('mousemove', ev => {
    const t = ev.target.closest('[data-tip]');
    if (t) show(t, ev); else tip.hidden = true;
  });
  container.addEventListener('mouseleave', () => { tip.hidden = true; });
  container.addEventListener('click', ev => {
    const t = ev.target.closest('[data-tip]');
    if (t) { show(t, ev); setTimeout(() => { tip.hidden = true; }, 2200); }
  });
}
