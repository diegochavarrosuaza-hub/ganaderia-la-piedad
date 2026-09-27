// Vista Respaldo — exportar/importar los datos y ayuda
import { exportarTodo, importarTodo, respaldoPrevio } from '../db.js';
import { download, hoyISO, fmtNum, esc } from '../util.js';
import { toast, confirmar } from '../ui.js';
import * as sync from '../sync.js';

const fmtFechaCorta = iso => {
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
};

export function render(el, ctx) {
  const { state } = ctx;
  const conteos = [
    ['🐄 Vacas', state.vacas.length],
    ['🐮 Terneros', state.terneros.length],
    ['💉 Servicios', state.servicios.length],
    ['🤰 Preñeces', state.prenez.length],
    ['⚖️ Pesajes', state.pesajes.length],
    ['🩺 Tratamientos', (state.tratamientos || []).length],
    ['📋 Eventos', state.eventos.length],
  ];

  const cfg = sync.getConfig();
  const activa = sync.haySync();

  el.innerHTML = `
    <div class="card">
      <h2>🔄 Sincronizar entre dispositivos
        <span class="h2-note">${activa ? 'activa ✅' : 'sin configurar'}</span></h2>
      <p style="font-size:14px; line-height:1.6; margin-bottom:12px;">
        ${activa
          ? 'La tablet y el celular comparten los mismos datos. Se sincroniza sola al abrir la app, cuando vuelve el internet y cada 5 minutos. Sin señal la app sigue funcionando: los cambios suben después.'
          : 'Hoy cada aparato guarda lo suyo por separado: lo que se registra en la tablet no se ve en el celular. Al configurar esto, todos los aparatos ven lo mismo.'}
      </p>
      <div class="f-row" style="max-width:560px;">
        <label>Enlace del proyecto (URL)</label>
        <input type="text" id="sync-url" placeholder="https://xxxx.supabase.co" value="${cfg.url}">
      </div>
      <div class="f-row" style="max-width:560px;">
        <label>Clave pública (anon key)</label>
        <input type="password" id="sync-key" placeholder="eyJhbG..." value="${cfg.key ? '' : ''}">
        <div class="f-help">${cfg.key ? 'Ya hay una clave guardada; escribe una nueva solo si la vas a cambiar.' : 'Se guarda solo en este dispositivo.'}</div>
      </div>
      <div class="fab-row">
        <button class="btn btn-primary btn-sm" id="sync-guardar">Guardar y probar</button>
        ${activa ? '<button class="btn btn-blue btn-sm" id="sync-ahora">🔄 Sincronizar ahora</button>' : ''}
        ${activa ? '<button class="btn btn-ghost btn-sm" id="sync-enlace">🔗 Conectar otro dispositivo</button>' : ''}
        ${activa ? '<button class="btn btn-danger btn-sm" id="sync-quitar">Desconectar</button>' : ''}
      </div>
      <div id="sync-enlace-box"></div>
      <div id="sync-estado" class="muted" style="font-size:13px; margin-top:8px;"></div>
    </div>

    <div class="card">
      <h2>💾 Respaldo de los datos</h2>
      <p style="font-size:14px; line-height:1.6; margin-bottom:12px;">
        Los datos viven <b>en este dispositivo</b> (en el navegador). Descarga un respaldo
        cada cierto tiempo y guárdalo en Google Drive o envíalo por WhatsApp: con ese archivo
        se puede recuperar todo en cualquier otro celular o computador.
      </p>
      <div class="fab-row">
        <button class="btn btn-primary" id="btn-exportar">⬇️ Descargar respaldo</button>
        <button class="btn btn-ghost" id="btn-importar">⬆️ Restaurar desde respaldo</button>
        <input type="file" id="file-import" accept=".json,application/json" hidden>
      </div>
      <div id="previo-box"></div>
    </div>

    <div class="card">
      <h2>📦 Qué hay guardado</h2>
      <div class="kpi-grid">
        ${conteos.map(([label, n]) => `
          <div class="kpi-card"><div class="kpi-val">${fmtNum(n)}</div>
          <div class="kpi-label">${label}</div></div>`).join('')}
      </div>
    </div>

    <div class="card">
      <h2>📱 Instalar en el celular</h2>
      <p style="font-size:14px; line-height:1.6;">
        Abre esta página en el navegador del celular y usa
        <b>“Agregar a pantalla de inicio”</b> (Chrome: menú ⋮ → Agregar a pantalla principal).
        Queda como una app normal, con su ícono, y funciona aunque no haya señal.
      </p>
    </div>
  `;

  // Si hubo una actualización automática de datos, ofrecer lo que había antes.
  respaldoPrevio().then(prev => {
    const caja = el.querySelector('#previo-box');
    if (!prev || !caja) return;
    caja.innerHTML = `<div class="hint" style="margin-top:12px;">💡
      <span>La app actualizó los datos del hato el ${fmtFechaCorta(prev.fecha)}.
      Guardamos por si acaso lo que había antes.
      <button class="btn btn-ghost btn-sm" id="btn-previo" style="margin-left:6px;">⬇️ Descargar datos anteriores</button></span></div>`;
    caja.querySelector('#btn-previo').onclick = () => {
      download(`datos-anteriores-la-piedad-${prev.fecha.slice(0, 10)}.json`,
        JSON.stringify({ app: 'ganaderia-la-piedad', version: 3, exportado: prev.fecha, datos: prev.datos }, null, 1));
      toast('Descargado. Si necesitas volver a esos datos, usa “Restaurar desde respaldo”.', 'info');
    };
  });

  // ── Sincronización ──
  sync.ultimaSync().then(f => {
    const cont = el.querySelector('#sync-estado');
    if (cont && f) cont.textContent = 'Última sincronización: ' + new Date(f).toLocaleString('es-CO');
  });

  el.querySelector('#sync-guardar').onclick = async () => {
    const url = el.querySelector('#sync-url').value.trim();
    const keyEscrita = el.querySelector('#sync-key').value.trim();
    const key = keyEscrita || sync.getConfig().key;
    if (!url || !key) return toast('Faltan el enlace y la clave.', 'error');
    sync.setConfig(url, key);
    const cont = el.querySelector('#sync-estado');
    cont.textContent = 'Probando la conexión…';
    try {
      await sync.probarConexion();
      cont.textContent = 'Conexión correcta. Sincronizando…';
      const r = await sync.sincronizar();
      toast(`Sincronización activada ✅ (subidos ${r.subidos}, bajados ${r.bajados})`);
      ctx.refresh();
    } catch (err) {
      cont.textContent = '';
      toast(err.message, 'error');
    }
  };

  const btnAhora = el.querySelector('#sync-ahora');
  if (btnAhora) btnAhora.onclick = async () => {
    btnAhora.disabled = true;
    const txt = btnAhora.textContent;
    btnAhora.textContent = '⏳ Sincronizando…';
    try {
      const r = await sync.sincronizar();
      if (r.ok) {
        toast(`Listo: subidos ${r.subidos}, bajados ${r.bajados}.`);
        if (r.bajados) return ctx.refresh();
      } else {
        toast(r.motivo === 'sin-internet' ? 'Sin internet ahora mismo.' : 'Falta configurar.', 'error');
      }
    } catch (err) {
      toast(err.message, 'error');
    }
    btnAhora.disabled = false;
    btnAhora.textContent = txt;
  };

  // Enlace para no tener que teclear la clave en la tablet ni en el celular.
  const btnEnlace = el.querySelector('#sync-enlace');
  if (btnEnlace) btnEnlace.onclick = async () => {
    const caja = el.querySelector('#sync-enlace-box');
    let enlace;
    try {
      enlace = sync.crearEnlaceConfig();
    } catch (err) {
      return toast(err.message, 'error');
    }
    let copiado = false;
    try {
      await navigator.clipboard.writeText(enlace);
      copiado = true;
    } catch { /* sin permiso de portapapeles: queda a la vista para copiarlo a mano */ }

    caja.innerHTML = `
      <div class="hint" style="margin-top:12px; flex-direction:column; align-items:stretch;">
        <div><b>Abre este enlace UNA vez en el otro dispositivo</b> (tablet o celular)
          y queda conectado solo. Mándalo por WhatsApp.</div>
        <input type="text" id="sync-enlace-txt" readonly value="${esc(enlace)}"
               style="margin-top:8px; width:100%; font-size:12px;">
        <div style="margin-top:8px;">⚠️ Este enlace <b>es la llave de los datos de la finca</b>.
          Mándalo solo a quien deba entrar; no lo publiques en grupos.</div>
      </div>`;
    const campo = caja.querySelector('#sync-enlace-txt');
    campo.onclick = () => campo.select();
    toast(copiado ? 'Enlace copiado ✅ Pégalo en WhatsApp.' : 'Enlace listo: tócalo y cópialo.', 'info');
  };

  const btnQuitar = el.querySelector('#sync-quitar');
  if (btnQuitar) btnQuitar.onclick = async () => {
    if (!(await confirmar('¿Desconectar este dispositivo de la sincronización? Los datos que ya tiene se quedan aquí, pero dejará de compartirlos.', { peligro: true, okLabel: 'Desconectar' }))) return;
    sync.setConfig('', '');
    toast('Sincronización desconectada.', 'info');
    ctx.refresh();
  };

  el.querySelector('#btn-exportar').onclick = async () => {
    const respaldo = await exportarTodo();
    download(`respaldo-la-piedad-${hoyISO()}.json`, JSON.stringify(respaldo, null, 1));
    toast('Respaldo descargado. Guárdalo en un lugar seguro. ✅');
  };

  const fileInput = el.querySelector('#file-import');
  el.querySelector('#btn-importar').onclick = () => fileInput.click();
  fileInput.onchange = async () => {
    const archivo = fileInput.files[0];
    if (!archivo) return;
    try {
      const contenido = JSON.parse(await archivo.text());
      const fecha = contenido?.exportado ? contenido.exportado.slice(0, 10) : '(fecha desconocida)';
      const ok = await confirmar(
        `¿Restaurar el respaldo del <b>${fecha}</b>?<br><br>⚠️ Esto <b>reemplaza TODOS los datos actuales</b> de la app por los del archivo.`,
        { peligro: true, okLabel: 'Sí, restaurar' });
      if (!ok) return;
      await importarTodo(contenido);
      toast('Respaldo restaurado correctamente. ✅');
      ctx.refresh();
    } catch (err) {
      toast('No se pudo restaurar: ' + err.message, 'error');
    } finally {
      fileInput.value = '';
    }
  };
}
