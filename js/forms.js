// forms.js — formularios del negocio, compartidos por varias vistas
import * as db from './db.js';
import { hoyISO, addDias, fmtFecha, esc, edadMeses } from './util.js';
import { formModal, toast } from './ui.js';
import * as logic from './logic.js';

const GENETICAS = ['F1', 'Plus', 'Plus x Plus', 'Convencional', 'Otra'];

// Cómo quedó preñada la vaca. Antes la monta con toro se escribía como nota
// suelta; clasificarla es lo que deja comparar después qué está funcionando.
const ORIGENES = [
  { value: 'MN', label: '🐂 Monta con toro' },
  { value: 'IA', label: '💉 Inseminación' },
  { value: 'TE', label: '🔬 Transferencia de embrión' },
  { value: '', label: '❓ Todavía no se sabe' },
];
const RESULTADOS = [
  { value: 'PENDIENTE', label: '⏳ Pendiente por confirmar' },
  { value: 'PREÑADA', label: '✅ Preñada' },
  { value: 'VACÍA', label: '❌ Vacía (no funcionó)' },
];

/*
 * Mantiene "parto probable" al día mientras se elige la fecha y el origen.
 * Si la usuaria escribe esa fecha a mano (vaca comprada preñada, con fecha
 * dada por el vendedor) se respeta y deja de recalcularse sola.
 */
function autoFechaParto(form) {
  const fp = form.querySelector('[name="fechaPrenez"]');
  const or = form.querySelector('[name="origen"]');
  const pp = form.querySelector('[name="fechaProbParto"]');
  if (!fp || !pp) return;
  let aMano = false;
  pp.addEventListener('input', () => { aMano = true; });
  const calcular = () => {
    if (aMano || !fp.value) return;
    pp.value = addDias(fp.value, logic.DIAS_GESTACION[or ? or.value : 'MN'] || 280);
  };
  fp.addEventListener('change', calcular);
  if (or) or.addEventListener('change', calcular);
  if (!pp.value) calcular();
}

// ── VACAS ─────────────────────────────────────────────────────────
export function formNuevaVaca(ctx) {
  formModal({
    title: '🐄 Registrar nueva vaca',
    fields: [
      { name: 'chapeta', label: 'Chapeta', required: true, half: true, placeholder: '072' },
      { name: 'codigo', label: 'Código de registro', half: true, placeholder: '367-20' },
      { name: 'genetica', label: 'Genética', type: 'select', options: GENETICAS, half: true },
      { name: 'fechaNac', label: 'Fecha de nacimiento', type: 'date', half: true },
      { name: 'ultimoParto', label: 'Último parto (si ya parió)', type: 'date', half: true },
      { name: 'criaActual', label: 'Cría actual (nombre)', half: true },
      { name: 'notas', label: 'Notas', type: 'textarea' },
    ],
    async onSubmit(v) {
      if (ctx.state.vacas.some(x => x.chapeta === v.chapeta)) {
        throw new Error(`Ya existe una vaca con la chapeta ${v.chapeta}.`);
      }
      await db.add('vacas', {
        chapeta: v.chapeta, codigo: v.codigo, genetica: v.genetica,
        fechaNac: v.fechaNac, sexo: 'Hembra', ultimoParto: v.ultimoParto,
        criaActual: v.criaActual, fechaPrenez: '', fechaProbParto: '',
        estado: 'ACTIVA', fechaSalida: '', notas: v.notas,
      });
      await logic.registrarEvento('VACA', v.chapeta, 'ALTA_VACA', { fecha: v.fechaNac });
      toast(`Vaca ${v.chapeta} registrada.`);
      ctx.refresh();
    },
  });
}

