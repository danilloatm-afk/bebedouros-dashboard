const SUPABASE_URL = "https://jvfyqvefznkpcvjaerta.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp2ZnlxdmVmem5rcGN2amFlcnRhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYyMTQ4NjgsImV4cCI6MjEwMTc5MDg2OH0.2Ef6LpZ61WM8myHBYeQGo3TuGqk5C3x36ER_sWRNPS4";
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Registra o service worker (app shell instalavel + funciona offline mesmo
// abrindo do zero sem sinal nenhum). Se falhar (ex: navegador antigo), o
// app continua funcionando normalmente, so sem esse reforço.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch((err) => console.warn("Service worker nao registrado:", err));
  });
}

const STATUS_LABEL = {
  ok: "Em dia",
  atencao: "Atenção",
  atrasado: "Atrasado",
  nunca: "Nunca feito",
};

const TIPO_LABEL = { filtro: "Troca de filtro", limpeza: "Limpeza" };

// ---------- tema claro/escuro ----------
const LS_TEMA = "bd_tema";

function temaEfetivoEscuro(tema) {
  if (tema === "dark") return true;
  if (tema === "light") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function aplicarTema(tema) {
  if (tema === "light" || tema === "dark") {
    document.documentElement.setAttribute("data-theme", tema);
  } else {
    document.documentElement.removeAttribute("data-theme");
  }
  document.getElementById("btn-theme-toggle").textContent = temaEfetivoEscuro(tema) ? "☀️" : "🌙";
}

let temaAtual = localStorage.getItem(LS_TEMA) || "auto";
aplicarTema(temaAtual);

document.getElementById("btn-theme-toggle").addEventListener("click", () => {
  temaAtual = temaEfetivoEscuro(temaAtual) ? "light" : "dark";
  localStorage.setItem(LS_TEMA, temaAtual);
  aplicarTema(temaAtual);
});

// ---------- mosaico de fundo (alho, batata, cenoura, soja, milho) ----------
const IMAGENS_MOSAICO = ["alho.jpg", "batata.jpg", "cenoura.jpg", "soja.jpg", "milho.jpg"];
const TILE_MOSAICO_PX = 90;

function gerarMosaicoFundo() {
  const container = document.getElementById("watermark-logo");
  const cols = Math.ceil(window.innerWidth / TILE_MOSAICO_PX) + 1;
  const rows = Math.ceil(window.innerHeight / TILE_MOSAICO_PX) + 1;
  const total = cols * rows;
  let html = "";
  for (let i = 0; i < total; i++) {
    html += `<img src="img/${IMAGENS_MOSAICO[i % IMAGENS_MOSAICO.length]}" alt="">`;
  }
  container.style.gridTemplateColumns = `repeat(${cols}, ${TILE_MOSAICO_PX}px)`;
  container.innerHTML = html;
}

gerarMosaicoFundo();
let redimensionarTimer;
window.addEventListener("resize", () => {
  clearTimeout(redimensionarTimer);
  redimensionarTimer = setTimeout(gerarMosaicoFundo, 300);
});

let bebedourosCache = [];
let funcionariosCache = [];
let empresasCache = [];
let fotoSelecionadaDataUrl = null;

// ---------- empresa selecionada (isola painel/registrar/historico por empresa) ----------
const LS_EMPRESA_SELECIONADA = "bd_empresa_selecionada";
let empresaSelecionadaId = localStorage.getItem(LS_EMPRESA_SELECIONADA) || "";

async function loadEmpresas() {
  try {
    const { data, error } = await comTimeout(db.from("bd_empresas").select("*").order("ativo", { ascending: false }).order("nome"));
    if (error) throw error;
    empresasCache = data;
    localStorage.setItem("bd_cache_empresas", JSON.stringify(empresasCache));
  } catch {
    empresasCache = JSON.parse(localStorage.getItem("bd_cache_empresas") || "[]");
  }
  const ativas = empresasCache.filter((emp) => emp.ativo);

  // garante que a empresa selecionada ainda existe e esta ativa; senao usa a primeira disponivel
  if (!ativas.some((emp) => String(emp.id) === String(empresaSelecionadaId))) {
    empresaSelecionadaId = ativas[0] ? String(ativas[0].id) : "";
    localStorage.setItem(LS_EMPRESA_SELECIONADA, empresaSelecionadaId);
  }

  const sel = document.getElementById("empresa-select");
  sel.innerHTML = ativas.length
    ? ativas.map((emp) => `<option value="${emp.id}">${escapeHtml(emp.nome)}</option>`).join("")
    : '<option value="">Nenhuma empresa cadastrada</option>';
  sel.value = empresaSelecionadaId;

  const bebEmpresaSel = document.getElementById("beb-empresa");
  bebEmpresaSel.innerHTML = ativas.map((emp) => `<option value="${emp.id}">${escapeHtml(emp.nome)}</option>`).join("");
  if (empresaSelecionadaId) bebEmpresaSel.value = empresaSelecionadaId;

  atualizarLogoUI();
}

// Mostra a logo da empresa selecionada ao lado do seletor. Sem logo
// cadastrada, o icone some. O fundo do app usa um padrao fixo (mosaico),
// nao muda por empresa.
function atualizarLogoUI() {
  const empresa = empresasCache.find((emp) => String(emp.id) === String(empresaSelecionadaId));
  const url = empresa && empresa.logo_path ? urlPublica("bd_logos", empresa.logo_path) : null;

  const icone = document.getElementById("empresa-select-logo");
  if (url) {
    icone.src = url;
    icone.classList.remove("hidden");
  } else {
    icone.classList.add("hidden");
  }
}

document.getElementById("empresa-select").addEventListener("change", (e) => {
  empresaSelecionadaId = e.target.value;
  localStorage.setItem(LS_EMPRESA_SELECIONADA, empresaSelecionadaId);
  atualizarSelectsFiltradosPorEmpresa();
  atualizarLogoUI();
  loadDashboard();
  if (document.getElementById("tab-historico").classList.contains("active")) loadHistorico();
});

// Reduz uma imagem (largura maxima e qualidade) antes de enviar/guardar
// localmente, para nao estourar o limite de armazenamento do navegador
// quando varias fotos ficam na fila offline.
function comprimirImagem(file, maxDimensao = 1024, qualidade = 0.6, formato = "image/jpeg") {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Nao foi possivel ler o arquivo"));
    reader.onload = () => {
      img.onerror = () => reject(new Error("Arquivo nao e uma imagem valida"));
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDimensao || height > maxDimensao) {
          const escala = maxDimensao / Math.max(width, height);
          width = Math.round(width * escala);
          height = Math.round(height * escala);
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL(formato, qualidade));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// Logos usam PNG (preserva fundo transparente) e um tamanho menor, ja que
// sao só um icone, nao uma foto.
function comprimirLogo(file) {
  return comprimirImagem(file, 320, 0.92, "image/png");
}

// ---------- storage (fotos de registros e logos de empresas) ----------
function dataUrlParaBlob(dataUrl) {
  const [header, b64] = dataUrl.split(",");
  const mime = (header.match(/data:([^;]+);base64/) || [, "image/jpeg"])[1];
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

async function enviarImagemStorage(dataUrl, bucket) {
  const blob = dataUrlParaBlob(dataUrl);
  const ext = blob.type === "image/png" ? "png" : blob.type === "image/webp" ? "webp" : "jpg";
  const nome = `${crypto.randomUUID()}.${ext}`;
  const { error } = await db.storage.from(bucket).upload(nome, blob, { contentType: blob.type });
  if (error) throw error;
  return nome;
}

function urlPublica(bucket, path) {
  if (!path) return null;
  return `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${path}`;
}

// Da timeout numa promise do Supabase para detectar "sem conexao" de forma
// rapida (em vez de ficar pendurado esperando o navegador desistir sozinho).
function comTimeout(promise, ms = 6000) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms)),
  ]);
}

