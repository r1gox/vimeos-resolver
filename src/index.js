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

// ======================================================
// RESOLVERS DE STREAM (YourUpload | MP4Upload | Ryderjet)
// ======================================================

function detectProvider(url) {
  var u = String(url || '').toLowerCase();
  if (/yourupload\.com/i.test(u)) return 'yourupload';
  if (/mp4upload\.com/i.test(u)) return 'mp4upload';
  if (/ryderjet\.com/i.test(u)) return 'ryderjet';
  return null;
}

function toBase(n, base) {
  if (n === 0) return '0';
  var digits = '0123456789abcdefghijklmnopqrstuvwxyz';
  var s = '';
  while (n) {
    s = digits[n % base] + s;
    n = Math.floor(n / base);
  }
  return s || '0';
}

function unpackPacker(html) {
  var start = html.indexOf('eval(function(p,a,c,k,e,d)');
  if (start < 0) throw new Error('Packer no encontrado');
  var end = html.indexOf('</script>', start);
  var packer = end > start ? html.slice(start, end) : html.slice(start);
  var idx = packer.lastIndexOf('}(');
  if (idx < 0) throw new Error('Args del Packer no encontrados');
  var args = packer.slice(idx + 2);

  var m =
    args.match(/^'([\s\S]*)',\s*(\d+)\s*,\s*(\d+)\s*,\s*'([\s\S]*)'\.split\('\|'\)/) ||
    args.match(/^"([\s\S]*)",\s*(\d+)\s*,\s*(\d+)\s*,\s*"([\s\S]*)"\.split\("\|"\)/);
  if (!m) throw new Error('Estructura Packer no reconocida');

  var code = m[1];
  var radix = parseInt(m[2], 10);
  var count = parseInt(m[3], 10);
  var words = m[4].split('|');
  var p = code;
  for (var i = count - 1; i >= 0; i--) {
    if (i < words.length && words[i]) {
      var token = toBase(i, radix);
      p = p.replace(new RegExp('\\b' + token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'g'), words[i]);
    }
  }
  return p;
}

function findStreamUrls(decoded) {
  var urls = [];
  var re1 = /"(hls\d+|file|src)"\s*:\s*"(https?:\/\/[^"]+)"/gi;
  var m;
  while ((m = re1.exec(decoded))) urls.push(m[2]);
  var re2 = /file\s*:\s*["'](https?:\/\/[^"']+)["']/gi;
  while ((m = re2.exec(decoded))) urls.push(m[1]);
  var re3 = /https?:\/\/[^"'\s<>\\]+(?:\.m3u8|master\.txt)(?:\?[^"'\s<>\\]*)?/gi;
  while ((m = re3.exec(decoded))) urls.push(m[0]);
  var re4 = /"hls\d+"\s*:\s*"(https?:\/\/[^"]+)"/gi;
  while ((m = re4.exec(decoded))) urls.push(m[1]);

  var out = [];
  for (var i = 0; i < urls.length; i++) {
    var u = urls[i].replace(/\\\//g, '/').trim().replace(/\\$/, '');
    if (u.indexOf('http') === 0 && out.indexOf(u) === -1) out.push(u);
  }
  return out;
}

// Prefiere una URL cuyo probeStatus haya salido "activo"; si ninguna lo
// está, cae a la primera .m3u8, y si tampoco hay, a la primera de la lista.
function pickBestUrl(urls, hlsStatus) {
  for (var i = 0; i < urls.length; i++) {
    var st = hlsStatus[i];
    if (st && st.status === 'activo') return urls[i];
  }
  for (var j = 0; j < urls.length; j++) {
    if (urls[j].indexOf('.m3u8') !== -1) return urls[j];
  }
  return urls[0] || null;
}

async function probeStatus(streamUrl, ref) {
  try {
    var res = await fetch(streamUrl, {
      method: 'GET',
      headers: {
        'User-Agent': HEADERS['User-Agent'],
        'Referer': ref || '',
        'Origin': ref ? (function () { try { return new URL(ref).origin; } catch (e) { return ''; } })() : '',
        'Accept': '*/*'
      },
      redirect: 'follow'
    });
    if (res.status === 403) return { url: streamUrl, status: 'bloqueado 403' };
    if (res.status >= 400) return { url: streamUrl, status: 'error ' + res.status };
    var body = '';
    try { body = await res.text(); } catch (e) {}
    if (body.indexOf('#EXT') !== -1 || res.status === 200 || res.status === 206) {
      return { url: streamUrl, status: 'activo', body: body.slice(0, 8000) };
    }
    return { url: streamUrl, status: 'activo' };
  } catch (e) {
    return { url: streamUrl, status: 'error: ' + (e.message || e) };
  }
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
      try { stream = new URL(stream, masterUrl).href; } catch (e) {}
    }
    var resM = lines[i].match(/RESOLUTION=(\d+)x(\d+)/);
    var bwM = lines[i].match(/BANDWIDTH=(\d+)/);
    variants.push({
      width: resM ? parseInt(resM[1], 10) : 0,
      height: resM ? parseInt(resM[2], 10) : 0,
      bandwidth: bwM ? parseInt(bwM[1], 10) : 0,
      url: stream
    });
  }
  return variants;
}

