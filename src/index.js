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
  var seasonQ = url.searchParams.get('season');
  var episodeQ = url.searchParams.get('episode');
  var playersQ = url.searchParams.get('players') === '1';
  var maxCapsQ = parseInt(url.searchParams.get('maxCaps') || '5', 10);
  var sourceParam = normalizarSourceId(url.searchParams.get('source') || '');

  var commonOpts = {
    season: seasonQ ? parseInt(seasonQ, 10) : null,
    episode: episodeQ ? parseInt(episodeQ, 10) : null,
    players: playersQ,
    maxCaps: maxCapsQ,
    requestUrl: request.url
  };

  // ---------- Health ----------
  if (path === '/' && !url.searchParams.has('url') && !url.searchParams.has('q') && !url.searchParams.has('episodePostId')) {
    return json({
      status: 'ok',
      service: 'MovieZone Worker',
      sources: {
        '1': 'lamovie',
        '2': 'hackstore',
        '3': 'pelisplushd'
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
        por_url: origin + '/?url={url_completa}'
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
      nota: 'IDs de fuente: 1=lamovie, 2=hackstore, 3=pelisplushd. Van en la ruta: /{id}/serie/{slug}',
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
      sources: { '1': 'lamovie', '2': 'hackstore', '3': 'pelisplushd' }
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
  return '';
}

function sourceIdFromName(name) {
  name = String(name || '').toLowerCase();
  if (name === 'hackstore') return '2';
  if (name === 'pelisplushd') return '3';
  return '1'; // lamovie default
}

function sourceNameFromId(id) {
  id = String(id || '').toLowerCase();
  if (id === '2' || id === 'hackstore' || id === 'hs') return 'hackstore';
  if (id === '3' || id === 'pelisplushd' || id === 'pp') return 'pelisplushd';
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
  if (u.indexOf('pelisplushd') !== -1) return 'pelisplushd';
  if (u.indexOf('hackstore') !== -1) return 'hackstore';
  if (u.indexOf('lamovie') !== -1) return 'lamovie';
  if (/\/(pelicula|serie|anime)\//i.test(u)) return 'pelisplushd';
  return 'lamovie';
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
    detalle.temporadas_tmdb = metaFull.temporadas;
    if (!detalle.total_temporadas) detalle.total_temporadas = metaFull.temporadas.length;
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
    titulo: metas.titulo,
    portada: metas.portada,
    descripcion: metas.descripcion,
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

    return {
      success: true,
      fuente: 'hackstore',
      tipo: 'Serie',
      link: pageUrl,
      titulo: metas.titulo,
      portada: metas.portada,
      descripcion: metas.descripcion,
      year: null,
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

  return {
    success: true,
    fuente: 'hackstore',
    tipo: 'Pelicula',
    link: pageUrl,
    titulo: metasP.titulo,
    portada: metasP.portada,
    descripcion: metasP.descripcion,
    year: null,
    calificacion: null,
    total: reproductores.length,
    embeds: reproductores.map(function (r) { return r.url; }),
    reproductores: reproductores,
    descargas: descargas
  };
}