// ---------- fila offline (registros pendentes de sincronização) ----------
const LS_FILA = "bd_fila_registros";
const LS_BEB_CACHE = "bd_cache_bebedouros";
const LS_FUNC_CACHE = "bd_cache_funcionarios";

function getFila() {
  try {
    return JSON.parse(localStorage.getItem(LS_FILA) || "[]");
  } catch {
    return [];
  }
}

function setFila(fila) {
  localStorage.setItem(LS_FILA, JSON.stringify(fila));
}

function enfileirarRegistro(payload) {
  const fila = getFila();
  fila.push({
    local_id: "local-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8),
    ...payload,
    criado_localmente_em: new Date().toISOString(),
  });
  setFila(fila);
}

// O supabase-js nao rejeita a promise quando a rede falha — ele sempre
// resolve com {data:null, error:{message:"TypeError: Failed to fetch"...}}.
// Entao a unica forma de saber se foi "sem internet" (deve ir pra fila
// offline) ou "servidor recusou os dados" (erro de verdade) e checando o
// texto da mensagem.
function pareceErroDeRede(mensagem) {
  if (!mensagem) return false;
  const m = String(mensagem).toLowerCase();
  return m.includes("fetch") || m.includes("network") || m.includes("timeout") || m.includes("load failed");
}

