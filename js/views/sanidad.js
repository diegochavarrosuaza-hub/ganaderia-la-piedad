// Vista Sanidad — vacunas y tratamientos.
//   1. El catálogo: cada vacuna o producto se crea una sola vez (con su
//      refuerzo, si lleva).
//   2. Las aplicaciones: cada vez que se aplica, se marca a qué animales.
//      También se puede aplicar desde la hoja de vida de cada animal.
//   3. Los refuerzos pendientes avisan en el tablero.
import { fmtFecha, esc, hoyISO, diasEntre } from '../util.js';
import { tablaHTML, badge, toast, confirmar } from '../ui.js';
import { catalogo, reaplicarTratamiento, TIPOS_PRODUCTO, animalesDeTratamiento } from '../logic.js';
import { formAplicacion, formProducto, formEditarAplicacion } from '../forms.js';

export function render(el, ctx) {
  const { state } = ctx;
  const cat = catalogo(state);
  const filas = [...(state.tratamientos || [])].sort((a, b) =>
    (b.fecha || '').localeCompare(a.fecha || '') || (b.id - a.id));

  const refuerzo = t => {
    if (!t.fechaReaplicar) return '<span class="muted">no lleva</span>';
    if (t.estado === 'HECHO') return `<span class="muted">${fmtFecha(t.fechaReaplicar)} ✓</span>`;
    const d = diasEntre(hoyISO(), t.fechaReaplicar);
    const cls = d < 0 ? 'badge-vencido' : (d <= 15 ? 'badge-vigente' : '');
    const txt = d < 0 ? `atrasado ${-d} d` : (d === 0 ? 'hoy' : `en ${d} d`);
    return `${fmtFecha(t.fechaReaplicar)} <span class="badge ${cls}">${txt}</span>`;
  };

  el.innerHTML = `
    <div class="hint">💡 <span>Crea cada <b>vacuna o producto una sola vez</b>. Después, cada vez que se aplique,
      regístralo y <b>marca a qué animales</b> se les puso. También se puede aplicar desde la hoja de vida de
      cada animal (💉 Vacuna / tratamiento). Si lleva refuerzo, la app avisa en el tablero.</span></div>
    <div class="fab-row">
      <button class="btn btn-primary" id="btn-aplicar">💉 Registrar aplicación</button>
      <button class="btn btn-ghost" id="btn-producto">➕ Nueva vacuna o producto</button>
    </div>

    <div class="card">
      <h2>🧴 Vacunas y productos <span class="h2-note">${cat.length}</span></h2>
      ${cat.length ? `<div class="prod-grid">${cat.map(p => `
        <div class="prod-card">
          <div class="prod-nombre">${esc(p.nombre)}</div>
          <div class="muted prod-tipo">${esc(TIPOS_PRODUCTO[p.tipo] || 'Sin tipo')}${p.diasReaplicar ? ` · refuerzo cada ${p.diasReaplicar} días` : ''}</div>
          <div class="prod-uso">${p.ultima
            ? `Última vez: ${fmtFecha(p.ultima.fecha)} · ${p.ultima.n} animal${p.ultima.n === 1 ? '' : 'es'}`
            : 'Todavía no se ha aplicado'}</div>
          <div class="prod-acc">
            <button class="btn btn-primary btn-sm" data-aplicar="${esc(p.nombre)}">💉 Aplicar</button>
            ${p.uid ? `<button class="btn-icon" data-editp="${esc(p.uid)}" title="Editar">✏️</button>` : ''}
          </div>
        </div>`).join('')}</div>`
        : '<div class="empty-note">Todavía no hay vacunas ni productos. Crea el primero con “➕ Nueva vacuna o producto”.</div>'}
    </div>

    <div class="card">
      <h2>📋 Aplicaciones <span class="h2-note">toca una para ver o corregir a quiénes</span></h2>
      <div class="table-wrap" style="box-shadow:none;">${tablaHTML({
        columns: [
          { key: 'fecha', label: 'Fecha', render: t => fmtFecha(t.fecha) },
          { key: 'producto', label: 'Vacuna / producto', render: t => `<b>${esc(t.producto)}</b>` },
          { key: 'aplicadoA', label: 'A quiénes', render: t => esc(t.aplicadoA || '') },
          { key: 'reaplicar', label: 'Refuerzo', render: refuerzo },
          { key: 'estado', label: 'Estado', render: t => badge(t.estado === 'HECHO' ? 'REAPLICADO' : (t.fechaReaplicar ? 'PENDIENTE' : 'VIGENTE')) },
          { key: '_a', label: '', render: t => (t.estado !== 'HECHO' && t.fechaReaplicar)
              ? `<button class="btn btn-primary btn-sm" data-reap="${t.id}">✅ Ya se reforzó</button>` : '' },
        ],
        rows: filas,
        rowAttr: t => `class="row-click" data-trat="${t.id}"`,
        emptyMsg: 'Aún no hay aplicaciones registradas.',
      })}</div>
    </div>
  `;

  el.querySelector('#btn-aplicar').onclick = () => formAplicacion(ctx);
  el.querySelector('#btn-producto').onclick = () => formProducto(ctx);
  el.querySelectorAll('[data-aplicar]').forEach(b => b.addEventListener('click', () =>
    formAplicacion(ctx, { producto: b.dataset.aplicar })));
  el.querySelectorAll('[data-editp]').forEach(b => b.addEventListener('click', () => {
    const p = (ctx.state.productos || []).find(x => x.uid === b.dataset.editp);
    if (p) formProducto(ctx, p);
  }));
  el.querySelectorAll('tr[data-trat]').forEach(tr => tr.addEventListener('click', e => {
    if (e.target.closest('button')) return;
    const t = ctx.state.tratamientos.find(x => x.id === Number(tr.dataset.trat));
    if (t) formEditarAplicacion(t, ctx);
  }));
  el.querySelectorAll('[data-reap]').forEach(b => b.addEventListener('click', async e => {
    e.stopPropagation();
    const t = ctx.state.tratamientos.find(x => x.id === Number(b.dataset.reap));
    if (!t) return;
    const n = animalesDeTratamiento(ctx.state, t).length;
    if (!(await confirmar(`¿Registrar que el refuerzo de <b>${esc(t.producto)}</b> se aplicó hoy a los mismos `
      + `<b>${n} animal${n === 1 ? '' : 'es'}</b>? Se agenda el siguiente en ${t.diasReaplicar} días.`
      + '<br><br>Si cambió a quiénes se les puso, mejor usa “💉 Registrar aplicación”.', { okLabel: 'Sí, se reforzó' }))) return;
    await reaplicarTratamiento(t);
    toast('Refuerzo registrado. Próximo agendado.');
    ctx.refresh();
  }));
}
