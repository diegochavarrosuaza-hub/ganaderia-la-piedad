// fichas.js — hojas de vida de vacas y terneros (modal grande con historial)
import { fmtFecha, fmtMoney, fmtNum, esc, edadTexto } from './util.js';
import { openModal, closeModal, badge } from './ui.js';
import * as logic from './logic.js';
import { sparkline } from './charts.js';
import * as forms from './forms.js';
import { imprimirFicha } from './print.js';

export function abrirFichaVaca(chapeta, ctx) {
  const { state } = ctx;
  const vaca = logic.vacaDe(state, chapeta);
  if (!vaca) return;

  const prenezActiva = logic.prenezActivaDe(state, chapeta);
  const servicios = logic.serviciosDe(state, chapeta);
  const preneces = logic.prenecesDe(state, chapeta);
  const crias = logic.criasDe(state, chapeta);
  const eventos = logic.eventosDe(state, chapeta).slice(0, 12);
  const activa = vaca.estado === 'ACTIVA';

  const acciones = [
    prenezActiva
      ? `<button class="btn btn-pink btn-sm" data-f="parto">🍼 Registrar parto</button>`
      : (activa ? `<button class="btn btn-pink btn-sm" data-f="prenez">🤰 Registrar preñez</button>` : ''),
    activa ? `<button class="btn btn-blue btn-sm" data-f="ia">💉 Inseminar</button>` : '',
    activa ? `<button class="btn btn-warn btn-sm" data-f="vender">💰 Vender</button>` : '',
    activa ? `<button class="btn btn-danger btn-sm" data-f="fallecer">🕊️ Falleció</button>` : '',
    `<button class="btn btn-ghost btn-sm" data-f="editar">✏️ Editar</button>`,
    `<button class="btn btn-ghost btn-sm" data-f="pdf">🖨️ PDF</button>`,
  ].filter(Boolean).join('');

  const cuerpo = `
      <div class="ficha-head">
        <span class="ficha-id">Chapeta ${esc(vaca.chapeta)}</span>
        ${badge(vaca.estado)}
        ${vaca.genetica ? `<span class="muted">Genética: ${esc(vaca.genetica)}</span>` : ''}
      </div>
      <div class="ficha-datos">
        <div class="fd"><b>Código</b>${esc(vaca.codigo) || '—'}</div>
        <div class="fd"><b>Nacimiento</b>${fmtFecha(vaca.fechaNac)} (${edadTexto(vaca.fechaNac)})</div>
        <div class="fd"><b>Último parto</b>${fmtFecha(vaca.ultimoParto)}</div>
        <div class="fd"><b>Cría actual</b>${esc(vaca.criaActual) || '—'}</div>
        ${prenezActiva ? `<div class="fd"><b>Parto probable</b>🍼 ${fmtFecha(prenezActiva.fechaProbParto)}</div>` : ''}
        ${(() => {
          const r = logic.estadoReproductivo(state, vaca);
          if (r.estado === 'SIN_SERVICIO') return `<div class="fd"><b>Reproducción</b>⏰ ${r.diasVacia} días sin servicio</div>`;
          if (r.estado === 'ESPERANDO') return `<div class="fd"><b>Reproducción</b>⏳ esperando confirmación (${r.diasServicio} d)</div>`;
          if (r.estado === 'DESCANSO') return `<div class="fd"><b>Reproducción</b>descansando (${r.diasVacia} d posparto)</div>`;
          return '';
        })()}
        ${vaca.fechaSalida ? `<div class="fd"><b>Fecha salida</b>${fmtFecha(vaca.fechaSalida)}</div>` : ''}
      </div>
      <div class="fab-row">${acciones}</div>

      <div class="hint hint-sm">✏️ Toca cualquier línea del historial para corregirla o borrarla.</div>

      ${seccion('🍼 Crías registradas', crias.map(c => fila('cria', `data-nombre="${esc(c.nombre)}"`, `
          <span class="hist-fecha">${fmtFecha(c.fechaNac)}</span>
          <span><b>${esc(c.nombre)}</b> (${esc(c.sexo) || '?'}) ${c.activo ? '' : '· ' + badge(c.tipoSalida || 'NO')}</span>`,
        '↗')), 'Sin crías vinculadas a esta chapeta.')}

      ${seccion('💉 Servicios (monta, IA, TE)', servicios.map(s => fila('servicio', `data-id="${s.id}"`, `
          <span class="hist-fecha">${fmtFecha(s.fecha)}</span>
          <span>${badge(s.tipo)} ${esc([s.material, s.raza].filter(Boolean).join(' · '))}
          → ${badge(s.resultado)}</span>`)), 'Sin servicios registrados.')}

      ${seccion('🤰 Preñeces', preneces.map(p => fila('prenez', `data-id="${p.id}"`, `
          <span class="hist-fecha">${fmtFecha(p.fechaPrenez)}</span>
          <span>${badge(p.estado)} ${origenBadge(p)} parto probable ${fmtFecha(p.fechaProbParto)}
          ${p.fechaPreparto ? '· 🌾 preparto desde ' + fmtFecha(p.fechaPreparto) : ''}
          ${p.observaciones ? '· <span class="muted">' + esc(p.observaciones) + '</span>' : ''}</span>`)),
        'Sin preñeces registradas.')}

      ${seccion('📋 Últimos eventos', eventos.map(e => fila('evento', `data-id="${e.id}"`, `
          <span class="hist-fecha">${fmtFecha(e.fecha) !== '—' ? fmtFecha(e.fecha) : (e.timestamp || '').slice(0, 10)}</span>
          <span>${esc(e.tipo)}${e.precio ? ' · ' + fmtMoney(e.precio) : ''}${e.causa ? ' · ' + esc(e.causa) : ''}</span>`)),
        'Sin eventos.')}
    `;

  const modal = openModal({
    lg: true,
    title: `🐄 Hoja de vida — Vaca ${esc(vaca.chapeta)}`,
    bodyHTML: cuerpo,
  });

  const acc = {
    parto: () => forms.formParto(vaca.chapeta, ctx),
    prenez: () => forms.formPrenez(vaca.chapeta, ctx),
    ia: () => forms.formServicio('IA', ctx, vaca.chapeta),
    vender: () => forms.formEstadoVaca(vaca, 'VENDIDA', ctx),
    fallecer: () => forms.formEstadoVaca(vaca, 'FALLECIDA', ctx),
    editar: () => forms.formEditarVaca(vaca, ctx),
  };
  modal.querySelectorAll('[data-f]').forEach(b =>
    b.addEventListener('click', () => {
      if (b.dataset.f === 'pdf') {
        return imprimirFicha('vaca-' + vaca.chapeta, `Hoja de vida — Vaca ${vaca.chapeta}`, cuerpo);
      }
      closeModal(); acc[b.dataset.f]();
    }));
  conectarEdicion(modal, ctx);
}

