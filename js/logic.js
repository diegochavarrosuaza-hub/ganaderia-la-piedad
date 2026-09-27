// logic.js — reglas del negocio (portadas del Apps Script original y ampliadas)
import * as db from './db.js';
import { hoyISO, addDias, diasEntre, mesKey, ultimosMeses, toDate } from './util.js';

export const DIAS_GESTACION = { IA: 280, TE: 273, MN: 280 };
// Nombre legible de cada tipo de servicio
export const TIPO_SERVICIO = { IA: 'inseminación', TE: 'transferencia', MN: 'monta natural' };
// De dónde viene una preñez. Antes la monta con toro era solo una nota escrita;
// ahora se guarda clasificada, que es lo que permite medir qué funciona mejor.
export const ORIGEN_PRENEZ = { MN: 'Monta con toro', IA: 'Inseminación', TE: 'Transferencia' };
// Días antes del parto en que la vaca entra a preparto (dieta y manejo especial).
export const DIAS_PREPARTO = 45;

// ── Ajustes de la finca (personalizables desde Respaldo → Ajustes) ──
// Los valores de aquí son los de partida; lo que se guarde en el store
// 'ajustes' manda y viaja entre dispositivos con la sincronización.
export const AJUSTES_DEFECTO = {
  finca: 'Ganadería La Piedad',
  esperaPosparto: 90,   // días de descanso tras parir antes de contar "sin servicio"
  diasPalpar: 45,       // días después del servicio para poder confirmar la preñez
  diasPreparto: 45,     // días antes del parto para avisar que toca preparto
  diasAvisoParto: 60,   // con cuántos días de anticipación avisar los partos
};
export function ajustes(state) {
  const guardado = state && state.ajustes && state.ajustes[0];
  const a = { ...AJUSTES_DEFECTO };
  for (const k of Object.keys(AJUSTES_DEFECTO)) {
    if (!guardado || guardado[k] === '' || guardado[k] == null) continue;
    a[k] = typeof AJUSTES_DEFECTO[k] === 'number' ? (Number(guardado[k]) || AJUSTES_DEFECTO[k]) : guardado[k];
  }
  return a;
}
export async function guardarAjustes(state, cambios) {
  const actual = state.ajustes && state.ajustes[0];
  if (actual) { Object.assign(actual, cambios); return db.put('ajustes', actual); }
  return db.add('ajustes', { ...cambios });
}

// Las preñeces registradas antes de esta versión no tienen 'origen' guardado:
// se deduce del texto que se escribió en observaciones.
export function origenDe(p) {
  if (p.origen) return p.origen;
  const o = String(p.observaciones || '').toLowerCase();
  if (o.includes('transferencia') || o.includes('embri')) return 'TE';
  if (o.includes('inseminaci')) return 'IA';
  if (o.includes('toro') || o.includes('monta')) return 'MN';
  return '';
}

// ── Log de eventos ────────────────────────────────────────────────
export function registrarEvento(categoria, refId, tipo, extra = {}) {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  const timestamp = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  return db.add('eventos', {
    timestamp,
    categoria, refId: String(refId ?? ''), tipo,
    fecha: extra.fecha || '',
    precio: extra.precio != null && extra.precio !== '' ? Number(extra.precio) : null,
    causa: extra.causa || '',
  });
}

// ── Preñez ────────────────────────────────────────────────────────
export function prenezActivaDe(state, chapeta) {
  return state.prenez.find(p => p.chapeta === String(chapeta) && p.estado === 'PREÑADA');
}

export async function crearPrenez({ chapeta, fechaPrenez, origen = 'MN', dias, observaciones = '',
                                   fechaPreparto = '', fechaProbParto = '', servicioUid = '' }) {
  chapeta = String(chapeta).trim();
  if (!chapeta) throw new Error('Falta la chapeta de la vaca.');
  const prenez = await db.all('prenez');
  if (prenez.some(p => p.chapeta === chapeta && p.estado === 'PREÑADA')) {
    throw new Error(`La vaca ${chapeta} ya tiene una preñez activa.`);
  }
  const fp = fechaPrenez || hoyISO();
  const gest = Number(dias) || DIAS_GESTACION[origen] || 280;
  // La fecha de parto se calcula sola, salvo que nos la den (vaca comprada preñada).
  const fpp = fechaProbParto || addDias(fp, gest);
  await db.add('prenez', {
    chapeta, fechaPrenez: fp, fechaProbParto: fpp, origen,
    fechaPreparto, observaciones, estado: 'PREÑADA', servicioUid,
  });
  await refrescarPrenezEnVaca(chapeta);
  await registrarEvento('VACA', chapeta, 'PREÑEZ',
    { fecha: fp, causa: [ORIGEN_PRENEZ[origen], observaciones].filter(Boolean).join(' — ') });
  return fpp;
}