// Tenta enviar um registro ao Supabase (incluindo a foto, se houver).
// Retorna {offline:true} se nao conseguiu nem conversar com o servidor
// (sem rede). Lanca erro normalmente se o servidor recusou os dados.
async function tentarEnviarRegistro(payload) {
  try {
    await comTimeout((async () => {
      let fotoPath = null;
      if (payload.foto_base64) {
        fotoPath = await enviarImagemStorage(payload.foto_base64, "bd_fotos");
      }
      const { error } = await db.from("bd_registros").insert({
        bebedouro_id: Number(payload.bebedouro_id),
        funcionario_id: Number(payload.funcionario_id),
        tipo: payload.tipo,
        data: payload.data,
        observacao: payload.observacao,
        foto_path: fotoPath,
      });
      if (error) throw new Error(error.message || "Erro ao salvar registro");
    })());
    return { offline: false };
  } catch (err) {
    if (pareceErroDeRede(err.message)) return { offline: true };
    throw err;
  }
}

let sincronizando = false;
async function sincronizarFila() {
  if (sincronizando) return;
  sincronizando = true;
  try {
    const fila = getFila();
    if (fila.length === 0) return;
    const restantes = [];
    for (let i = 0; i < fila.length; i++) {
      const { local_id, criado_localmente_em, ...payload } = fila[i];
      try {
        const resultado = await tentarEnviarRegistro(payload);
        if (resultado.offline) {
          // servidor ainda inalcançável: mantém este e todos os seguintes na fila
          restantes.push(...fila.slice(i));
          break;
        }
        // enviado com sucesso, não volta pra fila
      } catch (err) {
        // servidor recusou os dados (ex: bebedouro/funcionário desativado) — descarta e avisa
        console.warn("Registro pendente descartado (dados inválidos):", err.message, fila[i]);
      }
    }
    setFila(restantes);
  } finally {
    sincronizando = false;
    atualizarBadgeSync();
  }
}

function atualizarBadgeSync() {
  const fila = getFila();
  const box = document.getElementById("sync-status");
  const count = document.getElementById("sync-count");
  if (fila.length === 0) {
    box.classList.add("hidden");
    return;
  }
  box.classList.remove("hidden");
  count.textContent = `${fila.length} registro${fila.length === 1 ? "" : "s"} aguardando envio ao servidor`;
}

document.getElementById("btn-sync-now").addEventListener("click", async () => {
  await sincronizarFila();
  if (document.getElementById("tab-historico").classList.contains("active")) loadHistorico();
});

window.addEventListener("online", sincronizarFila);
setInterval(() => {
  if (getFila().length > 0) sincronizarFila();
}, 30000);

// ---------- tabs ----------
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-content").forEach((c) => c.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById("tab-" + btn.dataset.tab).classList.add("active");
    if (btn.dataset.tab === "dashboard") loadDashboard();
    if (btn.dataset.tab === "historico") loadHistorico();
  });
});