export function formEditarVaca(vaca, ctx) {
  formModal({
    title: '✏️ Editar vaca ' + esc(vaca.chapeta),
    submitLabel: 'Guardar cambios',
    fields: [
      { name: 'codigo', label: 'Código de registro', value: vaca.codigo, half: true },
      { name: 'genetica', label: 'Genética', type: 'select', value: vaca.genetica,
        options: [...new Set([...(vaca.genetica ? [vaca.genetica] : []), ...GENETICAS])], half: true },
      { name: 'fechaNac', label: 'Fecha de nacimiento', type: 'date', value: vaca.fechaNac, half: true },
      { name: 'ultimoParto', label: 'Último parto', type: 'date', value: vaca.ultimoParto, half: true },
      { name: 'criaActual', label: 'Cría actual', value: vaca.criaActual, half: true },
      { name: 'estado', label: 'Estado', type: 'select', value: vaca.estado,
        options: ['ACTIVA', 'VENDIDA', 'FALLECIDA'], half: true },
      { name: 'notas', label: 'Notas', type: 'textarea', value: vaca.notas },
    ],
    async onSubmit(v) {
      Object.assign(vaca, v);
      await db.put('vacas', vaca);
      toast(`Vaca ${vaca.chapeta} actualizada.`);
      ctx.refresh();
    },
  });
}

export function formEstadoVaca(vaca, estado, ctx) {
  const esVenta = estado === 'VENDIDA';
  formModal({
    title: esVenta ? `💰 Vender vaca ${esc(vaca.chapeta)}` : `🕊️ Registrar fallecimiento — vaca ${esc(vaca.chapeta)}`,
    submitLabel: esVenta ? 'Registrar venta' : 'Registrar',
    fields: [
      { name: 'fecha', label: 'Fecha', type: 'date', required: true, value: hoyISO(), half: true },
      ...(esVenta ? [{ name: 'precio', label: 'Precio de venta ($)', type: 'number', half: true }] : []),
      { name: 'causa', label: esVenta ? 'Comprador / destino' : 'Causa', placeholder: esVenta ? '¿A quién se vendió?' : '¿Qué pasó?' },
    ],
    async onSubmit(v) {
      await logic.cambiarEstadoVaca(vaca, estado, v);
      toast(`Vaca ${vaca.chapeta} marcada como ${estado.toLowerCase()}.`);
      ctx.refresh();
    },
  });
}

// Si no se pasa chapeta, el formulario pregunta primero de qué vaca se trata.
export function formPrenez(chapeta, ctx) {
  const disponibles = ctx.state.vacas
    .filter(v => v.estado === 'ACTIVA' && !logic.esToro(v)
      && !ctx.state.prenez.some(p => p.chapeta === v.chapeta && p.estado === 'PREÑADA'))
    .map(v => v.chapeta);
  if (!chapeta && !disponibles.length) {
    return toast('Todas las vacas activas ya tienen una preñez registrada.', 'info');
  }

  formModal({
    title: chapeta ? `🤰 Registrar preñez — vaca ${esc(chapeta)}` : '🤰 Registrar preñez',
    fields: [
      ...(chapeta ? [] : [{ name: 'chapeta', label: 'Vaca (chapeta)', type: 'select',
        required: true, options: disponibles }]),
      { name: 'origen', label: '¿Cómo quedó preñada?', type: 'select', value: 'MN', options: ORIGENES },
      { name: 'fechaPrenez', label: 'Fecha de la monta o del servicio', type: 'date',
        required: true, value: hoyISO(), half: true },
      { name: 'fechaProbParto', label: 'Parto probable', type: 'date', half: true,
        help: 'Se calcula sola; cámbiala si te dieron la fecha exacta.' },
      { name: 'fechaPreparto', label: 'Inicio del preparto (si ya empezó)', type: 'date', half: true },
      { name: 'observaciones', label: 'Observaciones', half: true,
        placeholder: 'Toro Eclipse, embrión de Bronco…' },
    ],
    afterRender: autoFechaParto,
    async onSubmit(v) {
      const fpp = await logic.crearPrenez({
        chapeta: chapeta || v.chapeta, fechaPrenez: v.fechaPrenez, origen: v.origen,
        fechaProbParto: v.fechaProbParto, fechaPreparto: v.fechaPreparto,
        observaciones: v.observaciones,
      });
      toast(`Preñez registrada. Parto esperado: ${fmtFecha(fpp)}.`);
      ctx.refresh();
    },
  });
}

