// forms.js — formularios del negocio, compartidos por varias vistas
import * as db from './db.js';
import { hoyISO, addDias, fmtFecha, esc, edadMeses } from './util.js';
import { formModal, toast, preguntar } from './ui.js';
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
  { value: 'CERRADO', label: '➖ Cerrado (la preñez vino de otro servicio, o ya parió)' },
];
const ETIQUETA_TIPO = { MN: 'Monta con toro', IA: 'Inseminación', TE: 'Transferencia' };
const activasDe = ctx => ctx.state.vacas.filter(v => v.estado === 'ACTIVA' && !logic.esToro(v)).map(v => v.chapeta);
const torosDe = ctx => ctx.state.vacas.filter(v => logic.esToro(v) && v.estado === 'ACTIVA').map(v => v.chapeta);
const pendientesDe = (ctx, chapeta) => ctx.state.servicios
  .filter(x => x.chapeta === String(chapeta) && x.resultado === 'PENDIENTE')
  .sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
const textoServicio = x => `${fmtFecha(x.fecha)} · ${ETIQUETA_TIPO[x.tipo] || x.tipo}${x.raza ? ' · ' + x.raza : ''}`;
// "por transferencia" · "sin saber todavía de qué servicio"
const metodoDe = p => {
  const o = logic.origenDe(p);
  return o ? 'por ' + logic.ORIGEN_PRENEZ[o].toLowerCase() : 'sin saber todavía de qué servicio';
};
// Abrir otra ventana justo después de que la actual se cierre sola.
const despues = fn => setTimeout(fn, 0);
const abrirTernero = (nombre, ctx) => import('./fichas.js').then(m => m.abrirFichaTernero(nombre, ctx));

/*
 * La vaca ya tiene un parto registrado hace muy poco: antes de crear otra
 * cría se pregunta qué pasó. Devuelve 'misma' | 'otra' | 'registrar' | null.
 */