export function abrirFichaTernero(nombre, ctx) {
  const { state } = ctx;
  const t = logic.terneroDe(state, nombre);
  if (!t) return;

  const pesos = logic.pesajesDe(state, t.nombre);
  const gdp = logic.gdpDe(state, t.nombre);
  const eventos = logic.eventosDe(state, t.nombre).slice(0, 10);
  const madre = logic.vacaDe(state, t.codigoMadre);

  const acciones = [
    t.activo ? `<button class="btn btn-primary btn-sm" data-f="pesar">⚖️ Pesar</button>` : '',
    t.activo ? `<button class="btn btn-warn btn-sm" data-f="vender">💰 Vender</button>` : '',
    t.activo ? `<button class="btn btn-danger btn-sm" data-f="fallecer">🕊️ Falleció</button>` : '',
    `<button class="btn btn-ghost btn-sm" data-f="editar">✏️ Editar</button>`,
    `<button class="btn btn-ghost btn-sm" data-f="pdf">🖨️ PDF</button>`,
  ].filter(Boolean).join('');

  const cuerpo = `
      <div class="ficha-head">
        <span class="ficha-id">${esc(t.nombre)}</span>
        ${badge(t.activo ? 'VIVO' : (t.tipoSalida || 'NO'))}
        <span class="muted">${esc(t.sexo) || ''}</span>
      </div>
      <div class="ficha-datos">
        <div class="fd"><b>Nacimiento</b>${fmtFecha(t.fechaNac)} (${edadTexto(t.fechaNac)})</div>
        <div class="fd"><b>Madre</b>${madre ? '🐄 Vaca ' + esc(madre.chapeta) : (esc(t.codigoMadre) || '—')}</div>
        <div class="fd"><b>Último peso</b>${t.ultimoPeso ? fmtNum(t.ultimoPeso, 1) + ' kg (' + fmtFecha(t.fechaUltimoPesaje) + ')' : '—'}</div>
        <div class="fd"><b>Ganancia diaria</b>${gdp != null ? fmtNum(gdp * 1000, 0) + ' g/día' : '— (necesita 2+ pesajes)'}</div>
        ${t.genetica ? `<div class="fd"><b>Raza / genética</b>${esc(t.genetica)}</div>` : ''}
        <div class="fd"><b>Brucelosis</b>${esc(t.brucelosis) || 'No'}</div>
        ${t.fechaSalida ? `<div class="fd"><b>Salida</b>${fmtFecha(t.fechaSalida)}</div>` : ''}
      </div>
      ${t.observaciones ? `<div class="muted" style="font-size:13px; margin-bottom:8px;">${esc(t.observaciones)}</div>` : ''}
      <div class="fab-row">${acciones}</div>

      ${pesos.length >= 2 ? `
        <div class="ficha-sec"><h3>📈 Curva de crecimiento</h3>
          <div class="sparkline-wrap chart-box">${sparkline(pesos.map(p => ({ x: p.fecha, y: p.peso })), { width: 380, height: 64 })}</div>
        </div>` : ''}

      <div class="hint hint-sm">✏️ Toca cualquier línea del historial para corregirla o borrarla.</div>

      ${seccion('⚖️ Pesajes', pesos.slice().reverse().map(p => fila('pesaje', `data-id="${p.id}"`, `
          <span class="hist-fecha">${fmtFecha(p.fecha)}</span>
          <span><b>${fmtNum(p.peso, 1)} kg</b>${p.observaciones ? ' · <span class="muted">' + esc(p.observaciones) + '</span>' : ''}</span>`)),
        'Sin pesajes todavía.')}

      ${seccion('📋 Últimos eventos', eventos.map(e => fila('evento', `data-id="${e.id}"`, `
          <span class="hist-fecha">${fmtFecha(e.fecha) !== '—' ? fmtFecha(e.fecha) : (e.timestamp || '').slice(0, 10)}</span>
          <span>${esc(e.tipo)}${e.precio ? ' · ' + fmtNum(e.precio) : ''}${e.causa ? ' · ' + esc(e.causa) : ''}</span>`)),
        'Sin eventos.')}
    `;

  const modal = openModal({
    lg: true,
    title: `🐮 Hoja de vida — ${esc(t.nombre)}`,
    bodyHTML: cuerpo,
  });

  const acc = {
    pesar: () => forms.formPesaje(ctx, t.nombre),
    vender: () => forms.formSalidaTernero(t, 'VENDIDO', ctx),
    fallecer: () => forms.formSalidaTernero(t, 'FALLECIDO', ctx),
    editar: () => forms.formEditarTernero(t, ctx),
  };
  modal.querySelectorAll('[data-f]').forEach(b =>
    b.addEventListener('click', () => {
      if (b.dataset.f === 'pdf') {
        return imprimirFicha('ternero-' + t.nombre.toLowerCase().replace(/\s+/g, '-'),
          `Hoja de vida — ${t.nombre}`, cuerpo);
      }
      closeModal(); acc[b.dataset.f]();
    }));
  conectarEdicion(modal, ctx);
}