export function formEditarPrenez(p, ctx) {
  formModal({
    title: `✏️ Corregir preñez — vaca ${esc(p.chapeta)}`,
    submitLabel: 'Guardar cambios',
    fields: [
      { name: 'origen', label: '¿Cómo quedó preñada?', type: 'select',
        value: logic.origenDe(p), options: ORIGENES },
      { name: 'fechaPrenez', label: 'Fecha de la monta o del servicio', type: 'date',
        required: true, value: p.fechaPrenez, half: true },
      { name: 'fechaProbParto', label: 'Parto probable', type: 'date', value: p.fechaProbParto, half: true },
      { name: 'fechaPreparto', label: 'Inicio del preparto', type: 'date', value: p.fechaPreparto || '', half: true },
      { name: 'estado', label: 'Estado', type: 'select', value: p.estado, half: true, options: [
        { value: 'PREÑADA', label: '🤰 Preñada (en curso)' },
        { value: 'PARIDA', label: '🍼 Ya parió' },
        { value: 'PERDIDA', label: '💔 Perdió la cría' },
      ] },
      { name: 'observaciones', label: 'Observaciones', type: 'textarea', value: p.observaciones },
    ],
    afterRender: autoFechaParto,
    async onSubmit(v) {
      await logic.actualizarPrenez(p, v);
      toast(`Preñez de la vaca ${p.chapeta} corregida.`);
      ctx.refresh();
    },
    onDelete: {
      mensaje: `¿Eliminar la preñez de la vaca <b>${esc(p.chapeta)}</b> del ${fmtFecha(p.fechaPrenez)}?`
        + '<br><br>La vaca quedará sin preñez y volverá a la lista de las que necesitan servicio.',
      async run() {
        await logic.eliminarPrenez(p);
        toast('Preñez eliminada.', 'info');
        ctx.refresh();
      },
    },
  });
}

export function formParto(chapeta, ctx) {
  formModal({
    title: `🍼 Registrar parto — vaca ${esc(chapeta)}`,
    submitLabel: 'Registrar parto',
    fields: [
      { name: 'fechaParto', label: 'Fecha del parto', type: 'date', required: true, value: hoyISO(), half: true },
      { name: 'criaNombre', label: 'Nombre de la cría', half: true, placeholder: 'Se crea como ternero',
        help: 'Si lo dejas vacío, solo se cierra la preñez.' },
      { name: 'sexoCria', label: 'Sexo de la cría', type: 'select', options: ['Macho', 'Hembra'], half: true },
      { name: 'brucelosis', label: 'Vacuna brucelosis', type: 'select', options: ['No', 'Sí'], half: true },
      { name: 'complicaciones', label: '¿Cómo salió todo?', type: 'select',
        options: [{ value: '', label: 'Todo bien' }, { value: 'si', label: 'Hubo complicaciones' }] },
    ],
    async onSubmit(v) {
      await logic.registrarParto({
        chapeta, fechaParto: v.fechaParto, criaNombre: v.criaNombre,
        sexoCria: v.sexoCria, brucelosis: v.brucelosis, complicaciones: !!v.complicaciones,
      });
      toast(v.criaNombre
        ? `Parto registrado. Ternero "${v.criaNombre}" creado automáticamente. 🎉`
        : 'Parto registrado.');
      ctx.refresh();
    },
  });
}