function preguntarCriaRepetida(chapeta, reciente) {
  const { cria, dias } = reciente;
  const quien = cria
    ? `a <b>${esc(cria.nombre)}</b>${cria.sexo ? ' (' + esc(cria.sexo.toLowerCase()) + ')' : ''}, nacido el ${fmtFecha(cria.fechaNac)}`
    : `un parto el ${fmtFecha(reciente.fecha)}`;
  const gemelos = dias <= 3;
  return preguntar({
    titulo: `⚠️ La vaca ${esc(chapeta)} ya parió hace poco`,
    mensaje: `Ya tiene registrado ${quien}${dias === 0 ? ', el mismo día' : ` (${dias} día${dias === 1 ? '' : 's'} de diferencia)`}.`
      + '<br><br>Una vaca no vuelve a parir tan pronto. <b>¿Qué pasó?</b>',
    opciones: [
      ...(cria ? [{ valor: 'misma', texto: '📝 Es el mismo ternero: ya estaba registrado',
        detalle: `No se crea nada nuevo. Te abro la ficha de ${cria.nombre} por si hay que corregirla.` }] : []),
      { valor: 'otra', texto: '↩️ Me equivoqué de vaca', detalle: 'No se registra nada; vuelve y elige la madre correcta.' },
      gemelos
        ? { valor: 'registrar', texto: '👯 Son gemelos: es una segunda cría', detalle: 'Queda como segunda cría del mismo parto.' }
        : { valor: 'registrar', texto: '➕ Registrarla de todas formas', detalle: 'Solo si estás segura: la cría anterior sigue registrada.' },
    ],
  });
}

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

  // Si la vaca tiene montas o servicios pendientes, la preñez casi siempre
  // viene de uno de ellos: se elige y queda todo enlazado (el servicio pasa a
  // PREÑADA y los demás se cierran). Así no quedan montas "pendientes" eternas.
  const opcionesServicio = c => [
    ...pendientesDe(ctx, c).map(x => ({ value: String(x.id), label: textoServicio(x) })),
    { value: '', label: 'Otro / no quedó registrado' },
  ];
  const primera = chapeta || disponibles[0];

  formModal({
    title: chapeta ? `🤰 Registrar preñez — vaca ${esc(chapeta)}` : '🤰 Registrar preñez',
    fields: [
      ...(chapeta ? [] : [{ name: 'chapeta', label: 'Vaca (chapeta)', type: 'select',
        required: true, options: disponibles }]),
      { name: 'servicio', label: '¿De qué monta o servicio viene?', type: 'select',
        options: opcionesServicio(primera),
        help: 'Si eliges uno, la fecha y el origen se llenan solos.' },
      { name: 'origen', label: '¿Cómo quedó preñada?', type: 'select', value: 'MN', options: ORIGENES },
      { name: 'fechaPrenez', label: 'Fecha de la monta o del servicio', type: 'date',
        required: true, value: hoyISO(), half: true },
      { name: 'fechaProbParto', label: 'Parto probable', type: 'date', half: true,
        help: 'Se calcula sola; cámbiala si te dieron la fecha exacta.' },
      { name: 'fechaPreparto', label: 'Inicio del preparto (si ya empezó)', type: 'date', half: true },
      { name: 'observaciones', label: 'Observaciones', half: true,
        placeholder: 'Toro Eclipse, embrión de Bronco…' },
    ],
    afterRender(form) {
      autoFechaParto(form);
      const selV = form.querySelector('[name="chapeta"]');
      const selS = form.querySelector('[name="servicio"]');
      const or = form.querySelector('[name="origen"]');
      const fp = form.querySelector('[name="fechaPrenez"]');
      const aplicar = () => {
        const x = ctx.state.servicios.find(y => String(y.id) === selS.value);
        if (!x) return;
        or.value = x.tipo;
        fp.value = x.fecha;
        or.dispatchEvent(new Event('change'));
      };
      selS.addEventListener('change', aplicar);
      if (selV) selV.addEventListener('change', () => {
        selS.innerHTML = opcionesServicio(selV.value)
          .map(o => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('');
        aplicar();
      });
      aplicar();
    },
    async onSubmit(v) {
      const c = chapeta || v.chapeta;
      const x = ctx.state.servicios.find(y => String(y.id) === v.servicio);
      let fpp, cerrados = 0;
      if (x) {
        const r = await logic.confirmarServicio(x, 'PREÑADA', {
          fechaPrenez: v.fechaPrenez, fechaProbParto: v.fechaProbParto,
          fechaPreparto: v.fechaPreparto, observaciones: v.observaciones,
        });
        fpp = r.fechaProbParto; cerrados = r.cerrados || 0;
      } else {
        fpp = await logic.crearPrenez({
          chapeta: c, fechaPrenez: v.fechaPrenez, origen: v.origen,
          fechaProbParto: v.fechaProbParto, fechaPreparto: v.fechaPreparto,
          observaciones: v.observaciones,
        });
        cerrados = await logic.cerrarServiciosPendientes(c, { motivo: 'Se registró la preñez aparte' });
      }
      toast(`Preñez registrada. Parto esperado: ${fmtFecha(fpp)}.`
        + (cerrados ? ` Se cerraron ${cerrados} servicio(s) que quedaban pendientes.` : ''));
      ctx.refresh();
    },
  });
}