function seccion(titulo, items, vacio) {
  return `<div class="ficha-sec"><h3>${titulo}</h3>
    <div class="hist-list">${items.length ? items.join('') : `<div class="empty-note">${esc(vacio)}</div>`}</div>
  </div>`;
}

// Cada línea del historial se puede tocar para corregirla o borrarla.
function fila(tipo, attrs, interior, icono = '✏️') {
  return `<div class="hist-item hist-ed" data-ed="${tipo}" ${attrs}>${interior}
    <button class="hist-lapiz" type="button" title="Tocar para corregir">${icono}</button>
  </div>`;
}

// Cómo quedó preñada: antes solo se escribía en las observaciones, por eso las
// preñeces viejas se deducen del texto (logic.origenDe).
function origenBadge(p) {
  const o = logic.origenDe(p);
  return o ? badge(logic.ORIGEN_PRENEZ[o]) : '';
}

// Abre el formulario de corrección que corresponda a la línea tocada.
function conectarEdicion(modal, ctx) {
  modal.querySelectorAll('[data-ed]').forEach(linea => linea.addEventListener('click', () => {
    const tipo = linea.dataset.ed;
    if (tipo === 'cria') { closeModal(); return abrirFichaTernero(linea.dataset.nombre, ctx); }

    const id = Number(linea.dataset.id);
    const store = { servicio: 'servicios', prenez: 'prenez', evento: 'eventos', pesaje: 'pesajes' }[tipo];
    const registro = store && ctx.state[store].find(x => x.id === id);
    if (!registro) return;

    const abrir = {
      servicio: forms.formEditarServicio,
      prenez: forms.formEditarPrenez,
      evento: forms.formEditarEvento,
      pesaje: forms.formEditarPesaje,
    }[tipo];
    closeModal();
    abrir(registro, ctx);
  }));
}
