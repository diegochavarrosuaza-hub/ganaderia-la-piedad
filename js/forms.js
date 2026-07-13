// forms.js — formularios del negocio, compartidos por varias vistas
import * as db from './db.js';
import { hoyISO, addDias, fmtFecha, esc } from './util.js';
import { formModal, toast } from './ui.js';
import * as logic from './logic.js';

const GENETICAS = ['F1', 'Plus', 'Plus x Plus', 'Convencional', 'Otra'];

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

export function formPrenez(chapeta, ctx) {
  formModal({
    title: `🤰 Registrar preñez — vaca ${esc(chapeta)}`,
    fields: [
      { name: 'fechaPrenez', label: 'Fecha de preñez (servicio o monta)', type: 'date', required: true, value: hoyISO() },
      { name: 'observaciones', label: 'Observaciones', placeholder: 'Toro, monta natural…' },
    ],
    async onSubmit(v) {
      const fpp = await logic.crearPrenez({ chapeta, fechaPrenez: v.fechaPrenez, observaciones: v.observaciones });
      toast(`Preñez registrada. Parto esperado: ${fmtFecha(fpp)}.`);
      ctx.refresh();
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
  const esIA = tipo === 'IA';
  const activas = ctx.state.vacas.filter(v => v.estado === 'ACTIVA').map(v => v.chapeta);
  formModal({
    title: esIA ? '💉 Registrar inseminación' : '🔬 Registrar transferencia de embrión',
    fields: [
      { name: 'chapeta', label: 'Vaca (chapeta)', type: 'select', required: true, value: chapeta,
        options: activas, half: true },
      { name: 'fecha', label: 'Fecha del servicio', type: 'date', required: true, value: hoyISO(), half: true },
      { name: 'material', label: esIA ? 'Tipo de semen' : 'Tipo de embrión', half: true,
        placeholder: esIA ? 'Sexado, convencional…' : 'Plus x Plus…' },
      ...(esIA ? [{ name: 'raza', label: 'Raza del semen', half: true, placeholder: 'Gyr, Holstein…' }] : []),
      { name: 'cria', label: esIA ? 'Nombre cría esperada (opcional)' : 'Embrión / cría (opcional)' },
    ],
    async onSubmit(v) {
      await db.add('servicios', {
        tipo, chapeta: v.chapeta, cria: v.cria, material: v.material,
        raza: v.raza || '', fecha: v.fecha, resultado: 'PENDIENTE', fechaConfirmacion: '',
      });
      await logic.registrarEvento('VACA', v.chapeta, esIA ? 'INSEMINACIÓN' : 'TRANSFERENCIA',
        { fecha: v.fecha, causa: v.material });
      toast(`${esIA ? 'Inseminación' : 'Transferencia'} de la vaca ${v.chapeta} registrada. En ±45 días podrás confirmar el resultado.`);
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
