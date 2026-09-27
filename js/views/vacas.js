// Vista Vacas — listado con acceso a la hoja de vida
import { fmtFecha, esc, edadTexto } from '../util.js';
import { tablaHTML, badge, redibujarSoloTabla } from '../ui.js';
import { prenezActivaDe, estadoReproductivo, semaforoDiasVacia, ajustes } from '../logic.js';
import { formNuevaVaca } from '../forms.js';
import { abrirFichaVaca } from '../fichas.js';
import { avatarHTML, iniciarRonda } from '../fotos.js';
import { imprimir, construirListaVacas } from '../print.js';

let filtro = { q: '', estado: 'ACTIVA' };

export function render(el, ctx) {
  const { state } = ctx;
  // Si llegamos desde la tarjeta del tablero, aplicar ese filtro
  if (ctx.opciones && ctx.opciones.filtro) {
    filtro.estado = ctx.opciones.filtro;
    ctx.opciones = null;
  }
  let filas = [...state.vacas].sort((a, b) =>
    String(a.chapeta || '').localeCompare(String(b.chapeta || ''), 'es', { numeric: true }));
  filas = filas.filter(v => v.tipo !== 'toro'); // los toros tienen su propia pestaña

  // Estado reproductivo de cada vaca (para columna y filtros)
  const repro = new Map(filas.map(v => [v.chapeta, estadoReproductivo(state, v)]));

  if (filtro.estado === 'SIN_SERVICIO') {
    filas = filas.filter(v => repro.get(v.chapeta).estado === 'SIN_SERVICIO')
      .sort((a, b) => (repro.get(b.chapeta).diasVacia || 0) - (repro.get(a.chapeta).diasVacia || 0));
  } else if (filtro.estado === 'PRENADAS') {
    filas = filas.filter(v => repro.get(v.chapeta).estado === 'PREÑADA');
  } else if (filtro.estado === 'ESPERANDO') {
    filas = filas.filter(v => repro.get(v.chapeta).estado === 'ESPERANDO');
  } else if (filtro.estado) {
    filas = filas.filter(v => v.estado === filtro.estado);
  }
  if (filtro.q) {
    const q = filtro.q.toLowerCase();
    filas = filas.filter(v => [v.chapeta, v.codigo, v.genetica, v.criaActual]
      .some(x => String(x || '').toLowerCase().includes(q)));
  }

  el.innerHTML = `
    <div class="hint">💡 <span>Toca cualquier vaca para ver su <b>hoja de vida completa</b>: crías, servicios, preñeces y acciones (parto, venta…).</span></div>
    <div class="toolbar">
      <button class="btn btn-primary" id="btn-nueva">➕ Nueva vaca</button>
      <button class="btn btn-ghost" id="btn-ronda">📷 Ronda de fotos</button>
      <input class="search" id="v-q" placeholder="🔍 Chapeta, código, cría…" value="${esc(filtro.q)}">
      <select class="filter-sel" id="v-estado">
        <option value="ACTIVA" ${filtro.estado === 'ACTIVA' ? 'selected' : ''}>Activas</option>
        <option value="SIN_SERVICIO" ${filtro.estado === 'SIN_SERVICIO' ? 'selected' : ''}>⏰ Sin servicio</option>
        <option value="PRENADAS" ${filtro.estado === 'PRENADAS' ? 'selected' : ''}>🤰 Preñadas</option>
        <option value="ESPERANDO" ${filtro.estado === 'ESPERANDO' ? 'selected' : ''}>⏳ Esperando confirmación</option>
        <option value="VENDIDA" ${filtro.estado === 'VENDIDA' ? 'selected' : ''}>Vendidas</option>
        <option value="FALLECIDA" ${filtro.estado === 'FALLECIDA' ? 'selected' : ''}>Fallecidas</option>
        <option value="">Todas</option>
      </select>
      <span class="muted" style="font-size:13px;">${filas.length} vacas</span>
      <button class="btn btn-ghost btn-sm" id="btn-lista-vacas" title="Imprimir esta lista">🖨️ PDF</button>
      ${filtro.estado === 'SIN_SERVICIO' ? `<span class="muted" style="font-size:12.5px;">
        (parieron hace más de ${ajustes(state).esperaPosparto} días y no tienen monta ni inseminación registrada)</span>` : ''}
    </div>

    <div class="table-wrap">${tablaHTML({
      columns: [
        { key: 'chapeta', label: 'Chapeta', render: v =>
            `<span class="nombre-con-foto">${avatarHTML(state, v, { tam: 'sm' })}<b>${esc(v.chapeta)}</b></span>` },
        { key: 'codigo', label: 'Código' },
        { key: 'genetica', label: 'Genética' },
        { key: 'edad', label: 'Edad', render: v => edadTexto(v.fechaNac) },
        { key: 'ultimoParto', label: 'Último parto', render: v => fmtFecha(v.ultimoParto) },
        { key: 'criaActual', label: 'Cría actual' },
        { key: 'prenez', label: 'Reproducción', render: v => {
            const r = repro.get(v.chapeta) || {};
            const p = prenezActivaDe(state, v.chapeta);
            if (r.estado === 'PREÑADA' && p) return `🤰 parto ${fmtFecha(p.fechaProbParto)}`;
            if (r.estado === 'ESPERANDO') {
              return `⏳ ${r.listoParaPalpar ? '<span class="badge badge-vigente">listo para palpar</span>' : 'servicio hace ' + r.diasServicio + ' d'}`;
            }
            if (r.estado === 'SIN_SERVICIO') {
              const sem = semaforoDiasVacia(r.diasVacia);
              return `<span class="badge badge-sinservicio-${sem}">⏰ ${r.diasVacia} días sin servicio</span>`;
            }
            if (r.estado === 'DESCANSO') return `<span class="muted">descansando (${r.diasVacia} d)</span>`;
            if (r.estado === 'NOVILLA') return '<span class="muted">novilla</span>';
            return '';
          } },
        { key: 'estado', label: 'Estado', render: v => badge(v.estado) },
      ],
      rows: filas,
      rowAttr: v => `class="row-click" data-chapeta="${esc(v.chapeta)}"`,
      emptyMsg: 'No hay vacas con ese filtro.',
    })}</div>
  `;

  el.querySelector('#btn-nueva').onclick = () => formNuevaVaca(ctx);
  el.querySelector('#btn-ronda').onclick = () => iniciarRonda(ctx, 'vacas');
  el.querySelector('#btn-lista-vacas').onclick = () => {
    const nombreFiltro = el.querySelector('#v-estado').selectedOptions[0]?.textContent.trim() || '';
    imprimir('vacas-' + (filtro.estado || 'todas').toLowerCase(), 'Lista de vacas', construirListaVacas(state, filas, repro),
      { subtitulo: `${filas.length} vacas · ${nombreFiltro}${filtro.q ? ' · búsqueda: ' + filtro.q : ''}` });
  };
  el.querySelector('#v-q').oninput = e => { filtro.q = e.target.value; redibujarSoloTabla(el, t => render(t, ctx)); };
  el.querySelector('#v-estado').onchange = e => { filtro.estado = e.target.value; render(el, ctx); };
  el.querySelectorAll('tr[data-chapeta]').forEach(tr =>
    tr.addEventListener('click', () => abrirFichaVaca(tr.dataset.chapeta, ctx)));
}
