addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8'
};

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
    return host.split('.')[0];
  } catch {
    return 'desconocido';
  }
}

function limpiarTexto(txt) {
  if (!txt) return '';
  return txt.replace(/\s+/g, ' ').trim();
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

  // data-url + data-name
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

  // Título
  let titulo = '';
  const t1 = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
  const t2 = html.match(/property=["']og:title["']\s+content=["']([^"']+)["']/i);
  titulo = limpiarTexto((t1 && t1[1]) || (t2 && t2[1]) || '');

  // Portada
  let portada = '';
  const p1 = html.match(/property=["']og:image["']\s+content=["']([^"']+)["']/i);
  if (p1) portada = p1[1];

  // Sinopsis / Descripción
  let descripcion = '';
  const d1 = html.match(/property=["']og:description["']\s+content=["']([^"']+)["']/i);
  const d2 = html.match(/name=["']description["']\s+content=["']([^"']+)["']/i);
  descripcion = limpiarTexto((d1 && d1[1]) || (d2 && d2[1]) || '');

  // Año
  let year = null;
  const y1 = html.match(/(?:Año|Year|Estreno)[^0-9]{0,20}(19|20)\d{2}/i) || 
             html.match(/\b(19|20)\d{2}\b/);
  if (y1) year = y1[0].match(/(19|20)\d{2}/)[0];

  // Calificación
  let calificacion = null;
  const c1 = html.match(/(?:IMDb|TMDB|Calificación|Rating)[^0-9]{0,15}(\d+[.,]\d+)/i) ||
             html.match(/(\d+[.,]\d+)\s*\/\s*10/);
  if (c1) calificacion = c1[1].replace(',', '.');

  // Calidad
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
// 2. LAMOVIE
// ======================================================
async function scrapearLamovie(pageUrl) {
  const res = await fetch(pageUrl, {
    headers: { ...HEADERS, 'Referer': 'https://lamovie.org/' }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();

  const reproductores = [];
  const vistos = new Set();

  // Buscar iframes y posibles players
  const regex = /(?:src|data-src|data-url|href)=["'](https?:\/\/[^"']+(?:embed|player|streamwish|voe|vidhide|filemoon|dood|mixdrop|uqload|streamtape|play\.php|lamovie)[^"']*)["']/gi;
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

  // Título
  let titulo = '';
  const t1 = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
  const t2 = html.match(/property=["']og:title["']\s+content=["']([^"']+)["']/i);
  titulo = limpiarTexto((t1 && t1[1]) || (t2 && t2[1]) || '');

  // Portada
  let portada = '';
  const p1 = html.match(/property=["']og:image["']\s+content=["']([^"']+)["']/i);
  if (p1) portada = p1[1];

  // Descripción
  let descripcion = '';
  const d1 = html.match(/property=["']og:description["']\s+content=["']([^"']+)["']/i);
  const d2 = html.match(/name=["']description["']\s+content=["']([^"']+)["']/i);
  descripcion = limpiarTexto((d1 && d1[1]) || (d2 && d2[1]) || '');

  // Año
  let year = null;
  const yMatch = html.match(/\b(19|20)\d{2}\b/);
  if (yMatch) year = yMatch[0];

  // Calificación
  let calificacion = null;
  const cMatch = html.match(/(\d+[.,]\d+)\s*\/\s*10/) || html.match(/(?:rating|imdb|tmdb)[^0-9]{0,15}(\d+[.,]\d+)/i);
  if (cMatch) calificacion = cMatch[1].replace(',', '.');

  // Calidad
  let calidad = [];
  const calMatch = html.match(/(4K|1080p|720p|Full HD|HD|BluRay|WEB-DL|HDRip)/gi);
  if (calMatch) calidad = [...new Set(calMatch)];

  return {
    success: true,
    fuente: 'lamovie',
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

  // Reproductores / embeds
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

  // Posibles descargas (Mega, Mediafire, etc.)
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

  // Título
  let titulo = '';
  const t1 = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
  const t2 = html.match(/property=["']og:title["']\s+content=["']([^"']+)["']/i);
  titulo = limpiarTexto((t1 && t1[1]) || (t2 && t2[1]) || '');
  // Limpiar títulos genéricos
  titulo = titulo.replace(/^Descargar\s+/i, '').replace(/\s*online\s*$/i, '').replace(/\s*gratis\s*$/i, '');

  // Portada
  let portada = '';
  const p1 = html.match(/property=["']og:image["']\s+content=["']([^"']+)["']/i);
  if (p1) portada = p1[1];

  // Descripción
  let descripcion = '';
  const d1 = html.match(/property=["']og:description["']\s+content=["']([^"']+)["']/i);
  const d2 = html.match(/name=["']description["']\s+content=["']([^"']+)["']/i);
  descripcion = limpiarTexto((d1 && d1[1]) || (d2 && d2[1]) || '');

  // Año
  let year = null;
  const yMatch = html.match(/\b(19|20)\d{2}\b/);
  if (yMatch) year = yMatch[0];

  // Calificación
  let calificacion = null;
  const cMatch = html.match(/(\d+[.,]\d+)\s*\/\s*10/) || html.match(/(?:rating|imdb|tmdb)[^0-9]{0,15}(\d+[.,]\d+)/i);
  if (cMatch) calificacion = cMatch[1].replace(',', '.');

  // Calidad
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