// ── TERNEROS ──────────────────────────────────────────────────────
export function formNuevoTernero(ctx) {
  const madres = ctx.state.vacas.filter(v => v.estado === 'ACTIVA').map(v => v.chapeta);
  formModal({
    title: '🐮 Registrar nuevo ternero',
    fields: [
      { name: 'nombre', label: 'Nombre', required: true, half: true },
      { name: 'sexo', label: 'Sexo', type: 'select', options: ['Macho', 'Hembra'], half: true },
      { name: 'fechaNac', label: 'Fecha de nacimiento', type: 'date', required: true, value: hoyISO(), half: true },
      { name: 'codigoMadre', label: 'Madre (chapeta)', type: 'select',
        options: ['', ...madres], half: true },
      { name: 'brucelosis', label: 'Vacuna brucelosis', type: 'select', options: ['No', 'Sí'], half: true },
      { name: 'observaciones', label: 'Observaciones', half: true },
    ],
    async onSubmit(v) {
      if (ctx.state.terneros.some(t => t.nombre.trim().toLowerCase() === v.nombre.trim().toLowerCase())) {
        throw new Error(`Ya existe un ternero llamado "${v.nombre}".`);
      }
      await db.add('terneros', {
        nombre: v.nombre, sexo: v.sexo, fechaNac: v.fechaNac, codigoMadre: v.codigoMadre,
        activo: true, fechaSalida: '', tipoSalida: '', brucelosis: v.brucelosis,
        observaciones: v.observaciones, ultimoPeso: null, fechaUltimoPesaje: '',
      });
      await logic.registrarEvento('TERNERO', v.nombre, 'ALTA_TERNERO',
        { fecha: v.fechaNac, causa: v.codigoMadre ? 'Madre: ' + v.codigoMadre : '' });
      toast(`Ternero ${v.nombre} registrado.`);
      ctx.refresh();
    },
  });
}

export function formEditarTernero(t, ctx) {
  formModal({
    title: '✏️ Editar ternero ' + esc(t.nombre),
    submitLabel: 'Guardar cambios',
    fields: [
      { name: 'sexo', label: 'Sexo', type: 'select', value: t.sexo, options: ['Macho', 'Hembra'], half: true },
      { name: 'fechaNac', label: 'Fecha de nacimiento', type: 'date', value: t.fechaNac, half: true },
      { name: 'codigoMadre', label: 'Madre (chapeta)', value: t.codigoMadre, half: true },
      { name: 'brucelosis', label: 'Vacuna brucelosis', type: 'select', value: t.brucelosis, options: ['No', 'Sí'], half: true },
      { name: 'observaciones', label: 'Observaciones', type: 'textarea', value: t.observaciones },
    ],
    async onSubmit(v) {
      Object.assign(t, v);
      await db.put('terneros', t);
      toast(`Ternero ${t.nombre} actualizado.`);
      ctx.refresh();
    },
  });
}

export function formSalidaTernero(t, tipo, ctx) {
  const esVenta = tipo === 'VENDIDO';
  formModal({
    title: esVenta ? `💰 Vender ternero ${esc(t.nombre)}` : `🕊️ Registrar muerte — ${esc(t.nombre)}`,
    submitLabel: 'Registrar',
    fields: [
      { name: 'fecha', label: 'Fecha', type: 'date', required: true, value: hoyISO(), half: true },
      ...(esVenta ? [{ name: 'precio', label: 'Precio de venta ($)', type: 'number', half: true }] : []),
      { name: 'causa', label: esVenta ? 'Comprador / destino' : 'Causa' },
    ],
    async onSubmit(v) {
      await logic.salidaTernero(t, tipo, v);
      toast(`Ternero ${t.nombre} registrado como ${tipo.toLowerCase()}.`);
      ctx.refresh();
    },
  });
}

