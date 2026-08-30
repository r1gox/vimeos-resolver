var __LAST_ORIGIN__ = "";
// src/index.js — MovieZone Worker (Lamovie + Hackstore + PelisPlusHD)
// Compatible con Workers clásico y module workers
addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request, event.env || self || {}));
});

// Module worker export (Wrangler moderno)
export default {
  async fetch(request, env, ctx) {
    return handleRequest(request, env || {});
  }
};

var HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8'
};

var LAMOVIE_API = 'https://lamovie.org/wp-api/v1';
var LAMOVIE_BASE = 'https://lamovie.org';
var HACKSTORE_BASE = 'https://www.hackstore.fo';
var PELISPLUS_BASE = 'https://www.pelisplushd.la';
var ANIMEAV1_BASE = 'https://animeav1.com';
// Metadatos TMDB vía worker público (no cambia el flujo de embeds/fuentes)
var TMDB_META_API = 'https://pelisplushd.tvymas.workers.dev';

var REPRODUCTORES_PERMITIDOS = [
  'vimeos.net', 'player.vimeos',
  'goodstream', 'streamwish', 'filemoon', 'voe.',
  'doodstream', 'dood.', 'ds2play', 'doods.pro', 'dsvplay',
  'streamtape', 'mixdrop', 'upstream',
  'vidmoly', 'mp4upload', 'uqload',
  'vidhide', 'vidguard', 'lulustream', 'filelions',
  'yourupload', 'supervideo', 'krakenfiles', 'ok.ru',
  'videoapp.zip', 'videoapp', 'waaw.', 'hqq.', 'netu.'
];

var REPRODUCTORES_BLOQUEADOS = [
  'lamovie.org', 'lamovie', 'youtube.com', 'youtu.be',
  'youtube-nocookie', 'example.com',
  'sblongvu', 'sbfull', 'fembed', '4shared',
  'oembed', 'wp-json', 'hackstore.fo', 'hackstore'
];

var PALABRAS_BLOQUEADAS_BUSQUEDA = ['estrenos', 'populares', 'genero', 'categoria', 'pagina'];

// ======================================================
// ROUTER
// ======================================================
async function handleRequest(request, env) {
  // API key TMDB opcional (Cloudflare Worker secret / var)
  try {
    if (env && env.TMDB_API_KEY) __TMDB_KEY__ = env.TMDB_API_KEY;
  } catch (eEnv) { /* ok */ }

  var url = new URL(request.url);
  var path = url.pathname.replace(/\/+$/, '') || '/';
  var parts = path.split('/').filter(Boolean);

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders()
    });
  }

  var origin = url.origin;
  try { __LAST_ORIGIN__ = origin; } catch (eO) {}
  var seasonQ = url.searchParams.get('season');
  var episodeQ = url.searchParams.get('episode');
  var playersQ = url.searchParams.get('players') === '1';
  var maxCapsQ = parseInt(url.searchParams.get('maxCaps') || '5', 10);
  var sourceParam = normalizarSourceId(url.searchParams.get('source') || '');

  var commonOpts = {
    epFrom: url.searchParams.get('ep_from') || url.searchParams.get('epFrom') || null,
    epTo: url.searchParams.get('ep_to') || url.searchParams.get('epTo') || null,
    season: seasonQ ? parseInt(seasonQ, 10) : null,
    episode: episodeQ ? parseInt(episodeQ, 10) : null,
    players: playersQ,
    maxCaps: maxCapsQ,
    requestUrl: request.url
  };


  // ---------- PROXY HLS (reproduce m3u8 / segmentos con CORS) ----------
  // Solo /proxy?...  (NO confundir con &proxy=1 del endpoint /resolve)
  if (parts[0] === 'proxy') {
    var proxyTarget = url.searchParams.get('url') || '';
    if (!proxyTarget) {
      return json({ success: false, error: 'Falta url. Uso: /proxy?url={m3u8_o_segmento}' }, 400);
    }
    try {
      proxyTarget = decodeURIComponent(proxyTarget);
    } catch (eDec) {}
    if (!/^https?:\/\//i.test(proxyTarget)) {
      return json({ success: false, error: 'url debe ser http(s)' }, 400);
    }
    try {
      return await handleProxy(request, proxyTarget);
    } catch (errP) {
      return json({ success: false, error: errP.message || 'Error en proxy' }, 502);
    }
  }

  // ---------- RESOLVE embed → m3u8 (vimeos / streamwish) ----------
  // /resolve?url=...  |  /resolve/vimeos?url=...  |  /resolve/streamwish?url=...
  // &proxy=1 añade proxy_url listo para el player
  if (parts[0] === 'resolve' || url.searchParams.has('resolve')) {
    var resolveUrl = url.searchParams.get('url') || url.searchParams.get('resolve') || '';
    var provider = (parts[1] || url.searchParams.get('provider') || '').toLowerCase();
    var wantProxy = url.searchParams.get('proxy') === '1' || url.searchParams.get('proxy') === 'true';
    if (!resolveUrl) {
      return json({
        success: false,
        error: 'Falta url del embed',
        uso: {
          auto: origin + '/resolve?url={embed}&proxy=1',
          vimeos: origin + '/resolve/vimeos?url={embed}&proxy=1',
          streamwish: origin + '/resolve/streamwish?url={embed}&proxy=1'
        }
      }, 400);
    }
    try {
      resolveUrl = decodeURIComponent(resolveUrl);
    } catch (eR) {}
    if (!provider) provider = detectarProviderEmbed(resolveUrl) || 'vimeos';
    try {
      var resolved;
      if (provider === 'streamwish') {
        resolved = await resolveStreamwishEmbed(resolveUrl, wantProxy ? origin : null);
      } else if (provider === 'vimeos') {
        resolved = await resolveVimeosEmbed(resolveUrl, wantProxy ? origin : null);
      } else {
        return json({ success: false, error: 'Provider no soportado: ' + provider + ' (usa vimeos|streamwish)' }, 400);
      }
      // Si pidieron proxy=1 y aún no hay proxy_url
      if (wantProxy && resolved && resolved.url && !resolved.proxy_url) {
        resolved.proxy_url = origin + '/proxy?url=' + encodeURIComponent(resolved.url);
        if (resolved.master) {
          resolved.proxy_master = origin + '/proxy?url=' + encodeURIComponent(resolved.master);
        }
      }
      return json(resolved);
    } catch (errR) {
      return json({ success: false, provider: provider || null, error: errR.message || 'Error resolviendo embed' }, 500);
    }
  }



  // ---------- Streamwish streamurl (JSON rico: hls, status, qualities + proxy) ----------
  // /wish/streamurl?url=https://streamwish.to/e/xxx
  // /streamurl?url=... (alias)
  // /wish/streamurl | /vidhide/streamurl | /voe/streamurl | /goodstream/streamurl | /streamurl?url=
  if (
    (parts[0] === 'wish' && parts[1] === 'streamurl') ||
    (parts[0] === 'vidhide' && parts[1] === 'streamurl') ||
    (parts[0] === 'voe' && parts[1] === 'streamurl') ||
    (parts[0] === 'goodstream' && parts[1] === 'streamurl') ||
    parts[0] === 'streamurl'
  ) {
    var swUrl = url.searchParams.get('url') || '';
    if (!swUrl) {
      return json({
        success: false,
        error: 'Falta url del embed',
        uso: {
          streamwish: origin + '/wish/streamurl?url=https://streamwish.to/e/XXXX',
          vidhide: origin + '/vidhide/streamurl?url=https://vidhidepro.com/v/XXXX',
          voe: origin + '/voe/streamurl?url=https://voe.sx/e/XXXX',
          goodstream: origin + '/goodstream/streamurl?url=https://goodstream.one/embed-XXXX.html',
          auto: origin + '/streamurl?url={embed}'
        }
      }, 400);
    }
    try { swUrl = decodeURIComponent(swUrl); } catch (eSw) {}
    var forceProv = '';
    if (parts[0] === 'wish') forceProv = 'streamwish';
    else if (parts[0] === 'vidhide') forceProv = 'vidhide';
    else if (parts[0] === 'voe') forceProv = 'voe';
    else if (parts[0] === 'goodstream') forceProv = 'goodstream';
    try {
      var rich = await buildProviderRichResponse(swUrl, origin, forceProv);
      return json(rich);
    } catch (errSw) {
      return json({ success: false, error: errSw.message || 'Error streamurl' }, 500);
    }
  }

  // ---------- Health ----------
  if (path === '/' && !url.searchParams.has('url') && !url.searchParams.has('q') && !url.searchParams.has('episodePostId')) {
    return json({
      status: 'ok',
      service: 'MovieZone Worker',
      sources: {
        '1': 'lamovie',
        '2': 'hackstore',
        '3': 'pelisplushd',
        '4': 'animeav1'
      },
      endpoints: {
        search: origin + '/search?q={texto}',
        serie: origin + '/{id}/serie/{slug}',
        serie_episodio: origin + '/{id}/serie/{slug}/{temporada}/{episodio}',
        pelicula: origin + '/{id}/pelicula/{slug}',
        anime: origin + '/{id}/anime/{slug}',
        estrenos_peliculas: origin + '/3/peliculas/estrenos',
        estrenos_series: origin + '/3/series/estrenos',
        estrenos_animes: origin + '/3/animes/estrenos',
        populares_peliculas: origin + '/3/peliculas/populares',
        por_url: origin + '/?url={url_completa}',
        resolve_vimeos: origin + '/resolve/vimeos?url={embed}&proxy=1',
        resolve_streamwish: origin + '/resolve/streamwish?url={embed}&proxy=1',
        resolve_auto: origin + '/resolve?url={embed}&proxy=1',
        proxy_hls: origin + '/proxy?url={m3u8}',
        streamwish_streamurl: origin + '/wish/streamurl?url={embed_streamwish}'
      },
      ejemplos: {
        buscar: origin + '/search?q=acaramelados',
        lamovie_serie: origin + '/1/serie/acaramelados-2026',
        lamovie_cap: origin + '/1/serie/acaramelados-2026/1/1',
        hackstore_serie: origin + '/2/serie/asi-aprenderas-2026',
        hackstore_cap: origin + '/2/serie/asi-aprenderas-2026/1/1',
        pelisplus_serie: origin + '/3/serie/acaramelados',
        pelisplus_cap: origin + '/3/serie/acaramelados/1/1',
        estrenos: origin + '/3/peliculas/estrenos'
      },
      nota: 'IDs de fuente: 1=lamovie, 2=hackstore, 3=pelisplushd, 4=animeav1. Van en la ruta: /{id}/anime/{slug}',
      meta: 'Búsqueda y detalle se enriquecen con TMDB (géneros, sinopsis, rating, poster, backdrop, temporadas)'
    });
  }

  // ---------- /search?q= ----------
  if (parts[0] === 'search' || url.searchParams.has('q')) {
    var query = url.searchParams.get('q') || parts[1] || '';
    if (!query) return json({ error: 'Falta q. Usa /search?q=texto' }, 400);
    try {
      var sourceFilter = sourceParam || 'all';
      var limit = parseInt(url.searchParams.get('limit') || '15', 10);
      var resultados = await buscarUniversal(query, sourceFilter, limit);
      if (resultados.resultados) {
        for (var ri = 0; ri < resultados.resultados.length; ri++) {
          var r = resultados.resultados[ri];
          var tipoPath = (r.tipo === 'Serie' || r.tipo === 'Anime')
            ? (r.tipo === 'Anime' ? 'anime' : 'serie')
            : 'pelicula';
          var sid = sourceIdFromName(r.fuente);
          r.titulo = limpiarTitulo(r.titulo || '');
          if (r.slug) {
            r.url_extract = origin + '/' + sid + '/' + tipoPath + '/' + r.slug;
            r.source_id = sid;
          }
          delete r.link;
          delete r.url;
        }
        // Enriquecer con TMDB (géneros, sinopsis, rating, poster, backdrop…) sin tocar fuentes
        try {
          resultados.resultados = await enriquecerListaConTmdb(resultados.resultados, query);
          // Quitar aliases duplicados en cada resultado
          for (var cj = 0; cj < resultados.resultados.length; cj++) {
            var itc = resultados.resultados[cj];
            delete itc.tmdb_overview;
            delete itc.overview_tmdb;
            delete itc.description;
            delete itc.tmdb_genres;
            delete itc.genres_tmdb;
            delete itc.genres;
            delete itc.tmdb_poster;
            delete itc.poster_tmdb;
            delete itc.tmdb_rating;
            delete itc.rating;
            delete itc.tmdb_release_date;
            delete itc.release_date;
            delete itc.tmdb_title;
            delete itc.original_title;
            delete itc.image;
          }
        } catch (eEnrich) { /* silencioso */ }
      }
      return json(resultados);
    } catch (err) {
      return json({ success: false, error: err.message }, 500);
    }
  }

  // ---------- episodePostId (compat) ----------
  var episodePostId = url.searchParams.get('episodePostId');
  if (episodePostId) {
    try {
      var pd = await getPlayerLamovie(episodePostId);
      return json({
        success: true,
        fuente: 'lamovie',
        source_id: '1',
        tipo: 'Capitulo',
        postId: Number(episodePostId) || episodePostId,
        titulo: null,
        total: pd.embeds.length,
        embeds: pd.embeds.map(function (e) { return e.url; }),
        reproductores: pd.embeds,
        descargas: pd.downloads
      });
    } catch (err) {
      return json({ success: false, error: err.message }, 500);
    }
  }

  // ---------- Catálogos PelisPlus: /3/peliculas/estrenos, /3/series/estrenos, etc. ----------
  // parts: [3, peliculas, estrenos] o [pelisplushd, peliculas, estrenos]
  var catSource = normalizarSourceId(parts[0] || '');
  var catTipoIdx = catSource ? 1 : 0;
  var catSeccion = (parts[catTipoIdx] || '').toLowerCase(); // peliculas|series|animes
  var catFiltro = (parts[catTipoIdx + 1] || '').toLowerCase(); // estrenos|populares|''

  if ((catSeccion === 'peliculas' || catSeccion === 'series' || catSeccion === 'animes') &&
      (catFiltro === 'estrenos' || catFiltro === 'populares' || catFiltro === '' || catFiltro === 'page')) {
    var pageNum = parseInt(url.searchParams.get('page') || '1', 10);
    if (catFiltro === 'page' && parts[catTipoIdx + 2]) {
      pageNum = parseInt(parts[catTipoIdx + 2], 10) || 1;
      catFiltro = '';
    }
    // Solo PelisPlus tiene estas listas públicas; id 3 o sin id con source=3
    var srcCat = catSource || sourceParam || 'pelisplushd';
    if (srcCat !== 'pelisplushd' && srcCat !== '3') {
      // permitir /3/... forzado
      if (String(parts[0]) !== '3' && parts[0] !== 'pelisplushd' && parts[0] !== 'pp') {
        return json({
          success: false,
          error: 'Los catalogos estrenos/populares solo estan disponibles para PelisPlus (id 3)',
          ejemplo: origin + '/3/peliculas/estrenos'
        }, 400);
      }
      srcCat = 'pelisplushd';
    }
    try {
      var catalogo = await listarPelisplusCatalogo(catSeccion, catFiltro || null, pageNum, origin);
      if (catalogo && catalogo.resultados && catalogo.resultados.length) {
        try {
          // Cada título se enriquece por su nombre (no solo el primero)
          catalogo.resultados = await enriquecerListaConTmdb(catalogo.resultados, '');
        } catch (eCat) { /* ok */ }
      }
      return json(catalogo);
    } catch (err) {
      return json({ success: false, error: err.message }, 500);
    }
  }

  // ---------- Rutas con ID: /{id}/serie|pelicula|anime/{slug}[/{s}/{e}] ----------
  // parts[0] puede ser 1|2|3|lamovie|hackstore|pelisplushd
  var pathSource = normalizarSourceId(parts[0] || '');
  var tipoIdx = pathSource ? 1 : 0;
  var tipoRuta = parts[tipoIdx];

  if (tipoRuta === 'pelicula' || tipoRuta === 'serie' || tipoRuta === 'anime') {
    var slug = parts[tipoIdx + 1];
    if (!slug) {
      return json({ error: 'Falta el slug. Ej: /2/serie/nombre-titulo' }, 400);
    }
    // /2/serie/slug/1/2
    if (parts[tipoIdx + 2] && parts[tipoIdx + 3]) {
      commonOpts.season = parseInt(parts[tipoIdx + 2], 10);
      commonOpts.episode = parseInt(parts[tipoIdx + 3], 10);
    }

    var forcedSource = pathSource || sourceParam || '';

    try {
      var resultadoPath = await scrapearPorSlug(tipoRuta, slug, forcedSource, commonOpts, origin);
      // Enriquecer detalle con TMDB (descripción, géneros, backdrop, temporadas meta…)
      try {
        resultadoPath = await enriquecerDetalleConTmdb(resultadoPath, tipoRuta);
      } catch (eDet) { /* silencioso */ }
      return json(resultadoPath);
    } catch (err) {
      return json({
        success: false,
        error: err.message || 'No se encontro el titulo',
        slug: slug,
        tipo: tipoRuta,
        source_id: forcedSource || null
      }, 404);
    }
  }

  // ---------- ?url= (compat completo) ----------
  var targetUrl = url.searchParams.get('url');
  if (!targetUrl) {
    return json({
      error: 'Usa rutas con id de fuente',
      ejemplos: {
        serie: origin + '/1/serie/acaramelados-2026',
        capitulo: origin + '/1/serie/acaramelados-2026/1/1',
        hackstore: origin + '/2/serie/asi-aprenderas-2026/1/1',
        search: origin + '/search?q=matrix'
      },
      sources: { '1': 'lamovie', '2': 'hackstore', '3': 'pelisplushd', '4': 'animeav1' }
    }, 400);
  }

  targetUrl = normalizarUrlEntrada(targetUrl);
  var source = sourceParam || detectarFuente(targetUrl);

  try {
    var resultado;
    if (source === 'pelisplushd') {
      resultado = await scrapearPelisplus(targetUrl, commonOpts);
    } else if (source === 'hackstore') {
      resultado = await scrapearHackstore(targetUrl, commonOpts);
    } else if (source === 'animeav1') {
      resultado = await scrapearAnimeAv1(targetUrl, commonOpts);
    } else {
      resultado = await scrapearLamovie(targetUrl, commonOpts);
    }
    resultado = reescribirLinksCortos(resultado, origin, null, null, source);
    try {
      resultado = await enriquecerDetalleConTmdb(resultado, resultado.tipo || '');
    } catch (eUrl) { /* ok */ }
    return json(resultado);
  } catch (err) {
    return json({
      success: false,
      error: err.message || 'Error al scrapear',
      fuente: source
    }, 500);
  }
}

/** 1=lamovie, 2=hackstore, 3=pelisplushd (también acepta nombres) */
function normalizarSourceId(s) {
  s = String(s || '').toLowerCase().trim();
  if (s === '1' || s === 'lamovie' || s === 'lm') return 'lamovie';
  if (s === '2' || s === 'hackstore' || s === 'hs') return 'hackstore';
  if (s === '3' || s === 'pelisplushd' || s === 'pelisplus' || s === 'pp') return 'pelisplushd';
  if (s === '4' || s === 'animeav1' || s === 'av1' || s === 'aa1') return 'animeav1';
  return '';
}

function sourceIdFromName(name) {
  name = String(name || '').toLowerCase();
  if (name === 'hackstore') return '2';
  if (name === 'pelisplushd') return '3';
  if (name === 'animeav1') return '4';
  return '1'; // lamovie default
}

