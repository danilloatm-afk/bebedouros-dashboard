// Service Worker do app shell. So cuida dos arquivos estaticos (HTML/CSS/JS/
// imagens) para o app abrir instantaneamente e funcionar offline mesmo com
// o navegador fechado antes. NAO mexe com as chamadas ao Supabase (dados) —
// essas continuam passando direto pela rede; a fila offline de registros ja
// e tratada dentro do app.js via localStorage.
//
// IMPORTANTE: sempre que qualquer arquivo estatico mudar (index.html,
// style.css, app.js, manifest.json, icones, imagens do mosaico), aumente o
// CACHE_VERSION abaixo. Sem isso o navegador de quem ja instalou o app
// continua servindo os arquivos antigos do cache indefinidamente.
const CACHE_VERSION = "v2";
const CACHE_NAME = `bd-shell-${CACHE_VERSION}`;

const ARQUIVOS_PRECACHE = [
  "./",
  "index.html",
  "style.css",
  "app.js",
  "manifest.json",
  "icon-192.png",
  "icon-512.png",
  "apple-touch-icon.png",
  "img/alho.jpg",
  "img/batata.jpg",
  "img/cenoura.jpg",
  "img/soja.jpg",
  "img/milho.jpg",
  "https://unpkg.com/@supabase/supabase-js@2",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // add() individual em vez de addAll(): se um arquivo falhar, os
      // outros continuam sendo guardados em vez de tudo falhar junto.
      await Promise.all(ARQUIVOS_PRECACHE.map((url) => cache.add(url).catch(() => {})));
      await self.skipWaiting();
    })
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((nomes) => Promise.all(nomes.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

function ehChamadaDeApi(url) {
  return url.hostname.endsWith("supabase.co");
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Chamadas ao Supabase (dados) sempre vao direto pra rede, sem cache.
  if (ehChamadaDeApi(url)) return;

  const ehArquivoEstavel = url.pathname.includes("/img/") || url.pathname.endsWith(".png");

  if (ehArquivoEstavel) {
    // Imagens do mosaico/icones: quase nunca mudam, prioriza cache (mais rapido e funciona offline).
    event.respondWith(
      caches.match(event.request).then((cacheado) => cacheado || fetch(event.request))
    );
    return;
  }

  // HTML/CSS/JS do app: tenta a rede primeiro (pra sempre pegar a versao mais
  // nova quando online), e so cai pro cache se estiver sem conexao.
  event.respondWith(
    fetch(event.request)
      .then((resposta) => {
        const copia = resposta.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copia));
        return resposta;
      })
      .catch(() => caches.match(event.request))
  );
});
