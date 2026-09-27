// Vista Eventos — bitácora de todo lo que pasa en la finca; cada línea se corrige
import { fmtFecha, fmtMoney, esc } from '../util.js';
import { tablaHTML, badge, redibujarSoloTabla } from '../ui.js';
import { formEditarEvento } from '../forms.js';

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
      <span class="muted" style="font-size:13px;">Todo queda anotado aquí · toca una línea para corregirla</span>
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
      rowAttr: e => `class="row-click" data-ev="${e.id}"`,
      emptyMsg: 'La bitácora está vacía.',
    })}</div>
  `;

  el.querySelectorAll('tr[data-ev]').forEach(tr => tr.addEventListener('click', () => {
    const ev = ctx.state.eventos.find(x => x.id === Number(tr.dataset.ev));
    if (ev) formEditarEvento(ev, ctx);
  }));

  el.querySelector('#e-q').oninput = e => { filtro.q = e.target.value; redibujarSoloTabla(el, t => render(t, ctx)); };
}