// ── Palpación: el resultado de todos los servicios pendientes de la vaca ──
export function formPalpacion(chapeta, ctx) {
  const pend = pendientesDe(ctx, chapeta);
  if (!pend.length) return toast('Esta vaca no tiene montas ni servicios pendientes.', 'info');
  formModal({
    title: `🩺 Palpación — vaca ${esc(chapeta)}`,
    submitLabel: 'Registrar resultado',
    fields: [
      { name: 'resultado', label: '¿Qué dijo la palpación?', type: 'select', options: [
        { value: 'PREÑADA', label: '✅ Preñada' },
        { value: 'VACÍA', label: '❌ Vacía' },
      ] },
      { name: 'servicio', label: '¿De cuál servicio quedó preñada?', type: 'select',
        options: pend.map(x => ({ value: String(x.id), label: textoServicio(x) })),
        help: pend.length > 1 ? 'Los demás se cierran solos.' : '' },
      { name: 'fecha', label: 'Fecha de la palpación', type: 'date', value: hoyISO(), half: true },
      { name: 'fechaPreparto', label: 'Inicio del preparto (si ya empezó)', type: 'date', half: true },
      { name: 'observaciones', label: 'Observaciones' },
    ],
    async onSubmit(v) {
      if (v.resultado === 'VACÍA') {
        const n = await logic.palpacionNegativa(chapeta, { fecha: v.fecha, causa: v.observaciones });
        toast(`Vaca ${chapeta} vacía: ${n} servicio(s) marcados como no exitosos.`);
      } else {
        const x = ctx.state.servicios.find(y => String(y.id) === v.servicio);
        const r = await logic.confirmarServicio(x, 'PREÑADA', {
          fechaPreparto: v.fechaPreparto, observaciones: v.observaciones,
        });
        toast(`Vaca ${chapeta} preñada 🎉 Parto esperado: ${fmtFecha(r.fechaProbParto)}.`);
      }
      ctx.refresh();
    },
  });
}

// ── Pérdida de la cría (aborto) ──
export function formPerdida(chapeta, ctx) {
  formModal({
    title: `💔 Perdió la cría — vaca ${esc(chapeta)}`,
    submitLabel: 'Registrar',
    fields: [
      { name: 'fecha', label: '¿Cuándo?', type: 'date', required: true, value: hoyISO(), half: true },
      { name: 'causa', label: '¿Qué pasó? (si se sabe)', half: true, placeholder: 'Aborto, enfermedad…' },
    ],
    async onSubmit(v) {
      await logic.perderPrenez(chapeta, v);
      toast(`Registrado. La vaca ${chapeta} vuelve a la lista de las que necesitan servicio.`, 'info');
      ctx.refresh();
    },
  });
}

// ── Preparto ──
export function formPreparto(chapeta, ctx) {
  formModal({
    title: `🌾 Inicio del preparto — vaca ${esc(chapeta)}`,
    submitLabel: 'Registrar',
    fields: [
      { name: 'fecha', label: '¿Desde cuándo?', type: 'date', required: true, value: hoyISO() },
    ],
    async onSubmit(v) {
      await logic.marcarPreparto(chapeta, v.fecha);
      toast(`Preparto de la vaca ${chapeta} registrado. 🌾`);
      ctx.refresh();
    },
  });
}

