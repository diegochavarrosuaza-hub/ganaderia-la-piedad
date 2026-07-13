// util.js — fechas, formatos y helpers generales

export function isoOf(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')
       + '-' + String(d.getDate()).padStart(2, '0');
}
export function hoyISO() { return isoOf(new Date()); }

export function toDate(iso) {
  if (!iso) return null;
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

export function fmtFecha(iso) {
  if (!iso) return '—';
  const s = String(iso).slice(0, 10);
  const [y, m, d] = s.split('-');
  return (d && m && y) ? `${d}/${m}/${y}` : s;
}

export function addDias(iso, dias) {
  const d = toDate(iso) || new Date();
  d.setDate(d.getDate() + dias);
  return isoOf(d);
}

// días de a → b (positivo si b es después)
export function diasEntre(a, b) {
  const da = toDate(a), db = toDate(b);
  if (!da || !db) return null;
  return Math.round((db - da) / 86400000);
}

const moneyFmt = new Intl.NumberFormat('es-CO', {
  style: 'currency', currency: 'COP', maximumFractionDigits: 0,
});
export function fmtMoney(v) {
  const n = Number(v);
  return (v === '' || v == null || isNaN(n)) ? '—' : moneyFmt.format(n);
}
// Compacto para ejes/tiles: $1,2 M · $850 mil
export function fmtMoneyCorto(v) {
  const n = Number(v) || 0;
  if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toLocaleString('es-CO', { maximumFractionDigits: 1 }) + ' M';
  if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3).toLocaleString('es-CO') + ' mil';
  return '$' + Math.round(n).toLocaleString('es-CO');
}

export function fmtNum(v, dec = 0) {
  const n = Number(v);
  return (v === '' || v == null || isNaN(n)) ? '—'
    : n.toLocaleString('es-CO', { maximumFractionDigits: dec });
}

// Edad legible a partir de fecha de nacimiento: "8 m" · "6a 2m"
export function edadTexto(fechaNacISO, hastaISO) {
  const nac = toDate(fechaNacISO);
  if (!nac) return '—';
  const hasta = toDate(hastaISO) || new Date();
  let meses = (hasta.getFullYear() - nac.getFullYear()) * 12 + (hasta.getMonth() - nac.getMonth());
  if (hasta.getDate() < nac.getDate()) meses--;
  if (meses < 0) return '—';
  if (meses < 24) return meses + ' m';
  return Math.floor(meses / 12) + 'a ' + (meses % 12) + 'm';
}
export function edadMeses(fechaNacISO, hastaISO) {
  const nac = toDate(fechaNacISO);
  if (!nac) return null;
  const hasta = toDate(hastaISO) || new Date();
  return Math.max(0, Math.round((hasta - nac) / (30.44 * 86400000)));
}

export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// 'YYYY-MM' de una fecha ISO
export function mesKey(iso) { return String(iso || '').slice(0, 7); }
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
export function mesLabel(key) {
  const [y, m] = String(key).split('-').map(Number);
  if (!y || !m) return key;
  return MESES[m - 1] + ' ' + String(y).slice(2);
}
// Lista de los últimos n meses como claves 'YYYY-MM' (incluye el actual)
export function ultimosMeses(n) {
  const out = [];
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - (n - 1));
  for (let i = 0; i < n; i++) {
    out.push(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'));
    d.setMonth(d.getMonth() + 1);
  }
  return out;
}

export function download(nombre, contenido, tipo = 'application/json') {
  const blob = new Blob([contenido], { type: tipo + ';charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = nombre;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 300);
}

export function aCSV(filas, columnas) {
  const escCsv = v => {
    const s = String(v == null ? '' : v);
    return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const lineas = [columnas.map(c => escCsv(c.label)).join(';')];
  for (const f of filas) lineas.push(columnas.map(c => escCsv(f[c.key])).join(';'));
  return '﻿' + lineas.join('\n'); // BOM para que Excel abra bien las tildes
}
