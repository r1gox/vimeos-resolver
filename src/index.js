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

const HACKSTORE_BASE = 'https://www.hackstore.fo';

// Dominios que SÍ aceptamos como reproductor
const REPRODUCTORES_PERMITIDOS = [
    "vimeos.net", "player.vimeos", "goodstream.one", "goodstream.uno", "goodstream",
    "streamwish", "filemoon", "voe.sx", "voe.", "doodstream", "dood.", "ds2play",
    "doods.pro", "streamtape", "mixdrop", "upstream", "vidmoly", "mp4upload",
    "uqload", "vidhide", "vidguard", "lulustream", "filelions", "yourupload",
    "supervideo", "krakenfiles", "ok.ru", "okru"
];

// Dominios basura que rechazamos explícitamente
const REPRODUCTORES_BLOQUEADOS = [
    "sblongvu.com", "sblongvu", "sblanh", "sbfull", "sbfast", "sbthe.com", "sbanh",
    "sbrity", "sbbrisk", "sblona", "lvturbo", "diasfem", "fembed", "4shared",
    "lamovie.org", "lamovie", "youtube.com", "youtu.be", "play.php", "example.com",
    "hackstore.fo"
];

// Palabras para filtrar resultados de búsqueda genéricos
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
    // Bloqueados siempre
    if (REPRODUCTORES_BLOQUEADOS.some(d => u.includes(d))) return false;
    // Solo permitidos
    return REPRODUCTORES_PERMITIDOS.some(d => u.includes(d));
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

function json(data, status) {
    return new Response(JSON.stringify(data, null, 2), {
        status: status || 200,
        headers: { 
            'Content-Type': 'application/json; charset=utf-8', 
            'Access-Control-Allow-Origin': '*' 
        }
    });
}

