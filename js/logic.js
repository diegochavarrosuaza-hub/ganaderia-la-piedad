// logic.js — reglas del negocio (portadas del Apps Script original y ampliadas)
import * as db from './db.js';
import { hoyISO, addDias, diasEntre, mesKey, ultimosMeses, toDate } from './util.js';

export const DIAS_GESTACION = { IA: 280, TE: 273 };

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

export async function crearPrenez({ chapeta, fechaPrenez, dias = 280, observaciones = '' }) {
  chapeta = String(chapeta).trim();
  if (!chapeta) throw new Error('Falta la chapeta de la vaca.');
  const prenez = await db.all('prenez');
  if (prenez.some(p => p.chapeta === chapeta && p.estado === 'PREÑADA')) {
    throw new Error(`La vaca ${chapeta} ya tiene una preñez activa.`);
  }
  const fp = fechaPrenez || hoyISO();
  const fechaProbParto = addDias(fp, dias);
  await db.add('prenez', { chapeta, fechaPrenez: fp, fechaProbParto, observaciones, estado: 'PREÑADA' });

  const vacas = await db.all('vacas');
  const vaca = vacas.find(v => v.chapeta === chapeta);
  if (vaca) {
    vaca.fechaPrenez = fp;
    vaca.fechaProbParto = fechaProbParto;
    await db.put('vacas', vaca);
  }
  await registrarEvento('VACA', chapeta, 'PREÑEZ', { fecha: fp, causa: observaciones });
  return fechaProbParto;
}

// ── Servicios (inseminación / transferencia) ──────────────────────
export async function confirmarServicio(servicio, resultado) {
  servicio.resultado = resultado;
  servicio.fechaConfirmacion = hoyISO();
  await db.put('servicios', servicio);
  const etiqueta = servicio.tipo === 'TE' ? 'transferencia' : 'inseminación';
  await registrarEvento('VACA', servicio.chapeta, 'RESULTADO_' + resultado,
    { fecha: servicio.fecha, causa: etiqueta });
  if (resultado === 'PREÑADA') {
    const fechaProbParto = await crearPrenez({
      chapeta: servicio.chapeta,
      fechaPrenez: servicio.fecha,
      dias: DIAS_GESTACION[servicio.tipo] || 280,
      observaciones: 'Por ' + etiqueta,
    });
    return { fechaProbParto };
  }
  return {};
}

// ── Parto ─────────────────────────────────────────────────────────
export async function registrarParto({ chapeta, fechaParto, criaNombre, sexoCria, brucelosis, complicaciones }) {
  chapeta = String(chapeta).trim();
  const prenez = await db.all('prenez');
  const activa = prenez.find(p => p.chapeta === chapeta && p.estado === 'PREÑADA');
  if (!activa) throw new Error(`No hay preñez activa para la vaca ${chapeta}.`);

  activa.estado = 'PARIDA';
  activa.observaciones = ('Parto ' + fechaParto + (criaNombre ? ' — Cría: ' + criaNombre : '')
    + (complicaciones ? ' (complicaciones)' : '')).trim();
  await db.put('prenez', activa);

  const vacas = await db.all('vacas');
  const vaca = vacas.find(v => v.chapeta === chapeta);
  if (vaca) {
    vaca.ultimoParto = fechaParto;
    if (criaNombre) vaca.criaActual = criaNombre;
    vaca.fechaPrenez = '';
    vaca.fechaProbParto = '';
    await db.put('vacas', vaca);
  }

  if (criaNombre) {
    await db.add('terneros', {
      nombre: criaNombre, sexo: sexoCria || '', fechaNac: fechaParto,
      codigoMadre: chapeta, activo: true, fechaSalida: '', tipoSalida: '',
      brucelosis: brucelosis || 'No',
      observaciones: 'Nacido del parto de vaca ' + chapeta,
      ultimoPeso: null, fechaUltimoPesaje: '',
    });
    await registrarEvento('TERNERO', criaNombre, 'NACIMIENTO',
      { fecha: fechaParto, causa: 'Madre: vaca ' + chapeta });
  }
  await registrarEvento('VACA', chapeta, 'PARTO', { fecha: fechaParto, causa: criaNombre });
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
    t.ultimoPeso = peso;
    t.fechaUltimoPesaje = fecha || hoyISO();
    await db.put('terneros', t);
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

export function kpisHato(state) {
  const v = state.vacas, t = state.terneros;
  return {
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
  for (const v of state.vacas.filter(x => x.estado === 'ACTIVA')) {
    const g = v.genetica || 'Sin registro';
    mapa[g] = (mapa[g] || 0) + 1;
  }
  return Object.entries(mapa)
    .sort((a, b) => b[1] - a[1])
    .map(([label, value]) => ({ label, value }));
}

export function kpisReproduccion(state) {
  const conf = state.servicios.filter(s => s.resultado && s.resultado !== 'PENDIENTE');
  const tasa = arr => {
    const c = arr.filter(s => s.resultado === 'PREÑADA').length;
    return arr.length ? Math.round((c / arr.length) * 100) : null;
  };
  return {
    prenadas: state.prenez.filter(p => p.estado === 'PREÑADA').length,
    pendientes: state.servicios.filter(s => s.resultado === 'PENDIENTE').length,
    tasaIA: tasa(conf.filter(s => s.tipo === 'IA')),
    tasaTE: tasa(conf.filter(s => s.tipo === 'TE')),
  };
}

// ── Alertas para el tablero ───────────────────────────────────────
export function alertas(state) {
  const hoy = hoyISO();
  const out = { partosProximos: [], partosVencidos: [], serviciosPorConfirmar: [] };

  for (const p of state.prenez) {
    if (p.estado !== 'PREÑADA' || !p.fechaProbParto) continue;
    const dias = diasEntre(hoy, p.fechaProbParto);
    if (dias == null) continue;
    if (dias < 0) out.partosVencidos.push({ ...p, dias });
    else if (dias <= 60) out.partosProximos.push({ ...p, dias });
  }
  out.partosProximos.sort((a, b) => a.dias - b.dias);
  out.partosVencidos.sort((a, b) => a.dias - b.dias);

  for (const s of state.servicios) {
    if (s.resultado !== 'PENDIENTE' || !s.fecha) continue;
    const dias = diasEntre(s.fecha, hoy);
    if (dias != null && dias >= 45) out.serviciosPorConfirmar.push({ ...s, dias });
  }
  out.serviciosPorConfirmar.sort((a, b) => b.dias - a.dias);

  return out;
}

// La vaca puede estar en el estado dado según los datos actuales
export function vacaDe(state, chapeta) {
  return state.vacas.find(v => v.chapeta === String(chapeta));
}
export function terneroDe(state, nombre) {
  return state.terneros.find(t => t.nombre.trim().toLowerCase() === String(nombre).trim().toLowerCase());
}
