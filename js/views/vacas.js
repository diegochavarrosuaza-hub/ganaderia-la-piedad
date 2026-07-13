// Vista Vacas — listado con acceso a la hoja de vida
import { fmtFecha, esc, edadTexto } from '../util.js';
import { tablaHTML, badge } from '../ui.js';
import { prenezActivaDe } from '../logic.js';
import { formNuevaVaca } from '../forms.js';
import { abrirFichaVaca } from '../fichas.js';

let filtro = { q: '', estado: 'ACTIVA' };

export function render(el, ctx) {
  const { state } = ctx;
  let filas = [...state.vacas].sort((a, b) =>
    a.chapeta.localeCompare(b.chapeta, 'es', { numeric: true }));
  if (filtro.estado) filas = filas.filter(v => v.estado === filtro.estado);
  if (filtro.q) {
    const q = filtro.q.toLowerCase();
    filas = filas.filter(v => [v.chapeta, v.codigo, v.genetica, v.criaActual]
      .some(x => String(x || '').toLowerCase().includes(q)));
  }

  el.innerHTML = `
    <div class="hint">💡 <span>Toca cualquier vaca para ver su <b>hoja de vida completa</b>: crías, servicios, preñeces y acciones (parto, venta…).</span></div>
    <div class="toolbar">
      <button class="btn btn-primary" id="btn-nueva">➕ Nueva vaca</button>
      <input class="search" id="v-q" placeholder="🔍 Chapeta, código, cría…" value="${esc(filtro.q)}">
      <select class="filter-sel" id="v-estado">
        <option value="ACTIVA" ${filtro.estado === 'ACTIVA' ? 'selected' : ''}>Activas</option>
        <option value="VENDIDA" ${filtro.estado === 'VENDIDA' ? 'selected' : ''}>Vendidas</option>
        <option value="FALLECIDA" ${filtro.estado === 'FALLECIDA' ? 'selected' : ''}>Fallecidas</option>
        <option value="">Todas</option>
      </select>
      <span class="muted" style="font-size:13px;">${filas.length} vacas</span>
    </div>

    <div class="table-wrap">${tablaHTML({
      columns: [
        { key: 'chapeta', label: 'Chapeta', render: v => `<b>${esc(v.chapeta)}</b>` },
        { key: 'codigo', label: 'Código' },
        { key: 'genetica', label: 'Genética' },
        { key: 'edad', label: 'Edad', render: v => edadTexto(v.fechaNac) },
        { key: 'ultimoParto', label: 'Último parto', render: v => fmtFecha(v.ultimoParto) },
        { key: 'criaActual', label: 'Cría actual' },
        { key: 'prenez', label: 'Preñez', render: v => {
            const p = prenezActivaDe(state, v.chapeta);
            return p ? `🤰 parto ${fmtFecha(p.fechaProbParto)}` : '';
          } },
        { key: 'estado', label: 'Estado', render: v => badge(v.estado) },
      ],
      rows: filas,
      rowAttr: v => `class="row-click" data-chapeta="${esc(v.chapeta)}"`,
      emptyMsg: 'No hay vacas con ese filtro.',
    })}</div>
  `;

  el.querySelector('#btn-nueva').onclick = () => formNuevaVaca(ctx);
  el.querySelector('#v-q').oninput = e => {
    filtro.q = e.target.value; render(el, ctx);
    const q = el.querySelector('#v-q'); q.focus(); q.setSelectionRange(q.value.length, q.value.length);
  };
  el.querySelector('#v-estado').onchange = e => { filtro.estado = e.target.value; render(el, ctx); };
  el.querySelectorAll('tr[data-chapeta]').forEach(tr =>
    tr.addEventListener('click', () => abrirFichaVaca(tr.dataset.chapeta, ctx)));
}
