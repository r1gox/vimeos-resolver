addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8'
};

const LAMOVIE_API = 'https://lamovie.org/wp-api/v1';
const LAMOVIE_BASE = 'https://lamovie.org';

const REPRODUCTORES_PERMITIDOS = [
  'vimeos.net', 'player.vimeos',
  'goodstream', 'streamwish', 'filemoon', 'voe.',
  'doodstream', 'dood.', 'ds2play', 'doods.pro',
  'streamtape', 'mixdrop', 'upstream',
  'vidmoly', 'mp4upload', 'uqload',
  'vidhide', 'vidguard', 'lulustream', 'filelions',
  'yourupload', 'supervideo', 'krakenfiles', 'ok.ru'
];

const REPRODUCTORES_BLOQUEADOS = [
  'lamovie.org', 'lamovie', 'youtube.com', 'youtu.be',
  'youtube-nocookie', 'play.php', 'example.com', 'hackstore',
  'sblongvu', 'sbfull', 'fembed', '4shared'
];

async function handleRequest(request) {
  const url = new URL(request.url);

  // Health check
  if (url.pathname === '/' && !url.searchParams.has('url')) {
    return json({
      status: 'ok',
      service: 'MovieZone Worker',
      sources: ['lamovie', 'hackstore', 'pelisplushd']
    });
  }

  const targetUrl = url.searchParams.get('url');
  let source = url.searchParams.get('source') || detectarFuente(targetUrl);

  if (!targetUrl) {
    return json({ error: 'Falta el parámetro ?url=' }, 400);
  }

  try {
    let resultado;

    if (source === 'pelisplushd' || targetUrl.includes('pelisplushd')) {
      resultado = await scrapearPelisplus(targetUrl);
    } else if (source === 'hackstore' || targetUrl.includes('hackstore')) {
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

function detectarFuente(url = '') {
  const u = (url || '').toLowerCase();
  if (u.includes('pelisplushd')) return 'pelisplushd';
  if (u.includes('hackstore')) return 'hackstore';
  if (u.includes('lamovie')) return 'lamovie';
  return 'lamovie';
}

function extraerServidor(url) {
  try {
    const host = new URL(url).hostname.replace('www.', '').toLowerCase();
    if (host.includes('streamwish')) return 'streamwish';
    if (host.includes('voe')) return 'voe';
    if (host.includes('vidhide')) return 'vidhide';
    if (host.includes('filemoon')) return 'filemoon';
    if (host.includes('dood')) return 'dood';
    if (host.includes('mixdrop')) return 'mixdrop';
    if (host.includes('uqload')) return 'uqload';
    if (host.includes('streamtape')) return 'streamtape';
    if (host.includes('vimeos')) return 'vimeos';
    if (host.includes('goodstream')) return 'goodstream';
    if (host.includes('vidmoly')) return 'vidmoly';
    if (host.includes('vidguard')) return 'vidguard';
    if (host.includes('lulustream')) return 'lulustream';
    return host.split('.')[0];
  } catch {
    return 'desconocido';
  }
}

function limpiarTexto(txt) {
  if (!txt) return '';
  return txt.replace(/\s+/g, ' ').trim();
}

function esReproductorValido(url) {
  if (!url) return false;
  const u = String(url).toLowerCase().trim();
  if (!/^https?:\/\//i.test(u)) return false;
  if (/\.(jpg|jpeg|png|webp|gif|svg|ico|css|woff2?)(\?|$)/i.test(u)) return false;
  if (REPRODUCTORES_BLOQUEADOS.some(d => u.includes(d))) return false;
  return REPRODUCTORES_PERMITIDOS.some(d => u.includes(d));
}

// ======================================================
// 1. PELISPLUSHD
// ======================================================
async function scrapearPelisplus(pageUrl) {
  const res = await fetch(pageUrl, {
    headers: { ...HEADERS, 'Referer': 'https://www.pelisplushd.la/' }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();

  const reproductores = [];
  const vistos = new Set();

  const regex1 = /data-url=["']([^"']+)["'][^>]*data-name=["']([^"']*)["']/gi;
  let m;
  while ((m = regex1.exec(html)) !== null) {
    const url = m[1];
    const idioma = m[2] || 'Desconocido';
    if (url && !vistos.has(url)) {
      vistos.add(url);
      reproductores.push({ url, idioma, servidor: extraerServidor(url), tipo: 'reproductor' });
    }
  }

  const regex2 = /data-name=["']([^"']*)["'][^>]*data-url=["']([^"']+)["']/gi;
  while ((m = regex2.exec(html)) !== null) {
    const idioma = m[1] || 'Desconocido';
    const url = m[2];
    if (url && !vistos.has(url)) {
      vistos.add(url);
      reproductores.push({ url, idioma, servidor: extraerServidor(url), tipo: 'reproductor' });
    }
  }

  let titulo = '';
  const t1 = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
  const t2 = html.match(/property=["']og:title["']\s+content=["']([^"']+)["']/i);
  titulo = limpiarTexto((t1 && t1[1]) || (t2 && t2[1]) || '');

  let portada = '';
  const p1 = html.match(/property=["']og:image["']\s+content=["']([^"']+)["']/i);
  if (p1) portada = p1[1];

  let descripcion = '';
  const d1 = html.match(/property=["']og:description["']\s+content=["']([^"']+)["']/i);
  const d2 = html.match(/name=["']description["']\s+content=["']([^"']+)["']/i);
  descripcion = limpiarTexto((d1 && d1[1]) || (d2 && d2[1]) || '');

  let year = null;
  const y1 = html.match(/(?:Año|Year|Estreno)[^0-9]{0,20}(19|20)\d{2}/i) ||
             html.match(/\b(19|20)\d{2}\b/);
  if (y1) year = y1[0].match(/(19|20)\d{2}/)[0];

  let calificacion = null;
  const c1 = html.match(/(?:IMDb|TMDB|Calificación|Rating)[^0-9]{0,15}(\d+[.,]\d+)/i) ||
             html.match(/(\d+[.,]\d+)\s*\/\s*10/);
  if (c1) calificacion = c1[1].replace(',', '.');

  let calidad = [];
  const calMatch = html.match(/(?:Calidad|Quality)[^A-Z0-9]{0,20}(4K|1080p|720p|HD|Full HD|BluRay|WEB-DL|HDRip)/gi);
  if (calMatch) {
    calidad = [...new Set(calMatch.map(x => x.match(/(4K|1080p|720p|HD|Full HD|BluRay|WEB-DL|HDRip)/i)[0]))];
  }

  return {
    success: true,
    fuente: 'pelisplushd',
    link: pageUrl,
    titulo: titulo || 'Sin título',
    portada,
    descripcion,
    year,
    calificacion,
    calidad,
    total: reproductores.length,
    embeds: reproductores.map(r => r.url),
    reproductores
  };
}

// ======================================================
// 2. LAMOVIE (convertido desde MOVIEZONE — usa API)
// ======================================================
function extraerSlugLamovie(pageUrl) {
  const m = pageUrl.match(/\/(?:peliculas|series|animes|pelicula|serie|anime)\/([^\/\?]+)/i);
  return m ? m[1].replace(/\/$/, '') : null;
}

async function buscarPostIdPorSlug(slug) {
  const url = `\( {LAMOVIE_API}/search?postType=any&q= \){encodeURIComponent(slug)}&postsPerPage=5`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
      'Accept': 'application/json'
    }
  });
  if (!res.ok) return null;
  const data = await res.json();
  const posts = data?.data?.posts || data?.data || [];
  if (!Array.isArray(posts)) return null;

  const exacto = posts.find(p => p.slug === slug);
  if (exacto) return { postId: exacto._id, post: exacto };

  if (posts[0]) return { postId: posts[0]._id, post: posts[0] };
  return null;
}

async function getPlayerLamovie(postId) {
  const url = `\( {LAMOVIE_API}/player?postId= \){postId}&demo=0`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
      'Accept': 'application/json',
      'Referer': LAMOVIE_BASE + '/'
    }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} en /player`);

  const data = await res.json();
  let embeds = data?.data?.embeds || [];
  let downloads = data?.data?.downloads || [];

  if ((!embeds || embeds.length === 0) && data?.data) {
    const d = data.data;
    const extras = [].concat(d.players || [], d.servers || [], d.sources || [], d.links || []);
    if (extras.length) embeds = extras;
  }

  const normalizar = (e) => {
    if (!e) return null;
    const url = typeof e === 'string' ? e : (e.url || e.link || e.src || null);
    if (!url) return null;
    return {
      url,
      idioma: e.lang || e.language || e.idioma || e.audio || 'Desconocido',
      servidor: extraerServidor(url),
      tipo: 'reproductor'
    };
  };

  const normalizarDl = (d) => {
    if (!d) return null;
    const url = typeof d === 'string' ? d : (d.url || d.link || d.href || null);
    if (!url) return null;
    return {
      url,
      servidor: extraerServidor(url),
      tipo: 'descarga'
    };
  };

  embeds = embeds.map(normalizar).filter(Boolean);
  downloads = downloads.map(normalizarDl).filter(Boolean);

  const embedsValidos = embeds.filter(e => esReproductorValido(e.url));
  const embedsInvalidos = embeds.filter(e => e.url && !esReproductorValido(e.url));

  // Resolver placeholders de Lamovie
  if (embedsValidos.length === 0 && embedsInvalidos.length > 0) {
    for (const inv of embedsInvalidos.slice(0, 2)) {
      if (!inv.url || !String(inv.url).includes('lamovie')) continue;
      try {
        const htmlRes = await fetch(inv.url, {
          headers: { ...HEADERS, 'Referer': LAMOVIE_BASE + '/' }
        });
        const html = await htmlRes.text();
        const urls = html.match(/https?:\/\/[^\s"'<>\\]+/gi) || [];
        for (const u of urls) {
          const limpia = u
            .replace(/\\u002F/g, '/')
            .replace(/\\\//g, '/')
            .replace(/["'<>),;]+$/g, '');
          if (esReproductorValido(limpia) && !embedsValidos.some(e => e.url === limpia)) {
            embedsValidos.push({
              url: limpia,
              idioma: 'Desconocido',
              servidor: extraerServidor(limpia),
              tipo: 'reproductor'
            });
          }
        }
      } catch (_) {}
    }
  }

  // Vimeos primero
  embedsValidos.sort((a, b) => {
    const aV = /vimeos/i.test(a.url);
    const bV = /vimeos/i.test(b.url);
    if (aV && !bV) return -1;
    if (!aV && bV) return 1;
    return 0;
  });

  return {
    embeds: embedsValidos.length > 0
      ? embedsValidos
      : embeds.filter(e => e.url && !/youtube|youtu\.be/i.test(e.url)),
    downloads
  };
}

async function scrapearLamovie(pageUrl) {
  const slug = extraerSlugLamovie(pageUrl);
  if (!slug) throw new Error('No se pudo extraer el slug de la URL de Lamovie');

  const encontrado = await buscarPostIdPorSlug(slug);
  if (!encontrado || !encontrado.postId) {
    throw new Error(`No se encontró postId para el slug: ${slug}`);
  }

  const { postId, post } = encontrado;
  const { embeds, downloads } = await getPlayerLamovie(postId);

  let titulo = post?.title || 'Sin título';
  let portada = '';
  if (post?.images?.poster) {
    portada = post.images.poster.startsWith('http')
      ? post.images.poster
      : `https://lamovie.org/wp-content/uploads${post.images.poster}`;
  }
  let descripcion = post?.overview || '';
  let year = post?.release_date ? String(post.release_date).slice(0, 4) : null;
  let calificacion = post?.rating || post?.imdb_rating || null;

  let calidad = [];
  if (Array.isArray(post?.quality)) {
    // ya viene como IDs, no lo resolvemos aquí
  }

  return {
    success: true,
    fuente: 'lamovie',
    link: pageUrl,
    postId,
    titulo,
    portada,
    descripcion,
    year,
    calificacion,
    calidad,
    total: embeds.length,
    embeds: embeds.map(e => e.url),
    reproductores: embeds,
    descargas: downloads
  };
}

// ======================================================
// 3. HACKSTORE
// ======================================================
async function scrapearHackstore(pageUrl) {
  const res = await fetch(pageUrl, {
    headers: { ...HEADERS, 'Referer': 'https://www.hackstore.fo/' }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();

  const reproductores = [];
  const descargas = [];
  const vistos = new Set();

  const regex = /(?:src|data-src|data-url|href)=["'](https?:\/\/[^"']+(?:embed|player|streamwish|voe|vidhide|filemoon|dood|mixdrop|uqload|streamtape|play\.php)[^"']*)["']/gi;
  let m;
  while ((m = regex.exec(html)) !== null) {
    let url = m[1];
    if (url && !vistos.has(url) && !url.includes('youtube') && !url.match(/\.(jpg|png|webp|gif)/i)) {
      vistos.add(url);
      reproductores.push({
        url,
        idioma: 'Desconocido',
        servidor: extraerServidor(url),
        tipo: 'reproductor'
      });
    }
  }

  const hostsDescarga = ['mega.nz', 'mega.co.nz', 'mediafire.com', '1fichier.com', 'gofile.io', 'uptobox.com', 'pixeldrain.com'];
  const regexDesc = /href=["'](https?:\/\/[^"']+)["']/gi;
  while ((m = regexDesc.exec(html)) !== null) {
    const url = m[1];
    if (hostsDescarga.some(h => url.toLowerCase().includes(h)) && !vistos.has(url)) {
      vistos.add(url);
      descargas.push({
        url,
        servidor: hostsDescarga.find(h => url.toLowerCase().includes(h)) || 'otro',
        tipo: 'descarga'
      });
    }
  }

  let titulo = '';
  const t1 = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
  const t2 = html.match(/property=["']og:title["']\s+content=["']([^"']+)["']/i);
  titulo = limpiarTexto((t1 && t1[1]) || (t2 && t2[1]) || '');
  titulo = titulo.replace(/^Descargar\s+/i, '').replace(/\s*online\s*\( /i, '').replace(/\s*gratis\s* \)/i, '');

  let portada = '';
  const p1 = html.match(/property=["']og:image["']\s+content=["']([^"']+)["']/i);
  if (p1) portada = p1[1];

  let descripcion = '';
  const d1 = html.match(/property=["']og:description["']\s+content=["']([^"']+)["']/i);
  const d2 = html.match(/name=["']description["']\s+content=["']([^"']+)["']/i);
  descripcion = limpiarTexto((d1 && d1[1]) || (d2 && d2[1]) || '');

  let year = null;
  const yMatch = html.match(/\b(19|20)\d{2}\b/);
  if (yMatch) year = yMatch[0];

  let calificacion = null;
  const cMatch = html.match(/(\d+[.,]\d+)\s*\/\s*10/) || html.match(/(?:rating|imdb|tmdb)[^0-9]{0,15}(\d+[.,]\d+)/i);
  if (cMatch) calificacion = cMatch[1].replace(',', '.');

  let calidad = [];
  const calMatch = html.match(/(4K|1080p|720p|Full HD|HD|BluRay|WEB-DL|HDRip|BDRip)/gi);
  if (calMatch) calidad = [...new Set(calMatch)];

  return {
    success: true,
    fuente: 'hackstore',
    link: pageUrl,
    titulo: titulo || 'Sin título',
    portada,
    descripcion,
    year,
    calificacion,
    calidad,
    total: reproductores.length,
    embeds: reproductores.map(r => r.url),
    reproductores,
    descargas
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    }
  });
}