function buildRich(opts) {
  var provider = opts.provider;
  var source = opts.source;
  var resolved = opts.resolved_embed || source;
  var type = opts.type || 'hls';
  var hlsList = opts.hls || [];
  var hlsStatus = opts.hls_status || [];
  var qualities = opts.qualities || [];
  var playDirect = opts.play_direct || (qualities[0] && qualities[0].url) || hlsList[0] || null;
  var origin = opts.origin || null;
  var ref = resolved;

  var playProxy = null;
  if (origin && playDirect) {
    playProxy = origin + '/proxy?url=' + encodeURIComponent(playDirect) + '&ref=' + encodeURIComponent(ref);
  }
  for (var i = 0; i < qualities.length; i++) {
    if (!qualities[i].proxy_url && origin && qualities[i].url) {
      qualities[i].proxy_url = origin + '/proxy?url=' + encodeURIComponent(qualities[i].url) + '&ref=' + encodeURIComponent(ref);
    }
  }

  return {
    success: true,
    provider: provider,
    source: source,
    resolved_embed: resolved,
    type: type,
    videos: {
      hls: type === 'hls' ? hlsList : [],
      mp4: type === 'mp4' ? [playDirect].filter(Boolean) : [],
      hls_status: hlsStatus
    },
    qualities: qualities,
    play_url: playProxy || playDirect,
    play_direct: playDirect,
    proxy_url: playProxy,
    url: playDirect,
    master: opts.master || (hlsList[0] || null)
  };
}