// Deja en la vaca la fecha de la preñez que esté activa (o la borra si no hay).
// Se llama después de crear, editar o eliminar una preñez para que la ficha de
// la vaca nunca quede mostrando una preñez que ya no existe.
async function refrescarPrenezEnVaca(chapeta) {
  const vacas = await db.all('vacas');
  const vaca = vacas.find(v => v.chapeta === String(chapeta));
  if (!vaca) return;
  const activa = (await db.all('prenez'))
    .find(p => p.chapeta === String(chapeta) && p.estado === 'PREÑADA');
  vaca.fechaPrenez = activa ? activa.fechaPrenez : '';
  vaca.fechaProbParto = activa ? activa.fechaProbParto : '';
  await db.put('vacas', vaca);
}

// ── Correcciones: editar o eliminar lo ya registrado ──────────────
// Todo lo que la app anota se puede corregir; si no, un dato mal metido
// se queda para siempre y la gente deja de confiar en la app.
export async function actualizarPrenez(prenez, cambios) {
  const estadoAntes = prenez.estado;
  Object.assign(prenez, cambios);
  await db.put('prenez', prenez);
  await refrescarPrenezEnVaca(prenez.chapeta);
  if (estadoAntes !== prenez.estado) {
    await registrarEvento('VACA', prenez.chapeta, 'CORRECCIÓN',
      { fecha: prenez.fechaPrenez, causa: `Preñez: ${estadoAntes} → ${prenez.estado}` });
  }
}

export async function eliminarPrenez(prenez) {
  await db.del('prenez', prenez.id);
  await refrescarPrenezEnVaca(prenez.chapeta);
  await registrarEvento('VACA', prenez.chapeta, 'CORRECCIÓN',
    { fecha: prenez.fechaPrenez, causa: 'Se eliminó la preñez del ' + prenez.fechaPrenez });
}

export async function actualizarServicio(servicio, cambios) {
  Object.assign(servicio, cambios);
  await db.put('servicios', servicio);
}

export async function eliminarServicio(servicio) {
  await db.del('servicios', servicio.id);
  await registrarEvento('VACA', servicio.chapeta, 'CORRECCIÓN',
    { fecha: servicio.fecha,
      causa: `Se eliminó la ${TIPO_SERVICIO[servicio.tipo] || 'servicio'} del ${servicio.fecha}` });
}

export async function actualizarEvento(evento, cambios) {
  Object.assign(evento, cambios);
  await db.put('eventos', evento);
}

// Los eventos son la bitácora: borrar uno no deja rastro a propósito
// (si dejara rastro, borrar el rastro crearía otro, sin fin).
export function eliminarEvento(evento) {
  return db.del('eventos', evento.id);
}

export async function actualizarPesaje(pesaje, cambios) {
  const nombreAntes = pesaje.nombre;
  Object.assign(pesaje, cambios);
  if (pesaje.peso != null) pesaje.peso = Number(pesaje.peso);
  await db.put('pesajes', pesaje);
  await recalcularUltimoPeso(nombreAntes);
  if (pesaje.nombre !== nombreAntes) await recalcularUltimoPeso(pesaje.nombre);
}

export async function eliminarPesaje(pesaje) {
  await db.del('pesajes', pesaje.id);
  await recalcularUltimoPeso(pesaje.nombre);
}

// El "último peso" del ternero es un resumen de sus pesajes: si se edita o se
// borra uno, hay que volver a sacarlo o el ternero queda con un peso fantasma.
export async function recalcularUltimoPeso(nombre) {
  const clave = String(nombre || '').trim().toLowerCase();
  const terneros = await db.all('terneros');
  const t = terneros.find(x => x.nombre.trim().toLowerCase() === clave);
  if (!t) return;
  const suyos = (await db.all('pesajes'))
    .filter(p => String(p.nombre || '').trim().toLowerCase() === clave)
    .sort((a, b) => (a.fecha || '').localeCompare(b.fecha || ''));
  const ultimo = suyos[suyos.length - 1];
  t.ultimoPeso = ultimo ? Number(ultimo.peso) : null;
  t.fechaUltimoPesaje = ultimo ? ultimo.fecha : '';
  await db.put('terneros', t);
}