// ---------- status (calculado no navegador, sem servidor) ----------
function computeStatus(lastDateStr, intervalDays) {
  if (!lastDateStr) return { dias_desde: null, status: "nunca" };
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const ultimo = new Date(lastDateStr + "T00:00:00");
  const dias = Math.round((hoje - ultimo) / 86400000);
  let status;
  if (dias > intervalDays) status = "atrasado";
  else if (dias > intervalDays * 0.8) status = "atencao";
  else status = "ok";
  return { dias_desde: dias, status };
}

// ---------- dashboard ----------
async function loadDashboard() {
  const container = document.getElementById("cards-container");
  if (!empresaSelecionadaId) {
    container.innerHTML = '<div class="empty-state">Nenhuma empresa selecionada. Vá em "Configurações" para cadastrar uma empresa.</div>';
    return;
  }
  container.innerHTML = '<div class="empty-state">Carregando...</div>';
  try {
    const { data: bebedouros, error: e1 } = await comTimeout(
      db.from("bd_bebedouros").select("*").eq("empresa_id", empresaSelecionadaId).eq("ativo", true).order("local").order("nome")
    );
    if (e1) throw new Error(e1.message);
    if (bebedouros.length === 0) {
      container.innerHTML = '<div class="empty-state">Nenhum bebedouro cadastrado para esta empresa ainda. Vá em "Configurações" para adicionar.</div>';
      return;
    }
    const ids = bebedouros.map((b) => b.id);
    const { data: registros, error: e2 } = await comTimeout(
      db.from("bd_registros").select("bebedouro_id,tipo,data").in("bebedouro_id", ids).order("data", { ascending: false })
    );
    if (e2) throw new Error(e2.message);

    const ultimos = {};
    for (const r of registros || []) {
      ultimos[r.bebedouro_id] = ultimos[r.bebedouro_id] || {};
      if (!(r.tipo in ultimos[r.bebedouro_id])) ultimos[r.bebedouro_id][r.tipo] = r.data;
    }

    const cfg = await carregarConfigValores();
    container.innerHTML = "";
    bebedouros.forEach((b) => {
      const filtroInfo = { ultima_data: ultimos[b.id]?.filtro || null, ...computeStatus(ultimos[b.id]?.filtro, cfg.intervalo_filtro_dias) };
      const limpezaInfo = { ultima_data: ultimos[b.id]?.limpeza || null, ...computeStatus(ultimos[b.id]?.limpeza, cfg.intervalo_limpeza_dias) };
      container.appendChild(renderCard(b, filtroInfo, limpezaInfo, cfg));
    });
  } catch (e) {
    container.innerHTML = `<div class="empty-state">Erro ao carregar: ${e.message}</div>`;
  }
}

function renderCard(b, filtroInfo, limpezaInfo, config) {
  const div = document.createElement("div");
  div.className = "card";
  div.innerHTML = `
    <h3>${escapeHtml(b.nome)}</h3>
    <div class="local">${escapeHtml(b.local || "sem local definido")}</div>
    ${renderRow("Filtro", filtroInfo, config.intervalo_filtro_dias)}
    ${renderRow("Limpeza", limpezaInfo, config.intervalo_limpeza_dias)}
  `;
  return div;
}

function renderRow(label, info, intervalo) {
  const badge = `<span class="badge ${info.status}">${STATUS_LABEL[info.status]}</span>`;
  let detail;
  if (info.ultima_data) {
    detail = `Último: ${formatDate(info.ultima_data)} (${info.dias_desde} dia${info.dias_desde === 1 ? "" : "s"} atrás) · intervalo: ${intervalo}d`;
  } else {
    detail = `Nunca registrado · intervalo: ${intervalo}d`;
  }
  return `
    <div class="card-row" style="flex-direction: column; align-items: stretch;">
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <span class="label">${label}</span>
        ${badge}
      </div>
      <div class="info">${detail}</div>
    </div>
  `;
}

function formatDate(iso) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

document.getElementById("btn-refresh-dashboard").addEventListener("click", loadDashboard);

