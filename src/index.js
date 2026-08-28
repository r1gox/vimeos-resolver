addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});

// ======================================================
// CONFIGURACIÓN
// ======================================================
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
  'Referer': 'https://www.hackstore.fo/'
};

const LAMOVIE_API = 'https://lamovie.org/wp-api/v1';
const LAMOVIE_BASE = 'https://lamovie.org';
const HACKSTORE_BASE = 'https://www.hackstore.fo';

// ======================================================
// REPRODUCTORES - PERMITIDOS Y BLOQUEADOS
// ======================================================
const REPRODUCTORES_PERMITIDOS = [
  'vimeos.net', 'player.vimeos', 'goodstream.one', 'goodstream.uno', 'goodstream',
  'streamwish', 'filemoon', 'voe.sx', 'voe.', 'doodstream', 'dood.', 'ds2play',
  'doods.pro', 'streamtape', 'mixdrop', 'upstream', 'vidmoly', 'mp4upload',
  'uqload', 'vidhide', 'vidguard', 'lulustream', 'filelions', 'yourupload',
  'supervideo', 'krakenfiles', 'ok.ru', 'okru'
];

const REPRODUCTORES_BLOQUEADOS = [
  'sblongvu.com', 'sblongvu', 'sblanh', 'sbfull', 'sbfast', 'sbthe.com', 'sbanh',
  'sbrity', 'sbbrisk', 'sblona', 'lvturbo', 'diasfem', 'fembed', '4shared',
  'lamovie.org', 'lamovie', 'youtube.com', 'youtu.be', 'play.php', 'example.com',
  'hackstore.fo', 'hackstore'
];

const PALABRAS_BLOQUEADAS_BUSQUEDA = ['estrenos', 'populares', 'genero', 'categoria', 'pagina'];

// ======================================================
// UTILIDADES
// ======================================================
function unirUrl(base, relativa) {
  try {
    return new URL(relativa, base).toString();
  } catch {
    return null;
  }
}