// ── Servicios (monta / inseminación / transferencia) ──────────────
/*
 * Cierra los servicios PENDIENTES de una vaca que ya no tienen sentido: se
 * confirmó otra preñez, parió, o perdió la cría. Quedan como CERRADO, que no
 * cuenta en las tasas de éxito (no se sabe si funcionaron o no).
 * Sin esto, cada monta registrada aparte de la preñez se quedaba "pendiente"
 * para siempre y el tablero se llenaba de avisos falsos.
 */
export async function cerrarServiciosPendientes(chapeta, { exceptoId = null, motivo = '' } = {}) {
  let n = 0;
  for (const s of await db.all('servicios')) {
    if (s.chapeta !== String(chapeta) || s.resultado !== 'PENDIENTE' || s.id === exceptoId) continue;
    s.resultado = 'CERRADO';
    s.fechaConfirmacion = hoyISO();
    s.cierre = motivo;
    await db.put('servicios', s);
    n++;
  }
  return n;
}

// Palpación negativa: la vaca está vacía, así que TODOS sus servicios
// pendientes fallaron (no solo uno).
export async function palpacionNegativa(chapeta, { fecha, causa = '' } = {}) {
  let n = 0;
  for (const s of await db.all('servicios')) {
    if (s.chapeta !== String(chapeta) || s.resultado !== 'PENDIENTE') continue;
    s.resultado = 'VACÍA';
    s.fechaConfirmacion = fecha || hoyISO();
    await db.put('servicios', s);
    n++;
  }
  await registrarEvento('VACA', chapeta, 'RESULTADO_VACÍA', { fecha: fecha || hoyISO(), causa: causa || 'Palpación: vacía' });
  return n;
}

export async function confirmarServicio(servicio, resultado, extraPrenez = {}) {
  const etiqueta = TIPO_SERVICIO[servicio.tipo] || 'servicio';
  let extra = {};
  // Si resulta preñada, creamos la preñez PRIMERO: si la vaca ya tenía una
  // preñez activa, crearPrenez lanza y no se persiste nada (el servicio queda
  // PENDIENTE, recuperable) en vez de dejar un servicio "preñada" sin preñez.
  if (resultado === 'PREÑADA') {
    const detalle = [etiqueta, servicio.raza].filter(Boolean).join(' — ');
    const fechaProbParto = await crearPrenez({
      chapeta: servicio.chapeta,
      fechaPrenez: extraPrenez.fechaPrenez || servicio.fecha,
      origen: servicio.tipo,
      dias: DIAS_GESTACION[servicio.tipo] || 280,
      observaciones: extraPrenez.observaciones || ('Por ' + detalle),
      fechaPreparto: extraPrenez.fechaPreparto || '',
      fechaProbParto: extraPrenez.fechaProbParto || '',
      servicioUid: servicio.uid || '',
    });
    extra = { fechaProbParto };
  }
  servicio.resultado = resultado;
  servicio.fechaConfirmacion = hoyISO();
  await db.put('servicios', servicio);
  await registrarEvento('VACA', servicio.chapeta, 'RESULTADO_' + resultado,
    { fecha: servicio.fecha, causa: etiqueta });
  // Las demás montas pendientes de la misma vaca ya no se van a confirmar.
  if (resultado === 'PREÑADA') {
    extra.cerrados = await cerrarServiciosPendientes(servicio.chapeta,
      { exceptoId: servicio.id, motivo: 'La preñez se atribuyó al servicio del ' + servicio.fecha });
  }
  return extra;
}