function sourceNameFromId(id) {
  id = String(id || '').toLowerCase();
  if (id === '2' || id === 'hackstore' || id === 'hs') return 'hackstore';
  if (id === '3' || id === 'pelisplushd' || id === 'pp') return 'pelisplushd';
  if (id === '4' || id === 'animeav1' || id === 'av1') return 'animeav1';
  if (id === '1' || id === 'lamovie' || id === 'lm') return 'lamovie';
  return id || '';
}

/** Construye URLs candidatas por fuente y scrapea la primera que funcione */
async function scrapearPorSlug(tipoRuta, slug, sourceParam, opts, origin) {
  opts = opts || {};
  slug = decodeURIComponent(slug).replace(/\/$/, '');
  sourceParam = normalizarSourceId(sourceParam) || sourceParam;

  var candidatos = [];

  function add(src, fullUrl) {
    if (sourceParam && sourceParam !== 'all' && sourceParam !== src) return;
    candidatos.push({ fuente: src, url: fullUrl });
  }

  if (tipoRuta === 'pelicula') {
    add('lamovie', LAMOVIE_BASE + '/peliculas/' + slug + '/');
    add('pelisplushd', PELISPLUS_BASE + '/pelicula/' + slug + '/');
    add('hackstore', HACKSTORE_BASE + '/peliculas/' + slug + '/');
  } else if (tipoRuta === 'anime') {
    add('lamovie', LAMOVIE_BASE + '/animes/' + slug + '/');
    add('pelisplushd', PELISPLUS_BASE + '/anime/' + slug + '/');
    add('animeav1', ANIMEAV1_BASE + '/media/' + slug);
    add('hackstore', HACKSTORE_BASE + '/animes/' + slug + '/');
  } else {
    add('lamovie', LAMOVIE_BASE + '/series/' + slug + '/');
    add('pelisplushd', PELISPLUS_BASE + '/serie/' + slug + '/');
    add('hackstore', HACKSTORE_BASE + '/series/' + slug + '/');
  }

  var lastErr = null;
  for (var i = 0; i < candidatos.length; i++) {
    var c = candidatos[i];
    try {
      var r;
      if (c.fuente === 'pelisplushd') r = await scrapearPelisplus(c.url, opts);
      else if (c.fuente === 'animeav1') r = await scrapearAnimeAv1(c.url, opts);
      else if (c.fuente === 'hackstore') r = await scrapearHackstore(c.url, opts);
      else r = await scrapearLamovie(c.url, opts);

      if (r && r.success !== false) {
        // Si es capítulo vacío y hay más fuentes, seguir intentando
        if (r.tipo === 'Capitulo' && (!r.reproductores || r.reproductores.length === 0) && candidatos.length > 1) {
          lastErr = new Error('Sin players en ' + c.fuente);
          continue;
        }
        r.source_id = sourceIdFromName(c.fuente);
        r = reescribirLinksCortos(r, origin, slug, tipoRuta, c.fuente);
        return r;
      }
    } catch (e) {
      lastErr = e;
    }
  }

  // Fallback búsqueda
  var q = slug.replace(/-\d{4}$/, '').replace(/-/g, ' ');
  var busqueda = await buscarUniversal(q, sourceParam || 'all', 10);
  var hits = (busqueda && busqueda.resultados) || [];
  for (var h = 0; h < hits.length; h++) {
    var hit = hits[h];
    if (sourceParam && sourceParam !== 'all' && hit.fuente !== sourceParam) continue;
    var tipoOk =
      (tipoRuta === 'pelicula' && hit.tipo === 'Pelicula') ||
      (tipoRuta === 'serie' && hit.tipo === 'Serie') ||
      (tipoRuta === 'anime' && hit.tipo === 'Anime') ||
      (hit.slug === slug);
    if (!tipoOk || !hit.link) continue;
    try {
      var opts2 = Object.assign({}, opts);
      var r2;
      if (hit.fuente === 'pelisplushd') r2 = await scrapearPelisplus(hit.link, opts2);
      else if (hit.fuente === 'hackstore') r2 = await scrapearHackstore(hit.link, opts2);
      else if (hit.fuente === 'animeav1') r2 = await scrapearAnimeAv1(hit.link, opts2);
      else r2 = await scrapearLamovie(hit.link, opts2);
      if (r2 && r2.success !== false) {
        if (r2.tipo === 'Capitulo' && (!r2.reproductores || r2.reproductores.length === 0)) continue;
        r2.source_id = sourceIdFromName(hit.fuente);
        r2 = reescribirLinksCortos(r2, origin, hit.slug || slug, tipoRuta, hit.fuente);
        return r2;
      }
    } catch (e2) {
      lastErr = e2;
    }
  }

  throw lastErr || new Error('No se encontro "' + slug + '" en ninguna fuente');
}

