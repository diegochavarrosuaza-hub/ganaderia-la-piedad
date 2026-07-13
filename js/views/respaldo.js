// Vista Respaldo — exportar/importar los datos y ayuda
import { exportarTodo, importarTodo } from '../db.js';
import { download, hoyISO, fmtNum } from '../util.js';
import { toast, confirmar } from '../ui.js';

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

  el.innerHTML = `
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