// ── Pérdida de la preñez (aborto) ─────────────────────────────────
export async function perderPrenez(chapeta, { fecha, causa = '' } = {}) {
  chapeta = String(chapeta).trim();
  const activa = (await db.all('prenez')).find(p => p.chapeta === chapeta && p.estado === 'PREÑADA');
  if (!activa) throw new Error(`No hay preñez activa para la vaca ${chapeta}.`);
  const f = fecha || hoyISO();
  activa.estado = 'PERDIDA';
  activa.fechaPerdida = f;
  activa.observaciones = [activa.observaciones, 'Perdió la cría el ' + f + (causa ? ': ' + causa : '')]
    .filter(Boolean).join(' | ');
  await db.put('prenez', activa);
  await refrescarPrenezEnVaca(chapeta);
  await cerrarServiciosPendientes(chapeta, { motivo: 'Pérdida de la preñez' });
  await registrarEvento('VACA', chapeta, 'PÉRDIDA', { fecha: f, causa });
}

// ── Preparto ──────────────────────────────────────────────────────
export async function marcarPreparto(chapeta, fecha) {
  chapeta = String(chapeta).trim();
  const activa = (await db.all('prenez')).find(p => p.chapeta === chapeta && p.estado === 'PREÑADA');
  if (!activa) throw new Error(`No hay preñez activa para la vaca ${chapeta}.`);
  activa.fechaPreparto = fecha || hoyISO();
  await db.put('prenez', activa);
  await registrarEvento('VACA', chapeta, 'PREPARTO', { fecha: activa.fechaPreparto, causa: 'Inicio del preparto' });
}

// ── Ternera que crece y pasa a ser vaca (novilla) ─────────────────
export async function pasarANovilla(ternero, { chapeta, fecha, codigo = '', genetica = '' }) {
  chapeta = String(chapeta || '').trim();
  if (!chapeta) throw new Error('Falta la chapeta que va a llevar.');
  if ((await db.all('vacas')).some(v => v.chapeta === chapeta)) {
    throw new Error(`Ya existe un animal con la chapeta ${chapeta}.`);
  }
  const f = fecha || hoyISO();
  await db.add('vacas', {
    chapeta, codigo, genetica: genetica || ternero.genetica || '', fechaNac: ternero.fechaNac,
    sexo: 'Hembra', ultimoParto: '', criaActual: '', fechaPrenez: '', fechaProbParto: '',
    estado: 'ACTIVA', fechaSalida: '', tipo: 'vaca', nombre: ternero.nombre,
    notas: `Criada en la finca: antes ternera "${ternero.nombre}"`
      + (ternero.codigoMadre ? `, hija de la vaca ${ternero.codigoMadre}` : '') + '.',
  });
  ternero.activo = false;
  ternero.tipoSalida = 'NOVILLA';
  ternero.fechaSalida = f;
  ternero.observaciones = [ternero.observaciones, `Pasó a vaca con la chapeta ${chapeta}`].filter(Boolean).join(' | ');
  await db.put('terneros', ternero);
  await registrarEvento('TERNERO', ternero.nombre, 'NOVILLA', { fecha: f, causa: 'Pasó a vaca con la chapeta ' + chapeta });
  await registrarEvento('VACA', chapeta, 'ALTA_VACA', { fecha: f, causa: `Novilla criada en la finca (antes ${ternero.nombre})` });
}

// Un ternero registrado a mano con madre también debe reflejarse en ella.
export async function vincularCriaConMadre(chapeta, nombre, fechaNac) {
  const vaca = (await db.all('vacas')).find(v => v.chapeta === String(chapeta));
  if (!vaca) return;
  if (!vaca.ultimoParto || (fechaNac || '') >= vaca.ultimoParto) {
    vaca.ultimoParto = fechaNac || vaca.ultimoParto;
    vaca.criaActual = nombre;
    await db.put('vacas', vaca);
  }
}

// Montas de un toro. Los servicios nuevos llevan la lista 'toros'; los viejos
// solo el texto libre en 'raza'.
export function montasDeToro(state, nombre) {
  const n = String(nombre || '').trim().toLowerCase();
  if (!n) return [];
  return state.servicios.filter(s => s.tipo === 'MN' && (Array.isArray(s.toros)
    ? s.toros.some(t => String(t).trim().toLowerCase() === n)
    : String(s.raza || '').toLowerCase().includes(n)));
}

// ── Parto ─────────────────────────────────────────────────────────
/*
 * criaEstado: 'viva' (lo normal), 'muerta' (nació muerta o murió al nacer) o
 * 'vendida' (se vendió de una). En los tres casos queda un ternero registrado,
 * porque el parto ocurrió y cuenta para la historia de la vaca.
 */
