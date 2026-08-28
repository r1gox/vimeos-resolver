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

var REPRODUCTORES_PERMITIDOS = [
  'vimeos.net', 'player.vimeos',
  'goodstream', 'streamwish', 'filemoon', 'voe.',
  'doodstream', 'dood.', 'ds2play', 'doods.pro', 'dsvplay',
  'streamtape', 'mixdrop', 'upstream',
  'vidmoly', 'mp4upload', 'uqload',
  'vidhide', 'vidguard', 'lulustream', 'filelions',
  'yourupload', 'supervideo', 'krakenfiles', 'ok.ru',
  'videoapp.zip', 'videoapp'
];

var REPRODUCTORES_BLOQUEADOS = [
  'lamovie.org', 'lamovie', 'youtube.com', 'youtu.be',
  'youtube-nocookie', 'example.com',
  'sblongvu', 'sbfull', 'fembed', '4shared',
  'oembed', 'wp-json', 'hackstore.fo', 'hackstore'
];

async function handleRequest(request) {
  var url = new URL(request.url);

  if (url.pathname === '/' && !url.searchParams.has('url')) {
    return json({
      status: 'ok',
      service: 'MovieZone Worker',
      sources: ['lamovie', 'hackstore', 'pelisplushd']
    });
  }

  var targetUrl = url.searchParams.get('url');
  var source = url.searchParams.get('source') || detectarFuente(targetUrl);

  if (!targetUrl) {
    return json({ error: 'Falta el parametro ?url=' }, 400);
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

function detectarFuente(u) {
  u = (u || '').toLowerCase();
  if (u.indexOf('pelisplushd') !== -1) return 'pelisplushd';
  if (u.indexOf('hackstore') !== -1) return 'hackstore';
  if (u.indexOf('lamovie') !== -1) return 'lamovie';
  return 'lamovie';
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
    'gofile.io', 'uptobox.com', 'pixeldrain.com', 'megaup.net',
    'magnet:'
  ];
  for (var i = 0; i < hosts.length; i++) {
    if (u.indexOf(hosts[i]) !== -1) return true;
  }
  return false;
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

// ======================================================
// 1. PELISPLUSHD
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
// 2. LAMOVIE
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
// 3. HACKSTORE
// ======================================================
async function scrapearHackstore(pageUrl) {
  var res = await fetch(pageUrl, {
    headers: Object.assign({}, HEADERS, { 'Referer': HACKSTORE_BASE + '/' })
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  var html = await res.text();

  var reproductores = [];
  var descargas = [];
  var vistos = {};

  // Players: /play.php → window.location.href = vimeos/voe/...
  var playMatches = html.match(/(?:https?:\/\/[^"'<>\s]*)?\/play\.php\?[^"'<>\s]+/gi) || [];
  for (var j = 0; j < Math.min(6, playMatches.length); j++) {
    try {
      var playUrl = playMatches[j];
      if (playUrl.indexOf('http') !== 0) {
        playUrl = HACKSTORE_BASE + (playUrl.indexOf('/') === 0 ? playUrl : '/' + playUrl);
      }
      playUrl = playUrl.replace(/&amp;/g, '&').replace(/&#038;/g, '&');

      var playRes = await fetch(playUrl, {
        headers: Object.assign({}, HEADERS, { 'Referer': pageUrl })
      });
      var playHtml = await playRes.text();

      var loc = playHtml.match(/window\.location\.href\s*=\s*['"]([^'"]+)/i) ||
                playHtml.match(/location\.href\s*=\s*['"]([^'"]+)/i);
      if (loc && loc[1]) {
        var real = loc[1].trim();
        if (esReproductorValido(real) && !vistos[real]) {
          vistos[real] = true;
          reproductores.push({
            url: real,
            idioma: 'Desconocido',
            servidor: extraerServidor(real),
            tipo: 'reproductor'
          });
        }
      }
    } catch (e) {}
  }

  // Descargas: domain_url= de favicons
  var domainUrls = html.match(/domain_url=(https?:\/\/[^"'&\s]+)/gi) || [];
  for (var d = 0; d < domainUrls.length; d++) {
    var raw = domainUrls[d].replace(/^domain_url=/i, '');
    try { raw = decodeURIComponent(raw); } catch (e) {}
    raw = raw.replace(/["'<>),;]+$/g, '');
    if (!raw || vistos[raw]) continue;
    if (!esDescargaValida(raw)) continue;
    vistos[raw] = true;
    descargas.push({
      url: raw,
      servidor: extraerServidor(raw),
      tipo: 'descarga'
    });
  }

  // Fallback href directos
  var hrefs = html.match(/href=["'](https?:\/\/[^"']+)["']/gi) || [];
  for (var h = 0; h < hrefs.length; h++) {
    var hu = hrefs[h].replace(/^href=["']/i, '').replace(/["']$/g, '');
    hu = hu.replace(/&amp;/g, '&');
    if (vistos[hu]) continue;
    if (esDescargaValida(hu)) {
      vistos[hu] = true;
      descargas.push({
        url: hu,
        servidor: extraerServidor(hu),
        tipo: 'descarga'
      });
    }
  }

  reproductores.sort(function (a, b) {
    var aV = a.url.toLowerCase().indexOf('vimeos') !== -1 ? 1 : 0;
    var bV = b.url.toLowerCase().indexOf('vimeos') !== -1 ? 1 : 0;
    return bV - aV;
  });

  var titulo = '';
  var t1 = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
  var t2 = html.match(/property=["']og:title["']\s+content=["']([^"']+)["']/i);
  titulo = limpiarTexto((t1 && t1[1]) || (t2 && t2[1]) || '');
  titulo = titulo
    .replace(/^Descargar\s+/i, '')
    .replace(/\s*online\s*$/i, '')
    .replace(/\s*gratis\s*$/i, '')
    .replace(/\s*-\s*Hackstore.*$/i, '')
    .trim();

  var portada = '';
  var p1 = html.match(/property=["']og:image["']\s+content=["']([^"']+)["']/i);
  var p2 = html.match(/thumbnailUrl["']?\s*:\s*["']([^"']+)["']/i);
  var p3 = html.match(/https:\/\/image\.tmdb\.org\/t\/p\/[^"'\\]+/i);
  if (p1) portada = p1[1];
  else if (p2) portada = p2[1];
  else if (p3) portada = p3[0];

  var descripcion = '';
  var d1 = html.match(/property=["']og:description["']\s+content=["']([^"']+)["']/i);
  var d2 = html.match(/name=["']description["']\s+content=["']([^"']+)["']/i);
  descripcion = limpiarTexto((d1 && d1[1]) || (d2 && d2[1]) || '');

  var year = null;
  var yMatch = titulo.match(/\((19|20)\d{2}\)/) || html.match(/\b(19|20)\d{2}\b/);
  if (yMatch) {
    var ym = yMatch[0].match(/(19|20)\d{2}/);
    if (ym) year = ym[0];
  }

  var calificacion = null;
  var cMatch = html.match(/(\d+[.,]\d+)\s*\/\s*10/) || html.match(/(?:rating|imdb|tmdb)[^0-9]{0,15}(\d+[.,]\d+)/i);
  if (cMatch) calificacion = cMatch[1].replace(',', '.');

  var calidad = [];
  var calMatch = html.match(/(4K|1080p|720p|Full HD|HD|BluRay|WEB-DL|HDRip|BDRip)/gi);
  if (calMatch) {
    var set = {};
    for (var c = 0; c < calMatch.length; c++) set[calMatch[c].toUpperCase()] = true;
    calidad = Object.keys(set);
  }

  return {
    success: true,
    fuente: 'hackstore',
    link: pageUrl,
    titulo: titulo || 'Sin titulo',
    portada: portada,
    descripcion: descripcion,
    year: year,
    calificacion: calificacion,
    calidad: calidad,
    total: reproductores.length,
    embeds: reproductores.map(function (r) { return r.url; }),
    reproductores: reproductores,
    descargas: descargas
  };
}