// ---------- YOURUPLOAD ----------
async function resolveYourUpload(embedUrl, origin) {
  var res = await fetch(embedUrl, {
    headers: { 'User-Agent': HEADERS['User-Agent'], 'Accept': 'text/html', 'Referer': 'https://www.yourupload.com/' },
    redirect: 'follow'
  });
  if (!res.ok) throw new Error('YourUpload HTTP ' + res.status);
  var html = await res.text();
  var m =
    html.match(/file\s*:\s*["'](https?:\/\/[^"']+\.mp4[^"']*)["']/i) ||
    html.match(/(https?:\/\/vidcache\.net[^"'\s]+\.mp4)/i) ||
    html.match(/(https?:\/\/[^"'\s]+\/video\.mp4)/i);
  if (!m) throw new Error('YourUpload: no se encontró MP4');
  var mp4 = m[1];
  var st = await probeStatus(mp4, embedUrl);
  return buildRich({
    provider: 'yourupload',
    source: embedUrl,
    resolved_embed: embedUrl,
    type: 'mp4',
    play_direct: mp4,
    hls_status: [st],
    qualities: [{ quality: 'default', resolution: null, bandwidth: null, url: mp4 }],
    origin: origin
  });
}

// ---------- MP4UPLOAD ----------
async function resolveMp4Upload(embedUrl, origin) {
  var res = await fetch(embedUrl, {
    headers: { 'User-Agent': HEADERS['User-Agent'], 'Accept': 'text/html', 'Referer': 'https://www.mp4upload.com/' },
    redirect: 'follow'
  });
  if (!res.ok) throw new Error('MP4Upload HTTP ' + res.status);
  var html = await res.text();
  var m =
    html.match(/player\.src\s*\(\s*\{[^}]*src\s*:\s*["'](https?:\/\/[^"']+)["']/i) ||
    html.match(/src\s*:\s*["'](https?:\/\/[^"']+video\.mp4[^"']*)["']/i) ||
    html.match(/(https?:\/\/[^"'\s]*mp4upload\.com[^"'\s]*\/video\.mp4)/i);
  if (!m) throw new Error('MP4Upload: no se encontró MP4');
  var mp4 = m[1];
  var st = await probeStatus(mp4, 'https://www.mp4upload.com/');
  return buildRich({
    provider: 'mp4upload',
    source: embedUrl,
    resolved_embed: embedUrl,
    type: 'mp4',
    play_direct: mp4,
    hls_status: [st],
    qualities: [{ quality: 'default', resolution: null, bandwidth: null, url: mp4 }],
    origin: origin
  });
}

// ---------- RYDERJET ----------
async function resolveRyderjet(embedUrl, origin) {
  var res = await fetch(embedUrl, {
    headers: {
      'User-Agent': HEADERS['User-Agent'],
      'Accept': 'text/html,application/xhtml+xml',
      'Referer': 'https://ryderjet.com/',
      'Accept-Language': 'en-US,en;q=0.9'
    },
    redirect: 'follow'
  });
  if (!res.ok) throw new Error('Ryderjet HTTP ' + res.status);
  var html = await res.text();
  var decoded = unpackPacker(html);
  var urls = findStreamUrls(decoded);
  if (!urls.length) throw new Error('Ryderjet: no se encontraron fuentes HLS');

  var hlsStatus = [];
  var activeBody = null;
  for (var i = 0; i < urls.length; i++) {
    var st = await probeStatus(urls[i], embedUrl);
    hlsStatus.push({ url: st.url, status: st.status });
    if (st.status === 'activo' && !activeBody) activeBody = st.body || null;
  }
  var activeUrl = pickBestUrl(urls, hlsStatus);

  var qualities = [];
  if (activeBody && activeBody.indexOf('#EXT') !== -1) {
    var variants = parseHlsVariants(activeBody, activeUrl);
    for (var v = 0; v < variants.length; v++) {
      var vv = variants[v];
      qualities.push({
        quality: vv.height ? vv.height + 'p' + (vv.width ? ' (' + vv.width + 'x' + vv.height + ')' : '') : 'auto',
        resolution: vv.width && vv.height ? vv.width + 'x' + vv.height : null,
        bandwidth: vv.bandwidth || null,
        url: vv.url
      });
    }
  }
  if (!qualities.length) qualities.push({ quality: 'auto', resolution: null, bandwidth: null, url: activeUrl });

  var play = qualities[0].url;
  for (var q = 0; q < qualities.length; q++) {
    if (/720p/i.test(qualities[q].quality)) { play = qualities[q].url; break; }
  }

  return buildRich({
    provider: 'ryderjet',
    source: embedUrl,
    resolved_embed: embedUrl,
    type: 'hls',
    hls: urls,
    hls_status: hlsStatus,
    master: activeUrl,
    play_direct: play,
    qualities: qualities,
    origin: origin
  });
}

async function resolveAny(embedUrl, origin) {
  var provider = detectProvider(embedUrl);
  if (!provider) {
    return {
      success: false,
      error: 'Provider no soportado',
      soportados: ['yourupload.com', 'mp4upload.com', 'ryderjet.com'],
      source: embedUrl
    };
  }
  if (provider === 'yourupload') return resolveYourUpload(embedUrl, origin);
  if (provider === 'mp4upload') return resolveMp4Upload(embedUrl, origin);
  if (provider === 'ryderjet') return resolveRyderjet(embedUrl, origin);
  return { success: false, error: 'Provider no implementado' };
}

async function handleProxy(request, targetUrl, ref) {
  var headers = { 'User-Agent': HEADERS['User-Agent'], 'Accept': '*/*', 'Referer': ref || 'https://www.google.com/' };
  try { var o = new URL(ref || targetUrl); headers['Origin'] = o.origin; } catch (e) {}
  if (request.headers.has('Range')) headers['Range'] = request.headers.get('Range');

  var upstream = await fetch(targetUrl, { method: 'GET', headers: headers, redirect: 'follow' });
  var out = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS', 'Access-Control-Allow-Headers': '*' };
  ['content-type', 'content-length', 'content-range', 'accept-ranges'].forEach(function (h) {
    if (upstream.headers.has(h)) out[h] = upstream.headers.get(h);
  });
  return new Response(upstream.body, { status: upstream.status, headers: out });
}

async function handleRequest(request) {
  var urlRes = new URL(request.url);
  var pathRes = urlRes.pathname.replace(/\/+$/, '') || '/';
  var partsRes = pathRes.split('/').filter(Boolean);
  var originRes = urlRes.origin;

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS', 'Access-Control-Allow-Headers': '*' }
    });
  }

  if (partsRes[0] === 'proxy') {
    var pT = urlRes.searchParams.get('url') || '';
    var pRef = urlRes.searchParams.get('ref') || '';
    if (!pT) return json({ success: false, error: 'Falta url' }, 400);
    try { pT = decodeURIComponent(pT); } catch (e) {}
    try {
      return await handleProxy(request, pT, pRef);
    } catch (err) {
      return json({ success: false, error: err.message || 'proxy error' }, 502);
    }
  }

  var esRutaResolver =
    partsRes[0] === 'streamurl' ||
    partsRes[0] === 'resolve' ||
    (partsRes[0] === 'yourupload' && partsRes[1] === 'streamurl') ||
    (partsRes[0] === 'mp4upload' && partsRes[1] === 'streamurl') ||
    (partsRes[0] === 'ryderjet' && partsRes[1] === 'streamurl');

  if (esRutaResolver) {
    var embed = urlRes.searchParams.get('url') || '';
    if (!embed) {
      return json({
        success: false,
        error: 'Falta url del embed',
        uso: {
          yourupload: originRes + '/yourupload/streamurl?url=https://www.yourupload.com/embed/XXXX',
          mp4upload: originRes + '/mp4upload/streamurl?url=https://www.mp4upload.com/embed-XXXX.html',
          ryderjet: originRes + '/ryderjet/streamurl?url=https://ryderjet.com/embed/XXXX',
          auto: originRes + '/streamurl?url={embed}'
        }
      }, 400);
    }
    try { embed = decodeURIComponent(embed); } catch (e) {}
    try {
      var rich = await resolveAny(embed, originRes);
      return json(rich, rich.success ? 200 : 502);
    } catch (err) {
      return json({ success: false, error: err.message || 'Error resolviendo', source: embed }, 500);
    }
  }

  var url = urlRes;

  // Health
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
    links[full] = { seccion: seccion, slug: slug, link: full };
  }

  var out = [];
  var keys = Object.keys(links);
  for (var i = 0; i < keys.length && out.length < (limit || 15); i++) {
    var item = links[keys[i]];
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