export async function registrarParto({ chapeta, fechaParto, criaNombre, sexoCria, brucelosis,
                                       complicaciones, criaEstado = 'viva', observaciones = '' }) {
  chapeta = String(chapeta).trim();
  const prenez = await db.all('prenez');
  const activa = prenez.find(p => p.chapeta === chapeta && p.estado === 'PREÑADA');
  if (!activa) throw new Error(`No hay preñez activa para la vaca ${chapeta}.`);

  const viva = criaEstado === 'viva';
  const nombre = (criaNombre || '').trim()
    || (criaEstado === 'muerta' ? `Cría ${chapeta} (murió)` : (criaEstado === 'vendida' ? `Cría ${chapeta} (vendida)` : ''));

  activa.estado = 'PARIDA';
  activa.fechaParto = fechaParto;
  activa.observaciones = ('Parto ' + fechaParto + (nombre ? ' — Cría: ' + nombre : '')
    + (criaEstado === 'muerta' ? ' (cría fallecida)' : '') + (criaEstado === 'vendida' ? ' (cría vendida)' : '')
    + (complicaciones ? ' (complicaciones)' : '')).trim();
  await db.put('prenez', activa);

  const vacas = await db.all('vacas');
  const vaca = vacas.find(v => v.chapeta === chapeta);
  if (vaca) {
    vaca.ultimoParto = fechaParto;
    vaca.criaActual = viva ? (nombre || vaca.criaActual) : (criaEstado === 'muerta' ? 'Cría fallecida' : 'Cría vendida');
    vaca.fechaPrenez = '';
    vaca.fechaProbParto = '';
    await db.put('vacas', vaca);
  }

  if (nombre) {
    await db.add('terneros', {
      nombre, sexo: sexoCria || '', fechaNac: fechaParto,
      codigoMadre: chapeta, activo: viva, fechaSalida: viva ? '' : fechaParto,
      tipoSalida: viva ? '' : (criaEstado === 'muerta' ? 'FALLECIDO' : 'VENDIDO'),
      brucelosis: brucelosis || 'No',
      observaciones: observaciones || (viva ? 'Nacido del parto de vaca ' + chapeta
        : (criaEstado === 'muerta' ? 'Nació muerta o murió al nacer' : 'Vendida al nacer')),
      ultimoPeso: null, fechaUltimoPesaje: '',
    });
    await registrarEvento('TERNERO', nombre, 'NACIMIENTO', { fecha: fechaParto, causa: 'Madre: vaca ' + chapeta });
    if (criaEstado === 'muerta') await registrarEvento('TERNERO', nombre, 'FALLECIDO', { fecha: fechaParto, causa: 'Al nacer' });
    if (criaEstado === 'vendida') await registrarEvento('TERNERO', nombre, 'VENDIDO', { fecha: fechaParto, causa: 'Vendida al nacer' });
  }
  await registrarEvento('VACA', chapeta, 'PARTO', { fecha: fechaParto,
    causa: nombre + (criaEstado === 'muerta' ? ' (cría fallecida)' : (criaEstado === 'vendida' ? ' (cría vendida)' : '')) });
  // Con el parto, cualquier servicio que quedara pendiente ya no aplica.
  await cerrarServiciosPendientes(chapeta, { motivo: 'Parto del ' + fechaParto });
}

// ── Estados de vaca / ternero ─────────────────────────────────────
export async function cambiarEstadoVaca(vaca, estado, { fecha, precio, causa } = {}) {
  vaca.estado = estado;
  if (fecha) vaca.fechaSalida = fecha;
  await db.put('vacas', vaca);
  await registrarEvento('VACA', vaca.chapeta, estado, { fecha, precio, causa });
}

export async function salidaTernero(ternero, tipo, { fecha, precio, causa } = {}) {
  ternero.activo = false;
  ternero.tipoSalida = tipo;
  if (fecha) ternero.fechaSalida = fecha;
  ternero.observaciones = (tipo === 'FALLECIDO' ? 'Fallecido' : 'Vendido')
    + (causa ? (tipo === 'FALLECIDO' ? ': ' : ' a: ') + causa : '');
  await db.put('terneros', ternero);
  await registrarEvento('TERNERO', ternero.nombre, tipo, { fecha, precio, causa });
}