function detectarTipo(url, nombre = "") {
    const texto = `${url} ${nombre}`.toLowerCase();
    if (texto.includes("/anime/") || texto.includes("/animes/") || texto.includes("anime")) return "Anime";
    if (texto.includes("/series/") || texto.includes("serie")) return "Serie";
    return "Película";
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

function extraerTitulo($, link) {
    let nombre = null;
    
    // Intentar con h1
    $("h1").each((_, el) => {
        if (nombre) return;
        const texto = $(el).text().trim().replace(/\s+/g, " ");
        if (!esTituloGenerico(texto)) nombre = texto;
    });
    
    // Intentar con og:title
    if (!nombre) {
        const titulo = $('meta[property="og:title"]').attr("content");
        if (titulo && !esTituloGenerico(titulo)) nombre = titulo.trim().replace(/\s+/g, " ");
    }
    
    // Intentar con title
    if (!nombre) {
        const titulo = $("title").first().text().trim().replace(/\s+/g, " ");
        if (titulo && !esTituloGenerico(titulo)) nombre = titulo;
    }
    
    // Último recurso: extraer del slug
    if (!nombre) {
        try {
            const url = new URL(link);
            const partes = url.pathname.split("/").filter(Boolean);
            if (partes.length) {
                let slug = partes[partes.length - 1]
                    .replace(/-\d{4}$/, "")
                    .replace(/[-_]+/g, " ")
                    .trim();
                if (slug) {
                    nombre = slug.replace(/\b\w/g, l => l.toUpperCase());
                }
            }
        } catch {}
    }
    
    // Limpiar nombre
    if (nombre) {
        nombre = nombre
            .replace(/\s*\|\s*MisVideos.*$/i, "")
            .replace(/\s*-\s*MisVideos.*$/i, "")
            .replace(/^Descargar\s+(serie|película|pelicula|anime)\s+/i, "")
            .replace(/^Ver\s+/i, "")
            .replace(/\s*online\s*$/i, "")
            .replace(/\s*gratis\s*$/i, "")
            .trim();
    }
    
    return nombre;
}

function extraerYearDelTitulo(nombre) {
    if (!nombre) return null;
    const match = nombre.match(/\((19|20)\d{2}\)/) || nombre.match(/\b(19|20)\d{2}\b/);
    if (match) {
        const yearMatch = match[0].match(/(19|20)\d{2}/);
        if (yearMatch) return yearMatch[0];
    }
    return null;
}

function extraerPortada($, link) {
    const candidatos = [];
    
    function agregar(urlImg) {
        if (!urlImg) return;
        try {
            let limpia = String(urlImg).trim();
            if (limpia.includes(" ")) limpia = limpia.split(/\s+/)[0];
            const absoluta = unirUrl(link, limpia);
            if (!absoluta) return;
            if (!candidatos.includes(absoluta)) candidatos.push(absoluta);
        } catch {}
    }
    
    // Meta tags
    agregar($('meta[property="og:image"]').attr("content"));
    agregar($('meta[property="og:image:secure_url"]').attr("content"));
    agregar($('meta[name="twitter:image"]').attr("content"));
    agregar($('meta[itemprop="image"]').attr("content"));
    
    // Imágenes
    $("img").each((_, img) => {
        const el = $(img);
        const posibles = [
            el.attr("src"),
            el.attr("data-src"),
            el.attr("data-lazy-src"),
            el.attr("data-original"),
            el.attr("srcset")
        ];
        for (const imagen of posibles) {
            if (!imagen) continue;
            const texto = imagen.toLowerCase();
            if (texto.includes("logo") || texto.includes("avatar") || texto.includes("icon") ||
                texto.includes("banner") || texto.includes("placeholder") || texto.includes("loading") ||
                texto.includes("spinner") || texto.includes("1x1") || texto.includes("pixel")) {
                continue;
            }
            agregar(imagen);
        }
    });
    
    if (candidatos.length === 0) {
        return "";
    }
    
    // Ordenar por relevancia
    candidatos.sort((a, b) => {
        const score = (u) => {
            let s = 0;
            const low = u.toLowerCase();
            if (low.includes("image.tmdb.org") || low.includes("tmdb.org")) s += 100;
            if (low.includes("poster") || low.includes("cover") || low.includes("portada")) s += 50;
            if (low.includes("/w500/") || low.includes("/w300/") || low.includes("/original/")) s += 30;
            if (low.includes(".jpg") || low.includes(".jpeg") || low.includes(".webp") || low.includes(".png")) s += 10;
            return s;
        };
        return score(b) - score(a);
    });
    
    return candidatos[0];
}

function extraerDescripcion($) {
    // Meta tags
    const posiblesMeta = [
        $('meta[property="og:description"]').attr("content"),
        $('meta[name="description"]').attr("content"),
        $('meta[name="twitter:description"]').attr("content")
    ];
    for (const d of posiblesMeta) {
        if (d && d.trim().length > 40) {
            return d.trim().replace(/\s+/g, " ");
        }
    }
    
    // Selectores comunes
    const selectores = [
        ".description", ".sinopsis", ".synopsis", ".plot",
        ".entry-content p", ".post-content p", ".content p",
        "article p", ".movie-description", ".desc", "#description",
        ".text-content p"
    ];
    for (const selector of selectores) {
        const elementos = $(selector);
        if (elementos.length > 0) {
            let texto = "";
            elementos.each((_, el) => {
                const t = $(el).text().trim();
                if (t.length > 30) {
                    texto += t + " ";
                }
            });
            texto = texto.trim().replace(/\s+/g, " ");
            if (texto.length > 60) {
                return texto;
            }
        }
    }
    
    // Último recurso: primer párrafo largo
    let mejor = "";
    $("p").each((_, el) => {
        const t = $(el).text().trim().replace(/\s+/g, " ");
        if (t.length > mejor.length && t.length > 80) {
            mejor = t;
        }
    });
    
    return mejor || "";
}

// ======================================================
// EXTRACCIÓN DE REPRODUCTOR (siguiendo redirecciones)
// ======================================================
async function extraerReproductor(url, $pagina) {
    const candidatos = [];
    
    function agregar(urlEncontrada) {
        if (!urlEncontrada) return;
        try {
            const absoluta = new URL(urlEncontrada, url).toString();
            if (!candidatos.includes(absoluta)) candidatos.push(absoluta);
        } catch {}
    }
    
    // Buscar en iframes
    $pagina("iframe").each((_, el) => {
        agregar($pagina(el).attr("src"));
        agregar($pagina(el).attr("data-src"));
        agregar($pagina(el).attr("data-url"));
        agregar($pagina(el).attr("data-embed"));
    });
    
    // Buscar en embeds
    $pagina("embed").each((_, el) => agregar($pagina(el).attr("src")));
    
    // Buscar en video/source
    $pagina("video, source").each((_, el) => {
        agregar($pagina(el).attr("src"));
        agregar($pagina(el).attr("data-src"));
    });
    
    // Buscar en atributos data-*
    $pagina("[data-player], [data-video], [data-iframe]").each((_, el) => {
        agregar($pagina(el).attr("data-player") || $pagina(el).attr("data-video") || $pagina(el).attr("data-iframe"));
    });
    
    // Buscar URLs en el HTML
    const html = $pagina.html() || "";
    const regex = /https?:\/\/[^\s"'<>\\]+/gi;
    const urls = html.match(regex) || [];
    for (const encontrada of urls) {
        let limpia = encontrada.replace(/\\u002F/g, "/").replace(/\\\//g, "/").replace(/["'<>),]+$/g, "");
        agregar(limpia);
    }
    
    // Ordenar: priorizar play.php, embed, player, etc.
    const prioridad = ["play.php", "/embed/", "/player/", "/embed-", "iframe", ".m3u8", ".mp4"];
    candidatos.sort((a, b) => {
        const pa = prioridad.findIndex(x => a.toLowerCase().includes(x));
        const pb = prioridad.findIndex(x => b.toLowerCase().includes(x));
        return (pa === -1 ? 999 : pa) - (pb === -1 ? 999 : pb);
    });
    
    // Probar cada candidato
    for (const candidato of candidatos) {
        try {
            // Si es un archivo directo, devolverlo
            if (candidato.includes(".m3u8") || candidato.includes(".mp4")) {
                return candidato;
            }
            
            // Si es play.php, seguir la redirección
            if (candidato.includes("play.php")) {
                const htmlPlayer = await obtenerHTML(candidato);
                const match = htmlPlayer.match(/window\.location\.href\s*=\s*["']([^"']+)/i) ||
                              htmlPlayer.match(/location\.href\s*=\s*["']([^"']+)/i);
                if (match) {
                    const siguiente = unirUrl(candidato, match[1]);
                    if (siguiente && esReproductorValido(siguiente)) {
                        return siguiente;
                    }
                }
                // Buscar URLs en el player
                const urlsPlayer = htmlPlayer.match(regex) || [];
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
            
            // Si es embed/player, devolverlo directamente
            if (candidato.includes("/embed/") || candidato.includes("/player/") || candidato.includes("embed-")) {
                if (esReproductorValido(candidato)) {
                    return candidato;
                }
            }
        } catch {}
    }
    
    return null;
}

// ======================================================
// EXTRACCIÓN DE EPISODIOS (basado en MOVIEZONE)
// ======================================================
function extraerEpisodios($, paginaBase) {
    const episodios = [];
    const vistos = new Set();
    
    $("a[href]").each((_, elemento) => {
        let texto = $(elemento).text().trim().replace(/\s+/g, " ");
        
        // Limpiar texto
        texto = texto
            .replace(/\.text\s*\{[^}]*\}/gi, "")
            .replace(/font-size:[^;]+;/gi, "")
            .replace(/font-weight:[^;]+;/gi, "")
            .replace(/fill:\s*#[0-9a-f]+;/gi, "")
            .replace(/\{[^}]*\}/g, "")
            .trim();
        
        // Buscar patrones de episodio
        const match = texto.match(/(\d+\s*[x×]\s*\d+|episodio\s*\d+|ep\.?\s*\d+|capítulo\s*\d+|capitulo\s*\d+)/i);
        if (match) {
            texto = match[0].replace(/\s+/g, "");
        }
        
        // Si no tiene texto, intentar con el href
        if (!texto || texto.length < 2 || texto.toLowerCase().includes("disponible")) {
            const href = $(elemento).attr("href") || "";
            const matchHref = href.match(/(\d+[x×]\d+|episodio[-_]?\d+|ep[-_]?\d+)/i);
            if (matchHref) {
                texto = matchHref[0].replace(/[-_]/g, " ");
            } else {
                return;
            }
        }
        
        const href = $(elemento).attr("href");
        if (!href) return;
        
        const url = unirUrl(paginaBase, href);
        if (!url) return;
        
        const contenido = `${texto} ${url}`.toLowerCase();
        const pareceEpisodio = /episodio|episode|capitulo|capítulo|\bep\.?\s*\d+|\b\d+x\d+\b/i.test(contenido);
        
        if (!pareceEpisodio || vistos.has(url) || url === paginaBase) return;
        
        vistos.add(url);
        
        // Extraer número de temporada y episodio
        let temporada = null;
        let episodioNum = null;
        
        // Buscar patrones como "T1 E1", "1x1", "temporada 1", etc.
        const tMatch = contenido.match(/(?:temporada|season)\s*(\d+)/i);
        if (tMatch) temporada = parseInt(tMatch[1]);
        
        const eMatch = contenido.match(/(?:episodio|episode|capítulo|capitulo|ep)\s*(\d+)/i);
        if (eMatch) episodioNum = parseInt(eMatch[1]);
        
        // Si no se encontró, intentar con formato "1x1"
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
    });
    
    return episodios;
}

// ======================================================
// OBTENER HTML
// ======================================================
async function obtenerHTML(url) {
    const response = await fetch(url, { headers: HEADERS });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
}

async function obtenerCheerio(url) {
    const html = await obtenerHTML(url);
    const cheerio = require('cheerio');
    return cheerio.load(html);
}

// ======================================================
// SCRAPER PRINCIPAL DE HACKSTORE (MEJORADO)
// ======================================================
async function scrapearHackstore(link) {
    console.log(`[Hackstore] Scrapeando: ${link}`);
    
    const html = await obtenerHTML(link);
    const cheerio = require('cheerio');
    const $ = cheerio.load(html);
    
    // Extraer metadatos
    const nombre = extraerTitulo($, link);
    const portada = extraerPortada($, link);
    const descripcion = extraerDescripcion($);
    const tipo = detectarTipo(link, nombre || "");
    let year = extraerYearDelTitulo(nombre);
    
    // Si no se encontró año en el título, buscar en la URL
    if (!year) {
        const urlYear = link.match(/-\d{4}/);
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
    
    // Extraer reproductor directo (si existe)
    let reproductorDirecto = await extraerReproductor(link, $);
    let soloTrailer = false;
    
    // Extraer episodios (si es serie o anime)
    let episodios = [];
    let temporadas = [];
    
    if (tipo === "Serie" || tipo === "Anime") {
        episodios = extraerEpisodios($, link);
        console.log(`[Hackstore] Encontrados ${episodios.length} episodios`);
        
        // Procesar cada episodio para obtener su video
        const episodiosProcesados = [];
        const limiteEp = Math.min(episodios.length, 20); // Limitar para no saturar
        
        for (let i = 0; i < limiteEp; i++) {
            const ep = episodios[i];
            try {
                console.log(`[Hackstore] Procesando episodio: ${ep.nombre} (${ep.link})`);
                const epHtml = await obtenerHTML(ep.link);
                const ep$ = cheerio.load(epHtml);
                let video = await extraerReproductor(ep.link, ep$);
                let epSoloTrailer = false;
                
                if (video && (video.includes("youtube.com") || video.includes("youtu.be"))) {
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
            } catch (err) {
                console.error(`[Hackstore] Error procesando episodio ${ep.nombre}:`, err.message);
                episodiosProcesados.push({
                    ...ep,
                    video: null,
                    embeds: [],
                    downloads: [],
                    soloTrailer: false
                });
            }
        }
        
        episodios = episodiosProcesados;
        
        // Agrupar por temporada
        const tempMap = {};
        for (const ep of episodios) {
            const tempNum = ep.temporada || 1;
            if (!tempMap[tempNum]) tempMap[tempNum] = [];
            tempMap[tempNum].push(ep);
        }
        
        temporadas = Object.keys(tempMap).sort((a, b) => parseInt(a) - parseInt(b)).map(num => {
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
    }
    
    // Construir respuesta
    const respuesta = {
        success: true,
        fuente: 'hackstore',
        link: link,
        titulo: nombre || 'Sin título',
        portada: portada,
        descripcion: descripcion,
        year: year,
        calificacion: calificacion,
        calidad: calidad,
        tipo: tipo
    };
    
    // Si es película, añadir reproductores directos
    if (tipo === "Película") {
        const reproductores = [];
        if (reproductorDirecto && esReproductorValido(reproductorDirecto)) {
            reproductores.push({
                url: reproductorDirecto,
                servidor: extraerServidor(reproductorDirecto),
                idioma: "Desconocido",
                tipo: "reproductor"
            });
        }
        respuesta.reproductores = reproductores;
        respuesta.embeds = reproductores.map(r => r.url);
        respuesta.total = reproductores.length;
    }
    
    // Si es serie/anime, añadir episodios y temporadas
    if (tipo === "Serie" || tipo === "Anime") {
        respuesta.episodios = episodios;
        respuesta.temporadas = temporadas;
        respuesta.totalEpisodios = episodios.length;
        
        // También añadir todos los reproductores encontrados (para compatibilidad)
        const allEmbeds = [];
        for (const ep of episodios) {
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
    
    // Descargas
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
    
    return respuesta;
}

// ======================================================
// BUSCADOR DE HACKSTORE (MEJORADO)
// ======================================================
async function buscarHackstore(query, limit) {
    const url = HACKSTORE_BASE + '/?s=' + encodeURIComponent(query);
    console.log(`[Hackstore] Buscando: ${url}`);
    
    const html = await obtenerHTML(url);
    const cheerio = require('cheerio');
    const $ = cheerio.load(html);
    
    const links = new Set();
    const resultados = [];
    
    $("a[href]").each((_, el) => {
        let href = $(el).attr("href");
        if (!href) return;
        
        try {
            href = unirUrl(HACKSTORE_BASE, href);
            href = limpiarUrl(href);
        } catch {
            return;
        }
        
        if (!href) return;
        
        const esPelicula = href.startsWith(HACKSTORE_BASE + "/peliculas/");
        const esSerie = href.startsWith(HACKSTORE_BASE + "/series/");
        const esAnime = href.startsWith(HACKSTORE_BASE + "/animes/");
        
        if (!esPelicula && !esSerie && !esAnime) return;
        
        // Filtrar páginas de categoría
        if (href === limpiarUrl(HACKSTORE_BASE + "/peliculas/") ||
            href === limpiarUrl(HACKSTORE_BASE + "/series/") ||
            href === limpiarUrl(HACKSTORE_BASE + "/animes/")) {
            return;
        }
        
        // Filtrar páginas de paginación
        if (/\/page\/\d+\/?$/.test(href)) return;
        
        // Extraer slug
        const slugMatch = href.match(/\/(?:peliculas|series|animes)\/([^\/\?#]+)/);
        if (!slugMatch) return;
        const slug = slugMatch[1];
        
        // FILTRO: ignorar slugs genéricos
        const slugLower = slug.toLowerCase();
        for (const palabra of PALABRAS_BLOQUEADAS_BUSQUEDA) {
            if (slugLower === palabra || slugLower.indexOf(palabra) === 0) {
                return;
            }
        }
        if (slug.length < 3) return;
        
        if (links.has(href)) return;
        links.add(href);
        
        const tipo = esSerie ? "Serie" : esAnime ? "Anime" : "Película";
        let titulo = slug
            .replace(/-\d{4}$/, "")
            .replace(/-/g, " ")
            .replace(/\b\w/g, c => c.toUpperCase());
        
        const yearMatch = slug.match(/-(\d{4})$/);
        const year = yearMatch ? yearMatch[1] : null;
        
        resultados.push({
            titulo: titulo,
            tipo: tipo,
            year: year,
            portada: "",
            calificacion: null,
            link: href,
            postId: null,
            fuente: "hackstore",
            slug: slug
        });
    });
    
    // Limitar resultados
    return resultados.slice(0, limit || 15);
}

// ======================================================
// MANEJADOR PRINCIPAL
// ======================================================
async function handleRequest(request) {
    const url = new URL(request.url);
    
    // Health check
    if (url.pathname === '/' && !url.searchParams.has('url') && !url.searchParams.has('q')) {
        return json({
            status: 'ok',
            service: 'Vimeos Resolver',
            sources: ['hackstore'],
            uso: {
                scrapear: '?url=https://www.hackstore.fo/series/...',
                buscar: '?q=supergirl'
            }
        });
    }
    
    // BUSCADOR
    const query = url.searchParams.get('q');
    if (query) {
        try {
            const resultados = await buscarHackstore(query, 15);
            return json({
                success: true,
                query: query,
                total: resultados.length,
                resultados: resultados
            });
        } catch (err) {
            return json({ success: false, error: err.message }, 500);
        }
    }
    
    // SCRAPEAR
    const targetUrl = url.searchParams.get('url');
    if (!targetUrl) {
        return json({ error: 'Usa ?url=... para scrapear o ?q=... para buscar' }, 400);
    }
    
    try {
        const resultado = await scrapearHackstore(targetUrl);
        return json(resultado);
    } catch (err) {
        return json({ success: false, error: err.message || 'Error al scrapear' }, 500);
    }
}
