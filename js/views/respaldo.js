// Vista Respaldo — sincronización, ajustes de la finca, respaldos y ayuda
import { exportarTodo, importarTodo, respaldosPrevios } from '../db.js';
import { download, hoyISO, fmtNum, esc } from '../util.js';
import { toast, confirmar } from '../ui.js';
import { ajustes, AJUSTES_DEFECTO, guardarAjustes } from '../logic.js';
import * as sync from '../sync.js';

const fmtFechaCorta = iso => {
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
};

export function render(el, ctx) {
  const { state } = ctx;
  const aj = ajustes(state);
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
      <div id="sync-estado" class="sync-estado"></div>
      ${activa ? '' : `
      <div class="f-row" style="max-width:560px;">
        <label>Enlace del proyecto (URL)</label>
        <input type="text" id="sync-url" placeholder="https://xxxx.supabase.co" value="${esc(cfg.url)}">
      </div>
      <div class="f-row" style="max-width:560px;">
        <label>Clave pública (publishable / anon key)</label>
        <input type="password" id="sync-key" placeholder="sb_publishable_… o eyJhbG…">
        <div class="f-help">Se guarda solo en este dispositivo, y solo si la conexión funciona.</div>
      </div>`}
      <div class="fab-row">
        ${activa ? '' : '<button class="btn btn-primary btn-sm" id="sync-guardar">Probar y conectar</button>'}
        ${activa ? '<button class="btn btn-blue btn-sm" id="sync-ahora">🔄 Sincronizar ahora</button>' : ''}
        ${activa ? '<button class="btn btn-ghost btn-sm" id="sync-enlace">🔗 Conectar otro dispositivo</button>' : ''}
        ${activa ? '<button class="btn btn-ghost btn-sm" id="sync-quitar">Desconectar</button>' : ''}
      </div>
      <div id="sync-enlace-box"></div>
      <details style="margin-top:10px; font-size:13px;">
        <summary class="muted" style="cursor:pointer;">Para crear la tabla en un proyecto nuevo de Supabase (SQL)</summary>
        <pre style="white-space:pre-wrap; font-size:11.5px; background:var(--gray-light); padding:10px; border-radius:8px; margin-top:8px;">${esc(sync.SQL_TABLA)}</pre>
      </details>
    </div>

    <div class="card">
      <h2>⚙️ Ajustes de la finca <span class="h2-note">se comparten entre dispositivos</span></h2>
      <div class="f-grid" style="max-width:720px;">
        <div class="f-row"><label>Nombre de la finca</label>
          <input type="text" id="aj-finca" value="${esc(aj.finca)}"></div>
        <div class="f-row"><label>Descanso después del parto (días)</label>
          <input type="number" id="aj-espera" inputmode="numeric" value="${aj.esperaPosparto}">
          <div class="f-help">Pasados estos días sin monta ni inseminación, la vaca aparece como “sin servicio”.</div></div>
        <div class="f-row"><label>Días para poder palpar</label>
          <input type="number" id="aj-palpar" inputmode="numeric" value="${aj.diasPalpar}">
          <div class="f-help">Después de una monta o servicio, cuándo avisar que ya se puede confirmar.</div></div>
        <div class="f-row"><label>Aviso de preparto (días antes del parto)</label>
          <input type="number" id="aj-preparto" inputmode="numeric" value="${aj.diasPreparto}"></div>
        <div class="f-row"><label>Aviso de partos próximos (días antes)</label>
          <input type="number" id="aj-avisoparto" inputmode="numeric" value="${aj.diasAvisoParto}"></div>
      </div>
      <div class="fab-row">
        <button class="btn btn-primary btn-sm" id="aj-guardar">Guardar ajustes</button>
        <button class="btn btn-ghost btn-sm" id="aj-defecto">Volver a los valores de fábrica</button>
      </div>
    </div>

    <div class="card">
      <h2>💾 Respaldo de los datos</h2>
      <p style="font-size:14px; line-height:1.6; margin-bottom:12px;">
        Descarga un respaldo cada cierto tiempo y guárdalo en Google Drive o envíalo por WhatsApp:
        con ese archivo se puede recuperar todo en cualquier otro celular o computador.
        ${activa ? 'Al restaurar un respaldo con la sincronización activa, lo restaurado <b>manda</b>: se sube a la nube y les llega a los demás aparatos.' : ''}
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
      <h2>📱 Instalar en el celular o la tablet</h2>
      <p style="font-size:14px; line-height:1.6;">
        Abre esta página en el navegador y usa <b>“Agregar a pantalla de inicio”</b>
        (Chrome: menú ⋮ → Agregar a pantalla principal · iPhone: compartir ⬆️ → Agregar a inicio).
        Queda como una app normal, con su ícono, y funciona aunque no haya señal.
      </p>
    </div>
  `;

  // ── Copias guardadas antes de cada actualización de datos ──
  respaldosPrevios().then(lista => {
    const caja = el.querySelector('#previo-box');
    if (!lista.length || !caja) return;
    caja.innerHTML = `
      <div class="hint" style="margin-top:12px; flex-direction:column; align-items:stretch; gap:6px;">
        <div>🛟 <b>Copias de seguridad automáticas</b> — se guardaron antes de actualizar los datos del hato:</div>
        ${lista.map((p, i) => `
          <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
            <span>${fmtFechaCorta(p.fecha)} · versión ${esc(p.versionAnterior)}</span>
            <button class="btn btn-ghost btn-sm" data-previo="${i}">⬇️ Descargar</button>
          </div>`).join('')}
      </div>`;
    caja.querySelectorAll('[data-previo]').forEach(b => b.onclick = () => {
      const p = lista[Number(b.dataset.previo)];
      download(`datos-anteriores-la-piedad-${p.fecha.slice(0, 10)}.json`,
        JSON.stringify({ app: 'ganaderia-la-piedad', version: 4, exportado: p.fecha, datos: p.datos }, null, 1));
      toast('Descargado. Si necesitas volver a esos datos, usa “Restaurar desde respaldo”.', 'info');
    });
  });

  // ── Estado de la sincronización, con alarma si lleva mucho sin funcionar ──
  const pintarEstado = async () => {
    const cont = el.querySelector('#sync-estado');
    if (!cont || !activa) return;
    const [ok, err, pend] = await Promise.all([sync.ultimaSync(), sync.ultimoError(), sync.pendientesDeSubir()]);
    const horas = ok ? (Date.now() - Date.parse(ok)) / 36e5 : Infinity;
    const partes = [];
    if (ok) partes.push('Última sincronización: ' + new Date(ok).toLocaleString('es-CO'));
    if (pend) partes.push(`${pend} cambio(s) de este aparato por subir`);
    if (err) partes.push('Último error: ' + esc(err.error));
    const mal = err || horas > 24;
    cont.className = 'sync-estado' + (mal ? ' mal' : '');
    cont.innerHTML = (mal ? '⚠️ ' : '✅ ') + (partes.join(' · ') || 'Todavía no ha sincronizado.');
  };
  pintarEstado();

  const btnGuardar = el.querySelector('#sync-guardar');
  if (btnGuardar) btnGuardar.onclick = async () => {
    const url = el.querySelector('#sync-url').value.trim();
    const key = el.querySelector('#sync-key').value.trim();
    if (!url || !key) return toast('Faltan el enlace y la clave.', 'error');
    btnGuardar.disabled = true;
    const txt = btnGuardar.textContent;
    btnGuardar.textContent = '⏳ Probando…';
    try {
      // Primero se prueba; solo si responde bien se guarda. Así una URL mal
      // escrita no deja el aparato "conectado" a la nada.
      await sync.probarConexion(url, key);
      sync.setConfig(url, key);
      const r = await ctx.sincronizar({ silencioso: true });
      toast(`Sincronización activada ✅ (subidos ${r ? r.subidos : 0}, bajados ${r ? r.bajados : 0})`);
      ctx.refresh();
    } catch (err) {
      toast(err.message, 'error');
      btnGuardar.disabled = false;
      btnGuardar.textContent = txt;
    }
  };

  const btnAhora = el.querySelector('#sync-ahora');
  if (btnAhora) btnAhora.onclick = async () => {
    btnAhora.disabled = true;
    const txt = btnAhora.textContent;
    btnAhora.textContent = '⏳ Sincronizando…';
    const r = await ctx.sincronizar({ silencioso: false });
    btnAhora.disabled = false;
    btnAhora.textContent = txt;
    if (r && r.ok && !r.bajados) pintarEstado();
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

  // ── Ajustes ──
  const leerAjustes = () => ({
    finca: el.querySelector('#aj-finca').value.trim() || AJUSTES_DEFECTO.finca,
    esperaPosparto: Number(el.querySelector('#aj-espera').value) || AJUSTES_DEFECTO.esperaPosparto,
    diasPalpar: Number(el.querySelector('#aj-palpar').value) || AJUSTES_DEFECTO.diasPalpar,
    diasPreparto: Number(el.querySelector('#aj-preparto').value) || AJUSTES_DEFECTO.diasPreparto,
    diasAvisoParto: Number(el.querySelector('#aj-avisoparto').value) || AJUSTES_DEFECTO.diasAvisoParto,
  });
  el.querySelector('#aj-guardar').onclick = async () => {
    await guardarAjustes(state, leerAjustes());
    toast('Ajustes guardados. ⚙️');
    ctx.refresh();
  };
  el.querySelector('#aj-defecto').onclick = async () => {
    await guardarAjustes(state, { ...AJUSTES_DEFECTO });
    toast('Ajustes de fábrica restaurados.', 'info');
    ctx.refresh();
  };

  // ── Respaldo ──
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
        `¿Restaurar el respaldo del <b>${fecha}</b>?<br><br>⚠️ Esto <b>reemplaza TODOS los datos actuales</b> de la app por los del archivo`
        + (activa ? ', y como la sincronización está activa, <b>también se impone en la nube y en los otros aparatos</b>.' : '.'),
        { peligro: true, okLabel: 'Sí, restaurar' });
      if (!ok) return;
      await importarTodo(contenido);
      toast('Respaldo restaurado correctamente. ✅');
      if (activa) await ctx.sincronizar({ silencioso: true });
      ctx.refresh();
    } catch (err) {
      toast('No se pudo restaurar: ' + err.message, 'error');
    } finally {
      fileInput.value = '';
    }
  };
}
