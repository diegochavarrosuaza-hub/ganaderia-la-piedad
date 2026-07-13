// Vista Eventos — bitácora de todo lo que pasa en la finca (solo lectura)
import { fmtFecha, fmtMoney, esc } from '../util.js';
import { tablaHTML, badge } from '../ui.js';

let filtro = { q: '' };

export function render(el, ctx) {
  let filas = [...ctx.state.eventos].sort((a, b) =>
    (b.timestamp || '').localeCompare(a.timestamp || ''));
  if (filtro.q) {
    const q = filtro.q.toLowerCase();
    filas = filas.filter(e => [e.refId, e.tipo, e.causa, e.categoria]
      .some(x => String(x || '').toLowerCase().includes(q)));
  }
  filas = filas.slice(0, 200);

  el.innerHTML = `
    <div class="toolbar">
      <input class="search" id="e-q" placeholder="🔍 Buscar en la bitácora…" value="${esc(filtro.q)}">
      <span class="muted" style="font-size:13px;">Todo queda anotado aquí automáticamente</span>
    </div>
    <div class="table-wrap">${tablaHTML({
      columns: [
        { key: 'timestamp', label: 'Registrado', render: e => `<span class="muted">${esc((e.timestamp || '').slice(0, 16))}</span>` },
        { key: 'categoria', label: 'Categoría', render: e => badge(e.categoria) },
        { key: 'refId', label: 'Animal', render: e => `<b>${esc(e.refId)}</b>` },
        { key: 'tipo', label: 'Qué pasó' },
        { key: 'fecha', label: 'Fecha', render: e => fmtFecha(e.fecha) },
        { key: 'precio', label: 'Valor', num: true, render: e => e.precio != null ? fmtMoney(e.precio) : '' },
        { key: 'causa', label: 'Detalle' },
      ],
      rows: filas,
      emptyMsg: 'La bitácora está vacía.',
    })}</div>
  `;

  el.querySelector('#e-q').oninput = e => {
    filtro.q = e.target.value; render(el, ctx);
    const q = el.querySelector('#e-q'); q.focus(); q.setSelectionRange(q.value.length, q.value.length);
  };
}
