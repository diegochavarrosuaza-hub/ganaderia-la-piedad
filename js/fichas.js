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
        ${vaca.fechaSalida ? `<div class="fd"><b>Fecha salida</b>${fmtFecha(vaca.fechaSalida)}</div>` : ''}
      </div>
      <div class="fab-row">${acciones}</div>

      ${seccion('🍼 Crías registradas', crias.map(c => `
        <div class="hist-item"><span class="hist-fecha">${fmtFecha(c.fechaNac)}</span>
          <span><b>${esc(c.nombre)}</b> (${esc(c.sexo) || '?'}) ${c.activo ? '' : '· ' + badge(c.tipoSalida || 'NO')}</span>
        </div>`), 'Sin crías vinculadas a esta chapeta.')}

      ${seccion('💉 Servicios (IA / TE)', servicios.map(s => `
        <div class="hist-item"><span class="hist-fecha">${fmtFecha(s.fecha)}</span>
          <span>${badge(s.tipo)} ${esc([s.material, s.raza].filter(Boolean).join(' · '))}
          → ${badge(s.resultado)}</span>
        </div>`), 'Sin servicios registrados.')}

      ${seccion('🤰 Preñeces', preneces.map(p => `
        <div class="hist-item"><span class="hist-fecha">${fmtFecha(p.fechaPrenez)}</span>
          <span>${badge(p.estado)} parto probable ${fmtFecha(p.fechaProbParto)}
          ${p.observaciones ? '· <span class="muted">' + esc(p.observaciones) + '</span>' : ''}</span>
        </div>`), 'Sin preñeces registradas.')}

      ${seccion('📋 Últimos eventos', eventos.map(e => `
        <div class="hist-item"><span class="hist-fecha">${fmtFecha(e.fecha) !== '—' ? fmtFecha(e.fecha) : (e.timestamp || '').slice(0, 10)}</span>
          <span>${esc(e.tipo)}${e.precio ? ' · ' + fmtMoney(e.precio) : ''}${e.causa ? ' · ' + esc(e.causa) : ''}</span>
        </div>`), 'Sin eventos.')}
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
        <div class="fd"><b>Brucelosis</b>${esc(t.brucelosis) || 'No'}</div>
        ${t.fechaSalida ? `<div class="fd"><b>Salida</b>${fmtFecha(t.fechaSalida)}</div>` : ''}
      </div>
      ${t.observaciones ? `<div class="muted" style="font-size:13px; margin-bottom:8px;">${esc(t.observaciones)}</div>` : ''}
      <div class="fab-row">${acciones}</div>

      ${pesos.length >= 2 ? `
        <div class="ficha-sec"><h3>📈 Curva de crecimiento</h3>
          <div class="sparkline-wrap chart-box">${sparkline(pesos.map(p => ({ x: p.fecha, y: p.peso })), { width: 380, height: 64 })}</div>
        </div>` : ''}

      ${seccion('⚖️ Pesajes', pesos.slice().reverse().map(p => `
        <div class="hist-item"><span class="hist-fecha">${fmtFecha(p.fecha)}</span>
          <span><b>${fmtNum(p.peso, 1)} kg</b>${p.observaciones ? ' · <span class="muted">' + esc(p.observaciones) + '</span>' : ''}</span>
        </div>`), 'Sin pesajes todavía.')}

      ${seccion('📋 Últimos eventos', eventos.map(e => `
        <div class="hist-item"><span class="hist-fecha">${fmtFecha(e.fecha) !== '—' ? fmtFecha(e.fecha) : (e.timestamp || '').slice(0, 10)}</span>
          <span>${esc(e.tipo)}${e.precio ? ' · ' + fmtNum(e.precio) : ''}${e.causa ? ' · ' + esc(e.causa) : ''}</span>
        </div>`), 'Sin eventos.')}
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
}

function seccion(titulo, items, vacio) {
  return `<div class="ficha-sec"><h3>${titulo}</h3>
    <div class="hist-list">${items.length ? items.join('') : `<div class="empty-note">${esc(vacio)}</div>`}</div>
  </div>`;
}