// ---------- cadastros (load selects) ----------
// Guarda uma cópia local das listas para o formulário de Registrar continuar
// funcionando mesmo se a aba estiver aberta sem conseguir falar com o servidor.
// bebedourosCache guarda TODOS os bebedouros (de todas as empresas) — a
// filtragem pela empresa selecionada acontece na hora de montar os selects.
async function loadBebedourosSelects() {
  try {
    const { data, error } = await comTimeout(
      db.from("bd_bebedouros").select("*, bd_empresas(nome)").order("ativo", { ascending: false }).order("local").order("nome")
    );
    if (error) throw error;
    bebedourosCache = data.map((b) => ({ ...b, empresa_nome: b.bd_empresas?.nome || "" }));
    localStorage.setItem(LS_BEB_CACHE, JSON.stringify(bebedourosCache));
  } catch {
    bebedourosCache = JSON.parse(localStorage.getItem(LS_BEB_CACHE) || "[]");
  }
  atualizarSelectsFiltradosPorEmpresa();
}

function atualizarSelectsFiltradosPorEmpresa() {
  const daEmpresa = bebedourosCache.filter((b) => String(b.empresa_id) === String(empresaSelecionadaId));
  const ativos = daEmpresa.filter((b) => b.ativo);

  const regSel = document.getElementById("reg-bebedouro");
  regSel.innerHTML = ativos.length
    ? ativos.map((b) => `<option value="${b.id}">${escapeHtml(b.nome)} — ${escapeHtml(b.local || "")}</option>`).join("")
    : '<option value="">Nenhum bebedouro cadastrado para esta empresa</option>';

  const histSel = document.getElementById("hist-bebedouro");
  histSel.innerHTML = '<option value="">Todos os bebedouros</option>' +
    daEmpresa.map((b) => `<option value="${b.id}">${escapeHtml(b.nome)}</option>`).join("");
}

async function loadFuncionariosSelects() {
  try {
    const { data, error } = await comTimeout(db.from("bd_funcionarios").select("*").order("ativo", { ascending: false }).order("nome"));
    if (error) throw error;
    funcionariosCache = data;
    localStorage.setItem(LS_FUNC_CACHE, JSON.stringify(funcionariosCache));
  } catch {
    funcionariosCache = JSON.parse(localStorage.getItem(LS_FUNC_CACHE) || "[]");
  }
  const ativos = funcionariosCache.filter((f) => f.ativo);
  const regSel = document.getElementById("reg-funcionario");
  regSel.innerHTML = ativos.map((f) => `<option value="${f.id}">${escapeHtml(f.nome)}</option>`).join("");
}

// ---------- registrar ----------
document.getElementById("reg-data").valueAsDate = new Date();

function limparFotoSelecionada() {
  fotoSelecionadaDataUrl = null;
  document.getElementById("reg-foto").value = "";
  document.getElementById("reg-foto-preview-wrap").classList.add("hidden");
}

document.getElementById("reg-foto").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const feedback = document.getElementById("reg-feedback");
  try {
    fotoSelecionadaDataUrl = await comprimirImagem(file);
    document.getElementById("reg-foto-preview").src = fotoSelecionadaDataUrl;
    document.getElementById("reg-foto-preview-wrap").classList.remove("hidden");
  } catch (err) {
    fotoSelecionadaDataUrl = null;
    feedback.textContent = "Não foi possível usar essa foto: " + err.message;
    feedback.className = "feedback error";
  }
});

document.getElementById("btn-remover-foto").addEventListener("click", limparFotoSelecionada);

document.getElementById("form-registro").addEventListener("submit", async (e) => {
  e.preventDefault();
  const feedback = document.getElementById("reg-feedback");
  feedback.textContent = "";
  feedback.className = "feedback";
  const payload = {
    bebedouro_id: document.getElementById("reg-bebedouro").value,
    funcionario_id: document.getElementById("reg-funcionario").value,
    tipo: document.getElementById("reg-tipo").value,
    data: document.getElementById("reg-data").value,
    observacao: document.getElementById("reg-observacao").value,
  };
  if (fotoSelecionadaDataUrl) payload.foto_base64 = fotoSelecionadaDataUrl;
  try {
    const resultado = await tentarEnviarRegistro(payload);
    if (resultado.offline) {
      enfileirarRegistro(payload);
      atualizarBadgeSync();
      feedback.textContent = "Sem conexão com o servidor. Registro salvo neste aparelho e será enviado automaticamente quando a conexão voltar.";
      feedback.className = "feedback offline";
    } else {
      feedback.textContent = "Registro salvo com sucesso!";
      feedback.className = "feedback success";
    }
    document.getElementById("reg-observacao").value = "";
    document.getElementById("reg-data").valueAsDate = new Date();
    limparFotoSelecionada();
  } catch (err) {
    feedback.textContent = "Erro: " + err.message;
    feedback.className = "feedback error";
  }
});