function limpiarUrl(urlStr) {
  try {
    const p = new URL(urlStr);
    let pathname = p.pathname;
    if (!pathname.endsWith("/")) {
      pathname += "/";
    }
    return `${p.protocol}//${p.host}${pathname}`;
  } catch {
    return urlStr;
  }
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

function limpiarTexto(txt) {
  if (!txt) return '';
  return String(txt).replace(/\s+/g, ' ').trim();
}

function esReproductorValido(url) {
  if (!url) return false;
  const u = String(url).toLowerCase().trim();
  if (!/^https?:\/\//i.test(u)) return false;
  if (/\.(jpg|jpeg|png|webp|gif|svg|ico|bmp|css|woff2?|ttf|eot)(\?|$)/i.test(u)) return false;
  if (u.includes("image.tmdb.org") || u.includes("themoviedb.org")) return false;
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
  var hosts = ['mega.nz', 'mega.co.nz', 'mediafire.com', '1fichier.com', 'gofile.io', 'uptobox.com', 'pixeldrain.com', 'megaup.net', 'magnet:'];
  for (var i = 0; i < hosts.length; i++) {
    if (u.indexOf(hosts[i]) !== -1) return true;
  }
  return false;
}

function esYouTube(url) {
  if (!url) return false;
  const u = String(url).toLowerCase();
  return u.includes('youtube.com') || u.includes('youtu.be');
}

function esTituloGenerico(texto) {
  if (!texto) return true;
  const t = String(texto).trim().toLowerCase().replace(/\s+/g, " ");
  if (t.length < 2) return true;
  const genericos = [
    "descargar peliculas gratis", "descargar películas gratis",
    "peliculas gratis", "películas gratis", "por mega",
    "google drive", "más en 1 link", "mas en 1 link",
    "ver peliculas gratis", "ver películas gratis"
  ];
  return genericos.some(p => t.includes(p));
}

function json(data, status) {
  status = status || 200;
  return new Response(JSON.stringify(data, null, 2), {
    status: status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    }
  });
}

function detectarFuente(u) {
  u = (u || '').toLowerCase();
  if (u.indexOf('pelisplushd') !== -1) return 'pelisplushd';
  if (u.indexOf('hackstore') !== -1) return 'hackstore';
  if (u.indexOf('lamovie') !== -1) return 'lamovie';
  return 'lamovie';
}

// ======================================================
// OBTENER HTML
// ======================================================
async function obtenerHTML(url, headers = {}) {
  const response = await fetch(url, {
    headers: Object.assign({}, HEADERS, headers)
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return await response.text();
}

// ======================================================
// MANEJADOR PRINCIPAL
// ======================================================
async function handleRequest(request) {
  var url = new URL(request.url);

  // Health check
  if (url.pathname === '/' && !url.searchParams.has('url') && !url.searchParams.has('q')) {
    return json({
      status: 'ok',
      service: 'MovieZone Worker',
      sources: ['lamovie', 'hackstore', 'pelisplushd'],
      uso: {
        scrapear: '?url=https://lamovie.org/peliculas/...',
        buscar: '?q=supergirl',
        buscar_fuente: '?q=supergirl&source=lamovie'
      }
    });
  }

  // BUSCADOR UNIVERSAL
  var query = url.searchParams.get('q');
  if (query) {
    var sourceFilter = url.searchParams.get('source') || 'all';
    var limit = parseInt(url.searchParams.get('limit') || '15', 10);
    try {
      var resultados = await buscarUniversal(query, sourceFilter, limit);
      return json(resultados);
    } catch (err) {
      return json({ success: false, error: err.message }, 500);
    }
  }

  // SCRAPEAR por URL
  var targetUrl = url.searchParams.get('url');
  var source = url.searchParams.get('source') || detectarFuente(targetUrl);

  if (!targetUrl) {
    return json({ error: 'Usa ?url=... para scrapear o ?q=... para buscar' }, 400);
  }

  try {
    var resultado;
    if (source === 'pelisplushd' || targetUrl.indexOf('pelisplushd') !== -1) {
      resultado = await scrapearPelisplus(targetUrl);
    } else if (source === 'hackstore' || targetUrl.indexOf('hackstore') !== -1) {
      resultado = await scrapearHackstore(targetUrl);
    } else {
      resultado = await scrapearLamovie(targetUrl);
    }
    return json(resultado);
  } catch (err) {
    return json({
      success: false,
      error: err.message || 'Error al scrapear',
      fuente: source
    }, 500);
  }
}

// ======================================================
// ENRIQUECER RESULTADOS CON LAMOVIE
// ======================================================
async function enriquecerConLamovie(resultado) {
  if (resultado.portada && resultado.calificacion) {
    return resultado;
  }
  try {
    var lamovieResults = await buscarLamovie(resultado.titulo, 1);
    if (lamovieResults && lamovieResults.length > 0) {
      var lamovieData = lamovieResults[0];
      if (lamovieData.portada) resultado.portada = lamovieData.portada;
      if (lamovieData.calificacion) resultado.calificacion = lamovieData.calificacion;
      if (lamovieData.year && !resultado.year) resultado.year = lamovieData.year;
      if (lamovieData.titulo && lamovieData.titulo.length > resultado.titulo.length) {
        resultado.titulo = lamovieData.titulo;
      }
    }
  } catch (e) {}
  return resultado;
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
  for (var i = 0; i < arrays.length; i++) {
    todos = todos.concat(arrays[i]);
  }

  // Enriquecer cada resultado con datos de Lamovie
  var resultadosEnriquecidos = [];
  for (var j = 0; j < todos.length; j++) {
    var resultado = await enriquecerConLamovie(todos[j]);
    resultadosEnriquecidos.push(resultado);
  }

  // Eliminar duplicados
  var vistos = {};
  var unicos = [];
  for (var k = 0; k < resultadosEnriquecidos.length; k++) {
    var key = (resultadosEnriquecidos[k].titulo || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!key || vistos[key]) continue;
    vistos[key] = true;
    unicos.push(resultadosEnriquecidos[k]);
  }

  // Ordenar: Lamovie primero (tiene más datos)
  unicos.sort(function(a, b) {
    if (a.fuente === 'lamovie' && b.fuente !== 'lamovie') return -1;
    if (a.fuente !== 'lamovie' && b.fuente === 'lamovie') return 1;
    return 0;
  });

  return {
    success: true,
    query: q,
    total: unicos.length,
    resultados: unicos.slice(0, limit * 2)
  };
}

// ======================================================
// 1. LAMOVIE - BÚSQUEDA
// ======================================================
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
      titulo: p.title || 'Sin titulo',
      tipo: tipo,
      year: p.release_date ? String(p.release_date).slice(0, 4) : null,
      portada: portada,
      calificacion: p.rating || p.imdb_rating || null,
      link: LAMOVIE_BASE + '/' + path + '/' + p.slug + '/',
      postId: p._id,
      fuente: 'lamovie',
      slug: p.slug
    });
  }
  return out;
}

