// Vista Pesajes — registro individual y masivo (día de báscula)
import * as db from '../db.js';
import { fmtFecha, fmtNum, esc, hoyISO, edadMeses } from '../util.js';
import { tablaHTML, toast, confirmar, openModal, closeModal } from '../ui.js';
import { registrarPesaje } from '../logic.js';
import { formPesaje } from '../forms.js';
import { abrirFichaTernero } from '../fichas.js';

export function render(el, ctx) {
  const { state } = ctx;
  const filas = [...state.pesajes].sort((a, b) =>
    (b.fecha || '').localeCompare(a.fecha || '') || (b.id - a.id)).slice(0, 120);

  el.innerHTML = `
    <div class="fab-row">
      <button class="btn btn-primary" id="btn-uno">⚖️ Registrar pesaje</button>
      <button class="btn btn-blue" id="btn-masivo">📋 Pesaje masivo (día de báscula)</button>
    </div>

    <div class="table-wrap">${tablaHTML({
      columns: [
        { key: 'fecha', label: 'Fecha', render: p => fmtFecha(p.fecha) },
        { key: 'nombre', label: 'Ternero', render: p => `<b>${esc(p.nombre)}</b>` },
        { key: 'peso', label: 'Peso', num: true, render: p => `<b>${fmtNum(p.peso, 1)} kg</b>` },
        { key: 'edadMeses', label: 'Edad al pesar', render: p => p.edadMeses != null ? fmtNum(p.edadMeses, 1) + ' meses' : '' },
        { key: 'observaciones', label: 'Observaciones' },
        { key: '_a', label: '', render: p =>
            `<button class="btn-icon" title="Eliminar" data-del="${p.id}">🗑️</button>` },
      ],
      rows: filas,
      rowAttr: p => `class="row-click" data-nombre="${esc(p.nombre)}"`,
      emptyMsg: 'No hay pesajes registrados todavía.',
    })}</div>
  `;

  el.querySelector('#btn-uno').onclick = () => formPesaje(ctx);
  el.querySelector('#btn-masivo').onclick = () => pesajeMasivo(ctx);
  el.querySelectorAll('tr[data-nombre]').forEach(tr =>
    tr.addEventListener('click', e => {
      if (e.target.closest('button')) return;
      abrirFichaTernero(tr.dataset.nombre, ctx);
    }));
  el.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async e => {
    e.stopPropagation();
    const p = ctx.state.pesajes.find(x => x.id === Number(b.dataset.del));
    if (!p) return;
    if (!(await confirmar(`¿Eliminar el pesaje de <b>${esc(p.nombre)}</b> del ${fmtFecha(p.fecha)} (${p.peso} kg)?`, { peligro: true, okLabel: 'Eliminar' }))) return;
    await db.del('pesajes', p.id);
    toast('Pesaje eliminado.', 'info');
    ctx.refresh();
  }));
}

// Un solo formulario con todos los terneros vivos: se llenan los que se pesaron
function pesajeMasivo(ctx) {
  const vivos = ctx.state.terneros.filter(t => t.activo)
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  if (!vivos.length) return toast('No hay terneros vivos para pesar.', 'error');

  const filas = vivos.map(t => `
    <div class="f-grid" style="align-items:center;">
      <div class="f-row" style="margin-bottom:6px;">
        <label style="margin:0;">${esc(t.nombre)} <span class="muted" style="font-weight:400;">
          ${t.ultimoPeso ? '(antes ' + fmtNum(t.ultimoPeso, 1) + ' kg)' : ''}</span></label>
      </div>
      <div class="f-row" style="margin-bottom:6px;">
        <input type="number" inputmode="decimal" step="0.1" placeholder="kg"
               data-peso="${esc(t.nombre)}">
      </div>
    </div>`).join('');

  const modal = openModal({
    lg: true,
    title: '📋 Pesaje masivo',
    bodyHTML: `
      <div class="f-row">
        <label>Fecha del pesaje</label>
        <input type="date" id="pm-fecha" value="${hoyISO()}">
      </div>
      <div class="hint">💡 <span>Escribe el peso solo de los terneros que pesaste hoy; los demás se dejan en blanco.</span></div>
      ${filas}
      <div class="modal-actions">
        <button class="btn btn-ghost" id="pm-cancel">Cancelar</button>
        <button class="btn btn-primary" id="pm-ok">Guardar pesajes</button>
      </div>`,
  });

  modal.querySelector('#pm-cancel').onclick = closeModal;
  modal.querySelector('#pm-ok').onclick = async () => {
    const fecha = modal.querySelector('#pm-fecha').value || hoyISO();
    const inputs = [...modal.querySelectorAll('[data-peso]')].filter(i => i.value.trim() !== '');
    if (!inputs.length) return toast('No escribiste ningún peso.', 'error');
    let ok = 0;
    for (const inp of inputs) {
      const t = ctx.state.terneros.find(x => x.nombre === inp.dataset.peso);
      try {
        await registrarPesaje({
          fecha, nombre: inp.dataset.peso, peso: parseFloat(inp.value),
          edadMeses: t ? edadMeses(t.fechaNac, fecha) : null, observaciones: '',
        });
        ok++;
      } catch { /* sigue con los demás */ }
    }
    closeModal();
    toast(`Pesaje masivo guardado: ${ok} terneros.`);
    ctx.refresh();
  };
}