// ── SERVICIOS ─────────────────────────────────────────────────────
export function formServicio(tipo, ctx, chapeta = '') {
  const esIA = tipo === 'IA', esMN = tipo === 'MN';
  const activas = ctx.state.vacas.filter(v => v.estado === 'ACTIVA' && v.tipo !== 'toro').map(v => v.chapeta);
  const toros = ctx.state.vacas.filter(v => v.tipo === 'toro' && v.estado === 'ACTIVA').map(v => v.chapeta);
  const titulo = esMN ? '🐂 Registrar monta con toro'
    : (esIA ? '💉 Registrar inseminación' : '🔬 Registrar transferencia de embrión');
  formModal({
    title: titulo,
    fields: [
      { name: 'chapeta', label: 'Vaca (chapeta)', type: 'select', required: true, value: chapeta,
        options: activas, half: true },
      { name: 'fecha', label: 'Fecha del servicio', type: 'date', required: true, value: hoyISO(), half: true },
      esMN
        ? { name: 'material', label: 'Tratamiento / celo', half: true, placeholder: 'Estro Zoo…' }
        : { name: 'material', label: esIA ? 'Tipo de semen' : 'Tipo de embrión', half: true,
            placeholder: esIA ? 'Sexado, convencional…' : 'Plus x Plus…' },
      ...(esMN ? [{ name: 'raza', label: 'Toro(s)', half: true,
          placeholder: toros.length ? toros.join(' y ') : 'Nombre del toro' }] : []),
      ...(esIA ? [{ name: 'raza', label: 'Raza del semen', half: true, placeholder: 'Gyr, Holstein…' }] : []),
      { name: 'cria', label: esIA ? 'Nombre cría esperada (opcional)' : 'Cría esperada (opcional)' },
    ],
    async onSubmit(v) {
      await db.add('servicios', {
        tipo, chapeta: v.chapeta, cria: v.cria, material: v.material,
        raza: v.raza || '', fecha: v.fecha, resultado: 'PENDIENTE', fechaConfirmacion: '',
      });
      const tipoEvento = esMN ? 'MONTA' : (esIA ? 'INSEMINACIÓN' : 'TRANSFERENCIA');
      await logic.registrarEvento('VACA', v.chapeta, tipoEvento,
        { fecha: v.fecha, causa: [v.material, v.raza].filter(Boolean).join(' — ') });
      const nombre = esMN ? 'Monta' : (esIA ? 'Inseminación' : 'Transferencia');
      toast(`${nombre} de la vaca ${v.chapeta} registrada. En ±45 días podrás confirmar el resultado.`);
      ctx.refresh();
    },
  });
}

// ── PESAJES ───────────────────────────────────────────────────────
export function formPesaje(ctx, nombre = '') {
  const vivos = ctx.state.terneros.filter(t => t.activo).map(t => t.nombre);
  formModal({
    title: '⚖️ Registrar pesaje',
    fields: [
      { name: 'nombre', label: 'Ternero', type: 'select', required: true, value: nombre, options: vivos, half: true },
      { name: 'fecha', label: 'Fecha', type: 'date', required: true, value: hoyISO(), half: true },
      { name: 'peso', label: 'Peso (kg)', type: 'number', step: '0.1', required: true, half: true },
      { name: 'observaciones', label: 'Observaciones', half: true },
    ],
    async onSubmit(v) {
      await logic.registrarPesaje(v);
      toast(`Pesaje de ${v.nombre}: ${v.peso} kg registrado.`);
      ctx.refresh();
    },
  });
}

// ── CORREGIR LO YA REGISTRADO ─────────────────────────────────────
// Todo lo que la app anota se puede corregir o borrar. Sin esto, un dato mal
// metido (una fecha de parto equivocada, una monta que no fue) se queda para
// siempre y la gente deja de confiar en lo que ve.