// ======================================================
// 2. HACKSTORE - BÚSQUEDA (FILTRADA)
// ======================================================
async function buscarHackstore(query, limit) {
  var url = HACKSTORE_BASE + '/?s=' + encodeURIComponent(query);
  var res = await fetch(url, {
    headers: Object.assign({}, HEADERS, { 'Referer': HACKSTORE_BASE + '/' })
  });
  if (!res.ok) return [];
  var html = await res.text();

  var links = {};
  var regex = /href=["'](https?:\/\/(?:www\.)?hackstore\.[a-z]+\/(peliculas|series|animes)\/([^"'\/\?]+))\/?["']/gi;
  var m;
  while ((m = regex.exec(html)) !== null) {
    var full = m[1].replace(/\/$/, '') + '/';
    var seccion = m[2];
    var slug = m[3];
    if (links[full]) continue;
    if (!slug || slug === 'page') continue;
    var slugLower = slug.toLowerCase();
    var esInvalido = false;
    for (var i = 0; i < PALABRAS_BLOQUEADAS_BUSQUEDA.length; i++) {
      if (slugLower === PALABRAS_BLOQUEADAS_BUSQUEDA[i] || slugLower.indexOf(PALABRAS_BLOQUEADAS_BUSQUEDA[i]) === 0) {
        esInvalido = true;
        break;
      }
    }
    if (esInvalido || slug.length < 3) continue;
    links[full] = { seccion: seccion, slug: slug, link: full };
  }

  var out = [];
  var keys = Object.keys(links);
  for (var j = 0; j < keys.length && out.length < (limit || 15); j++) {
    var item = links[keys[j]];
    var tipo = 'Pelicula';
    if (item.seccion === 'series') tipo = 'Serie';
    if (item.seccion === 'animes') tipo = 'Anime';

    var titulo = item.slug
      .replace(/-\d{4}$/, '')
      .replace(/-/g, ' ')
      .replace(/\b\w/g, function (c) { return c.toUpperCase(); });

    var yearMatch = item.slug.match(/-(\d{4})$/);
    out.push({
      titulo: titulo,
      tipo: tipo,
      year: yearMatch ? yearMatch[1] : null,
      portada: '',
      calificacion: null,
      link: item.link,
      postId: null,
      fuente: 'hackstore',
      slug: item.slug
    });
  }
  return out;
}