// ---------- historico ----------
function renderFotoCell(src) {
  if (!src) return "";
  return `<img class="foto-thumb" src="${escapeHtml(src)}" alt="Foto do registro">`;
}

function renderLinhasPendentes(bebId, tipo) {
  return getFila()
    .filter((r) => {
      const beb = bebedourosCache.find((b) => String(b.id) === String(r.bebedouro_id));
      if (!beb || String(beb.empresa_id) !== String(empresaSelecionadaId)) return false;
      return (!bebId || String(r.bebedouro_id) === String(bebId)) && (!tipo || r.tipo === tipo);
    })
    .map((r) => {
      const beb = bebedourosCache.find((b) => String(b.id) === String(r.bebedouro_id));
      const func = funcionariosCache.find((f) => String(f.id) === String(r.funcionario_id));
      return `
        <tr class="pendente">
          <td>${formatDate(r.data)}</td>
          <td>${escapeHtml(beb ? beb.nome : "?")}</td>
          <td>${escapeHtml(beb ? beb.local : "")}</td>
          <td>${TIPO_LABEL[r.tipo] || r.tipo}</td>
          <td>${escapeHtml(func ? func.nome : "?")}</td>
          <td class="observacao">${escapeHtml(r.observacao || "")}</td>
          <td>${renderFotoCell(r.foto_base64)}</td>
          <td><span class="tag-pendente">aguardando envio</span></td>
        </tr>
      `;
    })
    .join("");
}

async function loadHistorico() {
  const tbody = document.querySelector("#tbl-historico tbody");
  tbody.innerHTML = '<tr><td colspan="8">Carregando...</td></tr>';
  const bebId = document.getElementById("hist-bebedouro").value;
  const tipo = document.getElementById("hist-tipo").value;
  const linhasPendentes = renderLinhasPendentes(bebId, tipo);
  try {
    let query = db
      .from("bd_registros")
      .select("*, bd_bebedouros!inner(nome,local,empresa_id), bd_funcionarios(nome)")
      .eq("bd_bebedouros.empresa_id", empresaSelecionadaId)
      .order("data", { ascending: false })
      .order("id", { ascending: false })
      .limit(200);
    if (bebId) query = query.eq("bebedouro_id", bebId);
    if (tipo) query = query.eq("tipo", tipo);
    const { data: rows, error } = await comTimeout(query);
    if (error) throw new Error(error.message);
    if (rows.length === 0 && !linhasPendentes) {
      tbody.innerHTML = '<tr><td colspan="8">Nenhum registro encontrado.</td></tr>';
      return;
    }
    tbody.innerHTML = linhasPendentes + rows.map((r) => `
      <tr>
        <td>${formatDate(r.data)}</td>
        <td>${escapeHtml(r.bd_bebedouros?.nome || "")}</td>
        <td>${escapeHtml(r.bd_bebedouros?.local || "")}</td>
        <td>${TIPO_LABEL[r.tipo] || r.tipo}</td>
        <td>${escapeHtml(r.bd_funcionarios?.nome || "")}</td>
        <td class="observacao">${escapeHtml(r.observacao || "")}</td>
        <td>${renderFotoCell(urlPublica("bd_fotos", r.foto_path))}</td>
        <td><button class="link-btn" data-id="${r.id}">excluir</button></td>
      </tr>
    `).join("");
    tbody.querySelectorAll(".link-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm("Excluir este registro?")) return;
        await excluirRegistro(btn.dataset.id);
        loadHistorico();
      });
    });
  } catch (e) {
    tbody.innerHTML = linhasPendentes || `<tr><td colspan="8">Erro: ${e.message}</td></tr>`;
  }
}