// ── Pesajes ───────────────────────────────────────────────────────
export async function registrarPesaje({ fecha, nombre, peso, edadMeses, observaciones }) {
  peso = Number(peso);
  if (!nombre || !peso) throw new Error('Faltan el ternero o el peso.');
  await db.add('pesajes', {
    fecha: fecha || hoyISO(), nombre, peso,
    edadMeses: edadMeses != null && edadMeses !== '' ? Number(edadMeses) : null,
    observaciones: observaciones || '',
  });
  const terneros = await db.all('terneros');
  const t = terneros.find(x => x.nombre.trim().toLowerCase() === nombre.trim().toLowerCase());
  if (t) {
    const fechaNueva = fecha || hoyISO();
    // Solo actualiza el "último peso" si este pesaje es igual o más reciente que
    // el guardado (un pesaje retroactivo no debe pisar el peso actual real).
    if (!t.fechaUltimoPesaje || fechaNueva >= t.fechaUltimoPesaje) {
      t.ultimoPeso = peso;
      t.fechaUltimoPesaje = fechaNueva;
      await db.put('terneros', t);
    }
  }
  await registrarEvento('TERNERO', nombre, 'PESAJE', { fecha, precio: peso });
}

// ═══════ CÁLCULOS DERIVADOS (solo lectura, sobre el estado en memoria) ═══════

export function serviciosDe(state, chapeta) {
  return state.servicios.filter(s => s.chapeta === String(chapeta))
    .sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
}
export function prenecesDe(state, chapeta) {
  return state.prenez.filter(p => p.chapeta === String(chapeta))
    .sort((a, b) => (b.fechaPrenez || '').localeCompare(a.fechaPrenez || ''));
}
export function criasDe(state, chapeta) {
  return state.terneros.filter(t => t.codigoMadre === String(chapeta));
}
export function pesajesDe(state, nombre) {
  return state.pesajes.filter(p => p.nombre.trim().toLowerCase() === String(nombre).trim().toLowerCase())
    .sort((a, b) => (a.fecha || '').localeCompare(b.fecha || ''));
}
export function eventosDe(state, refId) {
  return state.eventos.filter(e => e.refId === String(refId))
    .sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
}

// Ganancia diaria de peso (kg/día) entre primer y último pesaje
export function gdpDe(state, nombre) {
  const ps = pesajesDe(state, nombre);
  if (ps.length < 2) return null;
  const dias = diasEntre(ps[0].fecha, ps[ps.length - 1].fecha);
  if (!dias || dias <= 0) return null;
  return (ps[ps.length - 1].peso - ps[0].peso) / dias;
}

export const esToro = a => a.tipo === 'toro';
export const soloVacas = arr => arr.filter(x => !esToro(x));

// ── Estado reproductivo de una vaca ───────────────────────────────
// Días de espera tras el parto antes de considerar que una vaca está atrasada.
// En trópico / doble propósito se usa un margen más amplio que en lechería.
export const ESPERA_POSPARTO = AJUSTES_DEFECTO.esperaPosparto; // (valor de partida; manda ajustes(state))
export const DIAS_PALPAR = AJUSTES_DEFECTO.diasPalpar;         // antes de esto un servicio aún no se puede confirmar

/*
 * Devuelve cómo va cada vaca en su ciclo reproductivo:
 *   PREÑADA   → tiene preñez activa
 *   ESPERANDO → le hicieron un servicio y falta confirmar
 *   DESCANSO  → parió hace poco (menos de ESPERA_POSPARTO días)
 *   SIN_SERVICIO → ya pasó el descanso y no tiene ningún servicio: hay que actuar
 *   NOVILLA   → nunca ha parido (no aplica el conteo de días vacía)
 */
export function estadoReproductivo(state, vaca) {
  if (esToro(vaca) || vaca.estado !== 'ACTIVA') return { estado: 'NO_APLICA' };

  const hoy = hoyISO();
  if (state.prenez.some(p => p.chapeta === vaca.chapeta && p.estado === 'PREÑADA')) {
    return { estado: 'PREÑADA' };
  }

  // Servicios hechos después del último parto (o todos, si nunca ha parido)
  const servicios = state.servicios.filter(s => s.chapeta === vaca.chapeta
    && (!vaca.ultimoParto || (s.fecha || '') > vaca.ultimoParto));
  const pendiente = servicios.filter(s => s.resultado === 'PENDIENTE')
    .sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''))[0];

  const diasVacia = vaca.ultimoParto ? diasEntre(vaca.ultimoParto, hoy) : null;
  const aj = ajustes(state);

  if (pendiente) {
    const d = diasEntre(pendiente.fecha, hoy);
    return { estado: 'ESPERANDO', diasVacia, servicios: servicios.length,
      diasServicio: d, listoParaPalpar: d != null && d >= aj.diasPalpar };
  }

  if (!vaca.ultimoParto) return { estado: 'NOVILLA', servicios: servicios.length };

  if (diasVacia != null && diasVacia <= aj.esperaPosparto) {
    return { estado: 'DESCANSO', diasVacia, servicios: servicios.length };
  }

  return { estado: 'SIN_SERVICIO', diasVacia, servicios: servicios.length };
}

