// Vista Toros — los reproductores de la finca, aparte de las vacas
import * as db from '../db.js';
import { fmtFecha, esc, edadTexto, hoyISO } from '../util.js';
import { tablaHTML, badge, toast, formModal, confirmar } from '../ui.js';
import { registrarEvento, serviciosDe } from '../logic.js';
import { abrirFichaVaca } from '../fichas.js';

export function render(el, ctx) {
  const { state } = ctx;
  const toros = state.vacas.filter(v => v.tipo === 'toro')
    .sort((a, b) => a.chapeta.localeCompare(b.chapeta, 'es'));

  // Montas de cada toro (servicios de tipo MN donde aparece su nombre)
  const montasDe = nombre => state.servicios.filter(s =>
    s.tipo === 'MN' && (s.raza || '').toLowerCase().includes(nombre.toLowerCase()));

  el.innerHTML = `
    <div class="hint">🐂 <span>Los toros de la finca. Sus montas se registran en
      <b>Reproducción → 🐂 Monta con toro</b>.</span></div>
    <div class="fab-row">
      <button class="btn btn-primary" id="btn-nuevo">➕ Registrar toro</button>
    </div>
    <div class="table-wrap">${tablaHTML({
      columns: [
        { key: 'chapeta', label: 'Nombre', render: t => `🐂 <b>${esc(t.chapeta)}</b>` },
        { key: 'genetica', label: 'Raza / genética' },
        { key: 'fechaNac', label: 'Nacimiento', render: t => fmtFecha(t.fechaNac) },
        { key: 'edad', label: 'Edad', render: t => edadTexto(t.fechaNac) },
        { key: 'montas', label: 'Montas', num: true, render: t => {
            const n = montasDe(t.chapeta).length;
            return n ? `${n}` : '<span class="muted">—</span>';
          } },
        { key: 'notas', label: 'Notas' },
        { key: 'estado', label: 'Estado', render: t => badge(t.estado) },
        { key: '_a', label: '', render: t => `<div class="act-cell">
            <button class="btn-icon" title="Editar" data-editar="${esc(t.chapeta)}">✏️</button>
            ${t.estado === 'ACTIVA' ? `<button class="btn-icon" title="Dar de baja" data-baja="${esc(t.chapeta)}">📤</button>` : ''}
          </div>` },
      ],
      rows: toros,
      emptyMsg: 'Aún no hay toros registrados.',
    })}</div>
  `;

  el.querySelector('#btn-nuevo').onclick = () => formToro(null, ctx);
  el.querySelectorAll('[data-editar]').forEach(b => b.addEventListener('click', () => {
    formToro(ctx.state.vacas.find(v => v.chapeta === b.dataset.editar), ctx);
  }));
  el.querySelectorAll('[data-baja]').forEach(b => b.addEventListener('click', async () => {
    const t = ctx.state.vacas.find(v => v.chapeta === b.dataset.baja);
    if (!t) return;
    formBaja(t, ctx);
  }));
}

function formToro(toro, ctx) {
  const esNuevo = !toro;
  formModal({
    title: esNuevo ? '🐂 Registrar toro' : `✏️ Editar ${esc(toro.chapeta)}`,
    submitLabel: esNuevo ? 'Registrar' : 'Guardar cambios',
    fields: [
      { name: 'chapeta', label: 'Nombre del toro', required: true, value: toro?.chapeta,
        readonly: !esNuevo, half: true, placeholder: 'Eclipse' },
      { name: 'fechaNac', label: 'Fecha de nacimiento', type: 'date', value: toro?.fechaNac, half: true },
      { name: 'genetica', label: 'Raza / genética', value: toro?.genetica, placeholder: 'Gyr, Brahman…' },
      { name: 'notas', label: 'Notas', type: 'textarea', value: toro?.notas },
    ],
    async onSubmit(v) {
      if (esNuevo) {
        if (ctx.state.vacas.some(x => x.chapeta.toLowerCase() === v.chapeta.toLowerCase())) {
          throw new Error(`Ya existe un animal llamado "${v.chapeta}".`);
        }
        await db.add('vacas', {
          chapeta: v.chapeta, codigo: '', genetica: v.genetica, fechaNac: v.fechaNac,
          sexo: 'Macho', ultimoParto: '', criaActual: '', fechaPrenez: '', fechaProbParto: '',
          estado: 'ACTIVA', fechaSalida: '', notas: v.notas || 'Toro reproductor', tipo: 'toro',
        });
        await registrarEvento('TORO', v.chapeta, 'ALTA_TORO', { fecha: v.fechaNac, causa: v.genetica });
        toast(`Toro ${v.chapeta} registrado. 🐂`);
      } else {
        Object.assign(toro, { fechaNac: v.fechaNac, genetica: v.genetica, notas: v.notas });
        await db.put('vacas', toro);
        toast(`Toro ${toro.chapeta} actualizado.`);
      }
      ctx.refresh();
    },
  });
}

function formBaja(toro, ctx) {
  formModal({
    title: `📤 Dar de baja a ${esc(toro.chapeta)}`,
    submitLabel: 'Registrar',
    fields: [
      { name: 'estado', label: '¿Qué pasó?', type: 'select',
        options: [{ value: 'VENDIDA', label: 'Vendido' }, { value: 'FALLECIDA', label: 'Falleció' }], half: true },
      { name: 'fecha', label: 'Fecha', type: 'date', required: true, value: hoyISO(), half: true },
      { name: 'causa', label: 'Comprador / causa' },
    ],
    async onSubmit(v) {
      toro.estado = v.estado;
      toro.fechaSalida = v.fecha;
      await db.put('vacas', toro);
      await registrarEvento('TORO', toro.chapeta, v.estado === 'VENDIDA' ? 'VENDIDO' : 'FALLECIDO',
        { fecha: v.fecha, causa: v.causa });
      toast(`Toro ${toro.chapeta} dado de baja.`);
      ctx.refresh();
    },
  });
}
