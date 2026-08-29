// src/index.js — MovieZone Worker (Lamovie + Hackstore + PelisPlusHD)
addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});

var HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8'
};

var LAMOVIE_API = 'https://lamovie.org/wp-api/v1';
var LAMOVIE_BASE = 'https://lamovie.org';
var HACKSTORE_BASE = 'https://www.hackstore.fo';
var PELISPLUS_BASE = 'https://www.pelisplushd.la';

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
async function handleRequest(request) {
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
      nota: 'IDs de fuente: 1=lamovie, 2=hackstore, 3=pelisplushd. Van en la ruta: /{id}/serie/{slug}'
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
  return String(txt).replace(/\s+/g, ' ').trim();
}

/** Quita basura de títulos: "Descargar serie", " - Hackstore.fo Oficial...", etc. */
function limpiarTitulo(txt) {
  if (!txt) return '';
  var t = String(txt);
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

/** Extrae titulo, descripcion y portada del HTML (og / meta / h1) */
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

  var descripcion = '';
  m = html.match(/property=["']og:description["']\s+content=["']([^"']+)["']/i)
    || html.match(/content=["']([^"']+)["']\s+property=["']og:description["']/i)
    || html.match(/name=["']description["']\s+content=["']([^"']+)["']/i)
    || html.match(/content=["']([^"']+)["']\s+name=["']description["']/i);
  if (m) descripcion = limpiarTexto(m[1]);
  descripcion = descripcion.replace(/^Serie\s+[^:]+:\s*/i, '');

  var portada = '';
  m = html.match(/property=["']og:image["']\s+content=["']([^"']+)["']/i)
    || html.match(/content=["']([^"']+)["']\s+property=["']og:image["']/i);
  if (m) portada = m[1];
  if (!portada) {
    m = html.match(/data-src=["'](https?:\/\/image\.tmdb\.org\/[^"']+)["']/i)
      || html.match(/src=["'](https?:\/\/image\.tmdb\.org\/t\/p\/w(?:300|500|780)\/[^"']+)["']/i);
    if (m) portada = m[1];
  }
  if (!portada) {
    m = html.match(/src=["'](\/?poster\/[^"']+)["']/i);
    if (m) {
      portada = m[1].indexOf('http') === 0 ? m[1] : PELISPLUS_BASE + (m[1].charAt(0) === '/' ? m[1] : '/' + m[1]);
    }
  }
  if (portada && /image\.tmdb\.org\/t\/p\/w300\//i.test(portada)) {
    portada = portada.replace('/w300/', '/w500/');
  }

  return { titulo: titulo, descripcion: descripcion, portada: portada };
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

async function buscarHackstore(query, limit) {
  var url = HACKSTORE_BASE + '/?s=' + encodeURIComponent(query);
  var res = await fetch(url, {
    headers: Object.assign({}, HEADERS, { 'Referer': HACKSTORE_BASE + '/' })
  });
  if (!res.ok) return [];
  var html = await res.text();
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
    out.push({
      titulo: limpiarTitulo(slug.replace(/-/g, ' ')),
      tipo: tipo,
      fuente: 'hackstore',
      link: link,
      slug: slug
    });
  }
  return out;
}

async function buscarPelisplus(query, limit) {
  var url = PELISPLUS_BASE + '/search?s=' + encodeURIComponent(query);
  var res = await fetch(url, {
    headers: Object.assign({}, HEADERS, { 'Referer': PELISPLUS_BASE + '/' })
  });
  if (!res.ok) return [];
  var html = await res.text();
  var out = [];
  var vistos = {};
  var regex = /href=["']((?:https?:\/\/[^"']+)?\/(?:pelicula|serie|anime)\/([^"'\/\?]+))\/?["']/gi;
  var m;
  while ((m = regex.exec(html)) !== null && out.length < (limit || 15)) {
    var path = m[1];
    var slug = m[2];
    var full = path.indexOf('http') === 0 ? path : PELISPLUS_BASE + path;
    full = full.replace(/\/$/, '') + '/';
    if (vistos[full]) continue;
    if (PALABRAS_BLOQUEADAS_BUSQUEDA.some(function (w) { return slug.indexOf(w) !== -1; })) continue;
    vistos[full] = true;
    var tipo = 'Pelicula';
    if (/\/serie\//i.test(full)) tipo = 'Serie';
    if (/\/anime\//i.test(full)) tipo = 'Anime';
    out.push({
      titulo: limpiarTitulo(slug.replace(/-/g, ' ')),
      tipo: tipo,
      fuente: 'pelisplushd',
      link: full,
      slug: slug
    });
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
      year: null,
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
    year: null,
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