// Vacas sin servicio (ya pasó el descanso posparto y no hay nada en marcha),
// ordenadas de la más atrasada a la menos.
export function vacasSinServicio(state) {
  return state.vacas
    .filter(v => !esToro(v) && v.estado === 'ACTIVA')
    .map(v => ({ vaca: v, ...estadoReproductivo(state, v) }))
    .filter(x => x.estado === 'SIN_SERVICIO')
    .sort((a, b) => (b.diasVacia || 0) - (a.diasVacia || 0));
}

// Semáforo por días vacía: verde ≤100, amarillo 101-150, rojo >150
export function semaforoDiasVacia(dias) {
  if (dias == null) return '';
  if (dias > 150) return 'rojo';
  if (dias > 100) return 'amarillo';
  return 'verde';
}

export function kpisHato(state) {
  const v = state.vacas.filter(x => !esToro(x)), t = state.terneros;
  return {
    toros: state.vacas.filter(x => esToro(x) && x.estado === 'ACTIVA').length,
    sinServicio: vacasSinServicio(state).length,
    vacasActivas: v.filter(x => x.estado === 'ACTIVA').length,
    vacasVendidas: v.filter(x => x.estado === 'VENDIDA').length,
    vacasFallecidas: v.filter(x => x.estado === 'FALLECIDA').length,
    prenadas: state.prenez.filter(p => p.estado === 'PREÑADA').length,
    ternerosVivos: t.filter(x => x.activo).length,
    ternerosVendidos: t.filter(x => x.tipoSalida === 'VENDIDO').length,
    ternerosFallecidos: t.filter(x => x.tipoSalida === 'FALLECIDO').length,
    totalAnimales: v.filter(x => x.estado === 'ACTIVA').length + t.filter(x => x.activo).length,
  };
}

// Nacimientos de terneros por mes (para la gráfica del tablero)
export function nacimientosPorMes(state, nMeses = 12) {
  const meses = ultimosMeses(nMeses);
  const mapa = Object.fromEntries(meses.map(m => [m, 0]));
  for (const t of state.terneros) {
    const k = mesKey(t.fechaNac);
    if (k in mapa) mapa[k]++;
  }
  return meses.map(m => ({ key: m, value: mapa[m] }));
}

// Composición del hato activo por genética
export function geneticasHato(state) {
  const mapa = {};
  for (const v of state.vacas.filter(x => x.estado === 'ACTIVA' && !esToro(x))) {
    const g = v.genetica || 'Sin registro';
    mapa[g] = (mapa[g] || 0) + 1;
  }
  return Object.entries(mapa)
    .sort((a, b) => b[1] - a[1])
    .map(([label, value]) => ({ label, value }));
}

export function kpisReproduccion(state) {
  // Solo cuentan los servicios con resultado conocido; los CERRADO no se sabe.
  const conf = state.servicios.filter(s => s.resultado === 'PREÑADA' || s.resultado === 'VACÍA');
  const tasa = arr => {
    const c = arr.filter(s => s.resultado === 'PREÑADA').length;
    return arr.length ? { pct: Math.round((c / arr.length) * 100), n: arr.length } : null;
  };
  return {
    prenadas: state.prenez.filter(p => p.estado === 'PREÑADA').length,
    pendientes: state.servicios.filter(s => s.resultado === 'PENDIENTE').length,
    tasaMN: tasa(conf.filter(s => s.tipo === 'MN')),
    tasaIA: tasa(conf.filter(s => s.tipo === 'IA')),
    tasaTE: tasa(conf.filter(s => s.tipo === 'TE')),
  };
}

