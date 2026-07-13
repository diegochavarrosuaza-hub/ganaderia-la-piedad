// Vista Terneros — listado con peso y crecimiento
import { fmtFecha, fmtNum, esc, edadTexto } from '../util.js';
import { tablaHTML, badge } from '../ui.js';
import { gdpDe } from '../logic.js';
import { formNuevoTernero, formPesaje } from '../forms.js';
import { abrirFichaTernero } from '../fichas.js';

let filtro = { q: '', estado: 'vivos' };

export function render(el, ctx) {
  const { state } = ctx;
  let filas = [...state.terneros].sort((a, b) => (b.fechaNac || '').localeCompare(a.fechaNac || ''));
  if (filtro.estado === 'vivos') filas = filas.filter(t => t.activo);
  else if (filtro.estado === 'vendidos') filas = filas.filter(t => t.tipoSalida === 'VENDIDO');
  else if (filtro.estado === 'fallecidos') filas = filas.filter(t => t.tipoSalida === 'FALLECIDO');
  if (filtro.q) {
    const q = filtro.q.toLowerCase();
    filas = filas.filter(t => [t.nombre, t.codigoMadre, t.observaciones]
      .some(x => String(x || '').toLowerCase().includes(q)));
  }

  el.innerHTML = `
    <div class="hint">💡 <span>Toca un ternero para ver su <b>curva de crecimiento</b> y registrar pesajes, ventas o salidas.</span></div>
    <div class="toolbar">
      <button class="btn btn-primary" id="btn-nuevo">➕ Nuevo ternero</button>
      <button class="btn btn-ghost" id="btn-pesar">⚖️ Registrar pesaje</button>
      <input class="search" id="t-q" placeholder="🔍 Nombre, madre…" value="${esc(filtro.q)}">
      <select class="filter-sel" id="t-estado">
        <option value="vivos" ${filtro.estado === 'vivos' ? 'selected' : ''}>Vivos</option>
        <option value="vendidos" ${filtro.estado === 'vendidos' ? 'selected' : ''}>Vendidos</option>
        <option value="fallecidos" ${filtro.estado === 'fallecidos' ? 'selected' : ''}>Fallecidos</option>
        <option value="" ${filtro.estado === '' ? 'selected' : ''}>Todos</option>
      </select>
      <span class="muted" style="font-size:13px;">${filas.length} terneros</span>
    </div>

    <div class="table-wrap">${tablaHTML({
      columns: [
        { key: 'nombre', label: 'Nombre', render: t => `<b>${esc(t.nombre)}</b>` },
        { key: 'sexo', label: 'Sexo' },
        { key: 'edad', label: 'Edad', render: t => edadTexto(t.fechaNac) },
        { key: 'codigoMadre', label: 'Madre', render: t => t.codigoMadre ? '🐄 ' + esc(t.codigoMadre) : '' },
        { key: 'ultimoPeso', label: 'Último peso', num: true,
          render: t => t.ultimoPeso ? `<b>${fmtNum(t.ultimoPeso, 1)} kg</b>` : '' },
        { key: 'gdp', label: 'Ganancia', num: true, render: t => {
            const g = gdpDe(state, t.nombre);
            return g != null ? fmtNum(g * 1000, 0) + ' g/día' : '';
          } },
        { key: 'estado', label: 'Estado', render: t => badge(t.activo ? 'VIVO' : (t.tipoSalida || 'NO')) },
      ],
      rows: filas,
      rowAttr: t => `class="row-click" data-nombre="${esc(t.nombre)}"`,
      emptyMsg: 'No hay terneros con ese filtro.',
    })}</div>
  `;

  el.querySelector('#btn-nuevo').onclick = () => formNuevoTernero(ctx);
  el.querySelector('#btn-pesar').onclick = () => formPesaje(ctx);
  el.querySelector('#t-q').oninput = e => {
    filtro.q = e.target.value; render(el, ctx);
    const q = el.querySelector('#t-q'); q.focus(); q.setSelectionRange(q.value.length, q.value.length);
  };
  el.querySelector('#t-estado').onchange = e => { filtro.estado = e.target.value; render(el, ctx); };
  el.querySelectorAll('tr[data-nombre]').forEach(tr =>
    tr.addEventListener('click', () => abrirFichaTernero(tr.dataset.nombre, ctx)));
}