// ── Ternera que pasa a vaca (novilla) ──
export function formNovilla(t, ctx) {
  formModal({
    title: `🐄 ${esc(t.nombre)} pasa a ser vaca`,
    submitLabel: 'Pasar a vaca',
    fields: [
      { name: 'chapeta', label: 'Chapeta que va a llevar', required: true, half: true, placeholder: '061' },
      { name: 'fecha', label: 'Desde', type: 'date', required: true, value: hoyISO(), half: true },
      { name: 'codigo', label: 'Código de registro (si tiene)', half: true },
      { name: 'genetica', label: 'Genética', type: 'select', half: true,
        value: t.genetica || '', options: [...new Set([t.genetica || '', ...GENETICAS])] },
    ],
    async onSubmit(v) {
      await logic.pasarANovilla(t, v);
      toast(`${t.nombre} ahora es la vaca ${v.chapeta}. 🐄`);
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
      const antes = logic.origenDe(p);
      const O = logic.ORIGEN_PRENEZ;
      if (p.estado === 'PREÑADA' && v.estado === 'PREÑADA' && antes && v.origen && v.origen !== antes) {
        const r = await preguntar({
          titulo: '¿Qué pasó con la preñez anterior?',
          mensaje: `Esta preñez estaba registrada por <b>${esc(O[antes].toLowerCase())}</b> (${fmtFecha(p.fechaPrenez)})`
            + ` y la estás cambiando a <b>${esc(O[v.origen].toLowerCase())}</b>.`,
          opciones: [
            { valor: 'error', texto: `✏️ Se registró mal: en realidad fue ${O[v.origen].toLowerCase()}`,
              detalle: 'Se corrige esta misma preñez con los datos que pusiste.' },
            { valor: 'perdio', texto: `💔 Perdió la de ${O[antes].toLowerCase()} y quedó preñada por ${O[v.origen].toLowerCase()}`,
              detalle: 'La anterior queda como perdida y se crea una preñez nueva.' },
          ],
        });
        if (!r) return;
        if (r === 'perdio') {
          await logic.perderPrenez(p.chapeta, { fecha: v.fechaPrenez, causa: 'Quedó preñada de nuevo por ' + O[v.origen].toLowerCase() });
          const fpp = await logic.crearPrenez({
            chapeta: p.chapeta, fechaPrenez: v.fechaPrenez, origen: v.origen, fechaProbParto: v.fechaProbParto,
            fechaPreparto: v.fechaPreparto, observaciones: v.observaciones !== p.observaciones ? v.observaciones : '',
          });
          toast(`Registrado: perdió la anterior y hay una preñez nueva. Parto esperado: ${fmtFecha(fpp)}.`, 'info');
          return ctx.refresh();
        }
        v.observaciones = [v.observaciones, `Corregido: antes figuraba ${O[antes].toLowerCase()}`].filter(Boolean).join(' | ');
      }
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

export function formParto(chapeta, ctx, previo = {}) {
  formModal({
    title: `🍼 Registrar parto — vaca ${esc(chapeta)}`,
    submitLabel: 'Registrar parto',
    fields: [
      { name: 'fechaParto', label: 'Fecha del parto', type: 'date', required: true, value: previo.fechaParto || hoyISO(), half: true },
      { name: 'criaNombre', label: 'Nombre de la cría', half: true, value: previo.criaNombre, placeholder: 'Se crea como ternero',
        help: 'Si se va a vender, puedes poner NN.' },
      { name: 'sexoCria', label: 'Sexo de la cría', type: 'select', value: previo.sexoCria, options: ['Macho', 'Hembra'], half: true },
      { name: 'brucelosis', label: 'Vacuna brucelosis', type: 'select', value: previo.brucelosis, options: ['No', 'Sí'], half: true },
      { name: 'criaEstado', label: '¿Cómo salió la cría?', type: 'select', value: previo.criaEstado, options: [
        { value: 'viva', label: '🐮 Viva' },
        { value: 'muerta', label: '🕊️ Nació muerta o murió al nacer' },
        { value: 'vendida', label: '💰 Se vendió al nacer' },
      ], half: true },
      { name: 'complicaciones', label: '¿Y la vaca?', type: 'select', half: true, value: previo.complicaciones,
        options: [{ value: '', label: 'Todo bien' }, { value: 'si', label: 'Hubo complicaciones' }] },
    ],
    async onSubmit(v) {
      // ¿Ya tiene una cría de hace muy poco? Puede ser el mismo ternero metido
      // dos veces (así quedó la 041 con Hércules y Ternero NN).
      const reciente = logic.partoReciente(ctx.state, chapeta, v.fechaParto);
      if (reciente) {
        const r = await preguntarCriaRepetida(chapeta, reciente);
        if (r === 'misma') {
          await logic.cerrarPrenezConCria(chapeta, reciente.cria);
          toast(`Listo: la preñez quedó cerrada con ${reciente.cria.nombre}, sin crear otra cría.`, 'info');
          await ctx.refresh();
          return despues(() => abrirTernero(reciente.cria.nombre, ctx));
        }
        if (r !== 'registrar') return;
      }
      const escrito = (v.criaNombre || '').trim();
      const auto = v.criaEstado === 'muerta' ? `Cría ${chapeta} (murió)` : (v.criaEstado === 'vendida' ? `Cría ${chapeta} (vendida)` : '');
      const nombre = (escrito || auto)
        ? logic.nombreDisponible(ctx.state, escrito || auto, { madre: chapeta, automatico: !escrito })
        : '';
      await logic.registrarParto({
        chapeta, fechaParto: v.fechaParto, criaNombre: nombre, criaEstado: v.criaEstado,
        sexoCria: v.sexoCria, brucelosis: v.brucelosis, complicaciones: !!v.complicaciones,
      });
      toast(v.criaEstado === 'viva'
        ? (nombre ? `Parto registrado. Ternero "${nombre}" creado automáticamente. 🎉` : 'Parto registrado.')
        : 'Parto registrado. Lo sentimos por la cría.', v.criaEstado === 'viva' ? 'success' : 'info');
      ctx.refresh();
    },
  });
}

// ── TERNEROS ──────────────────────────────────────────────────────
export function formNuevoTernero(ctx, previo = {}) {
  const madres = ctx.state.vacas.filter(v => v.estado === 'ACTIVA' && !logic.esToro(v)).map(v => v.chapeta);
  formModal({
    title: '🐮 Registrar nuevo ternero',
    fields: [
      { name: 'nombre', label: 'Nombre', required: true, half: true, value: previo.nombre,
        help: 'Si se va a vender, puedes poner NN.' },
      { name: 'sexo', label: 'Sexo', type: 'select', value: previo.sexo, options: ['Macho', 'Hembra'], half: true },
      { name: 'fechaNac', label: 'Fecha de nacimiento', type: 'date', required: true, value: previo.fechaNac || hoyISO(), half: true },
      { name: 'codigoMadre', label: 'Madre (chapeta)', type: 'select', value: previo.codigoMadre,
        options: ['', ...madres], half: true },
      { name: 'brucelosis', label: 'Vacuna brucelosis', type: 'select', value: previo.brucelosis, options: ['No', 'Sí'], half: true },
      { name: 'observaciones', label: 'Observaciones', half: true, value: previo.observaciones },
    ],
    async onSubmit(v) {
      const nombre = logic.nombreDisponible(ctx.state, v.nombre, { madre: v.codigoMadre });
      // ¿La madre ya parió hace muy poco? Puede ser el mismo ternero otra vez.
      if (v.codigoMadre) {
        const reciente = logic.partoReciente(ctx.state, v.codigoMadre, v.fechaNac);
        if (reciente) {
          const r = await preguntarCriaRepetida(v.codigoMadre, reciente);
          if (r === 'misma') {
            if (logic.prenezActivaDe(ctx.state, v.codigoMadre)) await logic.cerrarPrenezConCria(v.codigoMadre, reciente.cria);
            toast('No se creó ningún ternero nuevo.', 'info');
            await ctx.refresh();
            return despues(() => abrirTernero(reciente.cria.nombre, ctx));
          }
          if (r === 'otra') return despues(() => formNuevoTernero(ctx, { ...v, codigoMadre: '' }));
          if (r !== 'registrar') return;
        }
      }
      // Si la madre figura preñada, este ternero ES su parto: se registra como
      // tal (cierra la preñez y actualiza la vaca) en vez de duplicar caminos.
      if (v.codigoMadre && logic.prenezActivaDe(ctx.state, v.codigoMadre)) {
        await logic.registrarParto({
          chapeta: v.codigoMadre, fechaParto: v.fechaNac, criaNombre: nombre,
          sexoCria: v.sexo, brucelosis: v.brucelosis, observaciones: v.observaciones,
        });
        toast(`Como la vaca ${v.codigoMadre} estaba preñada, quedó registrado como su parto. 🎉`);
        return ctx.refresh();
      }
      await db.add('terneros', {
        nombre, sexo: v.sexo, fechaNac: v.fechaNac, codigoMadre: v.codigoMadre,
        activo: true, fechaSalida: '', tipoSalida: '', brucelosis: v.brucelosis,
        observaciones: v.observaciones, ultimoPeso: null, fechaUltimoPesaje: '',
      });
      if (v.codigoMadre) await logic.vincularCriaConMadre(v.codigoMadre, nombre, v.fechaNac);
      await logic.registrarEvento('TERNERO', nombre, 'ALTA_TERNERO',
        { fecha: v.fechaNac, causa: v.codigoMadre ? 'Madre: ' + v.codigoMadre : '' });
      toast(`Ternero ${nombre} registrado.`);
      ctx.refresh();
    },
  });
}

export function formEditarTernero(t, ctx) {
  const nPesajes = logic.pesajesDe(ctx.state, t.nombre).length;
  formModal({
    title: '✏️ Editar ternero ' + esc(t.nombre),
    submitLabel: 'Guardar cambios',
    fields: [
      { name: 'nombre', label: 'Nombre', required: true, value: t.nombre, half: true,
        help: 'Si se va a vender, puedes ponerle NN.' },
      { name: 'sexo', label: 'Sexo', type: 'select', value: t.sexo, options: ['Macho', 'Hembra'], half: true },
      { name: 'fechaNac', label: 'Fecha de nacimiento', type: 'date', value: t.fechaNac, half: true },
      { name: 'codigoMadre', label: 'Madre (chapeta)', value: t.codigoMadre, half: true },
      { name: 'brucelosis', label: 'Vacuna brucelosis', type: 'select', value: t.brucelosis, options: ['No', 'Sí'] },
      { name: 'observaciones', label: 'Observaciones', type: 'textarea', value: t.observaciones },
    ],
    async onSubmit(v) {
      const { nombre, ...resto } = v;
      if (nombre.trim() !== t.nombre) await logic.renombrarTernero(ctx.state, t, nombre);
      Object.assign(t, resto);
      await db.put('terneros', t);
      toast(`Ternero ${t.nombre} actualizado.`);
      ctx.refresh();
    },
    onDelete: {
      mensaje: `¿Eliminar a <b>${esc(t.nombre)}</b>${t.codigoMadre ? ` (cría de la vaca ${esc(t.codigoMadre)})` : ''}?`
        + (nPesajes ? `<br><br>También se borran sus <b>${nPesajes} pesaje${nPesajes === 1 ? '' : 's'}</b>.` : '')
        + '<br><br>Úsalo solo si es un registro <b>repetido o mal hecho</b>. Si se vendió o murió, usa '
        + '💰 Vender o 🕊️ Falleció: así queda en su historia.',
      label: 'Sí, eliminar',
      async run() {
        await logic.eliminarTernero(t);
        toast(`${t.nombre} eliminado.`, 'info');
        ctx.refresh();
      },
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
  const activas = activasDe(ctx);
  const toros = torosDe(ctx);
  const titulo = esMN ? '🐂 Registrar monta con toro'
    : (esIA ? '💉 Registrar inseminación' : '🔬 Registrar transferencia de embrión');
  formModal({
    title: titulo,
    fields: [
      { name: 'chapeta', label: 'Vaca (chapeta)', type: 'select', required: true, value: chapeta,
        options: activas, half: true },
      { name: 'fecha', label: 'Fecha del servicio', type: 'date', required: true, value: hoyISO(), half: true },
      // Monta: los toros se ELIGEN, no se escriben (así no hay "Ecli" ni
      // nombres distintos para el mismo animal, y la ficha del toro cuadra).
      ...(esMN ? [toros.length
        ? { name: 'toros', label: '¿Con qué toro(s)?', type: 'checks', options: toros,
            value: toros.length === 1 ? toros : [] }
        : { name: 'raza', label: 'Toro', placeholder: 'Nombre del toro',
            help: 'Registra los toros en la pestaña Toros para elegirlos con un toque.' },
        { name: 'material', label: 'Tratamiento / celo (opcional)', placeholder: 'Estro Zoo…' },
      ] : [
        { name: 'material', label: esIA ? 'Tipo de semen' : 'Tipo de embrión', half: true,
          placeholder: esIA ? 'Sexado, convencional…' : 'Plus x Plus…' },
        { name: 'raza', label: esIA ? 'Raza del semen' : 'Raza / toro donante', half: true,
          placeholder: esIA ? 'Gyr, Holstein…' : 'Bronco…' },
        { name: 'cria', label: 'Nombre pensado para la cría (opcional)' },
      ]),
    ],
    async onSubmit(v) {
      const elegidos = Array.isArray(v.toros) ? v.toros : [];
      if (esMN && toros.length && !elegidos.length) throw new Error('Elige al menos un toro.');
      // Una vaca preñada por un método no debería recibir otro servicio sin
      // aclarar qué pasó con esa preñez.
      const activa = logic.prenezActivaDe(ctx.state, v.chapeta);
      if (activa) {
        const nombreServ = esMN ? 'monta' : (esIA ? 'inseminación' : 'transferencia');
        const r = await preguntar({
          titulo: `⚠️ La vaca ${esc(v.chapeta)} figura preñada`,
          mensaje: `Está registrada preñada <b>${esc(metodoDe(activa))}</b> desde el ${fmtFecha(activa.fechaPrenez)}`
            + ` (parto probable ${fmtFecha(activa.fechaProbParto)}).<br><br>Antes de anotar esta ${nombreServ}, `
            + '<b>¿qué pasó con esa preñez?</b>',
          opciones: [
            { valor: 'perdio', texto: '💔 Perdió la cría', detalle: 'Esa preñez queda como perdida y se anota el servicio nuevo.' },
            { valor: 'mal', texto: '❌ No estaba preñada: esa preñez se registró mal',
              detalle: 'Se quita esa preñez y se anota el servicio nuevo.' },
            { valor: 'sigue', texto: '🤰 Sigue preñada: anotar el servicio igual',
              detalle: 'Por ejemplo, si el toro la montó sin querer. La preñez no cambia.' },
          ],
        });
        if (!r) return;
        if (r === 'perdio') await logic.perderPrenez(v.chapeta, { fecha: v.fecha, causa: 'Se supo al anotar un servicio nuevo' });
        if (r === 'mal') await logic.prenezMalRegistrada(activa);
      }
      const raza = esMN ? (elegidos.length ? elegidos.join(' y ') : (v.raza || '')) : (v.raza || '');
      await db.add('servicios', {
        tipo, chapeta: v.chapeta, cria: v.cria || '', material: v.material || '',
        raza, ...(elegidos.length ? { toros: elegidos } : {}),
        fecha: v.fecha, resultado: 'PENDIENTE', fechaConfirmacion: '',
      });
      const tipoEvento = esMN ? 'MONTA' : (esIA ? 'INSEMINACIÓN' : 'TRANSFERENCIA');
      await logic.registrarEvento('VACA', v.chapeta, tipoEvento,
        { fecha: v.fecha, causa: [v.material, v.raza].filter(Boolean).join(' — ') });
      const nombre = esMN ? 'Monta' : (esIA ? 'Inseminación' : 'Transferencia');
      toast(`${nombre} de la vaca ${v.chapeta} registrada. En unos ${logic.ajustes(ctx.state).diasPalpar} días se puede palpar.`);
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
      ...(s.tipo === 'MN' && torosDe(ctx).length
        ? [{ name: 'toros', label: 'Toro(s)', type: 'checks', options: torosDe(ctx),
             value: Array.isArray(s.toros) ? s.toros : torosDe(ctx).filter(t => (s.raza || '').toLowerCase().includes(t.toLowerCase())) }]
        : [{ name: 'raza', label: 'Toro o raza', value: s.raza, half: true }]),
      { name: 'resultado', label: 'Resultado', type: 'select', value: s.resultado, options: RESULTADOS,
        help: 'Aquí solo se corrige el dato. Para que la app cree la preñez sola, usa el botón ✅ Preñada de Reproducción.' },
    ],
    async onSubmit(v) {
      const cambios = { ...v };
      if (Array.isArray(v.toros)) { cambios.toros = v.toros; cambios.raza = v.toros.join(' y '); }
      await logic.actualizarServicio(s, cambios);
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
