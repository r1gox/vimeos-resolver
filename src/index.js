addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
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
  const source = url.searchParams.get('source') || detectarFuente(targetUrl);

  if (!targetUrl) {
    return json({ error: 'Falta el parámetro ?url=' }, 400);
  }

  try {
    let resultado;

    if (source === 'pelisplushd' || targetUrl.includes('pelisplushd')) {
      resultado = await scrapearPelisplus(targetUrl);
    } else if (source === 'hackstore' || targetUrl.includes('hackstore')) {
      resultado = await scrapearGenerico(targetUrl, 'hackstore');
    } else {
      // Por defecto intenta como lamovie / genérico
      resultado = await scrapearGenerico(targetUrl, 'lamovie');
    }

    return json(resultado);
  } catch (err) {
    return json({ error: err.message || 'Error al scrapear' }, 500);
  }
}

function detectarFuente(url = '') {
  const u = url.toLowerCase();
  if (u.includes('pelisplushd')) return 'pelisplushd';
  if (u.includes('hackstore')) return 'hackstore';
  return 'lamovie';
}

// ======================================================
// PELISPLUSHD - Extrae links de reproducción
// ======================================================
async function scrapearPelisplus(pageUrl) {
  const res = await fetch(pageUrl, {
    headers: {
      ...HEADERS,
      'Referer': 'https://www.pelisplushd.la/'
    }
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const html = await res.text();
  const reproductores = [];
  const vistos = new Set();

  // 1. Extraer data-url de los <li class="playurl">
  const regexDataUrl = /data-url=["']([^"']+)["'][^>]*data-name=["']([^"']*)["']/gi;
  let match;
  while ((match = regexDataUrl.exec(html)) !== null) {
    const url = match[1];
    const idioma = match[2] || 'Desconocido';
    if (url && !vistos.has(url)) {
      vistos.add(url);
      reproductores.push({
        url,
        idioma,
        servidor: extraerServidor(url),
        tipo: 'reproductor'
      });
    }
  }

  // 2. Variante invertida (data-name primero)
  const regexDataName = /data-name=["']([^"']*)["'][^>]*data-url=["']([^"']+)["']/gi;
  while ((match = regexDataName.exec(html)) !== null) {
    const idioma = match[1] || 'Desconocido';
    const url = match[2];
    if (url && !vistos.has(url)) {
      vistos.add(url);
      reproductores.push({
        url,
        idioma,
        servidor: extraerServidor(url),
        tipo: 'reproductor'
      });
    }
  }

  // 3. Buscar iframes / embeds sueltos
  const regexIframe = /(?:src|data-src)=["'](https?:\/\/[^"']+(?:streamwish|voe|vidhide|filemoon|dood|mixdrop|uqload|streamtape)[^"']*)["']/gi;
  while ((match = regexIframe.exec(html)) !== null) {
    const url = match[1];
    if (url && !vistos.has(url)) {
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
  const titleMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/i) || 
                     html.match(/property="og:title"\s+content="([^"]+)"/i);
  if (titleMatch) titulo = titleMatch[1].trim();

  // Portada
  let portada = '';
  const imgMatch = html.match(/property="og:image"\s+content="([^"]+)"/i);
  if (imgMatch) portada = imgMatch[1];

  return {
    success: true,
    fuente: 'pelisplushd',
    link: pageUrl,
    titulo: titulo || 'Sin título',
    portada,
    total: reproductores.length,
    embeds: reproductores.map(r => r.url),
    reproductores
  };
}

// ======================================================
// GENÉRICO (lamovie / hackstore) - versión básica
// ======================================================
async function scrapearGenerico(pageUrl, fuente) {
  const res = await fetch(pageUrl, {
    headers: {
      ...HEADERS,
      'Referer': pageUrl
    }
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const html = await res.text();
  const embeds = [];
  const vistos = new Set();

  // Buscar iframes y posibles players
  const regex = /(?:src|data-src|data-url|href)=["'](https?:\/\/[^"']+(?:embed|player|streamwish|voe|vidhide|filemoon|dood|mixdrop|uqload|streamtape|play\.php)[^"']*)["']/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    let url = match[1];
    if (url && !vistos.has(url) && !url.includes('youtube') && !url.includes('image')) {
      vistos.add(url);
      embeds.push(url);
    }
  }

  let titulo = '';
  const titleMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/i) || 
                     html.match(/property="og:title"\s+content="([^"]+)"/i);
  if (titleMatch) titulo = titleMatch[1].trim();

  return {
    success: true,
    fuente,
    link: pageUrl,
    titulo: titulo || 'Sin título',
    total: embeds.length,
    embeds,
    reproductores: embeds.map(url => ({
      url,
      idioma: 'Desconocido',
      servidor: extraerServidor(url),
      tipo: 'reproductor'
    }))
  };
}

function extraerServidor(url) {
  try {
    const host = new URL(url).hostname.replace('www.', '');
    if (host.includes('streamwish')) return 'streamwish';
    if (host.includes('voe')) return 'voe';
    if (host.includes('vidhide')) return 'vidhide';
    if (host.includes('filemoon')) return 'filemoon';
    if (host.includes('dood')) return 'dood';
    if (host.includes('mixdrop')) return 'mixdrop';
    if (host.includes('uqload')) return 'uqload';
    return host.split('.')[0];
  } catch {
    return 'desconocido';
  }
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