async function excluirRegistro(id) {
  const { data: row } = await db.from("bd_registros").select("foto_path").eq("id", id).single();
  await db.from("bd_registros").delete().eq("id", id);
  if (row && row.foto_path) {
    await db.storage.from("bd_fotos").remove([row.foto_path]);
  }
}

document.getElementById("btn-filtrar-historico").addEventListener("click", loadHistorico);

document.querySelector("#tbl-historico tbody").addEventListener("click", (e) => {
  if (e.target.classList.contains("foto-thumb")) {
    const w = window.open();
    if (w) w.document.write(`<img src="${e.target.src}" style="max-width:100%">`);
  }
});

// ---------- cadastros: empresas ----------
document.getElementById("form-empresa").addEventListener("submit", async (e) => {
  e.preventDefault();
  const nome = document.getElementById("emp-nome").value.trim();
  if (!nome) return;
  const { error } = await db.from("bd_empresas").insert({ nome });
  if (error) return alert("Erro ao adicionar empresa: " + error.message);
  document.getElementById("emp-nome").value = "";
  await loadEmpresas();
  await refreshCadastros();
});

async function renderListaEmpresas() {
  const ul = document.getElementById("lista-empresas");
  ul.innerHTML = empresasCache.map((emp) => `
    <li class="${emp.ativo ? "" : "inativo"}">
      <span>
        ${emp.logo_path ? `<img class="empresa-logo-thumb" src="${escapeHtml(urlPublica("bd_logos", emp.logo_path))}" alt="">` : ""}
        ${escapeHtml(emp.nome)}
      </span>
      <span>
        <label class="logo-upload-label">
          ${emp.logo_path ? "trocar logo" : "adicionar logo"}
          <input type="file" accept="image/*" data-id="${emp.id}" class="input-logo-empresa">
        </label>
        <button class="link-btn" data-id="${emp.id}" data-ativo="${emp.ativo ? 1 : 0}">${emp.ativo ? "desativar" : "reativar"}</button>
      </span>
    </li>
  `).join("");
  ul.querySelectorAll(".link-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const novoAtivo = btn.dataset.ativo === "1" ? false : true;
      await db.from("bd_empresas").update({ ativo: novoAtivo }).eq("id", btn.dataset.id);
      await loadEmpresas();
      await refreshCadastros();
      loadDashboard();
    });
  });
  ul.querySelectorAll(".input-logo-empresa").forEach((input) => {
    input.addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const logoDataUrl = await comprimirLogo(file);
        const empresaId = input.dataset.id;
        const existente = empresasCache.find((emp) => String(emp.id) === String(empresaId));
        const logoPath = await enviarImagemStorage(logoDataUrl, "bd_logos");
        const { error } = await db.from("bd_empresas").update({ logo_path: logoPath }).eq("id", empresaId);
        if (error) throw new Error(error.message);
        if (existente && existente.logo_path) {
          await db.storage.from("bd_logos").remove([existente.logo_path]);
        }
        await loadEmpresas();
        await refreshCadastros();
      } catch (err) {
        alert("Nao foi possivel usar essa imagem: " + err.message);
      }
    });
  });
}

// ---------- cadastros: bebedouros ----------
document.getElementById("form-bebedouro").addEventListener("submit", async (e) => {
  e.preventDefault();
  const empresa_id = document.getElementById("beb-empresa").value;
  const nome = document.getElementById("beb-nome").value.trim();
  const local = document.getElementById("beb-local").value.trim();
  if (!nome || !empresa_id) return;
  const { error } = await db.from("bd_bebedouros").insert({ empresa_id: Number(empresa_id), nome, local });
  if (error) return alert("Erro ao adicionar bebedouro: " + error.message);
  document.getElementById("beb-nome").value = "";
  document.getElementById("beb-local").value = "";
  await refreshCadastros();
});