// ── Alertas para el tablero ───────────────────────────────────────
export function alertas(state) {
  const hoy = hoyISO();
  const aj = ajustes(state);
  const out = { partosProximos: [], partosVencidos: [], serviciosPorConfirmar: [],
                reaplicaciones: [], preparto: [] };

  for (const t of (state.tratamientos || [])) {
    if (t.estado !== 'PENDIENTE' || !t.fechaReaplicar) continue;
    const dias = diasEntre(hoy, t.fechaReaplicar);
    if (dias != null && dias <= 15) out.reaplicaciones.push({ ...t, dias });
  }
  out.reaplicaciones.sort((a, b) => a.dias - b.dias);

  for (const p of state.prenez) {
    if (p.estado !== 'PREÑADA' || !p.fechaProbParto) continue;
    const dias = diasEntre(hoy, p.fechaProbParto);
    if (dias == null) continue;
    if (dias < 0) out.partosVencidos.push({ ...p, dias });
    else if (dias <= aj.diasAvisoParto) out.partosProximos.push({ ...p, dias });
  }
  out.partosProximos.sort((a, b) => a.dias - b.dias);
  out.partosVencidos.sort((a, b) => a.dias - b.dias);

  // Vacas que ya deberían estar en preparto y a las que no se les ha anotado.
  for (const p of state.prenez) {
    if (p.estado !== 'PREÑADA' || !p.fechaProbParto || p.fechaPreparto) continue;
    const dias = diasEntre(hoy, p.fechaProbParto);
    if (dias != null && dias >= 0 && dias <= aj.diasPreparto) out.preparto.push({ ...p, dias });
  }
  out.preparto.sort((a, b) => a.dias - b.dias);

  // Servicios por confirmar: uno por vaca (el más reciente), y solo si de
  // verdad hay algo que confirmar: la vaca sigue activa, no está ya preñada y
  // el servicio es posterior a su último parto.
  const prenadas = new Set(state.prenez.filter(p => p.estado === 'PREÑADA').map(p => p.chapeta));
  const porVaca = new Map();
  for (const s of state.servicios) {
    if (s.resultado !== 'PENDIENTE' || !s.fecha) continue;
    const v = state.vacas.find(x => x.chapeta === s.chapeta);
    if (!v || v.estado !== 'ACTIVA' || prenadas.has(s.chapeta)) continue;
    if (v.ultimoParto && s.fecha <= v.ultimoParto) continue;
    const dias = diasEntre(s.fecha, hoy);
    if (dias == null || dias < aj.diasPalpar) continue;
    const previo = porVaca.get(s.chapeta);
    if (!previo || s.fecha > previo.fecha) porVaca.set(s.chapeta, { ...s, dias });
  }
  out.serviciosPorConfirmar = [...porVaca.values()].sort((a, b) => b.dias - a.dias);

  return out;
}

// ── Sanidad ───────────────────────────────────────────────────────
export async function registrarTratamiento({ fecha, producto, aplicadoA, diasReaplicar, notas }) {
  fecha = fecha || hoyISO();
  const dias = Number(diasReaplicar) || 0;
  await db.add('tratamientos', {
    fecha, producto, aplicadoA: aplicadoA || 'Toda la lechería',
    diasReaplicar: dias, fechaReaplicar: dias ? addDias(fecha, dias) : '',
    estado: 'PENDIENTE', notas: notas || '',
  });
  await registrarEvento('SANIDAD', aplicadoA || 'Toda la lechería', 'TRATAMIENTO',
    { fecha, causa: producto + (dias ? ` — reaplicar en ${dias} días` : '') });
}

// Marca un tratamiento como reaplicado: lo cierra y crea el siguiente ciclo.
export async function reaplicarTratamiento(trat, fecha) {
  fecha = fecha || hoyISO();
  trat.estado = 'HECHO';
  await db.put('tratamientos', trat);
  await registrarTratamiento({
    fecha, producto: trat.producto, aplicadoA: trat.aplicadoA,
    diasReaplicar: trat.diasReaplicar, notas: trat.notas,
  });
}

// La vaca puede estar en el estado dado según los datos actuales
export function vacaDe(state, chapeta) {
  return state.vacas.find(v => v.chapeta === String(chapeta));
}
export function terneroDe(state, nombre) {
  return state.terneros.find(t => t.nombre.trim().toLowerCase() === String(nombre).trim().toLowerCase());
}