export function formEditarServicio(s, ctx) {
  formModal({
    title: `✏️ Corregir servicio — vaca ${esc(s.chapeta)}`,
    submitLabel: 'Guardar cambios',
    fields: [
      { name: 'tipo', label: 'Tipo de servicio', type: 'select', value: s.tipo, half: true,
        options: ORIGENES.filter(o => o.value) },
      { name: 'fecha', label: 'Fecha', type: 'date', required: true, value: s.fecha, half: true },
      { name: 'material', label: 'Semen / embrión / tratamiento', value: s.material, half: true },
      { name: 'raza', label: 'Toro o raza', value: s.raza, half: true },
      { name: 'resultado', label: 'Resultado', type: 'select', value: s.resultado, options: RESULTADOS,
        help: 'Aquí solo se corrige el dato. Para que la app cree la preñez sola, usa el botón ✅ Preñada de Reproducción.' },
    ],
    async onSubmit(v) {
      await logic.actualizarServicio(s, v);
      toast(`Servicio de la vaca ${s.chapeta} corregido.`);
      ctx.refresh();
    },
    onDelete: {
      mensaje: `¿Eliminar la ${logic.TIPO_SERVICIO[s.tipo] || 'servicio'} de la vaca `
        + `<b>${esc(s.chapeta)}</b> del ${fmtFecha(s.fecha)}?`,
      async run() {
        await logic.eliminarServicio(s);
        toast('Servicio eliminado.', 'info');
        ctx.refresh();
      },
    },
  });
}

export function formEditarPesaje(p, ctx) {
  const ternero = ctx.state.terneros.find(t =>
    t.nombre.trim().toLowerCase() === String(p.nombre).trim().toLowerCase());
  formModal({
    title: `✏️ Corregir pesaje — ${esc(p.nombre)}`,
    submitLabel: 'Guardar cambios',
    fields: [
      { name: 'fecha', label: 'Fecha del pesaje', type: 'date', required: true, value: p.fecha, half: true },
      { name: 'peso', label: 'Peso (kg)', type: 'number', step: '0.1', required: true, value: p.peso, half: true },
      { name: 'observaciones', label: 'Observaciones', value: p.observaciones },
    ],
    async onSubmit(v) {
      // Si cambia la fecha, la edad al pesar que se mostraba deja de servir.
      const edad = ternero && ternero.fechaNac ? edadMeses(ternero.fechaNac, v.fecha) : p.edadMeses;
      await logic.actualizarPesaje(p, { ...v, edadMeses: edad });
      toast(`Pesaje de ${p.nombre} corregido.`);
      ctx.refresh();
    },
    onDelete: {
      mensaje: `¿Eliminar el pesaje de <b>${esc(p.nombre)}</b> del ${fmtFecha(p.fecha)} (${p.peso} kg)?`
        + '<br><br>El último peso del ternero se vuelve a calcular con los pesajes que queden.',
      async run() {
        await logic.eliminarPesaje(p);
        toast('Pesaje eliminado.', 'info');
        ctx.refresh();
      },
    },
  });
}

export function formEditarEvento(ev, ctx) {
  formModal({
    title: '✏️ Corregir anotación de la bitácora',
    submitLabel: 'Guardar cambios',
    fields: [
      { name: 'tipo', label: 'Qué pasó', required: true, value: ev.tipo, half: true },
      { name: 'fecha', label: 'Fecha', type: 'date', value: ev.fecha, half: true },
      { name: 'causa', label: 'Detalle', value: ev.causa },
      { name: 'precio', label: 'Valor ($)', type: 'number', value: ev.precio ?? '', half: true },
    ],
    async onSubmit(v) {
      await logic.actualizarEvento(ev, {
        tipo: v.tipo, fecha: v.fecha, causa: v.causa,
        precio: v.precio === '' ? null : Number(v.precio),
      });
      toast('Anotación corregida.');
      ctx.refresh();
    },
    onDelete: {
      mensaje: `¿Borrar esta anotación de la bitácora?<br><br>`
        + `<b>${esc(ev.tipo)}</b> · ${esc(ev.refId)} · ${fmtFecha(ev.fecha)}`
        + '<br><br>Solo se borra la anotación; los datos del animal no cambian.',
      async run() {
        await logic.eliminarEvento(ev);
        toast('Anotación borrada.', 'info');
        ctx.refresh();
      },
    },
  });
}