async function renderListaBebedouros() {
  const ul = document.getElementById("lista-bebedouros");
  ul.innerHTML = bebedourosCache.map((b) => `
    <li class="${b.ativo ? "" : "inativo"}">
      <span>${escapeHtml(b.nome)} <span class="muted">${escapeHtml(b.local || "")} · ${escapeHtml(b.empresa_nome || "")}</span></span>
      <button class="link-btn" data-id="${b.id}" data-ativo="${b.ativo ? 1 : 0}">${b.ativo ? "desativar" : "reativar"}</button>
    </li>
  `).join("");
  ul.querySelectorAll(".link-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const novoAtivo = btn.dataset.ativo === "1" ? false : true;
      await db.from("bd_bebedouros").update({ ativo: novoAtivo }).eq("id", btn.dataset.id);
      await refreshCadastros();
    });
  });
}

// ---------- cadastros: funcionarios ----------
document.getElementById("form-funcionario").addEventListener("submit", async (e) => {
  e.preventDefault();
  const nome = document.getElementById("func-nome").value.trim();
  if (!nome) return;
  const { error } = await db.from("bd_funcionarios").insert({ nome });
  if (error) return alert("Erro ao adicionar funcionário: " + error.message);
  document.getElementById("func-nome").value = "";
  await refreshCadastros();
});

async function renderListaFuncionarios() {
  const ul = document.getElementById("lista-funcionarios");
  ul.innerHTML = funcionariosCache.map((f) => `
    <li class="${f.ativo ? "" : "inativo"}">
      <span>${escapeHtml(f.nome)}</span>
      <button class="link-btn" data-id="${f.id}" data-ativo="${f.ativo ? 1 : 0}">${f.ativo ? "desativar" : "reativar"}</button>
    </li>
  `).join("");
  ul.querySelectorAll(".link-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const novoAtivo = btn.dataset.ativo === "1" ? false : true;
      await db.from("bd_funcionarios").update({ ativo: novoAtivo }).eq("id", btn.dataset.id);
      await refreshCadastros();
    });
  });
}

async function refreshCadastros() {
  await Promise.all([loadBebedourosSelects(), loadFuncionariosSelects()]);
  await Promise.all([renderListaBebedouros(), renderListaFuncionarios(), renderListaEmpresas()]);
}

// ---------- config ----------
async function carregarConfigValores() {
  try {
    const { data, error } = await comTimeout(db.from("bd_config").select("chave,valor"));
    if (error) throw error;
    const cfg = {};
    data.forEach((r) => (cfg[r.chave] = r.valor));
    return {
      intervalo_filtro_dias: Number(cfg.intervalo_filtro_dias || 90),
      intervalo_limpeza_dias: Number(cfg.intervalo_limpeza_dias || 7),
    };
  } catch {
    return { intervalo_filtro_dias: 90, intervalo_limpeza_dias: 7 };
  }
}

document.getElementById("form-config").addEventListener("submit", async (e) => {
  e.preventDefault();
  const feedback = document.getElementById("cfg-feedback");
  feedback.textContent = "";
  feedback.className = "feedback";
  try {
    const filtro = document.getElementById("cfg-filtro").value;
    const limpeza = document.getElementById("cfg-limpeza").value;
    const { error: e1 } = await db.from("bd_config").upsert({ chave: "intervalo_filtro_dias", valor: String(filtro) });
    const { error: e2 } = await db.from("bd_config").upsert({ chave: "intervalo_limpeza_dias", valor: String(limpeza) });
    if (e1 || e2) throw new Error((e1 || e2).message);
    feedback.textContent = "Configurações salvas!";
    feedback.className = "feedback success";
  } catch (err) {
    feedback.textContent = "Erro: " + err.message;
    feedback.className = "feedback error";
  }
});

async function loadConfigForm() {
  const cfg = await carregarConfigValores();
  document.getElementById("cfg-filtro").value = cfg.intervalo_filtro_dias;
  document.getElementById("cfg-limpeza").value = cfg.intervalo_limpeza_dias;
}

// ---------- init ----------
(async function init() {
  atualizarBadgeSync();
  await loadEmpresas();
  await refreshCadastros();
  await loadConfigForm();
  await loadDashboard();
  sincronizarFila();
})();