// ======================================================
// 3. PELISPLUSHD - BÚSQUEDA (FILTRADA)
// ======================================================
async function buscarPelisplus(query, limit) {
  var bases = [
    'https://www.pelisplushd.nz',
    'https://www.pelisplushd.la',
    'https://pelisplushd.nz'
  ];

  for (var b = 0; b < bases.length; b++) {
    try {
      var url = bases[b] + '/search?s=' + encodeURIComponent(query);
      var res = await fetch(url, {
        headers: Object.assign({}, HEADERS, { 'Referer': bases[b] + '/' })
      });
      if (!res.ok) continue;
      var html = await res.text();

      var out = [];
      var vistos = {};
      var regex = /href=["']((?:https?:\/\/[^"']+)?\/(?:pelicula|serie|anime)s?\/([^"'\/\?]+))\/?["']/gi;
      var m;
      while ((m = regex.exec(html)) !== null && out.length < (limit || 15)) {
        var path = m[1];
        var slug = m[2];
        if (vistos[slug]) continue;
        vistos[slug] = true;

        var slugLower = slug.toLowerCase();
        var esInvalido = false;
        for (var i = 0; i < PALABRAS_BLOQUEADAS_BUSQUEDA.length; i++) {
          if (slugLower === PALABRAS_BLOQUEADAS_BUSQUEDA[i] || slugLower.indexOf(PALABRAS_BLOQUEADAS_BUSQUEDA[i]) === 0) {
            esInvalido = true;
            break;
          }
        }
        if (esInvalido || slug.length < 3) continue;

        var full = path.indexOf('http') === 0 ? path : (bases[b] + path);
        full = full.replace(/\/$/, '') + '/';

        var tipo = 'Pelicula';
        if (/\/series?\//i.test(full)) tipo = 'Serie';
        if (/\/animes?\//i.test(full)) tipo = 'Anime';

        var titulo = slug
          .replace(/-\d{4}$/, '')
          .replace(/-/g, ' ')
          .replace(/\b\w/g, function (c) { return c.toUpperCase(); });

        var yearMatch = slug.match(/-(\d{4})$/);
        out.push({
          titulo: titulo,
          tipo: tipo,
          year: yearMatch ? yearMatch[1] : null,
          portada: '',
          calificacion: null,
          link: full,
          postId: null,
          fuente: 'pelisplushd',
          slug: slug
        });
      }
      if (out.length > 0) return out;
    } catch (e) {}
  }
  return [];
}

// ======================================================
// 4. SCRAPER PELISPLUSHD
// ======================================================
async function scrapearPelisplus(pageUrl) {
  var res = await fetch(pageUrl, {
    headers: Object.assign({}, HEADERS, { 'Referer': 'https://www.pelisplushd.la/' })
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  var html = await res.text();

  var reproductores = [];
  var vistos = {};

  var regex1 = /data-url=["']([^"']+)["'][^>]*data-name=["']([^"']*)["']/gi;
  var m;
  while ((m = regex1.exec(html)) !== null) {
    var u = m[1];
    var idioma = m[2] || 'Desconocido';
    if (u && !vistos[u]) {
      vistos[u] = true;
      reproductores.push({ url: u, idioma: idioma, servidor: extraerServidor(u), tipo: 'reproductor' });
    }
  }

  var regex2 = /data-name=["']([^"']*)["'][^>]*data-url=["']([^"']+)["']/gi;
  while ((m = regex2.exec(html)) !== null) {
    var idioma2 = m[1] || 'Desconocido';
    var u2 = m[2];
    if (u2 && !vistos[u2]) {
      vistos[u2] = true;
      reproductores.push({ url: u2, idioma: idioma2, servidor: extraerServidor(u2), tipo: 'reproductor' });
    }
  }

  var titulo = '';
  var t1 = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
  var t2 = html.match(/property=["']og:title["']\s+content=["']([^"']+)["']/i);
  titulo = limpiarTexto((t1 && t1[1]) || (t2 && t2[1]) || '');

  var portada = '';
  var p1 = html.match(/property=["']og:image["']\s+content=["']([^"']+)["']/i);
  if (p1) portada = p1[1];

  var descripcion = '';
  var d1 = html.match(/property=["']og:description["']\s+content=["']([^"']+)["']/i);
  var d2 = html.match(/name=["']description["']\s+content=["']([^"']+)["']/i);
  descripcion = limpiarTexto((d1 && d1[1]) || (d2 && d2[1]) || '');

  var year = null;
  var y1 = html.match(/(?:Año|Year|Estreno)[^0-9]{0,20}(19|20)\d{2}/i) || html.match(/\b(19|20)\d{2}\b/);
  if (y1) {
    var ym = y1[0].match(/(19|20)\d{2}/);
    if (ym) year = ym[0];
  }

  var calificacion = null;
  var c1 = html.match(/(?:IMDb|TMDB|Calificación|Rating)[^0-9]{0,15}(\d+[.,]\d+)/i) || html.match(/(\d+[.,]\d+)\s*\/\s*10/);
  if (c1) calificacion = c1[1].replace(',', '.');

  var calidad = [];
  var calMatch = html.match(/(4K|1080p|720p|Full HD|HD|BluRay|WEB-DL|HDRip)/gi);
  if (calMatch) {
    var set = {};
    for (var i = 0; i < calMatch.length; i++) set[calMatch[i].toUpperCase()] = true;
    calidad = Object.keys(set);
  }

  return {
    success: true,
    fuente: 'pelisplushd',
    link: pageUrl,
    titulo: titulo || 'Sin titulo',
    portada: portada,
    descripcion: descripcion,
    year: year,
    calificacion: calificacion,
    calidad: calidad,
    total: reproductores.length,
    embeds: reproductores.map(function (r) { return r.url; }),
    reproductores: reproductores
  };
}

// ======================================================
// 5. EXTRACCIÓN DE REPRODUCTOR DESDE EMBED DE LAMOVIE
// ======================================================
async function extraerReproductorLamovieEmbed(embedUrl) {
  try {
    var res = await fetch(embedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': LAMOVIE_BASE + '/'
      }
    });
    if (!res.ok) return null;
    var html = await res.text();
    
    var iframeMatch = html.match(/<iframe[^>]*src=["']([^"']+)["'][^>]*>/i);
    if (iframeMatch && iframeMatch[1]) {
      var url = iframeMatch[1];
      if (esReproductorValido(url)) {
        return url;
      }
    }
    
    var locMatch = html.match(/window\.location\.href\s*=\s*["']([^"']+)["']/i);
    if (locMatch && locMatch[1]) {
      var url2 = locMatch[1];
      if (esReproductorValido(url2)) {
        return url2;
      }
    }
    
    var urlRegex = /https?:\/\/[^\s"'<>]+/gi;
    var urls = html.match(urlRegex) || [];
    for (var i = 0; i < urls.length; i++) {
      var u = urls[i];
      u = u.replace(/["'<>),;]+$/g, '');
      if (esReproductorValido(u)) {
        return u;
      }
    }
    
    return null;
  } catch (e) {
    return null;
  }
}

// ======================================================
// 6. SCRAPER LAMOVIE (MEJORADO)
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
    
    if (u.indexOf('lamovie.org/embed.html') !== -1 || u.indexOf('lamovie.org/embed') !== -1) {
      var realUrl = await extraerReproductorLamovieEmbed(u);
      if (realUrl && esReproductorValido(realUrl) && !vistos[realUrl]) {
        vistos[realUrl] = true;
        embeds.push({
          url: realUrl,
          idioma: (e && (e.lang || e.language || e.idioma)) || 'Desconocido',
          servidor: extraerServidor(realUrl),
          calidad: (e && (e.quality || e.calidad)) || null,
          tipo: 'reproductor'
        });
      }
      continue;
    }
    
    if (!esReproductorValido(u)) continue;
    vistos[u] = true;
    embeds.push({
      url: u,
      idioma: (e && (e.lang || e.language || e.idioma)) || 'Desconocido',
      servidor: extraerServidor(u),
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

async function scrapearLamovie(pageUrl) {
  var slug = extraerSlugLamovie(pageUrl);
  if (!slug) throw new Error('No se pudo extraer el slug de la URL de Lamovie');

  var encontrado = await buscarPostIdPorSlug(slug);
  if (!encontrado || !encontrado.postId) {
    throw new Error('No se encontro postId para el slug: ' + slug);
  }

  var postId = encontrado.postId;
  var post = encontrado.post || {};
  var playerData = await getPlayerLamovie(postId);
  var embeds = playerData.embeds;
  var downloads = playerData.downloads;

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

  return {
    success: true,
    fuente: 'lamovie',
    link: pageUrl,
    postId: postId,
    titulo: titulo,
    portada: portada,
    descripcion: descripcion,
    year: year,
    calificacion: calificacion,
    calidad: [],
    total: embeds.length,
    embeds: embeds.map(function (e) { return e.url; }),
    reproductores: embeds,
    descargas: downloads
  };
}

// ======================================================
// 7. SCRAPER HACKSTORE (CON EXTRACCIÓN DE EPISODIOS - BASADO EN MOVIEZONE)
// ======================================================

// Extraer episodios de Hackstore (adaptado de MOVIEZONE)[reference:5]
function extraerEpisodiosHackstore(html, paginaBase) {
  const episodios = [];
  const vistos = new Set();
  
  // Buscar todos los enlaces que parezcan episodios
  const regex = /<a[^>]*href=["']([^"']*)["'][^>]*>([^<]*)<\/a>/gi;
  let match;
  
  while ((match = regex.exec(html)) !== null) {
    let href = match[1];
    let texto = match[2].trim().replace(/\s+/g, " ");
    
    // Limpiar texto de estilos CSS
    texto = texto
      .replace(/\.text\s*\{[^}]*\}/gi, "")
      .replace(/font-size:[^;]+;/gi, "")
      .replace(/font-weight:[^;]+;/gi, "")
      .replace(/fill:\s*#[0-9a-f]+;/gi, "")
      .replace(/\{[^}]*\}/g, "")
      .trim();
    
    // Buscar patrones de episodio en el texto
    const matchEp = texto.match(/(\d+\s*[x×]\s*\d+|episodio\s*\d+|ep\.?\s*\d+|capítulo\s*\d+|capitulo\s*\d+)/i);
    if (matchEp) {
      texto = matchEp[0].replace(/\s+/g, "");
    }
    
    // Si no tiene texto o es muy corto, intentar con el href
    if (!texto || texto.length < 2 || texto.toLowerCase().includes("disponible")) {
      const matchHref = href.match(/(\d+[x×]\d+|episodio[-_]?\d+|ep[-_]?\d+)/i);
      if (matchHref) {
        texto = matchHref[0].replace(/[-_]/g, " ");
      } else {
        continue;
      }
    }
    
    if (!href) continue;
    const url = unirUrl(paginaBase, href);
    if (!url) continue;
    
    const contenido = `${texto} ${url}`.toLowerCase();
    const pareceEpisodio = /episodio|episode|capitulo|capítulo|\bep\.?\s*\d+|\b\d+x\d+\b/i.test(contenido);
    
    if (!pareceEpisodio || vistos.has(url) || url === paginaBase) continue;
    
    vistos.add(url);
    
    // Extraer número de temporada y episodio
    let temporada = null;
    let episodioNum = null;
    
    const tMatch = contenido.match(/(?:temporada|season)\s*(\d+)/i);
    if (tMatch) temporada = parseInt(tMatch[1]);
    
    const eMatch = contenido.match(/(?:episodio|episode|capítulo|capitulo|ep)\s*(\d+)/i);
    if (eMatch) episodioNum = parseInt(eMatch[1]);
    
    if (!temporada || !episodioNum) {
      const xMatch = contenido.match(/(\d+)\s*[x×]\s*(\d+)/);
      if (xMatch) {
        temporada = parseInt(xMatch[1]);
        episodioNum = parseInt(xMatch[2]);
      }
    }
    
    episodios.push({
      nombre: texto || `Episodio ${episodios.length + 1}`,
      link: url,
      temporada: temporada,
      episodio: episodioNum,
      video: null,
      embeds: [],
      downloads: [],
      soloTrailer: false
    });
  }
  
  return episodios;
}

// Extraer reproductor de una página de Hackstore (adaptado de MOVIEZONE)[reference:6]
async function extraerReproductorHackstore(url, html) {
  const candidatos = [];
  
  function agregar(urlEncontrada) {
    if (!urlEncontrada) return;
    try {
      const absoluta = new URL(urlEncontrada, url).toString();
      if (!candidatos.includes(absoluta)) candidatos.push(absoluta);
    } catch {}
  }
  
  // Buscar iframes
  const iframeRegex = /<iframe[^>]*src=["']([^"']+)["'][^>]*>/gi;
  let match;
  while ((match = iframeRegex.exec(html)) !== null) {
    agregar(match[1]);
  }
  
  // Buscar en atributos data-*
  const dataRegex = /data-(?:player|video|iframe|src|url)=["']([^"']+)["']/gi;
  while ((match = dataRegex.exec(html)) !== null) {
    agregar(match[1]);
  }
  
  // Buscar URLs en el HTML
  const urlRegex = /https?:\/\/[^\s"'<>\\]+/gi;
  const urls = html.match(urlRegex) || [];
  for (const encontrada of urls) {
    let limpia = encontrada.replace(/\\u002F/g, "/").replace(/\\\//g, "/").replace(/["'<>),]+$/g, "");
    agregar(limpia);
  }
  
  // Ordenar por prioridad
  const prioridad = ["play.php", "/embed/", "/player/", "/embed-", "iframe", ".m3u8", ".mp4"];
  candidatos.sort((a, b) => {
    const pa = prioridad.findIndex(x => a.toLowerCase().includes(x));
    const pb = prioridad.findIndex(x => b.toLowerCase().includes(x));
    return (pa === -1 ? 999 : pa) - (pb === -1 ? 999 : pb);
  });
  
  for (const candidato of candidatos) {
    try {
      if (candidato.includes(".m3u8") || candidato.includes(".mp4")) return candidato;
      
      if (candidato.includes("play.php")) {
        const htmlPlayer = await obtenerHTML(candidato);
        const matchLoc = htmlPlayer.match(/window\.location\.href\s*=\s*["']([^"']+)/i) ||
                        htmlPlayer.match(/location\.href\s*=\s*["']([^"']+)/i);
        if (matchLoc) {
          const siguiente = unirUrl(candidato, matchLoc[1]);
          if (siguiente && esReproductorValido(siguiente)) {
            return siguiente;
          }
        }
        const urlsPlayer = htmlPlayer.match(urlRegex) || [];
        for (const urlPlayer of urlsPlayer) {
          const limpia = urlPlayer.replace(/\\u002F/g, "/").replace(/\\\//g, "/").replace(/["'<>),]+$/g, "");
          if (limpia.includes(".m3u8") || limpia.includes(".mp4") || 
              limpia.includes("/embed/") || limpia.includes("/player/")) {
            if (esReproductorValido(limpia)) {
              return limpia;
            }
          }
        }
      }
      
      if (candidato.includes("/embed/") || candidato.includes("/player/") || candidato.includes("embed-")) {
        if (esReproductorValido(candidato)) {
          return candidato;
        }
      }
    } catch {}
  }
  
  return null;
}

// Extraer año del título
function extraerAnioDelTitulo(nombre) {
  if (!nombre) return null;
  const match = nombre.match(/\((19|20)\d{2}\)/) || nombre.match(/\b(19|20)\d{2}\b/);
  if (match) {
    const yearMatch = match[0].match(/(19|20)\d{2}/);
    if (yearMatch) return yearMatch[0];
  }
  return null;
}

// Detectar tipo de contenido (Película, Serie, Anime)
function detectarTipo(url, nombre = "") {
  const texto = `${url} ${nombre}`.toLowerCase();
  if (texto.includes("/anime/") || texto.includes("/animes/") || texto.includes("anime")) return "Anime";
  if (texto.includes("/series/") || texto.includes("serie")) return "Serie";
  return "Película";
}

// Scraper principal de Hackstore (basado en MOVIEZONE)[reference:7]
async function scrapearHackstore(pageUrl) {
  const html = await obtenerHTML(pageUrl);
  
  // Extraer título
  let titulo = '';
  const t1 = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
  const t2 = html.match(/property=["']og:title["']\s+content=["']([^"']+)["']/i);
  titulo = limpiarTexto((t1 && t1[1]) || (t2 && t2[1]) || '');
  titulo = titulo
    .replace(/^Descargar\s+/i, '')
    .replace(/\s*online\s*$/i, '')
    .replace(/\s*gratis\s*$/i, '')
    .replace(/\s*-\s*Hackstore.*$/i, '')
    .trim();
  
  // Extraer portada
  let portada = '';
  const p1 = html.match(/property=["']og:image["']\s+content=["']([^"']+)["']/i);
  const p2 = html.match(/thumbnailUrl["']?\s*:\s*["']([^"']+)["']/i);
  const p3 = html.match(/https:\/\/image\.tmdb\.org\/t\/p\/[^"'\\]+/i);
  if (p1) portada = p1[1];
  else if (p2) portada = p2[1];
  else if (p3) portada = p3[0];
  
  // Extraer descripción
  let descripcion = '';
  const d1 = html.match(/property=["']og:description["']\s+content=["']([^"']+)["']/i);
  const d2 = html.match(/name=["']description["']\s+content=["']([^"']+)["']/i);
  descripcion = limpiarTexto((d1 && d1[1]) || (d2 && d2[1]) || '');
  
  // Extraer año
  let year = extraerAnioDelTitulo(titulo);
  if (!year) {
    const urlYear = pageUrl.match(/-\d{4}/);
    if (urlYear) year = urlYear[0].replace('-', '');
  }
  
  // Extraer calificación
  let calificacion = null;
  const cMatch = html.match(/(\d+[.,]\d+)\s*\/\s*10/) || html.match(/(?:rating|imdb|tmdb)[^0-9]{0,15}(\d+[.,]\d+)/i);
  if (cMatch) calificacion = cMatch[1].replace(',', '.');
  
  // Extraer calidad
  let calidad = [];
  const calMatch = html.match(/(4K|1080p|720p|Full HD|HD|BluRay|WEB-DL|HDRip|BDRip)/gi);
  if (calMatch) {
    const set = {};
    for (let c = 0; c < calMatch.length; c++) set[calMatch[c].toUpperCase()] = true;
    calidad = Object.keys(set);
  }
  
  const tipo = detectarTipo(pageUrl, titulo || "");
  
  // Extraer reproductor directo (para películas)
  let reproductor = await extraerReproductorHackstore(pageUrl, html);
  let soloTrailer = false;
  if (esYouTube(reproductor)) {
    soloTrailer = true;
    reproductor = null;
  }
  
  // Extraer episodios (para series/animes)[reference:8]
  const episodios = extraerEpisodiosHackstore(html, pageUrl);
  
  // Procesar episodios (solo los primeros 12 para no demorar)[reference:9]
  const episodiosProcesados = [];
  const limiteEp = Math.min(episodios.length, 12);
  
  for (let i = 0; i < limiteEp; i++) {
    const ep = episodios[i];
    try {
      const epHtml = await obtenerHTML(ep.link);
      let video = await extraerReproductorHackstore(ep.link, epHtml);
      let epSoloTrailer = false;
      if (esYouTube(video)) {
        epSoloTrailer = true;
        video = null;
      }
      episodiosProcesados.push({
        nombre: epSoloTrailer ? `${ep.nombre} (Solo trailer)` : ep.nombre,
        link: ep.link,
        temporada: ep.temporada,
        episodio: ep.episodio,
        video: (video && esReproductorValido(video)) ? video : null,
        embeds: (video && esReproductorValido(video)) ? [{
          url: video,
          servidor: extraerServidor(video),
          idioma: "Desconocido"
        }] : [],
        downloads: [],
        soloTrailer: epSoloTrailer
      });
    } catch {
      episodiosProcesados.push({
        ...ep,
        video: null,
        embeds: [],
        downloads: [],
        soloTrailer: false
      });
    }
  }
  
  // Agrupar episodios por temporada
  const tempMap = {};
  for (const ep of episodiosProcesados) {
    const tempNum = ep.temporada || 1;
    if (!tempMap[tempNum]) tempMap[tempNum] = [];
    tempMap[tempNum].push(ep);
  }
  
  const temporadas = Object.keys(tempMap).sort((a, b) => parseInt(a) - parseInt(b)).map(num => {
    const eps = tempMap[num].sort((a, b) => (a.episodio || 0) - (b.episodio || 0));
    return {
      numero: parseInt(num),
      episodios: eps.map(ep => ({
        numero: ep.episodio || 0,
        titulo: ep.nombre,
        link: ep.link,
        reproductores: ep.embeds,
        video: ep.video
      }))
    };
  });
  
  // Construir respuesta
  const respuesta = {
    success: true,
    fuente: 'hackstore',
    link: pageUrl,
    titulo: titulo || 'Sin título',
    portada: portada,
    descripcion: descripcion,
    year: year,
    calificacion: calificacion,
    calidad: calidad,
    tipo: tipo,
    total: episodiosProcesados.length,
    episodios: episodiosProcesados,
    temporadas: temporadas,
    totalEpisodios: episodiosProcesados.length
  };
  
  // Para películas, añadir reproductores directos
  if (tipo === "Película") {
    const reproductores = [];
    if (reproductor && esReproductorValido(reproductor)) {
      reproductores.push({
        url: reproductor,
        servidor: extraerServidor(reproductor),
        idioma: "Desconocido",
        tipo: "reproductor"
      });
    }
    respuesta.reproductores = reproductores;
    respuesta.embeds = reproductores.map(r => r.url);
    respuesta.total = reproductores.length;
  } else {
    // Para series/animes, añadir todos los reproductores encontrados
    const allEmbeds = [];
    for (const ep of episodiosProcesados) {
      for (const embed of ep.embeds) {
        if (!allEmbeds.some(e => e.url === embed.url)) {
          allEmbeds.push(embed);
        }
      }
    }
    respuesta.reproductores = allEmbeds;
    respuesta.embeds = allEmbeds.map(e => e.url);
    respuesta.total = allEmbeds.length;
  }
  
  // Extraer descargas
  let descargas = [];
  const domainUrls = html.match(/domain_url=(https?:\/\/[^"'&\s]+)/gi) || [];
  for (let d = 0; d < domainUrls.length; d++) {
    let raw = domainUrls[d].replace(/^domain_url=/i, '');
    try { raw = decodeURIComponent(raw); } catch (e) {}
    raw = raw.replace(/["'<>),;]+$/g, '');
    if (!raw) continue;
    if (!esDescargaValida(raw)) continue;
    if (!descargas.some(item => item.url === raw)) {
      descargas.push({ url: raw, servidor: extraerServidor(raw), tipo: 'descarga' });
    }
  }
  respuesta.descargas = descargas;
  
  // Si es serie/anime y no tiene episodios, intentar fallback a Lamovie
  if ((tipo === "Serie" || tipo === "Anime") && episodiosProcesados.length === 0 && titulo) {
    try {
      const lamovieResults = await buscarLamovie(titulo, 1);
      if (lamovieResults && lamovieResults.length > 0) {
        const lamovieUrl = lamovieResults[0].link;
        const lamovieData = await scrapearLamovie(lamovieUrl);
        lamovieData.link_original = pageUrl;
        lamovieData.fuente = 'hackstore (via lamovie)';
        return lamovieData;
      }
    } catch (e) {}
  }
  
  return respuesta;
}