/** Links de episodios con ID de fuente: /{id}/serie/slug/T/E */
function reescribirLinksCortos(resultado, origin, slugHint, tipoHint, fuenteHint) {
  if (!resultado || !origin) return resultado;

  var slug = slugHint || '';
  if (!slug && resultado.link) {
    var m = String(resultado.link).match(/\/(?:series|serie|animes|anime|peliculas|pelicula)\/([^\/\?]+)/i);
    if (m) slug = m[1];
  }

  var tipoPath = tipoHint || 'serie';
  if (resultado.tipo === 'Anime' || /\/animes?\//i.test(resultado.link || '')) tipoPath = 'anime';
  if (resultado.tipo === 'Pelicula') tipoPath = 'pelicula';

  var fuente = fuenteHint || resultado.fuente || 'lamovie';
  var sid = sourceIdFromName(fuente);
  resultado.source_id = sid;

  if (resultado.temporadas && Array.isArray(resultado.temporadas)) {
    for (var t = 0; t < resultado.temporadas.length; t++) {
      var eps = resultado.temporadas[t].episodios || [];
      for (var e = 0; e < eps.length; e++) {
        var ep = eps[e];
        var s = ep.temporada || resultado.temporadas[t].temporada || 1;
        var n = ep.episodio || (e + 1);
        if (slug) {
          var uv = origin + '/' + sid + '/' + tipoPath + '/' + slug + '/' + s + '/' + n;
          ep.url_video = uv;
          ep.link = uv;
          ep.source_id = sid;
          delete ep.url;
          delete ep.source_link;
        }
      }
    }
  }

  if (resultado.tipo === 'Capitulo' && slug && resultado.temporada && resultado.episodio) {
    resultado.url_video = origin + '/' + sid + '/' + tipoPath + '/' + slug + '/' + resultado.temporada + '/' + resultado.episodio;
    delete resultado.url;
  }

  if (resultado.titulo) resultado.titulo = limpiarTitulo(resultado.titulo);

  return resultado;
}

function normalizarUrlEntrada(u) {
  u = String(u || '').trim();
  if (/^https?:\/\/\/+(series|animes|peliculas)\//i.test(u)) {
    u = u.replace(/^https?:\/\/\/+/i, LAMOVIE_BASE + '/');
  }
  if (/^\/(series|animes|peliculas)\//i.test(u)) {
    u = LAMOVIE_BASE + u;
  }
  return u;
}

function detectarFuente(u) {
  u = (u || '').toLowerCase();
  if (u.indexOf('animeav1') !== -1) return 'animeav1';
  if (u.indexOf('pelisplushd') !== -1) return 'pelisplushd';
  if (u.indexOf('hackstore') !== -1) return 'hackstore';
  if (u.indexOf('lamovie') !== -1) return 'lamovie';
  if (/\/(pelicula|serie|anime)\//i.test(u)) return 'pelisplushd';
  if (/\/media\//i.test(u)) return 'animeav1';
  return 'lamovie';
}


// ======================================================
// RESOLVERS HLS (Vimeos + Streamwish) + PROXY
// No modifican el flujo de catálogo / scrape existente
// ======================================================

var STREAMWISH_MIRRORS = [
  'streamwish.to', 'flaswish.com', 'strwish.com', 'streamwish.top',
  'ahvsh.com', 'streamwish.site', 'streamhg.com'
];

function toBaseN(n, base) {
  if (n === 0) return '0';
  var digits = '0123456789abcdefghijklmnopqrstuvwxyz';
  var s = '';
  while (n > 0) {
    s = digits[n % base] + s;
    n = Math.floor(n / base);
  }
  return s || '0';
}

/** Desofusca packer tipo Dean Edwards eval(function(p,a,c,k,e,d)...) */
function unpackPacker(html) {
  var start = html.indexOf('eval(function(p,a,c,k,e,d)');
  if (start < 0) throw new Error('Packer no encontrado');
  var end = html.indexOf('</script>', start);
  var packer = end > start ? html.slice(start, end) : html.slice(start);
  var idx = packer.lastIndexOf('}(');
  if (idx < 0) throw new Error('No se encontraron argumentos del Packer');
  var args = packer.slice(idx + 2);

  // Variantes de comillas
  var m = args.match(/^'(.*)',\s*(\d+)\s*,\s*(\d+)\s*,\s*'(.*)'\.split\('\|'\)/s);
  if (!m) m = args.match(/^"(.*)",\s*(\d+)\s*,\s*(\d+)\s*,\s*"(.*)"\.split\("\|"\)/s);
  if (!m) m = args.match(/^'(.*)',\s*(\d+)\s*,\s*(\d+)\s*,\s*'(.*)'\.split\("\|"\)/s);
  if (!m) {
    // fallback más flexible (vimeos)
    m = args.match(/(['"])([\s\S]*?)\1\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(['"])([\s\S]*?)\5\.split\(['"]\|['"]\)/);
    if (m) {
      return unpackWithWords(m[2], parseInt(m[3], 10), m[6].split('|'));
    }
    throw new Error('No se encontró la estructura interna del Packer');
  }
  var code = m[1];
  var radix = parseInt(m[2], 10);
  var count = parseInt(m[3], 10);
  var words = m[4].split('|');
  var p = code;
  for (var i = count - 1; i >= 0; i--) {
    if (i < words.length && words[i]) {
      var token = toBaseN(i, radix);
      p = p.replace(new RegExp('\\b' + token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'g'), words[i]);
    }
  }
  return p;
}

function unpackWithWords(code, radix, words) {
  // decode estilo base36 tokens → words[n]
  return code.replace(/\b[0-9a-z]+\b/g, function (token) {
    try {
      var n = parseInt(token, radix || 36);
      if (!isNaN(n) && n < words.length && words[n]) return words[n];
    } catch (e) {}
    return token;
  });
}

function findStreamUrlsInDecoded(decoded) {
  var urls = [];
  var re1 = /"(hls\d+|file|src)"\s*:\s*"(https?:\/\/[^"]+)"/gi;
  var mm;
  while ((mm = re1.exec(decoded))) urls.push(mm[2]);
  var re2 = /file\s*:\s*["'](https?:\/\/[^"']+)["']/gi;
  while ((mm = re2.exec(decoded))) urls.push(mm[1]);
  var re3 = /https?:\/\/[^"'\\s<>\\]+(?:\\.m3u8|master\\.txt)(?:\\?[^"'\\s<>\\]*)?/gi;
  // fix regex - in JS string
  re3 = /https?:\/\/[^"'\s<>\\]+(?:\.m3u8|master\.txt)(?:\?[^"'\s<>\\]*)?/gi;
  while ((mm = re3.exec(decoded))) urls.push(mm[0]);
  var out = [];
  for (var i = 0; i < urls.length; i++) {
    var u = String(urls[i]).replace(/\\\//g, '/').trim().replace(/\\+$/g, '');
    if (u.indexOf('http') === 0 && out.indexOf(u) === -1) out.push(u);
  }
  return out;
}

function pickMasterUrl(urls) {
  for (var i = 0; i < urls.length; i++) {
    if (urls[i].indexOf('master.m3u8') !== -1 || urls[i].indexOf('.m3u8') !== -1) return urls[i];
  }
  for (var j = 0; j < urls.length; j++) {
    if (urls[j].indexOf('master.txt') !== -1 || /\.txt(\?|$)/.test(urls[j])) return urls[j];
  }
  return urls[0];
}

function parseHlsVariants(playlist, masterUrl) {
  var lines = playlist.split(/\r?\n/);
  var variants = [];
  for (var i = 0; i < lines.length; i++) {
    if (lines[i].indexOf('#EXT-X-STREAM-INF:') === -1) continue;
    if (i + 1 >= lines.length) continue;
    var stream = lines[i + 1].trim();
    if (!stream || stream.charAt(0) === '#') continue;
    if (stream.indexOf('http') !== 0) {
      try { stream = new URL(stream, masterUrl).toString(); } catch (e) { continue; }
    }
    var resolution = lines[i].match(/RESOLUTION=(\d+)x(\d+)/);
    var bandwidth = lines[i].match(/BANDWIDTH=(\d+)/);
    variants.push({
      width: resolution ? parseInt(resolution[1], 10) : 0,
      height: resolution ? parseInt(resolution[2], 10) : 0,
      bandwidth: bandwidth ? parseInt(bandwidth[1], 10) : 0,
      url: stream
    });
  }
  return variants;
}

function selectVariant(variants, preferHeight) {
  preferHeight = preferHeight || 720;
  if (!variants || !variants.length) return null;
  var sel = null;
  for (var i = 0; i < variants.length; i++) {
    if (variants[i].height === preferHeight) { sel = variants[i]; break; }
  }
  if (!sel) {
    sel = variants.slice().sort(function (a, b) {
      return (b.height - a.height) || (b.bandwidth - a.bandwidth);
    })[0];
  }
  return sel;
}

async function fetchText(url, headers) {
  var res = await fetch(url, { headers: headers || HEADERS, redirect: 'follow' });
  if (!res.ok) throw new Error('HTTP ' + res.status + ' en ' + url);
  return await res.text();
}

/** Resolver embed Vimeos → m3u8 (misma lógica que tu script Python) */
async function resolveVimeosEmbed(embedUrl, origin) {
  var headers = {
    'User-Agent': HEADERS['User-Agent'],
    'Referer': 'https://vimeos.net/',
    'Accept': HEADERS['Accept']
  };
  var html = await fetchText(embedUrl, headers);
  var decoded = unpackPacker(html);
  var urls = findStreamUrlsInDecoded(decoded);
  if (!urls.length) {
    // fallback: buscar m3u8 en decoded crudo
    var m3 = decoded.match(/https?:\/\/[^"'\s<>]+\.m3u8(?:\?[^"'\s<>]*)?/gi) || [];
    urls = m3.filter(function (u, i, a) { return a.indexOf(u) === i; });
  }
  if (!urls.length) throw new Error('No se encontró ninguna fuente HLS (vimeos)');
  var master = pickMasterUrl(urls);
  var playlist = '';
  var variants = [];
  try {
    playlist = await fetchText(master, headers);
    if (playlist.indexOf('#EXTM3U') !== -1) variants = parseHlsVariants(playlist, master);
  } catch (e) { /* master puede ser ya la variante */ }

  var selected = selectVariant(variants, 720);
  var finalUrl = selected ? selected.url : master;
  var quality = selected && selected.height ? selected.height + 'p' : null;
  var resolution = selected && selected.height ? (selected.width + 'x' + selected.height) : null;

  var out = {
    success: true,
    provider: 'vimeos',
    source: embedUrl,
    type: 'hls',
    quality: quality,
    resolution: resolution,
    url: finalUrl,
    master: master,
    all_sources: urls,
    variants: variants
  };
  if (origin) {
    out.proxy_url = origin + '/proxy?url=' + encodeURIComponent(finalUrl);
    out.proxy_master = origin + '/proxy?url=' + encodeURIComponent(master);
  }
  return out;
}

function extractStreamwishId(url) {
  var m = String(url).match(/\/(?:e|f)\/([a-zA-Z0-9]+)/);
  if (m) return m[1];
  return String(url).replace(/\/$/, '').split('/').pop().split('?')[0];
}

function streamwishCandidateUrls(original) {
  var vid = extractStreamwishId(original);
  var out = [original];
  for (var i = 0; i < STREAMWISH_MIRRORS.length; i++) {
    var h = STREAMWISH_MIRRORS[i];
    var a = 'https://' + h + '/e/' + vid;
    var b = 'https://' + h + '/' + vid;
    if (out.indexOf(a) === -1) out.push(a);
    if (out.indexOf(b) === -1) out.push(b);
  }
  return out;
}

async function fetchStreamwishHtml(url) {
  var candidates = streamwishCandidateUrls(url);
  var lastErr = null;
  for (var i = 0; i < candidates.length; i++) {
    var u = candidates[i];
    var host = 'streamwish.to';
    try { host = new URL(u).hostname || host; } catch (e) {}
    var headers = {
      'User-Agent': HEADERS['User-Agent'],
      'Accept': HEADERS['Accept'],
      'Accept-Language': 'en-US,en;q=0.9,es;q=0.8',
      'Referer': 'https://' + host + '/',
      'Origin': 'https://' + host
    };
    try {
      var res = await fetch(u, { headers: headers, redirect: 'follow' });
      var text = await res.text();
      if (res.ok && text.length > 800 && text.indexOf('eval(function(p,a,c,k,e,d)') !== -1) {
        return { html: text, used: u, host: host };
      }
      lastErr = 'HTTP ' + res.status + ' en ' + u + ' (len=' + text.length + ')';
    } catch (e) {
      lastErr = u + ': ' + (e.message || e);
    }
  }
  throw new Error(lastErr || 'No se pudo descargar el embed Streamwish');
}

/** Resolver embed Streamwish / mirrors → m3u8 */
async function resolveStreamwishEmbed(embedUrl, origin) {
  var got = await fetchStreamwishHtml(embedUrl);
  var decoded = unpackPacker(got.html);
  var urls = findStreamUrlsInDecoded(decoded);
  if (!urls.length) throw new Error('No se encontró ninguna fuente HLS en el packer (streamwish)');
  var master = pickMasterUrl(urls);
  var headers = {
    'User-Agent': HEADERS['User-Agent'],
    'Referer': 'https://' + got.host + '/',
    'Origin': 'https://' + got.host,
    'Accept': '*/*'
  };
  var variants = [];
  var finalUrl = master;
  var quality = null;
  var resolution = null;
  try {
    var playlist = await fetchText(master, headers);
    if (playlist.indexOf('#EXTM3U') !== -1) {
      variants = parseHlsVariants(playlist, master);
      var selected = selectVariant(variants, 720);
      if (selected) {
        finalUrl = selected.url;
        quality = selected.height ? selected.height + 'p' : null;
        resolution = selected.height ? (selected.width + 'x' + selected.height) : null;
      }
    }
  } catch (e) { /* ok */ }

  var out = {
    success: true,
    provider: 'streamwish',
    source: embedUrl,
    resolved_embed: got.used,
    type: 'hls',
    quality: quality,
    resolution: resolution,
    url: finalUrl,
    master: master,
    all_sources: urls,
    variants: variants
  };
  if (origin) {
    out.proxy_url = origin + '/proxy?url=' + encodeURIComponent(finalUrl);
    out.proxy_master = origin + '/proxy?url=' + encodeURIComponent(master);
  }
  return out;
}

function detectarProviderEmbed(u) {
  u = String(u || '').toLowerCase();
  if (u.indexOf('vimeos') !== -1) return 'vimeos';
  if (u.indexOf('streamwish') !== -1 || u.indexOf('flaswish') !== -1 ||
      u.indexOf('strwish') !== -1 || u.indexOf('ahvsh') !== -1 ||
      u.indexOf('streamhg') !== -1) return 'streamwish';
  return '';
}

/** Reescribe playlist m3u8 para que segmentos pasen por /proxy */
function rewriteM3u8(body, baseUrl, proxyBase) {
  var lines = body.split(/\r?\n/);
  var out = [];
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    var trim = line.trim();
    if (!trim || trim.charAt(0) === '#') {
      // URI="..." en tags
      out.push(line.replace(/URI="([^"]+)"/g, function (_, uri) {
        try {
          var abs = new URL(uri, baseUrl).toString();
          return 'URI="' + proxyBase + encodeURIComponent(abs) + '"';
        } catch (e) {
          return 'URI="' + uri + '"';
        }
      }));
      continue;
    }
    try {
      var abs2 = new URL(trim, baseUrl).toString();
      out.push(proxyBase + encodeURIComponent(abs2));
    } catch (e2) {
      out.push(line);
    }
  }
  return out.join('\n');
}

async function handleProxy(request, targetUrl) {
  var headers = {
    'User-Agent': HEADERS['User-Agent'],
    'Accept': '*/*'
  };
  try {
    var reqUrl = new URL(request.url);
    var refParam = reqUrl.searchParams.get('ref') || '';
    var host = new URL(targetUrl).hostname || '';
    if (refParam) {
      headers['Referer'] = refParam;
      try { headers['Origin'] = new URL(refParam).origin; } catch (eR) {}
    } else if (host.indexOf('vimeos') !== -1) {
      headers['Referer'] = 'https://vimeos.net/';
    } else if (host) {
      headers['Referer'] = 'https://' + host + '/';
      headers['Origin'] = 'https://' + host;
    }
  } catch (e) {}

  var upstream = await fetch(targetUrl, { headers: headers, redirect: 'follow' });
  var ct = (upstream.headers.get('content-type') || '').toLowerCase();
  var buf = await upstream.arrayBuffer();
  var isM3u8 = ct.indexOf('mpegurl') !== -1 || ct.indexOf('m3u8') !== -1 ||
    /\.m3u8(\?|$)/i.test(targetUrl) || /\.txt(\?|$)/i.test(targetUrl);

  var origin = new URL(request.url).origin;
  var proxyBase = origin + '/proxy?url=';
  try {
    var refKeep = new URL(request.url).searchParams.get('ref');
    if (refKeep) proxyBase = origin + '/proxy?ref=' + encodeURIComponent(refKeep) + '&url=';
  } catch (eRef) {}

  if (isM3u8) {
    var text = new TextDecoder().decode(buf);
    if (text.indexOf('#EXT') !== -1) {
      text = rewriteM3u8(text, targetUrl, proxyBase);
      return new Response(text, {
        status: 200,
        headers: Object.assign({}, corsHeaders(), {
          'Content-Type': 'application/vnd.apple.mpegurl',
          'Cache-Control': 'no-cache'
        })
      });
    }
  }

  var h = Object.assign({}, corsHeaders(), {
    'Content-Type': ct || 'application/octet-stream',
    'Cache-Control': 'public, max-age=60'
  });
  return new Response(buf, { status: upstream.status, headers: h });
}



/** HEAD/GET rápido para saber si una URL HLS está activa o 403 */
async function checkHlsStatus(streamUrl, referer) {
  var headers = {
    'User-Agent': HEADERS['User-Agent'],
    'Accept': '*/*'
  };
  if (referer) {
    headers['Referer'] = referer;
    try { headers['Origin'] = new URL(referer).origin; } catch (e) {}
  }
  try {
    var res = await fetch(streamUrl, { method: 'GET', headers: headers, redirect: 'follow' });
    var status = res.status;
    var body = '';
    try { body = await res.text(); } catch (e2) {}
    if (status === 403) return { url: streamUrl, status: 'bloqueado 403' };
    if (status >= 400) return { url: streamUrl, status: 'error ' + status };
    if (body && body.indexOf('#EXT') !== -1) return { url: streamUrl, status: 'activo', body: body };
    if (status >= 200 && status < 300) return { url: streamUrl, status: 'activo', body: body };
    return { url: streamUrl, status: 'desconocido ' + status };
  } catch (e) {
    return { url: streamUrl, status: 'error: ' + (e.message || e) };
  }
}

function proxyUrlFor(origin, target, ref) {
  var u = origin + '/proxy?url=' + encodeURIComponent(target);
  if (ref) u += '&ref=' + encodeURIComponent(ref);
  return u;
}

/** Respuesta rica: hls + status + qualities con proxy_url listos para player */

var VIDHIDE_MIRRORS = [
  'vidhidepro.com', 'vidhide.com', 'vidhidepre.com', 'earnvids.com',
  'callistanise.com', 'smoothpre.com', 'filelions.com'
];

var VOE_MIRRORS = [
  'voe.sx', 'jilliandescribecompany.com', 'voe-unblock.com',
  'donaldlineelse.com', 'kathleenmemberhistory.com'
];

function extractIdGeneric(url, patterns) {
  for (var i = 0; i < patterns.length; i++) {
    var m = String(url).match(patterns[i]);
    if (m) return m[1];
  }
  return String(url).replace(/\/$/, '').split('/').pop().split('?')[0].replace(/^embed-/, '').replace(/\.html$/, '');
}

async function fetchEmbedHtmlCandidates(url, hosts, pathTemplates, refererBase) {
  var id = extractIdGeneric(url, [
    /\/(?:e|v|f)\/([a-zA-Z0-9]+)/,
    /embed-([a-zA-Z0-9]+)/,
    /\/([a-zA-Z0-9]{10,})(?:\.html)?(?:\?|$)/
  ]);
  var candidates = [url];
  for (var h = 0; h < hosts.length; h++) {
    for (var t = 0; t < pathTemplates.length; t++) {
      var u = 'https://' + hosts[h] + pathTemplates[t].replace('{id}', id);
      if (candidates.indexOf(u) === -1) candidates.push(u);
    }
  }
  var lastErr = null;
  for (var i = 0; i < candidates.length; i++) {
    var u2 = candidates[i];
    var host = 'localhost';
    try { host = new URL(u2).hostname; } catch (e) {}
    var headers = {
      'User-Agent': HEADERS['User-Agent'],
      'Accept': HEADERS['Accept'],
      'Accept-Language': 'en-US,en;q=0.9,es;q=0.8',
      'Referer': refererBase || ('https://' + host + '/'),
      'Origin': 'https://' + host
    };
    try {
      var res = await fetch(u2, { headers: headers, redirect: 'follow' });
      var html = await res.text();
      if (res.ok && html.length > 500 && (
        html.indexOf('eval(function(p,a,c,k,e,d)') !== -1 ||
        html.indexOf('jwplayer') !== -1 ||
        html.indexOf('sources') !== -1 ||
        /\.m3u8/.test(html)
      )) {
        return { html: html, used: u2, host: host };
      }
      lastErr = 'HTTP ' + res.status + ' ' + u2 + ' len=' + html.length;
    } catch (e2) {
      lastErr = u2 + ': ' + (e2.message || e2);
    }
  }
  throw new Error(lastErr || 'No se pudo descargar el embed');
}

function extractLinksFromDecoded(decoded) {
  var urls = findStreamUrlsInDecoded(decoded);
  // links object style hls2/hls3
  var reHls = /"(hls\d*|file|src)"\s*:\s*"(https?:\/\/[^"]+)"/gi;
  var mm;
  while ((mm = reHls.exec(decoded))) {
    if (urls.indexOf(mm[2]) === -1) urls.push(mm[2]);
  }
  var reM = /https?:\/\/[^"'\s<>\\]+\.m3u8(?:\?[^"'\s<>\\]*)?/gi;
  while ((mm = reM.exec(decoded))) {
    var u = mm[0].replace(/\\+$/g, '');
    if (urls.indexOf(u) === -1) urls.push(u);
  }
  return urls;
}

function extractDirectFromHtml(html) {
  var urls = [];
  var re = /https?:\/\/[^"'\s<>\\]+\.m3u8(?:\?[^"'\s<>\\]*)?/gi;
  var m;
  while ((m = re.exec(html))) {
    var u = m[0].replace(/\\\//g, '/');
    if (urls.indexOf(u) === -1) urls.push(u);
  }
  // JW sources file:"..."
  var re2 = /file\s*:\s*["'](https?:\/\/[^"']+)["']/gi;
  while ((m = re2.exec(html))) {
    if (urls.indexOf(m[1]) === -1) urls.push(m[1]);
  }
  return urls;
}

async function resolveVidhideEmbed(embedUrl, origin) {
  var got = await fetchEmbedHtmlCandidates(
    embedUrl,
    VIDHIDE_MIRRORS,
    ['/v/{id}', '/f/{id}', '/e/{id}', '/embed-{id}.html'],
    'https://vidhidepro.com/'
  );
  var urls = [];
  try {
    var decoded = unpackPacker(got.html);
    urls = extractLinksFromDecoded(decoded);
  } catch (e) {
    urls = extractDirectFromHtml(got.html);
  }
  if (!urls.length) urls = extractDirectFromHtml(got.html);
  // absolutizar paths relativos /stream/...
  for (var i = 0; i < urls.length; i++) {
    if (urls[i].indexOf('http') !== 0) {
      try { urls[i] = new URL(urls[i], got.used).toString(); } catch (e2) {}
    }
  }
  urls = urls.filter(function (u) { return /\.m3u8|master\.txt|\.mp4/i.test(u); });
  if (!urls.length) throw new Error('Vidhide: no se encontró HLS');
  var master = pickMasterUrl(urls);
  var out = {
    success: true,
    provider: 'vidhide',
    source: embedUrl,
    resolved_embed: got.used,
    type: 'hls',
    url: master,
    master: master,
    all_sources: urls
  };
  if (origin) {
    out.proxy_url = origin + '/proxy?url=' + encodeURIComponent(master) + '&ref=' + encodeURIComponent(got.used);
  }
  return out;
}

async function resolveGoodstreamEmbed(embedUrl, origin) {
  var headers = {
    'User-Agent': HEADERS['User-Agent'],
    'Referer': 'https://goodstream.one/',
    'Accept': HEADERS['Accept']
  };
  // normalizar a /embed-ID.html
  var id = extractIdGeneric(embedUrl, [/embed-([a-zA-Z0-9]+)/, /\/([a-zA-Z0-9]{8,})(?:\.html)?(?:\?|$)/]);
  var candidates = [embedUrl];
  if (id) {
    candidates.push('https://goodstream.one/embed-' + id + '.html');
    candidates.push('https://goodstream.one/' + id);
  }
  var html = null, used = embedUrl;
  var lastErr = null;
  for (var i = 0; i < candidates.length; i++) {
    try {
      var res = await fetch(candidates[i], { headers: headers, redirect: 'follow' });
      var t = await res.text();
      if (res.ok && t.length > 400) {
        html = t; used = candidates[i];
        if (/\.m3u8|sources|jwplayer/.test(t)) break;
      }
      lastErr = 'HTTP ' + res.status;
    } catch (e) { lastErr = e.message || e; }
  }
  if (!html) throw new Error('Goodstream: ' + (lastErr || 'sin HTML'));
  var urls = extractDirectFromHtml(html);
  try {
    if (html.indexOf('eval(function(p,a,c,k,e,d)') !== -1) {
      var decoded = unpackPacker(html);
      var more = extractLinksFromDecoded(decoded);
      for (var j = 0; j < more.length; j++) if (urls.indexOf(more[j]) === -1) urls.push(more[j]);
    }
  } catch (e2) {}
  urls = urls.filter(function (u) { return /\.m3u8|\.mp4/i.test(u); });
  if (!urls.length) throw new Error('Goodstream: no se encontró stream');
  var master = pickMasterUrl(urls);
  var out = {
    success: true,
    provider: 'goodstream',
    source: embedUrl,
    resolved_embed: used,
    type: 'hls',
    url: master,
    master: master,
    all_sources: urls
  };
  if (origin) {
    out.proxy_url = origin + '/proxy?url=' + encodeURIComponent(master) + '&ref=' + encodeURIComponent(used);
  }
  return out;
}

async function resolveVoeEmbed(embedUrl, origin) {
  // VOE suele tener DDoS-Guard; intentamos mirrors
  var got;
  try {
    got = await fetchEmbedHtmlCandidates(
      embedUrl,
      VOE_MIRRORS,
      ['/e/{id}', '/{id}'],
      'https://voe.sx/'
    );
  } catch (e) {
    throw new Error('Voe: bloqueado o no accesible desde el worker (' + (e.message || e) + '). Prueba otro mirror o más tarde.');
  }
  var urls = extractDirectFromHtml(got.html);
  try {
    if (got.html.indexOf('eval(function(p,a,c,k,e,d)') !== -1) {
      var decoded = unpackPacker(got.html);
      var more = extractLinksFromDecoded(decoded);
      for (var i = 0; i < more.length; i++) if (urls.indexOf(more[i]) === -1) urls.push(more[i]);
    }
  } catch (e2) {}
  // VOE a veces mete base64 de fuentes
  var b64 = got.html.match(/var\s+sources\s*=\s*JSON\.parse\(atob\(["']([A-Za-z0-9+/=]+)["']\)\)/);
  if (b64) {
    try {
      var jsonStr = atob(b64[1]);
      var obj = JSON.parse(jsonStr);
      var walk = function (o) {
        if (!o) return;
        if (typeof o === 'string' && /^https?:/.test(o)) {
          if (urls.indexOf(o) === -1) urls.push(o);
        } else if (Array.isArray(o)) o.forEach(walk);
        else if (typeof o === 'object') Object.keys(o).forEach(function (k) { walk(o[k]); });
      };
      walk(obj);
    } catch (e3) {}
  }
  urls = urls.filter(function (u) { return /\.m3u8|\.mp4|hls/i.test(u); });
  if (!urls.length) throw new Error('Voe: HTML obtenido pero sin fuentes HLS (posible challenge JS)');
  var master = pickMasterUrl(urls);
  var out = {
    success: true,
    provider: 'voe',
    source: embedUrl,
    resolved_embed: got.used,
    type: 'hls',
    url: master,
    master: master,
    all_sources: urls
  };
  if (origin) {
    out.proxy_url = origin + '/proxy?url=' + encodeURIComponent(master) + '&ref=' + encodeURIComponent(got.used);
  }
  return out;
}

function detectarProviderEmbedFull(u) {
  u = String(u || '').toLowerCase();
  if (u.indexOf('vimeos') !== -1) return 'vimeos';
  if (u.indexOf('streamwish') !== -1 || u.indexOf('flaswish') !== -1 ||
      u.indexOf('strwish') !== -1 || u.indexOf('ahvsh') !== -1 || u.indexOf('streamhg') !== -1) return 'streamwish';
  if (u.indexOf('vidhide') !== -1 || u.indexOf('earnvids') !== -1 ||
      u.indexOf('callistanise') !== -1 || u.indexOf('smoothpre') !== -1 || u.indexOf('filelions') !== -1) return 'vidhide';
  if (u.indexOf('voe') !== -1 || u.indexOf('jilliandescribe') !== -1) return 'voe';
  if (u.indexOf('goodstream') !== -1) return 'goodstream';
  return '';
}

async function resolveByProvider(embedUrl, provider, origin) {
  provider = provider || detectarProviderEmbedFull(embedUrl);
  if (provider === 'streamwish') return resolveStreamwishEmbed(embedUrl, origin);
  if (provider === 'vidhide') return resolveVidhideEmbed(embedUrl, origin);
  if (provider === 'goodstream') return resolveGoodstreamEmbed(embedUrl, origin);
  if (provider === 'voe') return resolveVoeEmbed(embedUrl, origin);
  if (provider === 'vimeos') return resolveVimeosEmbed(embedUrl, origin);
  throw new Error('Provider no soportado: ' + (provider || 'desconocido'));
}

async function buildProviderRichResponse(embedUrl, origin, forceProvider) {
  var provider = forceProvider || detectarProviderEmbedFull(embedUrl);
  if (provider === 'streamwish' || !provider) {
    // streamwish path existente
    if (!provider || provider === 'streamwish') {
      if (detectarProviderEmbedFull(embedUrl) === 'streamwish' || forceProvider === 'streamwish' || !forceProvider && detectarProviderEmbed(embedUrl) === 'streamwish') {
        return buildStreamwishRichResponse(embedUrl, origin);
      }
    }
  }
  var base = await resolveByProvider(embedUrl, provider || detectarProviderEmbedFull(embedUrl), null);
  var referer = base.resolved_embed || embedUrl;
  var hlsList = (base.all_sources || []).slice();
  if (base.master && hlsList.indexOf(base.master) === -1) hlsList.unshift(base.master);
  if (base.url && hlsList.indexOf(base.url) === -1) hlsList.unshift(base.url);
  hlsList.sort(function (a, b) {
    var sa = /\.txt(\?|$)/.test(String(a)) || String(a).indexOf('master.txt') !== -1 ? 0 : 1;
    var sb = /\.txt(\?|$)/.test(String(b)) || String(b).indexOf('master.txt') !== -1 ? 0 : 1;
    var pa = String(a).indexOf('premilkyway') !== -1 ? 1 : 0;
    var pb = String(b).indexOf('premilkyway') !== -1 ? 1 : 0;
    return sa - sb || pa - pb;
  });
  var hlsStatus = [];
  var activePlaylist = null;
  var activeMaster = null;
  for (var j = 0; j < hlsList.length; j++) {
    var st = await checkHlsStatus(hlsList[j], referer);
    hlsStatus.push({ url: st.url, status: st.status });
    if (!activePlaylist && st.status === 'activo' && st.body && st.body.indexOf('#EXT') !== -1) {
      activePlaylist = st.body;
      activeMaster = st.url;
    }
  }
  var qualities = [];
  if (activePlaylist && activeMaster) {
    var variants = parseHlsVariants(activePlaylist, activeMaster);
    if (!variants.length) {
      qualities.push({
        quality: 'auto',
        resolution: null,
        bandwidth: null,
        url: activeMaster,
        proxy_url: proxyUrlFor(origin, activeMaster, referer)
      });
    } else {
      variants.sort(function (a, b) { return (a.height || 0) - (b.height || 0); });
      for (var k = 0; k < variants.length; k++) {
        var v = variants[k];
        qualities.push({
          quality: v.height ? (v.height + 'p (' + v.width + 'x' + v.height + ')') : 'auto',
          resolution: v.height ? (v.width + 'x' + v.height) : null,
          bandwidth: v.bandwidth || null,
          url: v.url,
          proxy_url: proxyUrlFor(origin, v.url, referer)
        });
      }
    }
  }
  var best = qualities.length ? qualities[qualities.length - 1] : null;
  for (var q = 0; q < qualities.length; q++) {
    if (String(qualities[q].quality).indexOf('720') !== -1) { best = qualities[q]; break; }
  }
  return {
    success: true,
    provider: base.provider || provider,
    source: embedUrl,
    resolved_embed: referer,
    videos: { hls: hlsList, hls_status: hlsStatus },
    qualities: qualities,
    play_url: best ? best.proxy_url : (activeMaster ? proxyUrlFor(origin, activeMaster, referer) : null),
    play_direct: best ? best.url : activeMaster,
    proxy_url: best ? best.proxy_url : (activeMaster ? proxyUrlFor(origin, activeMaster, referer) : null)
  };
}


async function buildStreamwishRichResponse(embedUrl, origin) {
  var base = await resolveStreamwishEmbed(embedUrl, null);
  var referer = base.resolved_embed || embedUrl;
  var hlsList = [];
  if (Array.isArray(base.all_sources)) {
    for (var i = 0; i < base.all_sources.length; i++) {
      if (hlsList.indexOf(base.all_sources[i]) === -1) hlsList.push(base.all_sources[i]);
    }
  }
  if (base.master && hlsList.indexOf(base.master) === -1) hlsList.unshift(base.master);
  if (base.url && hlsList.indexOf(base.url) === -1) hlsList.unshift(base.url);

  hlsList.sort(function (a, b) {
    var sa = (String(a).indexOf('master.txt') !== -1 || /\.txt(\?|$)/.test(String(a))) ? 0 : 1;
    var sb = (String(b).indexOf('master.txt') !== -1 || /\.txt(\?|$)/.test(String(b))) ? 0 : 1;
    var pa = String(a).indexOf('premilkyway') !== -1 ? 1 : 0;
    var pb = String(b).indexOf('premilkyway') !== -1 ? 1 : 0;
    return sa - sb || pa - pb;
  });

  var hlsStatus = [];
  var activePlaylist = null;
  var activeMaster = null;
  for (var j = 0; j < hlsList.length; j++) {
    var st = await checkHlsStatus(hlsList[j], referer);
    hlsStatus.push({ url: st.url, status: st.status });
    if (!activePlaylist && st.status === 'activo' && st.body && st.body.indexOf('#EXT') !== -1) {
      activePlaylist = st.body;
      activeMaster = st.url;
    }
  }

  var qualities = [];
  if (activePlaylist && activeMaster) {
    var variants = parseHlsVariants(activePlaylist, activeMaster);
    if (!variants.length) {
      qualities.push({
        quality: base.quality || 'auto',
        resolution: base.resolution || null,
        bandwidth: null,
        url: activeMaster,
        proxy_url: proxyUrlFor(origin, activeMaster, referer)
      });
    } else {
      variants.sort(function (a, b) { return (a.height || 0) - (b.height || 0); });
      for (var k = 0; k < variants.length; k++) {
        var v = variants[k];
        qualities.push({
          quality: v.height ? (v.height + 'p (' + v.width + 'x' + v.height + ')') : 'auto',
          resolution: v.height ? (v.width + 'x' + v.height) : null,
          bandwidth: v.bandwidth || null,
          url: v.url,
          proxy_url: proxyUrlFor(origin, v.url, referer)
        });
      }
    }
  }

  var best = null;
  if (qualities.length) {
    best = qualities[qualities.length - 1];
    for (var q = 0; q < qualities.length; q++) {
      if (String(qualities[q].quality).indexOf('720') !== -1) { best = qualities[q]; break; }
    }
  }

  return {
    success: true,
    provider: 'streamwish',
    source: embedUrl,
    resolved_embed: referer,
    videos: {
      hls: hlsList,
      hls_status: hlsStatus
    },
    qualities: qualities,
    play_url: best ? best.proxy_url : (activeMaster ? proxyUrlFor(origin, activeMaster, referer) : null),
    play_direct: best ? best.url : activeMaster,
    proxy_url: best ? best.proxy_url : (activeMaster ? proxyUrlFor(origin, activeMaster, referer) : null)
  };
}

function attachStreamUrl(origin, rep) {
  if (!rep || !rep.url) return rep;
  var s = String(rep.servidor || '').toLowerCase();
  var u = String(rep.url || '').toLowerCase();
  var prov = detectarProviderEmbedFull(rep.url);
  if (prov === 'streamwish' || s.indexOf('streamwish') !== -1) {
    rep.stream_url = origin + '/wish/streamurl?url=' + encodeURIComponent(rep.url);
  } else if (prov === 'vidhide' || s.indexOf('vidhide') !== -1) {
    rep.stream_url = origin + '/vidhide/streamurl?url=' + encodeURIComponent(rep.url);
  } else if (prov === 'voe' || s.indexOf('voe') !== -1) {
    rep.stream_url = origin + '/voe/streamurl?url=' + encodeURIComponent(rep.url);
  } else if (prov === 'goodstream' || s.indexOf('goodstream') !== -1) {
    rep.stream_url = origin + '/goodstream/streamurl?url=' + encodeURIComponent(rep.url);
  } else if (prov === 'vimeos' || s.indexOf('vimeos') !== -1) {
    rep.stream_url = origin + '/resolve/vimeos?url=' + encodeURIComponent(rep.url) + '&proxy=1';
  }
  return rep;
}

function attachStreamUrlList(origin, list) {
  if (!Array.isArray(list)) return list;
  for (var i = 0; i < list.length; i++) attachStreamUrl(origin, list[i]);
  return list;
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
}

function json(data, status) {
  status = status || 200;
  try {
    if (data && typeof data === 'object' && __LAST_ORIGIN__) {
      if (Array.isArray(data.reproductores)) attachStreamUrlList(__LAST_ORIGIN__, data.reproductores);
      if (Array.isArray(data.embeds) && data.embeds[0] && data.embeds[0].url) {
        attachStreamUrlList(__LAST_ORIGIN__, data.embeds);
      }
      // episodios con reproductores
      if (Array.isArray(data.temporadas)) {
        for (var t = 0; t < data.temporadas.length; t++) {
          var caps = data.temporadas[t] && data.temporadas[t].capitulos;
          if (!Array.isArray(caps)) caps = data.temporadas[t] && data.temporadas[t].episodios;
          if (Array.isArray(caps)) {
            for (var c = 0; c < caps.length; c++) {
              if (caps[c] && Array.isArray(caps[c].reproductores)) {
                attachStreamUrlList(__LAST_ORIGIN__, caps[c].reproductores);
              }
            }
          }
        }
      }
      if (Array.isArray(data.episodios)) {
        for (var e = 0; e < data.episodios.length; e++) {
          if (data.episodios[e] && Array.isArray(data.episodios[e].reproductores)) {
            attachStreamUrlList(__LAST_ORIGIN__, data.episodios[e].reproductores);
          }
        }
      }
    }
  } catch (eAttach) {}
  var h = Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, corsHeaders());
  return new Response(JSON.stringify(data, null, 2), { status: status, headers: h });
}

function limpiarTexto(txt) {
  if (!txt) return '';
  var s = String(txt);
  // Corregir mojibake UTF-8 leído como Latin-1: "bÃºsqueda" → "búsqueda"
  if (/Ã.|Â.|â.|ð./.test(s)) {
    try {
      var fixed = '';
      // En Worker no hay Buffer: decodificar manualmente
      var bytes = [];
      for (var i = 0; i < s.length; i++) bytes.push(s.charCodeAt(i) & 0xff);
      fixed = new TextDecoder('utf-8').decode(new Uint8Array(bytes));
      if (fixed && !/Ã.|�/.test(fixed)) s = fixed;
    } catch (e) { /* keep s */ }
  }
  return s.replace(/\s+/g, ' ').trim();
}

/** Quita basura de títulos: "Descargar serie", " - Hackstore.fo Oficial...", etc. */
function limpiarTitulo(txt) {
  if (!txt) return '';
  var t = limpiarTexto(String(txt));
  // Mojibake frecuente en títulos
  t = t.replace(/CÃ³digo/gi, 'Código').replace(/CÃ\x93digo/gi, 'Código');
  t = t.replace(/Ã¡/g, 'á').replace(/Ã©/g, 'é').replace(/Ã­/g, 'í')
    .replace(/Ã³/g, 'ó').replace(/Ãº/g, 'ú').replace(/Ã±/g, 'ñ')
    .replace(/ÃÁ/g, 'Á').replace(/Ã‰/g, 'É').replace(/Ã/g, 'Í')
    .replace(/Ã“/g, 'Ó').replace(/Ãš/g, 'Ú').replace(/Ã‘/g, 'Ñ');
  t = t.replace(/\s*[-|–—]\s*Hackstore\.fo Oficial.*$/i, '');
  t = t.replace(/\s*[-|–—]\s*Peliculas,?\s*Series y animes.*$/i, '');
  t = t.replace(/\s*[-|–—]\s*Pelisplus.*$/i, '');
  t = t.replace(/\s*Online Latino HD.*$/i, '');
  t = t.replace(/\s*Gratis\s*$/i, '');
  t = t.replace(/^Ver\s+Serie:\s*/i, '');
  t = t.replace(/^Ver\s+Pel[ií]cula:\s*/i, '');
  t = t.replace(/^Descargar\s+(serie|pel[ií]cula|anime)\s+/i, '');
  t = t.replace(/^Serie\s+/i, '');
  t = t.replace(/\s*:\s*\d+x\d+(\s*[-–].*)?$/i, '');
  return limpiarTexto(t);
}

/**
 * Portadas Hackstore: wp-content/uploads/.../HASH.jpg suelen ser copias rotas de TMDB.
 * → https://image.tmdb.org/t/p/w500/HASH.jpg
 */
function normalizarPortadaUrl(url) {
  if (!url) return null;
  var u = String(url).trim();
  if (!u || u.indexOf('data:') === 0) return null;
  if (/image\.tmdb\.org/i.test(u)) {
    return u.replace(/\/w\d+\//, '/w500/');
  }
  var m = u.match(/\/(?:uploads\/\d{4}\/\d{2}\/|t\/p\/w\d+\/)([a-zA-Z0-9]{20,}\.(?:jpg|jpeg|png|webp))/i);
  if (m) {
    return 'https://image.tmdb.org/t/p/w500/' + m[1];
  }
  m = u.match(/\/([a-zA-Z0-9]{27,}\.(?:jpg|jpeg|png|webp))(?:\?|$)/i);
  if (m && /hackstore|wp-content/i.test(u)) {
    return 'https://image.tmdb.org/t/p/w500/' + m[1];
  }
  if (/media-amazon|amazon\.com/i.test(u)) return null;
  return u;
}

/** Portada Hackstore: preferir TMDB data-src del lazyload */
function extraerPortadaHackstore(html) {
  html = html || '';
  var m;
  m = html.match(/data-src=["'](https?:\/\/image\.tmdb\.org\/[^"']+)["']/i)
    || html.match(/data-lazy-src=["'](https?:\/\/image\.tmdb\.org\/[^"']+)["']/i)
    || html.match(/src=["'](https?:\/\/image\.tmdb\.org\/[^"']+)["']/i);
  if (m) return normalizarPortadaUrl(m[1]);
  m = html.match(/property=["']og:image["']\s+content=["']([^"']+)["']/i)
    || html.match(/content=["']([^"']+)["']\s+property=["']og:image["']/i);
  if (m) {
    var p = normalizarPortadaUrl(m[1]);
    if (p) return p;
  }
  m = html.match(/src=["'](https?:\/\/[^"']*hackstore[^"']*\/uploads\/[^"']+\.(?:jpg|png|webp))["']/i)
    || html.match(/src=["'](https?:\/\/[^"']*\/wp-content\/uploads\/[^"']+\.(?:jpg|png|webp))["']/i);
  if (m) return normalizarPortadaUrl(m[1]);
  return null;
}

/** Extrae titulo, descripcion completa, portada, géneros y año del HTML de la fuente */
function extraerMetas(html) {
  html = html || '';
  var titulo = '';
  var m;

  m = html.match(/property=["']og:title["']\s+content=["']([^"']+)["']/i)
    || html.match(/content=["']([^"']+)["']\s+property=["']og:title["']/i);
  if (m) titulo = m[1];
  if (!titulo) {
    m = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
    if (m) titulo = m[1];
  }
  if (!titulo) {
    m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (m) titulo = m[1];
  }
  titulo = limpiarTitulo(titulo);

  // Año desde título "Nombre (2026)"
  var year = null;
  var ym = titulo.match(/\((\d{4})\)/);
  if (ym) year = ym[1];
  if (!year) {
    ym = html.match(/Ver\s+[^<(]+\((\d{4})\)/i);
    if (ym) year = ym[1];
  }

  // Sinopsis COMPLETA de la página (div.text-large tras "Sinopsis"), no el meta truncado
  var descripcion = '';
  m = html.match(/Sinopsis\s*:?\s*<\/(?:b|strong|span|p)[^>]*>\s*(?:<\/p>\s*)?<div[^>]*class=["'][^"']*text-large[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)
    || html.match(/class=["'][^"']*text-large[^"']*["'][^>]*>\s*([\s\S]{40,}?)\s*<\/div>/i);
  if (m) {
    descripcion = limpiarTexto(m[1].replace(/<[^>]+>/g, ' '));
  }
  if (!descripcion || descripcion.length < 40) {
    m = html.match(/property=["']og:description["']\s+content=["']([^"']+)["']/i)
      || html.match(/content=["']([^"']+)["']\s+property=["']og:description["']/i)
      || html.match(/name=["']description["']\s+content=["']([^"']+)["']/i)
      || html.match(/content=["']([^"']+)["']\s+name=["']description["']/i);
    if (m) descripcion = limpiarTexto(m[1]);
  }
  // Quitar prefijos "Pelicula X:" / "Serie X:" y puntos suspensivos finales del meta
  descripcion = descripcion
    .replace(/^(Pel[ií]cula|Serie|Anime|Movie)\s*[^:]{0,80}:\s*/i, '')
    .replace(/\.\.\.\s*$/, '')
    .trim();
  descripcion = limpiarTexto(descripcion);

  // Portada: preferir poster del sitio o TMDB, NUNCA amazon media-amazon rotas
  var portada = '';
  m = html.match(/src=["'](https?:\/\/[^"']*\/poster\/[^"']+)["']/i)
    || html.match(/src=["'](\/?poster\/[^"']+)["']/i);
  if (m) {
    portada = m[1].indexOf('http') === 0 ? m[1] : PELISPLUS_BASE + (m[1].charAt(0) === '/' ? m[1] : '/' + m[1]);
  }
  if (!portada) {
    m = html.match(/property=["']og:image["']\s+content=["']([^"']+)["']/i)
      || html.match(/content=["']([^"']+)["']\s+property=["']og:image["']/i);
    if (m && !/media-amazon|amazon\.com/i.test(m[1])) portada = m[1];
  }
  if (!portada) {
    m = html.match(/data-src=["'](https?:\/\/image\.tmdb\.org\/[^"']+)["']/i)
      || html.match(/src=["'](https?:\/\/image\.tmdb\.org\/t\/p\/w(?:300|500|780)\/[^"']+)["']/i);
    if (m) portada = m[1];
  }
  if (portada) portada = normalizarPortadaUrl(portada) || portada;
  if (portada && /image\.tmdb\.org\/t\/p\/w300\//i.test(portada)) {
    portada = portada.replace('/w300/', '/w500/');
  }

  // Géneros: links /generos/ cerca de la ficha (tras Sinopsis / sectionDetail), no el menú lateral
  var generos = [];
  var genSeen = {};
  var zone = '';
  var zi = html.search(/Sinopsis/i);
  if (zi >= 0) zone = html.slice(zi, zi + 4000);
  else zone = html;
  var gre = /href=["']\/generos\/([^"'\/]+)["'][^>]*>([^<]+)</gi;
  var gm;
  while ((gm = gre.exec(zone)) !== null) {
    var gSlug = gm[1].toLowerCase();
    var gName = limpiarTexto(gm[2]);
    if (!gName || genSeen[gSlug]) continue;
    // filtrar entradas del menú genérico si aparecen
    if (gSlug === 'dorama' && generos.length === 0) continue;
    genSeen[gSlug] = true;
    generos.push(gName);
  }
  // fallback: keywords meta
  if (!generos.length) {
    m = html.match(/name=["']keywords["']\s+content=["']([^"']+)["']/i);
    // no suele traer géneros útiles
  }

  // Actores (opcional)
  var actores = [];
  var are = /href=["']\/actor\/[^"']+["'][^>]*>([^<]+)</gi;
  var am;
  var actorZone = zi >= 0 ? html.slice(zi, zi + 5000) : html;
  while ((am = are.exec(actorZone)) !== null && actores.length < 12) {
    var an = limpiarTexto(am[1]);
    if (an && actores.indexOf(an) === -1) actores.push(an);
  }

  return {
    titulo: titulo,
    descripcion: descripcion,
    portada: portada,
    year: year,
    generos: generos,
    genero: generos.length ? generos.join(', ') : null,
    actores: actores
  };
}

/** Extrae links de descarga (mega, mediafire, etc.) del HTML */
function extraerDescargas(html) {
  var out = [];
  var vistos = {};

  function add(u) {
    if (!u || vistos[u]) return;
    var low = String(u).toLowerCase();
    if (low.indexOf('favicon') !== -1 || low.indexOf('google.com/s2') !== -1) return;
    if (!esDescargaValida(u)) return;
    vistos[u] = true;
    out.push({
      url: u,
      servidor: extraerServidor(u),
      tipo: 'descarga'
    });
  }

  var reDom = /domain_url=(https?%3A%2F%2F[^&"'>\s]+|https?:\/\/[^&"'>\s]+)/gi;
  var m;
  while ((m = reDom.exec(html)) !== null) {
    var u = m[1];
    try { u = decodeURIComponent(u); } catch (e) { /* ignore */ }
    add(u);
  }

  var reHref = /href=["'](https?:\/\/[^"']+)["']/gi;
  while ((m = reHref.exec(html)) !== null) add(m[1]);

  var rePlain = /https?:\/\/(?:www\.)?(?:mega\.nz|mediafire\.com|1fichier\.com|megaup\.net|gofile\.io)[^\s"'<>]*/gi;
  while ((m = rePlain.exec(html)) !== null) add(m[0]);

  return out;
}

function extraerServidor(url) {
  try {
    var host = new URL(url).hostname.replace('www.', '').toLowerCase();
    if (host.indexOf('streamwish') !== -1) return 'streamwish';
    if (host.indexOf('voe') !== -1) return 'voe';
    if (host.indexOf('vidhide') !== -1) return 'vidhide';
    if (host.indexOf('filemoon') !== -1) return 'filemoon';
    if (host.indexOf('dood') !== -1 || host.indexOf('dsvplay') !== -1) return 'dood';
    if (host.indexOf('mixdrop') !== -1) return 'mixdrop';
    if (host.indexOf('uqload') !== -1) return 'uqload';
    if (host.indexOf('streamtape') !== -1) return 'streamtape';
    if (host.indexOf('vimeos') !== -1) return 'vimeos';
    if (host.indexOf('goodstream') !== -1) return 'goodstream';
    if (host.indexOf('vidmoly') !== -1) return 'vidmoly';
    if (host.indexOf('vidguard') !== -1) return 'vidguard';
    if (host.indexOf('lulustream') !== -1) return 'lulustream';
    if (host.indexOf('videoapp') !== -1) return 'videoapp';
    if (host.indexOf('mega.nz') !== -1 || host.indexOf('mega.co') !== -1) return 'mega';
    if (host.indexOf('mediafire') !== -1) return 'mediafire';
    if (host.indexOf('1fichier') !== -1) return '1fichier';
    if (host.indexOf('megaup') !== -1) return 'megaup';
    return host.split('.')[0];
  } catch (e) {
    return 'desconocido';
  }
}

function esReproductorValido(url) {
  if (!url) return false;
  var u = String(url).toLowerCase().trim();
  if (!/^https?:\/\//i.test(u)) return false;
  if (/\.(jpg|jpeg|png|webp|gif|svg|ico|css|woff2?)(\?|$)/i.test(u)) return false;
  if (u.indexOf('image.tmdb.org') !== -1 || u.indexOf('themoviedb.org') !== -1) return false;
  for (var i = 0; i < REPRODUCTORES_BLOQUEADOS.length; i++) {
    if (u.indexOf(REPRODUCTORES_BLOQUEADOS[i]) !== -1) return false;
  }
  for (var j = 0; j < REPRODUCTORES_PERMITIDOS.length; j++) {
    if (u.indexOf(REPRODUCTORES_PERMITIDOS[j]) !== -1) return true;
  }
  return false;
}

function esDescargaValida(url) {
  if (!url) return false;
  var u = String(url).toLowerCase();
  if (u.indexOf('google.com/s2/favicons') !== -1) return false;
  if (u.indexOf('acortalink') !== -1) return false;
  if (u.indexOf('favicon') !== -1) return false;
  var hosts = [
    'mega.nz', 'mega.co.nz', 'mediafire.com', '1fichier.com',
    'gofile.io', 'uptobox.com', 'pixeldrain.com', 'megaup.net'
  ];
  for (var i = 0; i < hosts.length; i++) {
    if (u.indexOf(hosts[i]) !== -1) return true;
  }
  return false;
}

// ======================================================
// BUSCADOR UNIVERSAL
// ======================================================
// ======================================================
// TMDB META (vía tvymas worker) — no altera embeds ni fuentes
// ======================================================
function normalizarTituloKey(t) {
  return String(t || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\(\d{4}\)/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function imgTmdb(path, size) {
  if (!path) return null;
  if (String(path).indexOf('http') === 0) return path;
  return 'https://image.tmdb.org/t/p/' + (size || 'w500') + path;
}

/** Busca en tvymas y devuelve mapa título→meta TMDB */
async function buscarMetaTmdb(query) {
  var url = TMDB_META_API + '/search?q=' + encodeURIComponent(query);
  var res = await fetch(url, {
    headers: { 'User-Agent': 'MovieZoneWorker/1.0', 'Accept': 'application/json' }
  });
  if (!res.ok) return [];
  var data = await res.json();
  var list = data.results || data.resultados || [];
  if (!Array.isArray(list)) return [];
  return list;
}

/** Detalle completo TMDB desde tvymas (serie/pelicula/anime/dorama) */
async function fetchDetalleTmdbMeta(slugOrTitle, tipoHint) {
  // 1) buscar por título/slug
  var q = String(slugOrTitle || '').replace(/-\d{4}$/, '').replace(/-/g, ' ').trim();
  var results = await buscarMetaTmdb(q);
  if (!results.length) return null;

  var keyWanted = normalizarTituloKey(q);
  var best = null;
  for (var i = 0; i < results.length; i++) {
    var it = results[i];
    var k = normalizarTituloKey(it.title || it.titulo || '');
    if (k === keyWanted || k.indexOf(keyWanted) !== -1 || keyWanted.indexOf(k) !== -1) {
      best = it;
      break;
    }
  }
  if (!best) best = results[0];

  // 2) si tiene slug de tvymas, pedir detalle completo
  var tvSlug = best.slug || null;
  if (!tvSlug) return mapMetaFromSearchItem(best);

  var paths = [];
  var t = String(tipoHint || '').toLowerCase();
  if (t.indexOf('anime') !== -1) paths = ['anime', 'serie', 'dorama', 'pelicula'];
  else if (t.indexOf('serie') !== -1 || t.indexOf('tv') !== -1) paths = ['serie', 'dorama', 'anime', 'pelicula'];
  else paths = ['pelicula', 'serie', 'dorama', 'anime'];

  for (var p = 0; p < paths.length; p++) {
    try {
      var dRes = await fetch(TMDB_META_API + '/' + paths[p] + '/' + encodeURIComponent(tvSlug), {
        headers: { 'User-Agent': 'MovieZoneWorker/1.0', 'Accept': 'application/json' }
      });
      if (!dRes.ok) continue;
      var det = await dRes.json();
      if (det && (det.tmdb_id || det.overview_tmdb || det.description || det.genres)) {
        return det;
      }
    } catch (e) { /* next */ }
  }
  return mapMetaFromSearchItem(best);
}

/** Extrae meta limpia desde un ítem de búsqueda tvymas (sin campos duplicados) */
function mapMetaFromSearchItem(it) {
  if (!it) return null;
  var poster = it.tmdb_poster || it.image || it.poster_tmdb || null;
  var overview = it.tmdb_overview || it.overview || it.description || null;
  var genres = it.tmdb_genres || it.genres || it.genres_tmdb || null;
  var rating = it.tmdb_rating || it.rating || null;
  var release = it.tmdb_release_date || it.release_date || null;
  return {
    tmdb_id: it.tmdb_id || null,
    titulo_tmdb: it.title || it.titulo || null,
    portada_tmdb: poster,
    backdrop: it.backdrop || null,
    calificacion: rating != null ? Number(rating) : null,
    descripcion: overview,
    generos: Array.isArray(genres) ? genres : (genres ? [genres] : []),
    fecha_estreno: release,
    year: release ? String(release).slice(0, 4) : null,
    titulo_original: it.original_title || null,
    votos: it.votes || null,
    duracion: it.runtime || null,
    status: it.status || null,
    tagline: it.tagline || null,
    imdb_id: it.imdb_id || null,
    slug_tmdb: it.slug || null
  };
}

/**
 * Aplica meta TMDB al ítem de tu API con campos ÚNICOS (sin repetir).
 * Mantiene compatibilidad con MovieZone: portada, descripcion, genero, calificacion, year
 */
function aplicarMetaAResultadoBusqueda(item, meta) {
  if (!item || !meta) return item;

  if (meta.tmdb_id) item.tmdb_id = meta.tmdb_id;
  if (meta.imdb_id) item.imdb_id = meta.imdb_id;
  if (meta.titulo_tmdb) item.titulo_tmdb = meta.titulo_tmdb;
  if (meta.titulo_original) item.titulo_original = meta.titulo_original;

  // Portada: TMDB ok; NUNCA amazon (no cargan bien)
  var posterOk = meta.portada_tmdb && !/media-amazon|amazon\.com|m\.media-amazon/i.test(meta.portada_tmdb);
  if (posterOk) {
    item.portada_tmdb = meta.portada_tmdb;
    // Solo reemplazar portada del listado si no hay o es placeholder; no pisar poster del sitio
    if (!item.portada || /placeholder/i.test(item.portada)) {
      item.portada = meta.portada_tmdb;
    }
  }
  if (meta.backdrop && !/media-amazon|amazon\.com/i.test(meta.backdrop)) {
    item.backdrop = meta.backdrop;
  }

  if (meta.calificacion != null && !isNaN(meta.calificacion) && !item.calificacion) {
    item.calificacion = String(meta.calificacion);
  }
  if (meta.votos && !item.votos) item.votos = meta.votos;

  // Descripción: preferir la de la página fuente (español completo); no pisar con inglés
  if (meta.descripcion) {
    var d = item.descripcion || '';
    var metaEsIngles = /\b(the|and|with|from|after|when|his|her)\b/i.test(meta.descripcion)
      && !/[áéíóúñ¿¡]/i.test(meta.descripcion);
    var dIncompleta = !d || d.length < 40 || /\.\.\.\s*$/.test(d) || /^(Pel[ií]cula|Serie)\s/i.test(d);
    if (dIncompleta && !metaEsIngles) {
      item.descripcion = meta.descripcion;
    } else if (dIncompleta && metaEsIngles && !d) {
      // solo si no hay nada
      item.descripcion = meta.descripcion;
    }
  }

  if (meta.generos && meta.generos.length) {
    item.generos = meta.generos;
    item.genero = meta.generos.join(', ');
  }

  if (meta.fecha_estreno) {
    item.fecha_estreno = meta.fecha_estreno;
    if (!item.year) item.year = String(meta.fecha_estreno).slice(0, 4);
  } else if (meta.year && !item.year) {
    item.year = meta.year;
  }

  if (meta.duracion) item.duracion = meta.duracion;
  if (meta.status) item.status = meta.status;
  if (meta.tagline) item.tagline = meta.tagline;

  return item;
}

/** Variantes de query para maximizar hits en APIs de meta */
function variantesTitulo(titulo) {
  var base = String(titulo || '')
    .replace(/\(\d{4}\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!base) return [];
  var out = [base];
  var sinPuntos = base.replace(/\./g, '');
  if (sinPuntos !== base) out.push(sinPuntos);
  var sinVs = base.replace(/\bvs\.?\b/gi, ' ').replace(/\s+/g, ' ').trim();
  if (sinVs !== base) out.push(sinVs);
  var sinDosPuntos = base.split(':')[0].trim();
  if (sinDosPuntos && sinDosPuntos !== base) out.push(sinDosPuntos);
  // quitar artículos iniciales
  var sinArt = base.replace(/^(el|la|los|las|the|a|an)\s+/i, '').trim();
  if (sinArt && sinArt !== base) out.push(sinArt);
  return out;
}

function elegirMejorMeta(metas, titulo) {
  if (!metas || !metas.length) return null;
  var key = normalizarTituloKey(titulo);
  var best = null;
  var bestScore = -1;
  for (var i = 0; i < metas.length; i++) {
    var k = normalizarTituloKey(metas[i].title || metas[i].titulo || metas[i].Title || '');
    var score = 0;
    if (k === key) score = 100;
    else if (k.indexOf(key) !== -1 || key.indexOf(k) !== -1) score = 50;
    else {
      var a = key.split(' ');
      var b = k.split(' ');
      var common = 0;
      for (var ti = 0; ti < a.length; ti++) {
        if (a[ti].length > 2 && b.indexOf(a[ti]) !== -1) common++;
      }
      score = common * 10;
    }
    if (score > bestScore) {
      bestScore = score;
      best = metas[i];
    }
  }
  if (!best || bestScore < 10) return null;
  return best;
}

/** OMDb (fallback gratuito cuando tvymas no tiene el título) */
async function buscarMetaOmdb(titulo) {
  var q = String(titulo || '').replace(/\(\d{4}\)/g, '').trim();
  if (!q) return null;
  try {
    var url = 'https://www.omdbapi.com/?t=' + encodeURIComponent(q) + '&apikey=trilogy&plot=full';
    var res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    var d = await res.json();
    if (!d || d.Response === 'False') return null;
    var genres = d.Genre ? d.Genre.split(',').map(function (g) { return g.trim(); }) : [];
    var year = d.Year ? String(d.Year).slice(0, 4) : null;
    var released = d.Released && d.Released !== 'N/A' ? d.Released : null;
    // Convertir fecha tipo "28 Aug 2026" a ISO aproximado
    var fecha = null;
    if (released) {
      var dt = new Date(released);
      if (!isNaN(dt.getTime())) fecha = dt.toISOString().slice(0, 10);
    }
    return {
      tmdb_id: null,
      imdb_id: d.imdbID || null,
      titulo_tmdb: d.Title || q,
      portada_tmdb: d.Poster && d.Poster !== 'N/A' ? d.Poster : null,
      backdrop: null,
      calificacion: d.imdbRating && d.imdbRating !== 'N/A' ? Number(d.imdbRating) : null,
      descripcion: d.Plot && d.Plot !== 'N/A' ? d.Plot : null,
      generos: genres,
      fecha_estreno: fecha,
      year: year,
      titulo_original: d.Title || null,
      votos: d.imdbVotes && d.imdbVotes !== 'N/A' ? d.imdbVotes : null,
      duracion: d.Runtime && d.Runtime !== 'N/A' ? parseInt(d.Runtime, 10) || null : null,
      status: null,
      tagline: null,
      slug_tmdb: null
    };
  } catch (e) {
    return null;
  }
}

/** TMDB oficial si hay TMDB_API_KEY en el Worker */
async function buscarMetaTmdbApi(titulo, tipoHint) {
  var key = __TMDB_KEY__ || null;
  if (!key) return null;
  var q = String(titulo || '').replace(/\(\d{4}\)/g, '').trim();
  if (!q) return null;
  try {
    var isTv = /serie|anime|tv/i.test(String(tipoHint || ''));
    var path = isTv ? 'search/tv' : 'search/movie';
    var url = 'https://api.themoviedb.org/3/' + path +
      '?api_key=' + encodeURIComponent(key) +
      '&language=es-ES&query=' + encodeURIComponent(q);
    var res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    var data = await res.json();
    var results = data.results || [];
    if (!results.length && !isTv) {
      // reintentar como TV
      url = 'https://api.themoviedb.org/3/search/tv?api_key=' + encodeURIComponent(key) +
        '&language=es-ES&query=' + encodeURIComponent(q);
      res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (res.ok) {
        data = await res.json();
        results = data.results || [];
        isTv = true;
      }
    }
    if (!results.length) return null;
    var best = results[0];
    var title = best.title || best.name || q;
    var overview = best.overview || null;
    var poster = best.poster_path ? imgTmdb(best.poster_path, 'w500') : null;
    var backdrop = best.backdrop_path ? imgTmdb(best.backdrop_path, 'w780') : null;
    var release = best.release_date || best.first_air_date || null;
    // géneros por id (mapa básico)
    var GENRE_MAP = {
      28: 'Acción', 12: 'Aventura', 16: 'Animación', 35: 'Comedia', 80: 'Crimen',
      99: 'Documental', 18: 'Drama', 10751: 'Familia', 14: 'Fantasía', 36: 'Historia',
      27: 'Terror', 10402: 'Música', 9648: 'Misterio', 10749: 'Romance', 878: 'Ciencia ficción',
      10770: 'Película de TV', 53: 'Suspenso', 10752: 'Bélica', 37: 'Western',
      10759: 'Action & Adventure', 10765: 'Sci-Fi & Fantasy'
    };
    var gens = (best.genre_ids || []).map(function (id) { return GENRE_MAP[id] || null; }).filter(Boolean);
    return {
      tmdb_id: best.id || null,
      imdb_id: null,
      titulo_tmdb: title,
      portada_tmdb: poster,
      backdrop: backdrop,
      calificacion: best.vote_average != null ? Number(best.vote_average) : null,
      descripcion: overview,
      generos: gens,
      fecha_estreno: release,
      year: release ? String(release).slice(0, 4) : null,
      titulo_original: best.original_title || best.original_name || null,
      votos: best.vote_count || null,
      duracion: null,
      status: null,
      tagline: null,
      slug_tmdb: null
    };
  } catch (e) {
    return null;
  }
}

var __TMDB_KEY__ = null; // se asigna en handleRequest desde env

/** Busca meta para un título: tvymas → TMDB API → OMDb */
async function metaTmdbParaTitulo(titulo, tipoHint) {
  var variantes = variantesTitulo(titulo);
  if (!variantes.length) return null;

  // 1) tvymas (varias queries)
  for (var v = 0; v < variantes.length; v++) {
    try {
      var metas = await buscarMetaTmdb(variantes[v]);
      var best = elegirMejorMeta(metas, titulo);
      if (best) return mapMetaFromSearchItem(best);
    } catch (e) { /* next */ }
  }

  // 2) TMDB oficial (si hay API key)
  for (var t = 0; t < Math.min(variantes.length, 3); t++) {
    try {
      var mTmdb = await buscarMetaTmdbApi(variantes[t], tipoHint);
      if (mTmdb && (mTmdb.descripcion || mTmdb.portada_tmdb || mTmdb.calificacion)) return mTmdb;
    } catch (e) { /* next */ }
  }

  // OMDb desactivado por defecto: datos en inglés y posters de Amazon que no cargan.
  // Usar solo TMDB (tvymas o API key) + scrape de la página fuente.

  return null;
}

/**
 * Enriquece CADA ítem de la lista (no solo los que coinciden con una query).
 * Concurrencia limitada para no saturar el worker de meta.
 */
async function enriquecerListaConTmdb(lista, query) {
  if (!lista || !lista.length) return lista;

  var CONCURRENCY = 5;
  var i = 0;

  async function worker() {
    while (i < lista.length) {
      var idx = i++;
      var item = lista[idx];
      if (!item || !item.titulo) continue;
      // Si ya tiene tmdb_id y descripcion, no repetir
      if (item.tmdb_id && item.descripcion && item.genero) continue;
      try {
        var meta = await metaTmdbParaTitulo(item.titulo, item.tipo);
        if (meta) aplicarMetaAResultadoBusqueda(item, meta);
      } catch (e) { /* siguiente */ }
    }
  }

  var jobs = [];
  for (var c = 0; c < Math.min(CONCURRENCY, lista.length); c++) {
    jobs.push(worker());
  }
  await Promise.all(jobs);
  return lista;
}

async function enriquecerDetalleConTmdb(detalle, tipoRuta) {
  if (!detalle || detalle.success === false) return detalle;
  var titulo = detalle.titulo || detalle.title || '';
  var slug = detalle.slug || '';
  var metaFull = null;
  try {
    metaFull = await fetchDetalleTmdbMeta(titulo || slug, tipoRuta || detalle.tipo);
  } catch (e) {
    return detalle;
  }
  if (!metaFull) return detalle;

  // Normalizar a meta limpia
  var meta = mapMetaFromSearchItem(metaFull);
  // fetchDetalle puede traer más campos
  if (metaFull.backdrop) meta.backdrop = metaFull.backdrop;
  if (metaFull.original_title) meta.titulo_original = metaFull.original_title;
  if (metaFull.votes) meta.votos = metaFull.votes;
  if (metaFull.runtime) meta.duracion = metaFull.runtime;
  if (metaFull.status) meta.status = metaFull.status;
  if (metaFull.tagline) meta.tagline = metaFull.tagline;
  if (metaFull.imdb_id) meta.imdb_id = metaFull.imdb_id;
  if (metaFull.overview_tmdb || metaFull.tmdb_overview) {
    meta.descripcion = metaFull.overview_tmdb || metaFull.tmdb_overview || meta.descripcion;
  }
  if (metaFull.genres_tmdb || metaFull.genres) {
    meta.generos = metaFull.genres_tmdb || metaFull.genres || meta.generos;
  }
  if (metaFull.poster_tmdb || metaFull.tmdb_poster) {
    meta.portada_tmdb = metaFull.poster_tmdb || metaFull.tmdb_poster || meta.portada_tmdb;
  }
  if (metaFull.rating || metaFull.tmdb_rating) {
    meta.calificacion = Number(metaFull.rating || metaFull.tmdb_rating);
  }
  if (metaFull.release_date || metaFull.tmdb_release_date) {
    meta.fecha_estreno = metaFull.release_date || metaFull.tmdb_release_date;
  }

  // No pisar datos buenos ya extraídos de la página fuente
  var descFuente = detalle.descripcion || '';
  var descFuenteOk = descFuente.length > 60 && !/\.\.\.\s*$/.test(descFuente);
  var portadaFuenteOk = detalle.portada && /pelisplushd|tmdb\.org|lamovie/i.test(detalle.portada);

  if (descFuenteOk) meta.descripcion = null; // conservar scrape
  if (portadaFuenteOk) meta.portada_tmdb = null;
  if (detalle.genero) meta.generos = null;

  aplicarMetaAResultadoBusqueda(detalle, meta);

  // Temporadas TMDB (solo meta; no pisa embeds)
  if (Array.isArray(metaFull.temporadas) && metaFull.temporadas.length) {
    // Solo meta (nombres/stills). NO mezclar con temporadas de la fuente (evita T1 duplicada / T2 fantasma)
    detalle.temporadas_tmdb = metaFull.temporadas;
    // total_temporadas: preferir lo que ya trajo la fuente (animeav1, etc.)
    // Contar temporadas de fuente + extras TMDB no duplicadas
    var nSrc = Array.isArray(detalle.temporadas) ? detalle.temporadas.length : 0;
    var nTmdb = metaFull.temporadas.length;
    detalle.total_temporadas = Math.max(nSrc || 0, nTmdb || 0, detalle.total_temporadas || 0) || nSrc || nTmdb || 1;
    // Solo rellenar lista de reproducción si la fuente no trajo ninguna
    if (!detalle.temporadas || !detalle.temporadas.length) {
      detalle.temporadas = metaFull.temporadas.map(function (t) {
        return t.season_number || t.temporada || t;
      }).filter(Boolean);
    }
  }

  // Limpiar aliases redundantes si alguien los había puesto antes
  delete detalle.tmdb_overview;
  delete detalle.overview_tmdb;
  delete detalle.description;
  delete detalle.tmdb_genres;
  delete detalle.genres_tmdb;
  delete detalle.genres;
  delete detalle.tmdb_poster;
  delete detalle.poster_tmdb;
  delete detalle.tmdb_rating;
  delete detalle.rating;
  delete detalle.tmdb_release_date;
  delete detalle.release_date;
  delete detalle.tmdb_title;
  delete detalle.original_title;
  delete detalle.image;

  return detalle;
}

async function buscarUniversal(query, sourceFilter, limit) {
  sourceFilter = (sourceFilter || 'all').toLowerCase();
  limit = limit || 15;
  var q = String(query || '').trim();
  if (!q) throw new Error('Falta el termino de busqueda');

  var promesas = [];
  if (sourceFilter === 'all' || sourceFilter === 'lamovie') {
    promesas.push(buscarLamovie(q, limit).catch(function () { return []; }));
  }
  if (sourceFilter === 'all' || sourceFilter === 'hackstore') {
    promesas.push(buscarHackstore(q, limit).catch(function () { return []; }));
  }
  if (sourceFilter === 'all' || sourceFilter === 'pelisplushd') {
    promesas.push(buscarPelisplus(q, limit).catch(function () { return []; }));
  }
  if (sourceFilter === 'all' || sourceFilter === 'animeav1' || sourceFilter === '4') {
    promesas.push(buscarAnimeAv1(q, limit).catch(function () { return []; }));
  }

  var arrays = await Promise.all(promesas);
  var todos = [];
  for (var i = 0; i < arrays.length; i++) todos = todos.concat(arrays[i]);

  var vistos = {};
  var unicos = [];
  for (var j = 0; j < todos.length; j++) {
    var key = (todos[j].titulo || '').toLowerCase().replace(/[^a-z0-9]/g, '') + '|' + (todos[j].fuente || '');
    if (!key || vistos[key]) continue;
    vistos[key] = true;
    unicos.push(todos[j]);
  }

  return {
    success: true,
    query: q,
    total: unicos.length,
    resultados: unicos.slice(0, limit * 2)
  };
}

async function buscarLamovie(query, limit) {
  var url = LAMOVIE_API + '/search?postType=any&q=' + encodeURIComponent(query) + '&postsPerPage=' + (limit || 15);
  var res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
      'Accept': 'application/json'
    }
  });
  if (!res.ok) return [];
  var data = await res.json();
  var posts = (data && data.data && data.data.posts) ? data.data.posts : [];
  if (!Array.isArray(posts)) return [];

  var out = [];
  for (var i = 0; i < posts.length; i++) {
    var p = posts[i];
    var tipo = 'Pelicula';
    var path = 'peliculas';
    if (p.type === 'tvshows') { tipo = 'Serie'; path = 'series'; }
    if (p.type === 'animes') { tipo = 'Anime'; path = 'animes'; }

    var portada = '';
    if (p.images && p.images.poster) {
      portada = p.images.poster.indexOf('http') === 0
        ? p.images.poster
        : 'https://lamovie.org/wp-content/uploads' + p.images.poster;
    }

    out.push({
      titulo: p.title || '',
      tipo: tipo,
      fuente: 'lamovie',
      postId: p._id,
      slug: p.slug || '',
      link: LAMOVIE_BASE + '/' + path + '/' + (p.slug || '') + '/',
      portada: portada,
      year: p.release_date ? String(p.release_date).slice(0, 4) : null,
      calificacion: p.rating || p.imdb_rating || null
    });
  }
  return out;
}

/** Query limpia para buscadores: sin acentos raros, sin ":", sin mojibake */
function normalizarQueryBusqueda(q) {
  var s = limpiarTexto(String(q || ''));
  // Quitar mojibake residual y normalizar Unicode
  try {
    s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  } catch (e) { /* ok */ }
  // "CÃ³digo" → "Codigo" si aún queda
  s = s.replace(/CAdigo|CÃ³digo|CÃ\x93digo/gi, 'Codigo');
  s = s.replace(/[:;|/\\]+/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

/** Título legible desde slug: codigo-venganza → Código Venganza (aprox.) */
function tituloDesdeSlug(slug) {
  var t = String(slug || '')
    .replace(/-\d{4}$/, '')
    .replace(/-+/g, ' ')
    .trim();
  // Capitalizar palabras
  t = t.replace(/\b([a-z])/g, function (c) { return c.toUpperCase(); });
  return limpiarTitulo(t);
}

async function buscarHackstore(query, limit) {
  var q = normalizarQueryBusqueda(query);
  if (!q) return [];
  var url = HACKSTORE_BASE + '/?s=' + encodeURIComponent(q);
  var res = await fetch(url, {
    headers: Object.assign({}, HEADERS, { 'Referer': HACKSTORE_BASE + '/' })
  });
  if (!res.ok) return [];
  var html = await res.text();
  html = html.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');
  var out = [];
  var vistos = {};
  var regex = /href=["'](https?:\/\/(?:www\.)?hackstore\.[a-z]+\/(peliculas|series|animes)\/([^"'\/\?]+))\/?["']/gi;
  var m;
  while ((m = regex.exec(html)) !== null && out.length < (limit || 15)) {
    var link = m[1].replace(/\/$/, '') + '/';
    var seccion = m[2];
    var slug = m[3];
    if (vistos[link]) continue;
    if (PALABRAS_BLOQUEADAS_BUSQUEDA.some(function (w) { return slug.indexOf(w) !== -1; })) continue;
    vistos[link] = true;
    var tipo = 'Pelicula';
    if (seccion === 'series') tipo = 'Serie';
    if (seccion === 'animes') tipo = 'Anime';

    // Portada: data-src de lazyload cerca del enlace
    var portada = null;
    var pos = m.index;
    var chunk = html.slice(Math.max(0, pos - 80), pos + 900);
    var imgM = chunk.match(/data-src=["'](https?:\/\/[^"']+)["']/i)
      || chunk.match(/data-lazy-src=["'](https?:\/\/[^"']+)["']/i)
      || chunk.match(/src=["'](https?:\/\/image\.tmdb\.org\/[^"']+)["']/i);
    if (imgM && !/data:image|svg\+xml|lazyload\.min/i.test(imgM[1])) {
      portada = imgM[1].replace('/w300/', '/w500/');
    }

    // Año desde slug
    var year = null;
    var ym = slug.match(/-(\d{4})$/);
    if (ym) year = ym[1];

    out.push({
      titulo: tituloDesdeSlug(slug),
      tipo: tipo,
      fuente: 'hackstore',
      link: link,
      slug: slug,
      portada: portada,
      year: year
    });
  }
  return out;
}

async function buscarPelisplus(query, limit) {
  // Variantes: con y sin acentos, sin ":"
  var variantes = [];
  var q0 = limpiarTexto(String(query || ''));
  var q1 = normalizarQueryBusqueda(query);
  if (q0) variantes.push(q0);
  if (q1 && variantes.indexOf(q1) === -1) variantes.push(q1);
  // Sin dos puntos / caracteres especiales
  var q2 = q1.replace(/[^\w\s\-]/g, ' ').replace(/\s+/g, ' ').trim();
  if (q2 && variantes.indexOf(q2) === -1) variantes.push(q2);
  // Primera palabra + última si hay muchas (Código Venganza → Codigo Venganza)
  if (variantes.length === 0) return [];

  var out = [];
  var vistos = {};
  var limitN = limit || 15;

  for (var vi = 0; vi < variantes.length && out.length < limitN; vi++) {
    var q = variantes[vi];
    if (!q) continue;
    try {
      var url = PELISPLUS_BASE + '/search?s=' + encodeURIComponent(q);
      var res = await fetch(url, {
        headers: Object.assign({}, HEADERS, {
          'Referer': PELISPLUS_BASE + '/',
          'Accept-Language': 'es-ES,es;q=0.9'
        })
      });
      if (!res.ok) continue;
      var html = await res.text();

      // Links pelicula/serie/anime
      var regex = /href=["']((?:https?:\/\/[^"']+)?\/(?:pelicula|serie|anime)\/([^"'\/\?]+))\/?["']/gi;
      var m;
      while ((m = regex.exec(html)) !== null && out.length < limitN) {
        var path = m[1];
        var slug = decodeURIComponent(m[2] || '');
        // Arreglar slugs rotos tipo c-digo-traje-rojo → codigo-...
        slug = slug.replace(/\bc-digo\b/gi, 'codigo').replace(/\bc-\s*digo\b/gi, 'codigo');
        var full = path.indexOf('http') === 0 ? path : PELISPLUS_BASE + path;
        full = full.replace(/\/$/, '') + '/';
        if (vistos[full]) continue;
        if (PALABRAS_BLOQUEADAS_BUSQUEDA.some(function (w) { return slug.indexOf(w) !== -1; })) continue;
        vistos[full] = true;
        var tipo = 'Pelicula';
        if (/\/serie\//i.test(full)) tipo = 'Serie';
        if (/\/anime\//i.test(full)) tipo = 'Anime';

        // Portada desde /poster/slug-thumb.jpg cerca del link
        var portada = null;
        var chunk = html.slice(Math.max(0, m.index - 200), m.index + 500);
        var pm = chunk.match(/(?:src|data-src)=["'](\/?poster\/[^"']+)["']/i)
          || chunk.match(/(?:src|data-src)=["'](https?:\/\/[^"']*\/poster\/[^"']+)["']/i);
        if (pm) {
          portada = pm[1].indexOf('http') === 0 ? pm[1] : PELISPLUS_BASE + (pm[1].charAt(0) === '/' ? pm[1] : '/' + pm[1]);
          // Preferir poster completo sin -thumb si existe patrón
          portada = portada.replace(/-thumb\.(jpg|png|webp)/i, '.$1');
        }
        if (!portada) {
          portada = PELISPLUS_BASE + '/poster/' + slug + '.jpg';
        }

        var titulo = tituloDesdeSlug(slug);
        // Título visible en el HTML (alt o texto)
        var tm = chunk.match(/alt=["']([^"']{3,80})["']/i)
          || chunk.match(/title=["']([^"']{3,80})["']/i);
        if (tm) titulo = limpiarTitulo(limpiarTexto(tm[1]));

        out.push({
          titulo: titulo,
          tipo: tipo,
          fuente: 'pelisplushd',
          link: full,
          slug: slug,
          portada: portada
        });
      }
    } catch (e) { /* next variante */ }
  }
  return out;
}

// ======================================================
// LAMOVIE
// ======================================================
function extraerSlugLamovie(pageUrl) {
  var m = pageUrl.match(/\/(?:peliculas|series|animes|pelicula|serie|anime)\/([^\/\?]+)/i);
  return m ? m[1].replace(/\/$/, '') : null;
}

function slugAQuery(slug) {
  return String(slug || '').replace(/-\d{4}$/, '').replace(/-/g, ' ').trim();
}

async function buscarPostIdPorSlug(slug) {
  var query = slugAQuery(slug) || slug;
  var url = LAMOVIE_API + '/search?postType=any&q=' + encodeURIComponent(query) + '&postsPerPage=10';
  var res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
      'Accept': 'application/json'
    }
  });
  if (!res.ok) return null;
  var data = await res.json();
  var posts = [];
  if (data && data.data && data.data.posts) posts = data.data.posts;
  else if (data && data.data && Array.isArray(data.data)) posts = data.data;
  if (!Array.isArray(posts) || posts.length === 0) return null;

  for (var i = 0; i < posts.length; i++) {
    if (posts[i].slug === slug) return { postId: posts[i]._id, post: posts[i] };
  }
  for (var j = 0; j < posts.length; j++) {
    if (posts[j].slug && (posts[j].slug.indexOf(slug) !== -1 || slug.indexOf(posts[j].slug) !== -1)) {
      return { postId: posts[j]._id, post: posts[j] };
    }
  }
  return { postId: posts[0]._id, post: posts[0] };
}

async function getPlayerLamovie(postId) {
  var url = LAMOVIE_API + '/player?postId=' + postId + '&demo=0';
  var res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
      'Accept': 'application/json',
      'Referer': LAMOVIE_BASE + '/'
    }
  });
  if (!res.ok) throw new Error('HTTP ' + res.status + ' en /player');

  var data = await res.json();
  var embedsRaw = (data && data.data && data.data.embeds) ? data.data.embeds : [];
  var downloadsRaw = (data && data.data && data.data.downloads) ? data.data.downloads : [];

  if ((!embedsRaw || embedsRaw.length === 0) && data && data.data) {
    var d = data.data;
    embedsRaw = [].concat(d.players || [], d.servers || [], d.sources || [], d.links || []);
  }

  var embeds = [];
  var downloads = [];
  var vistos = {};

  for (var i = 0; i < embedsRaw.length; i++) {
    var e = embedsRaw[i];
    var u = typeof e === 'string' ? e : (e.url || e.link || e.src || null);
    if (!u || vistos[u]) continue;
    if (!esReproductorValido(u)) continue;
    vistos[u] = true;
    embeds.push({
      url: u,
      idioma: (e && (e.lang || e.language || e.idioma)) || 'Desconocido',
      servidor: (e && e.server) || extraerServidor(u),
      calidad: (e && (e.quality || e.calidad)) || null,
      tipo: 'reproductor'
    });
  }

  for (var j = 0; j < downloadsRaw.length; j++) {
    var dl = downloadsRaw[j];
    var du = typeof dl === 'string' ? dl : (dl.url || dl.link || dl.href || null);
    if (!du || vistos[du]) continue;
    if (!esDescargaValida(du)) continue;
    vistos[du] = true;
    downloads.push({
      url: du,
      servidor: (dl && dl.server) || extraerServidor(du),
      calidad: (dl && (dl.quality || dl.calidad)) || null,
      size: (dl && dl.size) || null,
      tipo: 'descarga'
    });
  }

  embeds.sort(function (a, b) {
    var aV = a.url.toLowerCase().indexOf('vimeos') !== -1 ? 1 : 0;
    var bV = b.url.toLowerCase().indexOf('vimeos') !== -1 ? 1 : 0;
    return bV - aV;
  });

  return { embeds: embeds, downloads: downloads };
}

async function getEpisodesLamovie(serieId, season) {
  season = season || 1;
  var url = LAMOVIE_API + '/single/episodes/list?_id=' + encodeURIComponent(serieId) +
    '&season=' + season + '&page=1&postsPerPage=50';
  var res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
      'Accept': 'application/json',
      'Referer': LAMOVIE_BASE + '/'
    }
  });
  if (!res.ok) return { posts: [], seasons: [] };
  var data = await res.json();
  var d = (data && data.data) ? data.data : {};
  var posts = Array.isArray(d.posts) ? d.posts : [];
  var seasons = Array.isArray(d.seasons)
    ? d.seasons.map(function (s) { return parseInt(s, 10); }).filter(function (n) { return !isNaN(n); })
    : [];
  return { posts: posts, seasons: seasons };
}

async function scrapearLamovie(pageUrl, opts) {
  opts = opts || {};
  var incluirPlayers = !!opts.players;
  var maxCaps = opts.maxCaps || 5;
  var seasonOnly = opts.season ? parseInt(opts.season, 10) : null;
  var episodeOnly = opts.episode ? parseInt(opts.episode, 10) : null;

  var slug = extraerSlugLamovie(pageUrl);
  if (!slug) throw new Error('No se pudo extraer el slug de la URL de Lamovie');

  var encontrado = await buscarPostIdPorSlug(slug);
  if (!encontrado || !encontrado.postId) {
    throw new Error('No se encontro postId para el slug: ' + slug);
  }

  var postId = encontrado.postId;
  var post = encontrado.post || {};

  var tipo = 'Pelicula';
  if (post.type === 'tvshows' || /\/series\//i.test(pageUrl)) tipo = 'Serie';
  if (post.type === 'animes' || /\/animes\//i.test(pageUrl)) tipo = 'Anime';

  var titulo = post.title || 'Sin titulo';
  var portada = '';
  if (post.images && post.images.poster) {
    portada = post.images.poster.indexOf('http') === 0
      ? post.images.poster
      : 'https://lamovie.org/wp-content/uploads' + post.images.poster;
  }
  var descripcion = post.overview || '';
  var year = post.release_date ? String(post.release_date).slice(0, 4) : null;
  var calificacion = post.rating || post.imdb_rating || null;

  var workerOrigin = '';
  try {
    if (opts.requestUrl) workerOrigin = new URL(opts.requestUrl).origin;
  } catch (e) { /* ignore */ }

  // PELÍCULA
  if (tipo === 'Pelicula') {
    var playerData = await getPlayerLamovie(postId);
    return {
      success: true,
      fuente: 'lamovie',
      tipo: tipo,
      link: pageUrl,
      postId: postId,
      titulo: titulo,
      portada: portada,
      descripcion: descripcion,
      year: year,
      calificacion: calificacion,
      total: playerData.embeds.length,
      embeds: playerData.embeds.map(function (e) { return e.url; }),
      reproductores: playerData.embeds,
      descargas: playerData.downloads,
      temporadas: []
    };
  }

  // EPISODIO CONCRETO: ?url=SERIE&season=1&episode=1
  if (seasonOnly && episodeOnly) {
    var epList = await getEpisodesLamovie(postId, seasonOnly);
    var postsEps = epList.posts || [];
    var targetEp = null;
    for (var i = 0; i < postsEps.length; i++) {
      var n = postsEps[i].episode_number || (i + 1);
      if (parseInt(n, 10) === episodeOnly) {
        targetEp = postsEps[i];
        break;
      }
    }
    if (!targetEp) {
      throw new Error('No se encontro el episodio ' + seasonOnly + 'x' + episodeOnly);
    }
    var epId = targetEp._id || targetEp.id;
    var pd = await getPlayerLamovie(epId);
    var epTitulo = targetEp.title || (titulo + ': Temporada ' + seasonOnly + ' Episodio ' + episodeOnly);
    return {
      success: true,
      fuente: 'lamovie',
      tipo: 'Capitulo',
      link: pageUrl,
      postId: epId,
      serie_postId: postId,
      serie_titulo: titulo,
      titulo: epTitulo,
      portada: portada,
      temporada: seasonOnly,
      episodio: episodeOnly,
      overview: targetEp.overview || '',
      still: targetEp.still_path
        ? (String(targetEp.still_path).indexOf('http') === 0
            ? targetEp.still_path
            : 'https://image.tmdb.org/t/p/w300' + targetEp.still_path)
        : null,
      total: pd.embeds.length,
      embeds: pd.embeds.map(function (e) { return e.url; }),
      reproductores: pd.embeds,
      descargas: pd.downloads
    };
  }

  // SERIE / ANIME (listado)
  var first = await getEpisodesLamovie(postId, 1);
  var seasonNums = first.seasons && first.seasons.length ? first.seasons.slice() : [1];
  if (seasonOnly) seasonNums = [seasonOnly];

  var temporadas = [];
  var totalEps = 0;
  var resolvedPlayers = 0;

  for (var si = 0; si < seasonNums.length; si++) {
    var seasonNum = seasonNums[si];
    var epData = (seasonNum === 1 && !seasonOnly) ? first : await getEpisodesLamovie(postId, seasonNum);
    var postsList = epData.posts || [];

    if (epData.seasons && epData.seasons.length && !seasonOnly) {
      for (var sx = 0; sx < epData.seasons.length; sx++) {
        var sn = parseInt(epData.seasons[sx], 10);
        if (!isNaN(sn) && seasonNums.indexOf(sn) === -1) seasonNums.push(sn);
      }
    }

    var episodios = [];
    for (var ei = 0; ei < postsList.length; ei++) {
      var ep = postsList[ei];
      var epId2 = ep._id || ep.id;
      var epNum = ep.episode_number || (ei + 1);
      var epSeason = ep.season_number || seasonNum;

      var epLink = pageUrl.replace(/\/$/, '') + '/';
      if (workerOrigin) {
        epLink = workerOrigin + '/?url=' + encodeURIComponent(pageUrl) +
          '&season=' + epSeason + '&episode=' + epNum;
      }

      var epObj = {
        postId: epId2,
        temporada: epSeason,
        episodio: epNum,
        titulo: ep.title || ('Episodio ' + epNum),
        slug: ep.slug || null,
        overview: ep.overview || '',
        runtime: ep.runtime || null,
        still: ep.still_path
          ? (String(ep.still_path).indexOf('http') === 0
              ? ep.still_path
              : 'https://image.tmdb.org/t/p/w300' + ep.still_path)
          : null,
        link: epLink,
        url: epLink,
        episodePostId: epId2,
        reproductor: null,
        embeds: [],
        reproductores: [],
        descargas: []
      };

      if (incluirPlayers && epId2 && resolvedPlayers < maxCaps) {
        try {
          var pd2 = await getPlayerLamovie(epId2);
          epObj.reproductores = pd2.embeds || [];
          epObj.embeds = (pd2.embeds || []).map(function (e) { return e.url; });
          epObj.reproductor = epObj.embeds[0] || null;
          epObj.descargas = pd2.downloads || [];
          resolvedPlayers++;
        } catch (e) { /* ignore */ }
      }

      episodios.push(epObj);
      totalEps++;
    }

    temporadas.push({
      temporada: seasonNum,
      total_episodios: episodios.length,
      episodios: episodios
    });
  }

  return {
    success: true,
    fuente: 'lamovie',
    tipo: tipo,
    link: pageUrl,
    postId: postId,
    titulo: titulo,
    portada: portada,
    descripcion: descripcion,
    year: year,
    calificacion: calificacion,
    total_temporadas: temporadas.length,
    total_episodios: totalEps,
    total: resolvedPlayers,
    embeds: [],
    reproductores: [],
    descargas: [],
    temporadas: temporadas,
    nota: incluirPlayers
      ? 'Players solo en los primeros ' + maxCaps + ' caps. Usa ?url=SERIE&season=N&episode=M o ?episodePostId=XXX para un capítulo.'
      : 'Usa ?url=SERIE&season=N&episode=M o el link de cada episodio para obtener los players.'
  };
}

// ======================================================
// PELISPLUSHD
// ======================================================
function extraerPlayurlsPelisplus(html) {
  var reproductores = [];
  var vistos = {};

  function add(u, idioma) {
    if (!u || vistos[u]) return;
    var ok = esReproductorValido(u) ||
      /streamwish|vidhide|voe\.|filemoon|dood|waaw|hqq|netu|uqload|mixdrop/i.test(u);
    if (!ok) return;
    vistos[u] = true;
    reproductores.push({
      url: u,
      idioma: idioma || 'Desconocido',
      servidor: extraerServidor(u),
      tipo: 'reproductor'
    });
  }

  var r1 = /data-url=["']([^"']+)["'][^>]*data-name=["']([^"']*)["']/gi;
  var m;
  while ((m = r1.exec(html)) !== null) add(m[1], m[2]);

  var r2 = /data-name=["']([^"']*)["'][^>]*data-url=["']([^"']+)["']/gi;
  while ((m = r2.exec(html)) !== null) add(m[2], m[1]);

  var r3 = /<span[^>]+lid=["']?\d+["']?[^>]+url=["']([^"']+)["'][^>]*>/gi;
  while ((m = r3.exec(html)) !== null) add(m[1], 'Desconocido');

  var r4 = /<span[^>]+url=["']([^"']+)["'][^>]+lid=["']?\d+["']?[^>]*>/gi;
  while ((m = r4.exec(html)) !== null) add(m[1], 'Desconocido');

  var r5 = /\burl=["'](https?:\/\/[^"']+)["']/gi;
  while ((m = r5.exec(html)) !== null) add(m[1], 'Desconocido');

  return reproductores;
}

async function listarPelisplusCatalogo(seccion, filtro, page, origin) {
  seccion = (seccion || 'peliculas').toLowerCase();
  filtro = (filtro || '').toLowerCase();
  page = page || 1;

  var pathCat = '/' + seccion;
  if (filtro === 'estrenos' || filtro === 'populares') {
    pathCat += '/' + filtro;
  }
  var listUrl = PELISPLUS_BASE + pathCat + (page > 1 ? '?page=' + page : '');

  var res = await fetch(listUrl, {
    headers: Object.assign({}, HEADERS, { 'Referer': PELISPLUS_BASE + '/' })
  });
  if (!res.ok) throw new Error('HTTP ' + res.status + ' en catalogo PelisPlus');
  var html = await res.text();

  var tipoItem = 'Pelicula';
  var tipoPath = 'pelicula';
  if (seccion === 'series') { tipoItem = 'Serie'; tipoPath = 'serie'; }
  if (seccion === 'animes') { tipoItem = 'Anime'; tipoPath = 'anime'; }

  var items = [];
  var vistos = {};
  var m;

  // Tarjeta completa: <a href="/pelicula/slug" ...Posters-link...>...<img src="/poster/slug.jpg"...></a>
  var reCard = /<a\b[^>]*href=["'](?:https?:\/\/[^"']+)?\/(?:pelicula|serie|anime)\/([^"'\/\?]+)\/?["'][^>]*>[\s\S]*?<\/a>/gi;
  while ((m = reCard.exec(html)) !== null) {
    var slug = m[1];
    if (!slug || vistos[slug]) continue;
    if (PALABRAS_BLOQUEADAS_BUSQUEDA.some(function (w) { return slug.indexOf(w) !== -1; })) continue;
    if (!/Posters-link|\/poster\//i.test(m[0])) continue;
    vistos[slug] = true;

    var tag = m[0];
    var titulo = '';
    var tm = tag.match(/data-title=["']([^"']+)["']/i) || tag.match(/alt=["']([^"']+)["']/i);
    if (tm) titulo = limpiarTitulo(tm[1].replace(/^VER\s+/i, '').replace(/\s+Online.*$/i, ''));
    if (!titulo) titulo = limpiarTitulo(slug.replace(/-/g, ' '));

    var portada = '';
    // Buscar src de poster DENTRO de esta tarjeta
    var imgM = tag.match(/src=["']([^"']*\/poster\/[^"'\s>]+)["']/i)
      || tag.match(/data-src=["']([^"']*\/poster\/[^"'\s>]+)["']/i)
      || tag.match(/srcset=["']([^"'\s,>]*\/poster\/[^"'\s,>]+)/i);
    if (imgM) {
      portada = imgM[1];
      if (portada.indexOf('http') !== 0) {
        portada = PELISPLUS_BASE + (portada.charAt(0) === '/' ? portada : '/' + portada);
      }
    }
    // Si el src no coincide con el slug, preferir convención /poster/{slug}.jpg
    if (!portada || portada.indexOf('/poster/' + slug + '.') === -1) {
      var bySlug = PELISPLUS_BASE + '/poster/' + slug + '.jpg';
      // Solo forzar si no había imagen, o si la imagen es de otro slug
      if (!portada) portada = bySlug;
      else if (portada.indexOf('/poster/' + slug + '.') === -1) portada = bySlug;
    }

    items.push({
      titulo: titulo,
      tipo: tipoItem,
      fuente: 'pelisplushd',
      source_id: '3',
      slug: slug,
      portada: portada,
      url_extract: origin + '/3/' + tipoPath + '/' + slug
    });
  }

  return {
    success: true,
    fuente: 'pelisplushd',
    source_id: '3',
    seccion: seccion,
    filtro: filtro || 'todas',
    page: page,
    total: items.length,
    resultados: items
  };
}

async function scrapearPelisplus(pageUrl, opts) {
  opts = opts || {};
  var maxCaps = opts.maxCaps || 5;
  var incluirPlayers = !!opts.players;
  var seasonOnly = opts.season ? parseInt(opts.season, 10) : null;
  var episodeOnly = opts.episode ? parseInt(opts.episode, 10) : null;

  var workerOrigin = '';
  try {
    if (opts.requestUrl) workerOrigin = new URL(opts.requestUrl).origin;
  } catch (e) { /* ignore */ }

  // Si piden season+episode sobre URL de serie, construir URL del capítulo
  var esSerieRoot = (/\/serie\//i.test(pageUrl) || /\/anime\//i.test(pageUrl)) &&
    !/\/temporada\/\d+\/capitulo\/\d+/i.test(pageUrl);
  if (esSerieRoot && seasonOnly && episodeOnly) {
    var slugM = pageUrl.match(/\/(?:serie|anime)\/([^\/\?]+)/i);
    var tipoPath = /\/anime\//i.test(pageUrl) ? 'anime' : 'serie';
    if (slugM) {
      pageUrl = PELISPLUS_BASE + '/' + tipoPath + '/' + slugM[1] +
        '/temporada/' + seasonOnly + '/capitulo/' + episodeOnly + '/';
    }
  }

  var res = await fetch(pageUrl, {
    headers: Object.assign({}, HEADERS, { 'Referer': PELISPLUS_BASE + '/' })
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  var html = await res.text();

  var esSerie = /\/serie\//i.test(pageUrl) || /\/anime\//i.test(pageUrl);
  var esCapitulo = /\/temporada\/\d+\/capitulo\/\d+/i.test(pageUrl);

  var metas = extraerMetas(html);
  var titulo = metas.titulo;
  var portada = metas.portada;
  var descripcion = metas.descripcion;
  var yearMeta = metas.year || null;
  var generosMeta = metas.generos || [];
  var generoMeta = metas.genero || null;
  var actoresMeta = metas.actores || [];

  // Serie raíz → listar capítulos
  if (esSerie && !esCapitulo) {
    var caps = [];
    var reCap = /href=["']((?:https?:\/\/[^"']+)?\/(?:serie|anime)\/[^"']+\/temporada\/(\d+)\/capitulo\/(\d+)\/?)["']/gi;
    var cm;
    var seen = {};
    while ((cm = reCap.exec(html)) !== null) {
      var href = cm[1];
      if (href.indexOf('http') !== 0) href = PELISPLUS_BASE + href;
      href = href.replace(/\/$/, '') + '/';
      var key = cm[2] + 'x' + cm[3];
      if (seen[key]) continue;
      seen[key] = true;

      var epSeason = parseInt(cm[2], 10);
      var epNum = parseInt(cm[3], 10);
      var epLink = href;
      if (workerOrigin) {
        // Link unificado: worker + season + episode
        epLink = workerOrigin + '/?url=' + encodeURIComponent(pageUrl) +
          '&season=' + epSeason + '&episode=' + epNum;
      }

      caps.push({
        temporada: epSeason,
        episodio: epNum,
        link: epLink,
        url: epLink,
        source_link: href,
        reproductor: null,
        embeds: [],
        reproductores: []
      });
    }

    // Filtrar por temporada si pidieron solo una
    if (seasonOnly) {
      caps = caps.filter(function (c) { return c.temporada === seasonOnly; });
    }

    var bySeason = {};
    for (var i = 0; i < caps.length; i++) {
      var s = caps[i].temporada;
      if (!bySeason[s]) bySeason[s] = [];
      bySeason[s].push(caps[i]);
    }

    var resolved = 0;
    if (incluirPlayers) {
      for (var j = 0; j < caps.length && resolved < maxCaps; j++) {
        try {
          var srcLink = caps[j].source_link || caps[j].link;
          var r2 = await fetch(srcLink, {
            headers: Object.assign({}, HEADERS, { 'Referer': PELISPLUS_BASE + '/' })
          });
          if (!r2.ok) continue;
          var h2 = await r2.text();
          var reps = extraerPlayurlsPelisplus(h2);
          caps[j].reproductores = reps;
          caps[j].embeds = reps.map(function (x) { return x.url; });
          caps[j].reproductor = reps[0] ? reps[0].url : null;
          resolved++;
        } catch (e) { /* ignore */ }
      }
    }

    var temporadas = Object.keys(bySeason).map(Number).sort(function (a, b) { return a - b; }).map(function (num) {
      return {
        temporada: num,
        total_episodios: bySeason[num].length,
        episodios: bySeason[num]
      };
    });

    return {
      success: true,
      fuente: 'pelisplushd',
      tipo: 'Serie',
      link: pageUrl,
      titulo: titulo,
      portada: portada,
      descripcion: descripcion,
      year: yearMeta,
      genero: generoMeta,
      generos: generosMeta,
      actores: actoresMeta,
      calificacion: null,
      total_temporadas: temporadas.length,
      total_episodios: caps.length,
      total: resolved,
      embeds: [],
      reproductores: [],
      descargas: [],
      temporadas: temporadas,
      nota: incluirPlayers
        ? 'Players solo en los primeros ' + maxCaps + ' caps. Usa /3/serie/slug/T/E para un capítulo.'
        : 'Usa /3/serie/slug/T/E o url_video de cada episodio para obtener los players.'
    };
  }

  // Película o capítulo
  var reproductores = extraerPlayurlsPelisplus(html);
  var descargas = extraerDescargas(html);
  var capMatch = pageUrl.match(/\/temporada\/(\d+)\/capitulo\/(\d+)/i);
  return {
    success: true,
    fuente: 'pelisplushd',
    tipo: esCapitulo ? 'Capitulo' : 'Pelicula',
    link: pageUrl,
    titulo: titulo,
    portada: portada,
    descripcion: descripcion,
    year: yearMeta,
    genero: generoMeta,
    generos: generosMeta,
    actores: actoresMeta,
    calificacion: null,
    temporada: capMatch ? parseInt(capMatch[1], 10) : null,
    episodio: capMatch ? parseInt(capMatch[2], 10) : null,
    total: reproductores.length,
    embeds: reproductores.map(function (r) { return r.url; }),
    reproductores: reproductores,
    descargas: descargas
  };
}

// ======================================================
// HACKSTORE
// ======================================================
async function resolverPlayPhp(playUrl, referer) {
  if (playUrl.indexOf('http') !== 0) {
    playUrl = HACKSTORE_BASE + (playUrl.indexOf('/') === 0 ? playUrl : '/' + playUrl);
  }
  playUrl = playUrl.replace(/&amp;/g, '&');
  var pr = await fetch(playUrl, {
    headers: Object.assign({}, HEADERS, { 'Referer': referer || HACKSTORE_BASE + '/' }),
    redirect: 'follow'
  });
  var phtml = await pr.text();
  var ifr = phtml.match(/<(?:iframe|embed)[^>]+src=["']([^"']+)["']/i);
  if (ifr && ifr[1] && esReproductorValido(ifr[1])) return ifr[1];
  var urls = phtml.match(/https?:\/\/[^\s"'<>]+/gi) || [];
  for (var u = 0; u < urls.length; u++) {
    if (esReproductorValido(urls[u])) return urls[u];
  }
  return null;
}

async function scrapearHackstoreEpisodio(pageUrl) {
  var res = await fetch(pageUrl, {
    headers: Object.assign({}, HEADERS, { 'Referer': HACKSTORE_BASE + '/' })
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  var html = await res.text();

  var reproductores = [];
  var vistos = {};

  var rePlayr = /class=["'][^"']*playr[^"']*["'][^>]*data-href=["']([^"']+)["'][^>]*data-lang=["']([^"']*)["']/gi;
  var m;
  var jobs = [];
  while ((m = rePlayr.exec(html)) !== null) {
    jobs.push({ href: m[1].replace(/&amp;/g, '&'), lang: m[2] || 'Desconocido' });
  }
  var rePlayr2 = /data-href=["']([^"']*play\.php[^"']*)["'][^>]*data-lang=["']([^"']*)["']/gi;
  while ((m = rePlayr2.exec(html)) !== null) {
    jobs.push({ href: m[1].replace(/&amp;/g, '&'), lang: m[2] || 'Desconocido' });
  }

  var seenJob = {};
  var uniqueJobs = [];
  for (var j = 0; j < jobs.length; j++) {
    if (seenJob[jobs[j].href]) continue;
    seenJob[jobs[j].href] = true;
    uniqueJobs.push(jobs[j]);
  }

  for (var i = 0; i < Math.min(uniqueJobs.length, 8); i++) {
    try {
      var src = await resolverPlayPhp(uniqueJobs[i].href, pageUrl);
      if (src && !vistos[src]) {
        vistos[src] = true;
        reproductores.push({
          url: src,
          idioma: uniqueJobs[i].lang,
          servidor: extraerServidor(src),
          tipo: 'reproductor'
        });
      }
    } catch (e) { /* ignore */ }
  }

  var metas = extraerMetas(html);
  var descargas = extraerDescargas(html);

  return {
    success: true,
    fuente: 'hackstore',
    tipo: 'Capitulo',
    link: pageUrl,
    titulo: limpiarTitulo(metas.titulo),
    portada: extraerPortadaHackstore(html) || normalizarPortadaUrl(metas.portada) || metas.portada,
    descripcion: limpiarTexto(metas.descripcion),
    total: reproductores.length,
    embeds: reproductores.map(function (r) { return r.url; }),
    reproductores: reproductores,
    descargas: descargas
  };
}

async function scrapearHackstore(pageUrl, opts) {
  opts = opts || {};
  var maxCaps = opts.maxCaps || 5;
  var incluirPlayers = !!opts.players;
  var seasonOnly = opts.season ? parseInt(opts.season, 10) : null;
  var episodeOnly = opts.episode ? parseInt(opts.episode, 10) : null;

  var workerOrigin = '';
  try {
    if (opts.requestUrl) workerOrigin = new URL(opts.requestUrl).origin;
  } catch (e) { /* ignore */ }

  // Episodio directo por URL
  if (/\/episodio\//i.test(pageUrl)) {
    return scrapearHackstoreEpisodio(pageUrl);
  }

  var res = await fetch(pageUrl, {
    headers: Object.assign({}, HEADERS, { 'Referer': HACKSTORE_BASE + '/' })
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  var html = await res.text();

  var esSerie = /\/series\//i.test(pageUrl) || /\/animes\//i.test(pageUrl);

  if (esSerie) {
    var caps = [];
    var seen = {};
    var reEp = /href=["'](https?:\/\/(?:www\.)?hackstore\.[a-z]+\/episodio\/([^"'\/\?]+))\/?["']/gi;
    var em;
    while ((em = reEp.exec(html)) !== null) {
      var link = em[1].replace(/\/$/, '') + '/';
      var slug = em[2];
      if (seen[link]) continue;
      seen[link] = true;
      var sx = slug.match(/(\d+)x(\d+)/i);
      var epSeason = sx ? parseInt(sx[1], 10) : 1;
      var epNum = sx ? parseInt(sx[2], 10) : caps.length + 1;

      var epLink = link;
      if (workerOrigin) {
        epLink = workerOrigin + '/?url=' + encodeURIComponent(pageUrl) +
          '&season=' + epSeason + '&episode=' + epNum;
      }

      caps.push({
        temporada: epSeason,
        episodio: epNum,
        link: epLink,
        url: epLink,
        source_link: link,
        slug: slug,
        reproductor: null,
        embeds: [],
        reproductores: []
      });
    }

    // Filtrar por temporada si pidieron
    if (seasonOnly) {
      caps = caps.filter(function (c) { return c.temporada === seasonOnly; });
    }

    // Episodio concreto: ?url=SERIE&season=1&episode=1
    if (seasonOnly && episodeOnly) {
      var target = null;
      for (var ti = 0; ti < caps.length; ti++) {
        if (caps[ti].temporada === seasonOnly && caps[ti].episodio === episodeOnly) {
          target = caps[ti];
          break;
        }
      }
      if (!target) {
        throw new Error('No se encontro el episodio ' + seasonOnly + 'x' + episodeOnly);
      }
      return scrapearHackstoreEpisodio(target.source_link || target.link);
    }

    if (incluirPlayers) {
      for (var i = 0; i < Math.min(caps.length, maxCaps); i++) {
        try {
          var epData = await scrapearHackstoreEpisodio(caps[i].source_link || caps[i].link);
          caps[i].reproductores = epData.reproductores || [];
          caps[i].embeds = epData.embeds || [];
          caps[i].reproductor = caps[i].embeds[0] || null;
        } catch (e) { /* ignore */ }
      }
    }

    var bySeason = {};
    for (var k = 0; k < caps.length; k++) {
      var s = caps[k].temporada;
      if (!bySeason[s]) bySeason[s] = [];
      bySeason[s].push(caps[k]);
    }
    var temporadas = Object.keys(bySeason).map(Number).sort(function (a, b) { return a - b; }).map(function (num) {
      return { temporada: num, total_episodios: bySeason[num].length, episodios: bySeason[num] };
    });

    var metas = extraerMetas(html);
    var portadaHs = extraerPortadaHackstore(html) || normalizarPortadaUrl(metas.portada) || metas.portada;
    var yearHs = null;
    var ym = (metas.titulo || pageUrl).match(/\((\d{4})\)/) || pageUrl.match(/-(\d{4})\/?$/);
    if (ym) yearHs = ym[1];

    return {
      success: true,
      fuente: 'hackstore',
      tipo: 'Serie',
      link: pageUrl,
      titulo: limpiarTitulo(metas.titulo),
      portada: portadaHs,
      descripcion: limpiarTexto(metas.descripcion),
      year: yearHs,
      calificacion: null,
      total_temporadas: temporadas.length,
      total_episodios: caps.length,
      total: caps.filter(function (c) { return c.reproductor; }).length,
      embeds: [],
      reproductores: [],
      descargas: [],
      temporadas: temporadas,
      nota: incluirPlayers
        ? 'Players solo en los primeros ' + maxCaps + ' caps. Usa /2/serie/slug/T/E para un capítulo.'
        : 'Usa /2/serie/slug/T/E o url_video de cada episodio para obtener los players.'
    };
  }

  // Película
  var reproductores = [];
  var descargas = [];
  var vistos = {};

  var playMatches = html.match(/(?:https?:\/\/[^"'<>\s]*)?\/play\.php\?[^"'<>\s]+/gi) || [];
  var dataHref = html.match(/data-href=["']([^"']*play\.php[^"']*)["']/gi) || [];
  for (var d = 0; d < dataHref.length; d++) {
    var hm = dataHref[d].match(/data-href=["']([^"']+)["']/i);
    if (hm) playMatches.push(hm[1]);
  }

  for (var j = 0; j < Math.min(8, playMatches.length); j++) {
    try {
      var src = await resolverPlayPhp(playMatches[j], pageUrl);
      if (src && !vistos[src] && esReproductorValido(src)) {
        vistos[src] = true;
        reproductores.push({ url: src, idioma: 'Desconocido', servidor: extraerServidor(src), tipo: 'reproductor' });
      }
    } catch (e) { /* ignore */ }
  }

  var metasP = extraerMetas(html);
  descargas = extraerDescargas(html);
  var portadaPel = extraerPortadaHackstore(html) || normalizarPortadaUrl(metasP.portada) || metasP.portada;
  var yearPel = null;
  var ymP = (metasP.titulo || pageUrl).match(/\((\d{4})\)/) || pageUrl.match(/-(\d{4})\/?$/);
  if (ymP) yearPel = ymP[1];

  return {
    success: true,
    fuente: 'hackstore',
    tipo: 'Pelicula',
    link: pageUrl,
    titulo: limpiarTitulo(metasP.titulo),
    portada: portadaPel,
    descripcion: limpiarTexto(metasP.descripcion),
    year: yearPel,
    calificacion: null,
    total: reproductores.length,
    embeds: reproductores.map(function (r) { return r.url; }),
    reproductores: reproductores,
    descargas: descargas
  };
}


// ======================================================
// ANIMEAV1 (https://animeav1.com) — SvelteKit __data.json
// source_id = 4
// ======================================================

async function fetchAnimeAv1Data(pathAndQuery) {
  var p = String(pathAndQuery || '');
  if (p.charAt(0) !== '/') p = '/' + p;
  var url = ANIMEAV1_BASE + p;
  if (url.indexOf('__data.json') === -1) {
    // /catalogo/__data.json?search=x  vs  /media/slug/1/__data.json
    if (url.indexOf('?') !== -1) {
      url = url.replace('?', '/__data.json?');
      url = url.replace('/__data.json/__data.json', '/__data.json');
    } else {
      if (url.charAt(url.length - 1) === '/') url = url.slice(0, -1);
      url += '/__data.json';
    }
  }
  var res = await fetch(url, {
    headers: {
      'User-Agent': HEADERS['User-Agent'],
      'Accept': 'application/json',
      'Referer': ANIMEAV1_BASE + '/'
    },
    redirect: 'follow'
  });
  if (!res.ok) throw new Error('AnimeAV1 HTTP ' + res.status + ' en ' + url);
  return await res.json();
}

/** Decodifica el formato SvelteKit nodes[].data (referencias por índice) */
function decodeSvelteKitData(payload) {
  var nodes = (payload && payload.nodes) || [];
  var arr = null;
  for (var i = 0; i < nodes.length; i++) {
    var n = nodes[i];
    if (n && n.data && Array.isArray(n.data) && n.data.length > 2) {
      arr = n.data;
      break;
    }
  }
  if (!arr) return null;
  var memo = {};
  function resolve(idx, stack) {
    stack = stack || {};
    if (typeof idx !== 'number') return idx;
    if (stack[idx]) return null;
    if (memo[idx] !== undefined) return memo[idx];
    if (idx < 0 || idx >= arr.length) return null;
    stack[idx] = true;
    var val = arr[idx];
    if (val === null || typeof val === 'boolean' || typeof val === 'string' || typeof val === 'number') {
      memo[idx] = val;
      delete stack[idx];
      return val;
    }
    if (Array.isArray(val)) {
      var outA = [];
      for (var j = 0; j < val.length; j++) {
        outA.push(typeof val[j] === 'number' ? resolve(val[j], stack) : val[j]);
      }
      memo[idx] = outA;
      delete stack[idx];
      return outA;
    }
    if (typeof val === 'object') {
      var outO = {};
      var keys = Object.keys(val);
      for (var k = 0; k < keys.length; k++) {
        var key = keys[k];
        var v = val[key];
        outO[key] = typeof v === 'number' ? resolve(v, stack) : v;
      }
      memo[idx] = outO;
      delete stack[idx];
      return outO;
    }
    memo[idx] = val;
    delete stack[idx];
    return val;
  }
  var root = arr[0];
  if (!root || typeof root !== 'object') return null;
  var result = {};
  var rkeys = Object.keys(root);
  for (var r = 0; r < rkeys.length; r++) {
    var rk = rkeys[r];
    var rv = root[rk];
    result[rk] = typeof rv === 'number' ? resolve(rv) : rv;
  }
  return result;
}

function animeAv1Poster(slug, malId) {
  if (malId) return 'https://cdn.myanimelist.net/images/anime/' + String(malId).replace(/[^0-9]/g, '') + '.jpg';
  // fallback genérico (puede 404)
  return null;
}

function normalizarIdiomaLabel(lang) {
  var L = String(lang || '').toUpperCase().trim();
  if (!L) return 'Desconocido';
  if (L === 'SUB' || L === 'SOFTSUB' || L === 'SUBS' || /SUBTIT/.test(L)) return 'Subtitulado';
  if (L === 'LAT' || L === 'LATINO' || L === 'DUB' || L === 'DUBLADO' || L === 'ESP' || L === 'ES' ||
      L === 'AUDIO LATINO' || L === 'CAST' || L === 'CASTELLANO' || /LATIN/.test(L) || /ESPA/.test(L)) {
    return 'Latino';
  }
  if (L === 'ENG' || L === 'EN' || L === 'VOSE') return 'Inglés';
  return lang;
}

function esIdiomaLatino(label) {
  return /latino|castellano|español|dub/i.test(String(label || ''));
}

function mapAnimeAv1Embeds(embedsObj) {
  var reproductores = [];
  var descargas = [];
  if (!embedsObj || typeof embedsObj !== 'object') return { reproductores: reproductores, descargas: descargas };
  var langs = Object.keys(embedsObj);
  // Orden preferido de claves: LAT/DUB antes que SUB
  langs.sort(function (a, b) {
    var ra = esIdiomaLatino(normalizarIdiomaLabel(a)) ? 0 : 1;
    var rb = esIdiomaLatino(normalizarIdiomaLabel(b)) ? 0 : 1;
    return ra - rb;
  });
  for (var i = 0; i < langs.length; i++) {
    var lang = langs[i];
    var list = embedsObj[lang];
    if (!Array.isArray(list)) continue;
    var idioma = normalizarIdiomaLabel(lang);
    for (var j = 0; j < list.length; j++) {
      var e = list[j];
      if (!e || !e.url) continue;
      var url = e.url;
      var server = e.server || extraerServidor(url);
      var isDl = /mega\.nz\/file|1fichier|mediafire|download/i.test(url) && !/embed/i.test(url);
      var row = {
        url: url,
        idioma: idioma,
        lang: lang,
        servidor: server,
        tipo: isDl ? 'descarga' : 'reproductor'
      };
      if (isDl) descargas.push(row);
      else if (esReproductorValido(url) || /zilla-networks|uns\.bio|mp4upload|mega\.nz\/embed|yourupload|streamtape|vidhide|ryderjet/i.test(url)) {
        reproductores.push(row);
      }
    }
  }
  // Latino primero en la lista final
  reproductores.sort(function (a, b) {
    var la = esIdiomaLatino(a.idioma) ? 0 : 1;
    var lb = esIdiomaLatino(b.idioma) ? 0 : 1;
    return la - lb;
  });
  descargas.sort(function (a, b) {
    var la = esIdiomaLatino(a.idioma) ? 0 : 1;
    var lb = esIdiomaLatino(b.idioma) ? 0 : 1;
    return la - lb;
  });
  return { reproductores: reproductores, descargas: descargas };
}

async function buscarAnimeAv1(query, limit) {
  limit = limit || 15;
  var path = '/catalogo/__data.json?search=' + encodeURIComponent(query);
  var raw = await fetchAnimeAv1Data(path);
  var data = decodeSvelteKitData(raw);
  if (!data || !Array.isArray(data.results)) return [];
  var out = [];
  for (var i = 0; i < data.results.length && out.length < limit; i++) {
    var it = data.results[i];
    if (!it || !it.slug) continue;
    var catName = (it.category && it.category.name) || '';
    var tipo = 'Anime';
    if (/movie|pel[ií]cula/i.test(catName)) tipo = 'Pelicula';
    out.push({
      success: true,
      fuente: 'animeav1',
      tipo: tipo,
      titulo: it.title || it.slug,
      slug: it.slug,
      descripcion: it.synopsis || null,
      portada: null,
      link: ANIMEAV1_BASE + '/media/' + it.slug,
      year: null
    });
  }
  return out;
}

async function scrapearAnimeAv1(pageUrl, opts) {
  opts = opts || {};
  var u = String(pageUrl || '');
  // extraer slug y episodio
  var m = u.match(/\/media\/([^\/\?#]+)(?:\/(\d+))?/i);
  if (!m) {
    // permitir solo slug
    m = u.match(/animeav1\.com\/(?:media\/)?([^\/\?#]+)/i);
  }
  if (!m) throw new Error('AnimeAV1: no se pudo extraer slug de ' + pageUrl);
  var slug = decodeURIComponent(m[1]);
  var epNum = m[2] ? parseInt(m[2], 10) : null;
  if (opts.episode && !epNum) epNum = parseInt(opts.episode, 10);
  // season ignored (animeav1 usa número de episodio global)
  if (opts.season && opts.episode && !m[2]) {
    epNum = parseInt(opts.episode, 10);
  }

  // Datos del media
  var mediaRaw = await fetchAnimeAv1Data('/media/' + encodeURIComponent(slug) + '/__data.json');
  var mediaData = decodeSvelteKitData(mediaRaw);
  var media = (mediaData && mediaData.media) || {};
  var titulo = media.title || slug;
  var sinopsis = media.synopsis || null;
  var epsCount = media.episodesCount || 0;
  var score = media.score || null;
  var malId = media.malId || null;
  var portada = media.poster || null;
  if (!portada && malId) {
    // MAL id a veces no es path directo; dejar null y TMDB enriquecerá
    portada = null;
  }
  var catName = (media.category && media.category.name) || 'TV Anime';
  var tipo = /movie|pel[ií]cula/i.test(catName) ? 'Pelicula' : 'Anime';

  // Si piden episodio concreto → embeds (T2+ puede vivir en slug-season-N)
  if (epNum && epNum > 0) {
    var seasonNum = parseInt(opts.season || 1, 10) || 1;
    var mediaSlug = slug;
    if (seasonNum > 1) {
      var seasonCandidates = [
        slug + '-season-' + seasonNum,
        slug + '-' + seasonNum + 'nd-season',
        slug + '-' + seasonNum + 'rd-season',
        slug + '-' + seasonNum + 'th-season',
        slug + '-part-' + seasonNum
      ];
      for (var sc = 0; sc < seasonCandidates.length; sc++) {
        try {
          var testRaw = await fetchAnimeAv1Data('/media/' + encodeURIComponent(seasonCandidates[sc]) + '/__data.json');
          var testData = decodeSvelteKitData(testRaw);
          if (testData && testData.media) {
            mediaSlug = seasonCandidates[sc];
            break;
          }
        } catch (eS) { /* next */ }
      }
    }
    var epRaw = await fetchAnimeAv1Data('/media/' + encodeURIComponent(mediaSlug) + '/' + epNum + '/__data.json');
    var epData = decodeSvelteKitData(epRaw);
    var mapped = mapAnimeAv1Embeds(epData && epData.embeds);
    var dlMapped = mapAnimeAv1Embeds(epData && epData.downloads);
    // downloads object is separate
    var descargas = [];
    if (epData && epData.downloads && typeof epData.downloads === 'object') {
      var dlangs = Object.keys(epData.downloads);
      for (var di = 0; di < dlangs.length; di++) {
        var dlist = epData.downloads[dlangs[di]];
        if (!Array.isArray(dlist)) continue;
        for (var dj = 0; dj < dlist.length; dj++) {
          if (dlist[dj] && dlist[dj].url) {
            descargas.push({
              url: dlist[dj].url,
              idioma: dlangs[di] === 'SUB' ? 'Subtitulado' : dlangs[di],
              servidor: dlist[dj].server || extraerServidor(dlist[dj].url),
              tipo: 'descarga'
            });
          }
        }
      }
    }
    var epMeta = (epData && epData.episode) || {};
    return {
      success: true,
      fuente: 'animeav1',
      source_id: '4',
      tipo: 'Capitulo',
      link: ANIMEAV1_BASE + '/media/' + slug + '/' + epNum,
      slug: slug,
      titulo: titulo + ' — Episodio ' + epNum,
      titulo_serie: titulo,
      temporada: seasonNum || epMeta.season || opts.season || 1,
      episodio: epNum,
      slug_media: mediaSlug,
      portada: portada,
      descripcion: sinopsis,
      calificacion: score,
      total: mapped.reproductores.length,
      embeds: mapped.reproductores.map(function (r) { return r.url; }),
      reproductores: mapped.reproductores,
      descargas: descargas
    };
  }

  // Listado de episodios (stubs ligeros; players al pedir /4/anime/slug/1/N)
  // Soporta rango: opts.epFrom / opts.epTo o query ep_from/ep_to
  var totalEps = parseInt(epsCount, 10) || 0;
  if (totalEps < 1) totalEps = 1;
  // límite duro de seguridad (series kilométricas)
  if (totalEps > 5000) totalEps = 5000;

  var epFrom = parseInt(opts.epFrom || opts.ep_from || 1, 10) || 1;
  var epTo = parseInt(opts.epTo || opts.ep_to || 0, 10) || 0;
  // Por defecto: si hay muchos caps, devolver SOLO metadatos de total + primer bloque
  // el cliente pide rangos. Si epTo=0 y total > 200, devolver lista vacía + rangos sugeridos.
  var RANGO_DEFAULT = 100;
  if (!epTo || epTo < epFrom) {
    if (totalEps > 200) {
      epFrom = 1;
      epTo = Math.min(totalEps, RANGO_DEFAULT);
    } else {
      epFrom = 1;
      epTo = totalEps;
    }
  }
  if (epFrom < 1) epFrom = 1;
  if (epTo > totalEps) epTo = totalEps;
  if (epTo - epFrom > 300) epTo = epFrom + 299; // max 300 por respuesta

  var episodiosRango = [];
  for (var e = epFrom; e <= epTo; e++) {
    episodiosRango.push({
      temporada: 1,
      episodio: e,
      titulo: 'Episodio ' + e,
      url_video: null
    });
  }

  // Rangos sugeridos para la UI (1-100, 101-200, ...)
  var rangos = [];
  var step = RANGO_DEFAULT;
  for (var r = 1; r <= totalEps; r += step) {
    var r2 = Math.min(r + step - 1, totalEps);
    rangos.push({ desde: r, hasta: r2, label: r + '–' + r2 });
  }

  var temporadas = [{ temporada: 1, episodios: episodiosRango }];

  // Si pidieron players=1 y maxCaps, cargar algunos del rango
  if (opts.players && episodiosRango.length > 0) {
    var maxCaps = opts.maxCaps || 5;
    for (var p = 0; p < Math.min(maxCaps, episodiosRango.length); p++) {
      var epN = episodiosRango[p].episodio;
      try {
        var er = await fetchAnimeAv1Data('/media/' + encodeURIComponent(slug) + '/' + epN + '/__data.json');
        var ed = decodeSvelteKitData(er);
        var mp = mapAnimeAv1Embeds(ed && ed.embeds);
        temporadas[0].episodios[p].reproductores = mp.reproductores;
        temporadas[0].episodios[p].embeds = mp.reproductores.map(function (r) { return r.url; });
      } catch (eCap) { /* skip */ }
    }
  }

  // Descubrir temporadas extra en animeav1 (ej. slug-season-2 con DUB/Latino)
  for (var sn = 2; sn <= 5; sn++) {
    var altSlugs = [
      slug + '-season-' + sn,
      slug + '-' + sn + 'nd-season',
      slug + '-' + sn + 'rd-season',
      slug + '-' + sn + 'th-season'
    ];
    var found = null;
    var foundSlug = null;
    for (var ai = 0; ai < altSlugs.length; ai++) {
      try {
        var altRaw = await fetchAnimeAv1Data('/media/' + encodeURIComponent(altSlugs[ai]) + '/__data.json');
        var altData = decodeSvelteKitData(altRaw);
        if (altData && altData.media && (altData.media.episodesCount || altData.media.title)) {
          found = altData.media;
          foundSlug = altSlugs[ai];
          break;
        }
      } catch (eAlt) { /* next */ }
    }
    if (!found) break;
    var altCount = parseInt(found.episodesCount, 10) || 0;
    if (altCount < 1) altCount = 12;
    if (altCount > 500) altCount = 500;
    var altEps = [];
    for (var ae = 1; ae <= altCount; ae++) {
      altEps.push({
        temporada: sn,
        episodio: ae,
        titulo: 'Episodio ' + ae,
        url_video: null,
        slug_media: foundSlug
      });
    }
    temporadas.push({
      temporada: sn,
      slug_media: foundSlug,
      titulo: found.title || ('Temporada ' + sn),
      episodios: altEps
    });
    totalEps += altCount;
  }

  return {
    success: true,
    fuente: 'animeav1',
    source_id: '4',
    tipo: tipo,
    link: ANIMEAV1_BASE + '/media/' + slug,
    slug: slug,
    titulo: titulo,
    portada: portada,
    descripcion: sinopsis,
    calificacion: score,
    year: media.startDate ? String(media.startDate).slice(0, 4) : null,
    total_episodios: totalEps,
    total_temporadas: temporadas.length,
    episodio_desde: epFrom,
    episodio_hasta: epTo,
    rangos_episodios: rangos,
    total: 0,
    embeds: [],
    reproductores: [],
    descargas: [],
    temporadas: temporadas,
    nota: 'T1=' + slug + '. Temporadas extra en slug-season-N. Players: /4/anime/' + slug + '/{temp}/{ep}. DUB=Latino se prioriza.'
  };
}
