/**
 * MOVIEZONE v2 — Backend sin scraping
 * Fuente de datos: https://moviezone.tvjz.workers.dev/
 * Fuentes Worker: 1=lamovie 2=hackstore 3=pelisplushd 4=animeav1 5=animedbs 6=doramasflix
 * Meta: la fuente manda; IMDb/TMDB solo rellenan huecos (calificacion, year, descripcion, portada)
 * Persistencia: Supabase (misma tabla "movies")
 * Listo para Vercel (serverless) y Node local.
 */
const express = require("express");
const axios = require("axios");
const path = require("path");
const rateLimit = require("express-rate-limit");
const helmet = require("helmet");
const { createClient } = require("@supabase/supabase-js");

const app = express();
app.set("trust proxy", 1);

app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  })
);

const limiterGeneral = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 400,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Demasiadas peticiones. Espera un momento." },
});
const limiterBusqueda = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Demasiadas búsquedas. Espera un momento." },
});
// Solo limitar la API (home, CSS, JS e imágenes quedan libres del contador)
app.use("/api", limiterGeneral);

// No crashear si faltan env en el arranque (Vercel cold start / misconfig)
let supabase = null;
function getSupabase() {
  if (supabase) return supabase;
  const url = process.env.SUPABASE_URL || "";
  const key = process.env.SUPABASE_KEY || "";
  if (!url || !key) {
    console.warn("Supabase no configurado: faltan SUPABASE_URL o SUPABASE_KEY");
    return null;
  }
  supabase = createClient(url, key);
  return supabase;
}

const PORT = process.env.PORT || 3000;
const API_BASE = (process.env.MOVIEZONE_API || "https://moviezone.tvjz.workers.dev").replace(/\/$/, "");
// Fuente por defecto para listados de estrenos / populares (3 = pelisplushd)
// Worker: 1=lamovie 2=hackstore 3=pelisplushd 4=animeav1 5=animedbs 6=doramasflix
// Worker: 1=lamovie 2=hackstore 3=pelisplushd 4=animeav1 5=jkanime 6=doramasflix
const DEFAULT_SOURCE = process.env.MOVIEZONE_SOURCE || "9"; // se cambia a 3 si es asi o necesario

function resolverSourceId(val) {
  if (val == null || val === "") return DEFAULT_SOURCE;
  const s = String(val).toLowerCase().trim();
  
  /*if (/^[1-6]$/.test(s)) return s;
  const map = {
    lamovie: "1",
    hackstore: "2",
    pelisplushd: "3",
    pelisplus: "3",
    animeav1: "4",
    jkanime: "5",
    jk: "5",
    animedbs: "5", // legacy → jkanime
    doramasflix: "6",
    doramaflix: "6",
  };*/
    
  if (/^[1-9]$/.test(s)) return s;
  const map = {
    lamovie: "1",
    hackstore: "2",
    pelisplushd: "3",
    pelisplus: "3",
    animeav1: "4",
    jkanime: "5",
    jk: "5",
    animedbs: "5",
    doramasflix: "6",
    doramaflix: "6",
    pelisplushd_bz: "9",
    ppbz: "9",
    bz: "9",
  };
  return map[s] || DEFAULT_SOURCE;
}

/**
 * Identidad para pedir detalle a la API Worker:
 * link tipo https://moviezone.tvjz.workers.dev/3/pelicula/la-captura
 * → { source_id: "3", kind: "pelicula", slug: "la-captura" }
 */
function parseIdentidad(input) {
  if (!input) return null;
  // Acepta item completo o { link, slug, source_id, tipo }
  const link = input.link || input.url_extract || input.url || null;
  let slug = input.slug || null;
  let source_id = input.source_id != null ? String(input.source_id) : null;
  let tipo = input.tipo || input.type || null;
  let kind = null;

  if (link) {
    const m = String(link).match(
      /(?:workers\.dev|localhost(?::\d+)?)?\/(\d)\/(pelicula|serie|anime)\/([^\/\?\#]+)/i
    ) || String(link).match(/\/(\d)\/(pelicula|serie|anime)\/([^\/\?\#]+)/i);
    if (m) {
      if (!source_id) source_id = m[1];
      kind = m[2].toLowerCase();
      if (!slug) {
        try {
          slug = decodeURIComponent(m[3]);
        } catch (_) {
          slug = m[3];
        }
      }
    }
  }

  // source_id por nombre de fuente
  if (!source_id && input.fuente) {
    try {
      source_id = String(resolverSourceId(input.fuente));
    } catch (_) {}
  }

  if (!kind && tipo) {
    const t = String(tipo).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (t.includes("anime")) kind = "anime";
    else if (t.includes("serie") || t === "tv") kind = "serie";
    else kind = "pelicula";
  }
  if (!kind) kind = "pelicula";

  // source por defecto pelisplus
  if (!source_id) source_id = "3";

  if (!slug) return null;

  return {
    source_id: String(source_id),
    kind,
    slug: String(slug).replace(/\/+$/, ""),
  };
}



const api = axios.create({
  baseURL: API_BASE,
  timeout: 25000,
  headers: {
    "User-Agent": "MovieZone/2.0",
    Accept: "application/json",
  },
});

// ---------- Memoria local (espejo de Supabase) ----------
// En Vercel la memoria es por instancia y se queda vieja: prioritizamos Supabase.
let moviesDB = [];
let knownLinks = new Set();
const discardedLinks = new Set();
let moviesDBLoadedAt = 0;
const MOVIES_DB_TTL_MS = 15 * 1000; // refrescar desde Supabase cada 15s

function esDescartado(item) {
  if (!item) return true;
  if (item.certificacion === "DESCARTADO" || item.descripcion === "__DISCARDED__") return true;
  if (item.link && discardedLinks.has(item.link)) return true;
  return false;
}


/** En búsqueda online: no mostrar lo que no tiene forma de reproducir */
function filtrarSinReproductor(lista) {
  return (lista || []).filter((item) => {
    if (!item) return false;
    const tipo = String(item.tipo || "").toLowerCase();
    const esSA = tipo === "serie" || tipo === "anime";
    if (item.tiene_player === true) return true;
    if (item.embeds && item.embeds.length) return true;
    if (item.reproductor) return true;
    if (esSA) {
      if (item.episodios && item.episodios.length) return true;
      if (item.total_episodios && item.total_episodios > 0) return true;
      if (item.temporadas && item.temporadas.length) return true;
      // Listado de búsqueda de animeav1 solo trae slug: se permite si source_id 4 y slug
      // pero se oculta si ya está en DB marcado sin player y sin episodios
      const sid = resolverSourceId(item.source_id || item.fuente);
      // animeav1 / animedbs / doramasflix: listado con slug basta
      if (["4", "5", "6"].includes(sid)) {
        if (item.tiene_player === false) return false;
        return !!(item.slug || item.link);
      }
      return !!(item.slug || item.link);
    }
    // Películas: solo si tiene player
    if (item.tiene_player === false) return false;
    return false;
  });
}

function filtrarDescartados(lista) {
  return (lista || []).filter((i) => !esDescartado(i));
}

async function cargarDatosSupabase(force = false) {
  const ahora = Date.now();
  if (!force && moviesDB.length && ahora - moviesDBLoadedAt < MOVIES_DB_TTL_MS) {
    return moviesDB;
  }
  try {
    const sb = getSupabase();
    if (!sb) return moviesDB;
    const { data, error } = await sb
      .from("movies")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw error;
    const all = (data || []).map(normalizeItemFromDB).filter(Boolean);
    // Separar descartados
    discardedLinks.clear();
    for (const m of all) {
      if (esDescartado(m) && m.link) discardedLinks.add(m.link);
    }
    moviesDB = all.filter((m) => !esDescartado(m));
    knownLinks = new Set(moviesDB.map((i) => i.link).filter(Boolean));
    moviesDBLoadedAt = Date.now();
    console.log(`Supabase DB cargada: ${moviesDB.length} items (${discardedLinks.size} descartados)`);
  } catch (err) {
    console.error("No se pudo cargar desde Supabase:", err.message);
    if (!moviesDB.length) {
      moviesDB = [];
      knownLinks = new Set();
    }
  }
  return moviesDB;
}

/** Asegura datos frescos de Supabase antes de listados / búsqueda */
async function ensureMoviesDB() {
  await cargarDatosSupabase(false);
  return moviesDB;
}

function itemTieneContenidoValido(item) {
  if (!item) return false;
  if (item.reproductor && String(item.reproductor).length > 10) return true;
  if (Array.isArray(item.embeds) && item.embeds.length > 0) return true;
  if (Array.isArray(item.episodios) && item.episodios.length > 0) return true;
  if (Array.isArray(item.temporadas) && item.temporadas.length > 0) return true;
  return false;
}

async function guardarEnSupabase(items) {
  if (!items || !items.length) return;
  const sb = getSupabase();
  if (!sb) return;

  const paraInsertarRaw = items
    .map((item) => {
      // Asegurar link para upsert
      if (!item.link && item.url_extract) item.link = item.url_extract;
      if (!item.link && item.slug && item.source_id) {
        const k = /anime/i.test(item.tipo || "") ? "anime" : /serie/i.test(item.tipo || "") ? "serie" : "pelicula";
        item.link = `${API_BASE}/${item.source_id}/${k}/${item.slug}`;
      }
      return item;
    })
    .filter((item) => item.link && !discardedLinks.has(item.link) && !esDescartado(item))
    .map((item) => {
      let nombre = item.nombre || null;
      if (nombre && (item.tipo === "Serie" || item.tipo === "Anime")) {
        nombre = nombre
          .replace(/\s*[-–—]\s*(Temporada|Season|Episodio|Episode|Capítulo|Capitulo).*$/i, "")
          .trim();
      }
      // Proteger datos ya guardados: un listado no debe borrar players/descripción
      const existente =
        moviesDB.find((m) => m.link === item.link) ||
        moviesDB.find(
          (m) =>
            item.slug &&
            m.slug === item.slug &&
            normalizarTipo(m.tipo || "") === normalizarTipo(item.tipo || "")
        ) ||
        null;
      const tieneNuevo = itemTieneContenidoValido(item);
      const embedsFinal =
        tieneNuevo && item.embeds?.length
          ? item.embeds
          : (existente?.embeds?.length ? existente.embeds : item.embeds || []);
      // Unión de episodios: NUNCA perder temporadas/caps al guardar (stubs sin player también)
      let episodiosFinal = mergeEpisodiosLists(
        Array.isArray(existente?.episodios) ? existente.episodios : [],
        Array.isArray(item.episodios) ? item.episodios : []
      );
      // Conservar players ya resueltos
      if (episodiosFinal.length && existente?.episodios?.length) {
        const byKey = new Map();
        for (const ep of existente.episodios) {
          const k = `${Number(ep.season) || 1}-${Number(ep.episode || ep.episodio) || 0}`;
          byKey.set(k, ep);
        }
        episodiosFinal = episodiosFinal.map((ep) => {
          const k = `${Number(ep.season) || 1}-${Number(ep.episode || ep.episodio) || 0}`;
          const prev = byKey.get(k);
          if (!prev) return ep;
          const tieneNuevos = Array.isArray(ep.embeds) && ep.embeds.length > 0;
          if (tieneNuevos) return ep;
          if (prev.embeds?.length || prev.video || prev.reproductor) {
            return {
              ...ep,
              embeds: prev.embeds || [],
              video: prev.video || prev.reproductor || ep.video || null,
              reproductor: prev.reproductor || prev.video || ep.reproductor || null,
              downloads: (ep.downloads && ep.downloads.length) ? ep.downloads : (prev.downloads || []),
              url_capitulo: ep.url_capitulo || prev.url_capitulo || null,
            };
          }
          return ep;
        });
      }
      const descripcionFinal = elegirMejorDescripcion(item.descripcion, existente?.descripcion);
      return {
        link: item.link,
        nombre: (function () {
          const slug = item.slug || existente?.slug || "";
          return elegirTituloPrincipal({
            nombre: nombre || item.nombre,
            titulo: item.titulo,
            titulo_original: item.titulo_original,
            slug,
            cachedNombre: existente?.nombre,
          });
        })(),
        titulo_original: (function () {
          const principal = elegirTituloPrincipal({
            nombre: nombre || item.nombre,
            titulo: item.titulo,
            titulo_original: item.titulo_original,
            slug: item.slug || existente?.slug,
            cachedNombre: existente?.nombre,
          });
          return elegirTituloOriginal(
            principal,
            item.titulo_original || existente?.titulo_original,
            [item.titulo, item.nombre]
          );
        })(),
        portada: item.portada || existente?.portada || null,
        backdrop: item.backdrop || existente?.backdrop || null,
        descripcion: descripcionFinal,
        year: (function () {
          const yi = item.year && String(item.year).match(/(19|20)\d{2}/);
          const ye = existente?.year && String(existente.year).match(/(19|20)\d{2}/);
          // Si la API trae año distinto al de DB, confiar en la API (no mezclar 2012 con 2026)
          if (yi) return yi[0];
          if (ye) return ye[0];
          return item.year || existente?.year || null;
        })(),
        genero: item.genero || existente?.genero || null,
        generos: (item.generos && item.generos.length) ? item.generos : (existente?.generos || null),
        tipo: (function () {
          const nuevo = normalizarTipo(item.tipo || "");
          const viejo = normalizarTipo(existente?.tipo || "");
          // Nunca degradar Serie ↔ Anime por merge erróneo
          if (viejo === "Serie" && nuevo === "Anime") return "Serie";
          if (viejo === "Anime" && nuevo === "Serie") return "Anime";
          // Película/OVA/ONA desde API ganan sobre "Anime" genérico guardado por error
          if ((nuevo === "Película" || nuevo === "OVA" || nuevo === "ONA" || nuevo === "Especial") &&
              (viejo === "Anime" || !viejo)) return nuevo;
          if (nuevo === "Serie" || nuevo === "Anime" || nuevo === "Película" ||
              nuevo === "OVA" || nuevo === "ONA" || nuevo === "Especial") return nuevo;
          return viejo || nuevo || "Película";
        })(),
        idiomas: (item.idiomas && item.idiomas.length) ? item.idiomas : (existente?.idiomas || []),
        calidad: (item.calidad && item.calidad.length) ? item.calidad : (existente?.calidad || []),
        paises: item.paises || existente?.paises || [],
        calificacion: (function () {
          const yi = item.year && String(item.year).match(/(19|20)\d{2}/);
          const ye = existente?.year && String(existente.year).match(/(19|20)\d{2}/);
          if (yi && ye && yi[0] !== ye[0]) return item.calificacion ?? null;
          return item.calificacion ?? existente?.calificacion ?? null;
        })(),
        calificacion_comunidad: item.calificacion_comunidad || existente?.calificacion_comunidad || null,
        votos: (function () {
          const yi = item.year && String(item.year).match(/(19|20)\d{2}/);
          const ye = existente?.year && String(existente.year).match(/(19|20)\d{2}/);
          if (yi && ye && yi[0] !== ye[0]) {
            return item.votos ? Math.trunc(Number(item.votos)) || null : null;
          }
          return item.votos ? Math.trunc(Number(item.votos)) || null : (existente?.votos || null);
        })(),
        fecha_estreno: item.fecha_estreno || existente?.fecha_estreno || null,
        estado: item.estado || existente?.estado || null,
        en_emision: item.en_emision != null ? !!item.en_emision : (existente?.en_emision != null ? !!existente.en_emision : null),
        finalizado: item.finalizado != null ? !!item.finalizado : (existente?.finalizado != null ? !!existente.finalizado : null),
        duracion: item.duracion ? Math.trunc(Number(item.duracion)) || null : (existente?.duracion || null),
        certificacion: item.certificacion || existente?.certificacion || null,
        imdb: item.imdb || (existente && (!item.year || !existente.year || String(item.year).slice(0,4) === String(existente.year).slice(0,4)) ? existente.imdb : null) || null,
        tmdb: item.tmdb || (existente && (!item.year || !existente.year || String(item.year).slice(0,4) === String(existente.year).slice(0,4)) ? existente.tmdb : null) || null,
        ultimo_episodio: item.ultimo_episodio || existente?.ultimo_episodio || null,
        reproductor: item.reproductor || existente?.reproductor || null,
        embeds: embedsFinal,
        downloads: (item.downloads && item.downloads.length) ? item.downloads : (existente?.downloads || []),
        solo_trailer: !!(item.soloTrailer || existente?.soloTrailer),
        episodios: episodiosFinal,
        temporadas: (function () {
          const a = Array.isArray(item.temporadas) ? item.temporadas : [];
          const b = Array.isArray(existente?.temporadas) ? existente.temporadas : [];
          if (a.length >= b.length && a.length) return a;
          if (b.length) return b;
          return a;
        })(),
        postId: item.postId || existente?.postId || null,
        slug: item.slug || existente?.slug || null,
        source_id: item.source_id || existente?.source_id || null,
        imdb_id: item.imdb_id || existente?.imdb_id || (item.imdb && item.imdb.id) || null,
        tmdb_id: item.tmdb_id || existente?.tmdb_id || (item.tmdb && item.tmdb.id) || null,
        generos: (item.generos && item.generos.length) ? item.generos : (existente?.generos || null),
        duracion_texto: item.duracion_texto || existente?.duracion_texto || null,
        tiene_player: tieneNuevo || !!(existente && (existente.tiene_player || itemTieneContenidoValido(existente))),
      };
    });

  const vistos = new Set();
  const paraInsertar = [];
  for (const row of paraInsertarRaw) {
    // Si falta link pero hay slug + source_id → construir (AnimeAV1/JK)
    if (!row.link && row.slug) {
      const sid = String(row.source_id || "4");
      const t = String(row.tipo || "").toLowerCase();
      const kind = /pel[ií]cula|movie|film/.test(t) ? "pelicula" : (/serie|dorama/.test(t) ? "serie" : "anime");
      row.link = `${API_BASE}/${sid}/${kind}/${row.slug}`;
    }
    if (!row.link || vistos.has(row.link)) continue;
    vistos.add(row.link);
    paraInsertar.push(row);
  }
  if (!paraInsertar.length) return;

  // Campos seguros (evita fallo si la tabla no tiene columnas nuevas)
  function rowSafe(row) {
    // SOLO columnas reales de public.movies — NUNCA imdb/tmdb/omdb como objeto
    const out = {
      link: row.link,
      nombre: row.nombre,
      titulo_original: row.titulo_original || null,
      portada: row.portada || null,
      backdrop: row.backdrop || null,
      descripcion: row.descripcion || null,
      year: row.year != null ? String(row.year) : null,
      genero: row.genero || null,
      generos: Array.isArray(row.generos) ? row.generos : (row.genero ? String(row.genero).split(",").map((g) => g.trim()).filter(Boolean) : []),
      tipo: row.tipo || null,
      idiomas: Array.isArray(row.idiomas) ? row.idiomas : [],
      calidad: Array.isArray(row.calidad) ? row.calidad : [],
      paises: Array.isArray(row.paises) ? row.paises : [],
      calificacion: row.calificacion != null ? Number(row.calificacion) : (row.rating != null ? Number(row.rating) : null),
      calificacion_comunidad: row.calificacion_comunidad || null,
      votos: row.votos != null ? String(row.votos) : null,
      fecha_estreno: row.fecha_estreno || null,
      estado: row.estado || null,
      en_emision: row.en_emision != null ? !!row.en_emision : null,
      finalizado: row.finalizado != null ? !!row.finalizado : null,
      duracion: row.duracion != null ? Number(row.duracion) : null,
      duracion_texto: row.duracion_texto || null,
      certificacion: row.certificacion || null,
      ultimo_episodio: row.ultimo_episodio || null,
      reproductor: null,
      embeds: [],
      downloads: [],
      solo_trailer: !!row.solo_trailer,
      episodios: Array.isArray(row.episodios)
        ? row.episodios.map((ep) => ({
            season: ep.season || ep.temporada || 1,
            episode: ep.episode || ep.episodio || 0,
            temporada: ep.temporada || ep.season || 1,
            episodio: ep.episodio || ep.episode || 0,
            nombre: ep.nombre || ep.titulo || null,
            titulo: ep.titulo || ep.nombre || null,
            embeds: [],
            video: null,
            reproductor: null,
            back_img: ep.back_img || ep.screenshot || ep.still || null,
            still: ep.still || ep.back_img || null,
            imagen: ep.imagen || ep.image || ep.back_img || null,
          }))
        : [],
      temporadas: Array.isArray(row.temporadas) ? row.temporadas : [],
      postId: row.postId != null ? String(row.postId) : null,
      slug: row.slug || null,
      source_id: row.source_id != null ? String(row.source_id) : null,
      imdb_id: row.imdb_id || (row.imdb && row.imdb.id) || null,
      tmdb_id: row.tmdb_id != null ? String(row.tmdb_id) : (row.tmdb && row.tmdb.id != null ? String(row.tmdb.id) : null),
      rating_source: row.rating_source || (row.imdb_id || (row.imdb && row.imdb.id) ? "imdb" : (row.tmdb_id ? "tmdb" : null)),
      tiene_player: !!row.tiene_player,
      updated_at: new Date().toISOString(),
    };
    // Limpiar undefined / NaN
    Object.keys(out).forEach((k) => {
      if (out[k] === undefined) delete out[k];
      if (typeof out[k] === "number" && Number.isNaN(out[k])) out[k] = null;
    });
    return out;
  }

  const FORBIDDEN_COLS = new Set(["imdb", "tmdb", "omdb", "rating", "success", "alternativas", "temporadas_raw", "temporadas_tmdb", "nombre_display"]);
  const safeRows = paraInsertar.map(rowSafe).map((r) => {
    const clean = { ...r };
    FORBIDDEN_COLS.forEach((k) => { delete clean[k]; });
    return clean;
  });

  try {
    let { error } = await sb.from("movies").upsert(safeRows, { onConflict: "link" });
    if (error) {
      console.warn("Upsert full falló, reintento mínimo:", error.message);
      // Reintento solo columnas esenciales
      const minimal = safeRows.map((r) => ({
        link: r.link,
        nombre: r.nombre,
        portada: r.portada,
        descripcion: r.descripcion,
        year: r.year,
        genero: r.genero,
        generos: r.generos,
        tipo: r.tipo,
        calificacion: r.calificacion,
        votos: r.votos,
        embeds: r.embeds,
        downloads: r.downloads,
        episodios: r.episodios,
        temporadas: r.temporadas,
        slug: r.slug,
        source_id: r.source_id,
        imdb_id: r.imdb_id,
        tmdb_id: r.tmdb_id,
        rating_source: r.rating_source,
        duracion: r.duracion,
        duracion_texto: r.duracion_texto,
        certificacion: r.certificacion,
        fecha_estreno: r.fecha_estreno,
        titulo_original: r.titulo_original,
        tiene_player: r.tiene_player,
        reproductor: r.reproductor,
        updated_at: r.updated_at || new Date().toISOString(),
      }));
      const r2 = await sb.from("movies").upsert(minimal, { onConflict: "link" });
      if (r2.error) throw r2.error;
    }
    // Memoria local siempre (aunque Supabase falle parcialmente)
    paraInsertar.forEach((item) => {
      knownLinks.add(item.link);
      const idx = moviesDB.findIndex((m) => m.link === item.link);
      if (idx >= 0) moviesDB[idx] = { ...moviesDB[idx], ...item, tiene_player: !!(item.tiene_player || itemTieneContenidoValido(item)) };
      else moviesDB.unshift({ ...item, tiene_player: !!(item.tiene_player || itemTieneContenidoValido(item)) });
    });
    console.log(`Guardados/actualizados ${paraInsertar.length} items en Supabase (players=${paraInsertar.filter((i) => i.tiene_player).length})`);
    return true;
  } catch (err) {
    console.error("Error guardando en Supabase:", err.message || err);
    // Aun así espejo en memoria para esta instancia
    paraInsertar.forEach((item) => {
      if (!item.link) return;
      knownLinks.add(item.link);
      const idx = moviesDB.findIndex((m) => m.link === item.link);
      if (idx >= 0) moviesDB[idx] = { ...moviesDB[idx], ...item };
      else moviesDB.unshift(item);
    });
    return false;
  }
}

// ---------- Helpers de mapeo API → formato frontend ----------
function normalizarTipo(tipo) {
  const t = String(tipo || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (/\bova\b/.test(t) || t === "ova") return "OVA";
  if (/\bona\b/.test(t) || t === "ona") return "ONA";
  if (t.includes("especial") || t.includes("special")) return "Especial";
  if (t.includes("anime")) return "Anime";
  if (t.includes("serie") || t.includes("dorama") || t === "tv" || t === "tvshows") return "Serie";
  if (t.includes("cap") || t.includes("episod")) return "Capitulo";
  if (t.includes("pelicul") || t.includes("movie") || t.includes("film")) return "Película";
  return tipo ? String(tipo) : "Película";
}

function extraerAnio(titulo, year) {
  if (year) return String(year).substring(0, 4);
  const m = String(titulo || "").match(/\((\d{4})\)/);
  if (m) return m[1];
  const m2 = String(titulo || "").match(/\b(19|20)\d{2}\b/);
  return m2 ? m2[0] : null;
}

/** Corrige texto mal codificado (mojibake UTF-8 leído como Latin-1): "CÃ³digo" → "Código" */
function fixEncoding(text) {
  if (!text || typeof text !== "string") return text || "";
  let s = text;
  // Detección rápida de mojibake típico
  if (/Ã.|Â.|â.|ð./.test(s)) {
    try {
      // latin1 bytes → utf8
      const fixed = Buffer.from(s, "latin1").toString("utf8");
      // Solo aplicar si mejora (menos caracteres raros)
      const bad = (t) => (t.match(/Ã.|Â.|â.|ð.|�/g) || []).length;
      if (bad(fixed) < bad(s) && !fixed.includes("\uFFFD")) {
        s = fixed;
      }
    } catch (_) {}
  }
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Título principal = nombre local/español (Acaramelados).
 * titulo_original = inglés u otro idioma (Our Sticky Love).
 * Nunca promover el original inglés como nombre principal si ya hay uno local.
 */
function pareceTituloIngles(txt) {
  const s = String(txt || "").trim();
  if (!s || s.length < 2) return false;
  if (/[áéíóúñü¿¡]/i.test(s)) return false;
  const en = (s.match(/\b(the|and|of|love|our|my|his|her|with|from|for|a|an|to|in|on)\b/gi) || []).length;
  const es = (s.match(/\b(el|la|los|las|de|del|un|una|con|por|para|mi|su|nuestro|nuestra)\b/gi) || []).length;
  return en >= 1 && en > es;
}

function esSlugComoTitulo(titulo, slug) {
  if (!titulo || !slug) return false;
  const t = String(titulo).trim();
  const s = String(slug).trim();
  // Un título real casi siempre tiene mayúsculas (Title Case: "Found Encontrados").
  // Solo es "basura" cuando el título viene TODO en minúsculas (slug sin formatear,
  // ej. "our-sticky-love" usado tal cual como nombre). Si tiene alguna mayúscula,
  // es un título válido aunque su versión slugificada coincida con el slug real.
  if (t !== t.toLowerCase()) return false;
  return t.replace(/\s+/g, "-") === s.toLowerCase();
}

function elegirTituloPrincipal(opts) {
  const {
    nombre,
    titulo,
    titulo_original,
    slug,
    cachedNombre,
  } = opts || {};
  const cand = [
    cachedNombre,
    nombre,
    titulo,
  ].map((t) => limpiarTitulo(t)).filter((t) => t && !esSlugComoTitulo(t, slug));

  // Preferir el que NO parece inglés (Acaramelados > Our Sticky Love)
  for (const t of cand) {
    if (!pareceTituloIngles(t)) return t;
  }
  // Si todos parecen inglés, usar el primero legible
  if (cand.length) return cand[0];
  // Último recurso: no usar titulo_original como principal si hay cached
  if (cachedNombre && !esSlugComoTitulo(cachedNombre, slug)) return limpiarTitulo(cachedNombre);
  if (nombre && !esSlugComoTitulo(nombre, slug)) return limpiarTitulo(nombre);
  if (titulo) return limpiarTitulo(titulo);
  return "Sin título";
}

function elegirTituloOriginal(principal, original, fallbacks) {
  const p = limpiarTitulo(principal);
  const candidates = [original, ...(fallbacks || [])]
    .map((t) => limpiarTitulo(t))
    .filter((t) => t && t.toLowerCase() !== (p || "").toLowerCase());
  return candidates[0] || null;
}

function limpiarTitulo(titulo) {
  let s = fixEncoding(titulo);
  if (!s) return s;
  // Quitar spam SEO típico: "VER X Online Gratis HD", "Watch X Free Full HD", etc.
  s = s
    .replace(/^(ver|watch|ver\s+online|mira|descargar?)\s+/i, "")
    .replace(/\s*[-–—:|]\s*(ver|watch|online|gratis|free|hd|full\s*hd|4k|subtitulad[oa]?s?|latino|castellano|espa[nñ]ol|pelicula|serie|anime).*$/i, "")
    .replace(/\s+(online|gratis|free|hd|full\s*hd|4k|1080p|720p|subtitulad[oa]?s?|latino|castellano)(\s+(online|gratis|free|hd|full\s*hd|4k|1080p|720p|subtitulad[oa]?s?|latino|castellano))*$/i, "")
    .replace(/\s+(online|gratis|free)\s*$/i, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  // Si quedó vacío, devolver el original limpio de encoding
  if (!s) return fixEncoding(titulo);
  return s;
}

function limpiarTexto(texto) {
  return fixEncoding(texto);
}

/** Limpia sinopsis truncadas o con prefijo "Pelicula Título:" */
function limpiarDescripcion(texto, titulo) {
  let s = limpiarTexto(texto || "");
  if (!s) return "";
  // Quitar prefijo "Pelicula X:" / "Serie X:" típico de pelisplushd
  s = s.replace(/^(Pel[ií]cula|Serie|Anime|Movie|TV)\s*[^:]{0,80}:\s*/i, "");
  // Si el título aparece al inicio, quitarlo
  if (titulo) {
    const t = limpiarTitulo(titulo).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    s = s.replace(new RegExp("^" + t + "\\s*[:\\-–]?\\s*", "i"), "");
  }
  return s.trim();
}

function descripcionIncompleta(texto) {
  const s = String(texto || "").trim();
  if (s.length < 40) return true;
  if (/\.\.\.$|…$/.test(s)) return true;
  if (/^(Pel[ií]cula|Serie|Anime)\s/i.test(s) && s.length < 80) return true;
  return false;
}

/** Detecta si un texto parece español (preferir sobre inglés) */
function pareceEspanol(txt) {
  const s = String(txt || "");
  if (!s || s.length < 20) return false;
  if (/[áéíóúñü¿¡]/i.test(s)) return true;
  const es = (s.match(/\b(el|la|los|las|de|del|que|en|un|una|por|con|para|como|más|también|después|cuando|sobre|entre|hasta|desde|sin|este|esta|estos|sus|su|se|es|son|fue|ser|está|están|luego|demasiadas|contratar)\b/gi) || []).length;
  const en = (s.match(/\b(the|and|with|from|after|when|his|her|their|this|that|was|were|are|is|for|into|about|which|who|whom|all|of|made|by)\b/gi) || []).length;
  return es >= 3 && es > en;
}

function pareceIngles(txt) {
  const s = String(txt || "");
  if (!s || s.length < 20) return false;
  if (/[áéíóúñü¿¡]/i.test(s)) return false;
  const en = (s.match(/\b(the|and|with|from|after|when|his|her|their|this|that|was|were|are|is|for|into|about|which|all|of|made|by)\b/gi) || []).length;
  return en >= 3;
}

/**
 * Elige la mejor descripción: español completo > español > cualquier completa > más larga
 * Nunca reemplaza español válido por inglés solo porque sea más largo.
 */
function elegirMejorDescripcion(a, b) {
  const A = String(a || "").trim();
  const B = String(b || "").trim();
  if (!A) return B || null;
  if (!B) return A || null;
  const aEs = pareceEspanol(A);
  const bEs = pareceEspanol(B);
  const aEn = pareceIngles(A);
  const bEn = pareceIngles(B);
  const aInc = descripcionIncompleta(A);
  const bInc = descripcionIncompleta(B);

  // Si una es española y la otra inglesa → SIEMPRE la española (fuente > IMDb EN)
  if (aEs && bEn) return A;
  if (bEs && aEn) return B;
  if (aEs && !bEs) return A;
  if (bEs && !aEs) return B;
  // Ambos mismo idioma: preferir completa / más larga
  if (!aInc && bInc) return A;
  if (!bInc && aInc) return B;
  return A.length >= B.length ? A : B;
}

function extraerGenero(data) {
  if (!data) return null;
  const raw =
    data.genero ||
    data.genres ||
    data.categorias ||
    data.category ||
    data.categories ||
    data.genero_principal ||
    null;
  if (!raw) return null;
  if (Array.isArray(raw)) {
    const parts = raw
      .map((g) => (typeof g === "string" ? g : g?.name || g?.nombre || ""))
      .map((g) => limpiarTexto(g))
      .filter(Boolean);
    return parts.length ? parts.join(", ") : null;
  }
  return limpiarTexto(String(raw)) || null;
}


function buildStreamUrl(embedUrl) {
  if (!embedUrl || typeof embedUrl !== "string") return null;
  const u = embedUrl.toLowerCase();
  const q = encodeURIComponent(embedUrl);
  if (u.includes("vimeos")) return `${API_BASE}/resolve/vimeos?url=${q}&proxy=1`;
  if (/streamwish|flaswish|strwish|ahvsh|streamhg/.test(u)) return `${API_BASE}/wish/streamurl?url=${q}`;
  if (u.includes("goodstream")) return `${API_BASE}/goodstream/streamurl?url=${q}`;
  if (/vidhide|earnvids|filelions|smoothpre|callistanise/.test(u)) return `${API_BASE}/vidhide/streamurl?url=${q}`;
  if (/voe\.|jilliandescribe/.test(u)) return `${API_BASE}/voe/streamurl?url=${q}`;
  return null;
}

/** URL del worker que devuelve JSON de capítulo/detalle (no es embed reproducible) */
function esUrlMetaApi(url) {
  if (!url || typeof url !== "string") return false;
  const u = url.toLowerCase();
  if (!/moviezone\.tvjz\.workers\.dev/i.test(u)) return false;
  if (/\/(resolve|wish|goodstream|vidhide|voe)\//i.test(u)) return false;
  return true;
}

function mapEmbeds(raw) {
  if (!raw) return [];
  // Si viene string JSON desde Supabase
  if (typeof raw === "string") {
    try { raw = JSON.parse(raw); } catch { return []; }
  }
  if (!Array.isArray(raw)) return [];
  const mapped = raw
    .map((e) => {
      if (typeof e === "string" && e.startsWith("http")) {
        if (esUrlMetaApi(e)) return null;
        return { url: e, idioma: null, servidor: null, calidad: null };
      }
      if (e && typeof e === "object") {
        const url = e.url || e.src || e.link || null;
        if (!url || esUrlMetaApi(url)) return null;
        let idioma = e.idioma || e.lang || e.language || e.lang_code || null;
        if (idioma) {
          const L = String(idioma).toUpperCase();
          if (L === "LAT" || L === "LATINO" || L === "DUB") idioma = "Latino";
          else if (L === "SUB" || L === "SOFTSUB" || /SUBTIT/.test(L)) idioma = "Subtitulado";
        }
        const servidor = e.servidor || e.server || e.name || null;
        const stream_url = e.stream_url || buildStreamUrl(url);
        return {
          url,
          stream_url,
          idioma,
          lang: idioma,
          servidor,
          calidad: e.calidad || e.quality || null,
        };
      }
      return null;
    })
    .filter(Boolean);

  // Latino primero, luego Vimeos / MovieZone
  mapped.sort((a, b) => {
    const aL = /latino|castellano|español/i.test(`${a.idioma || ""} ${a.lang || ""}`) ? 1 : 0;
    const bL = /latino|castellano|español/i.test(`${b.idioma || ""} ${b.lang || ""}`) ? 1 : 0;
    if (aL !== bL) return bL - aL;
    const aV = /vimeos/i.test(a.url || "") || /vimeos|moviezone/i.test(a.servidor || "");
    const bV = /vimeos/i.test(b.url || "") || /vimeos|moviezone/i.test(b.servidor || "");
    return (bV ? 1 : 0) - (aV ? 1 : 0);
  });
  return mapped;
}

/** Título normalizado para deduplicar entre fuentes */
function normalizeTitleKey(titulo) {
  // se redefine abajo — keep one implementation
  return _normalizeTitleKeyImpl(titulo);
}
function _normalizeTitleKeyImpl(titulo) {
  // Aplicar limpieza SEO primero para unificar "VER X Online Gratis HD" con "X"
  const limpio = limpiarTitulo(titulo);
  return String(limpio || titulo || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\(\d{4}\)/g, "")
    .replace(/\s*season\s*\d+/gi, "")
    .replace(/\s*temporada\s*\d+/gi, "")
    .replace(/\b(ver|watch|online|gratis|free|hd|full|4k|1080p|720p|subtitulado|subtitulada|latino|castellano|espanol|pelicula|serie|anime)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** Portada usable (no placeholder, no data-uri, no SVG roto) */
function esPortadaValida(url) {
  if (!url || typeof url !== "string") return false;
  const u = url.trim();
  if (!u || u.includes("placeholder") || u.startsWith("data:")) return false;
  if (/svg\+xml|lazyload\.min|1x1|pixel\.gif|blank\./i.test(u)) return false;
  // Hackstore posters rotos salvo que sea TMDB reenviado
  if (/hackstore\./i.test(u) && !/image\.tmdb\.org/i.test(u)) return false;
  return /^https?:\/\//i.test(u);
}

/** Fuente primero; Metahub/IMDb/TMDB solo respaldo */
function elegirPortada(a, b, sourcePreferido) {
  const candidatos = [a, b].filter(esPortadaValida);
  if (!candidatos.length) return a || b || null;
  const score = (u) => {
    let s = 0;
    const url = String(u || "");
    if (/pelisplushd\.(to|bz|la)|\/poster\//i.test(url)) s += 100;
    if (/lamovie\.org/i.test(url)) s += 95;
    if (/animeav1|cdn\.animeav1/i.test(url)) s += 95;
    if (/jkanime|jkdesa|cdn\.jkdesa/i.test(url)) s += 95;
    if (/hackstore/i.test(url)) s += 90;
    if (/image\.tmdb\.org/i.test(url)) s += 40;
    if (/media-amazon\.com|imdb\.com/i.test(url)) s += 25;
    if (/metahub\.space/i.test(url)) s += 15;
    if (/\.(jpg|jpeg|png|webp)(\?|$)/i.test(url)) s += 3;
    return s;
  };
  candidatos.sort((x, y) => score(y) - score(x));
  return candidatos[0];
}

/** Fallback portada por slug (pelisplus suele tener /poster/{slug}.jpg) */
function portadaFallbackSlug(slug) {
  if (!slug) return null;
  const s = String(slug).toLowerCase().replace(/-\d{4}$/, "").trim();
  if (!s) return null;
  return `https://www.pelisplushd.la/poster/${s}.jpg`;
}

/** Si no hay portada válida, intentar slug pelisplus y otras fuentes en detalle */
async function asegurarPortada(item) {
  if (!item) return item;
  if (esPortadaValida(item.portada)) return item;
  const fb = portadaFallbackSlug(item.slug);
  if (fb) item.portada = fb;
  if (esPortadaValida(item.portada)) return item;
  // Detalle en fuentes con poster (3, 1, 4)
  if (!item.slug) return item;
  const kind =
    /anime/i.test(String(item.tipo || "")) ? "anime" :
    /serie/i.test(String(item.tipo || "")) ? "serie" : "pelicula";
  const slugs = [...new Set([item.slug, String(item.slug).replace(/-\d{4}$/, "")].filter(Boolean))];
  for (const sid of ["3", "1", "4"]) {
    for (const s of slugs) {
      try {
        const k = sid === "4" && kind === "pelicula" ? "anime" : kind;
        const det = await fetchDetailFromSource(sid, k, s, { slug: s });
        if (det && esPortadaValida(det.portada)) {
          item.portada = det.portada;
          if (!item.descripcion && det.descripcion) item.descripcion = det.descripcion;
          return item;
        }
      } catch (_) {}
    }
  }
  return item;
}

/** Puntúa un item por cantidad de datos útiles (portada, rating, descripción, players…) */
function scoreItem(item) {
  if (!item) return 0;
  let s = 0;
  if (esPortadaValida(item.portada)) s += 3;
  else if (item.portada) s += 0; // portada rota no suma
  if (item.backdrop) s += 1;
  if (item.calificacion && Number(item.calificacion) > 0) s += 2;
  if (item.descripcion && String(item.descripcion).length > 40) s += 4;
  if (item.year) s += 1;
  if (item.genero) s += 1;
  if (Array.isArray(item.idiomas) && item.idiomas.length) s += 1;
  if (Array.isArray(item.calidad) && item.calidad.length) s += 1;
  if (item.reproductor) s += 5;
  if (Array.isArray(item.embeds) && item.embeds.length) s += 5 + Math.min(item.embeds.length, 10);
  if (Array.isArray(item.downloads) && item.downloads.length) s += 2;
  if (Array.isArray(item.episodios) && item.episodios.length) s += 4;
  if (item.tiene_player) s += 6;
  // Más episodios / temporadas = mejor (evita quedarse con Wistoria 10eps de hackstore)
  const nEps = Number(item.total_episodios) || (Array.isArray(item.episodios) ? item.episodios.length : 0) || 0;
  const nTemps =
    Number(item.total_temporadas) ||
    (Array.isArray(item.temporadas) ? item.temporadas.length : 0) ||
    0;
  if (nEps) s += Math.min(40, nEps / 5); // One Piece 1175 suma mucho
  if (nTemps > 1) s += nTemps * 8; // 2 temporadas gana a 1
  if (item.episodios && item.episodios.length) s += Math.min(8, item.episodios.length / 6);
  if (item.slug) s += 1;
  const sid = String(item.source_id || "");
  const esAnime = /anime/i.test(String(item.tipo || ""));
  // En animes: priorizar animeav1 (4) > pelisplus (3) > lamovie (1) > hackstore (2)
  if (esAnime) {
      // En animes: solo animeav1 (4)
    if (sid === "4" || sid === "animeav1") s += 30;
    // jkanime no priorizar
    if (sid === "5" || sid === "jkanime") s += 0;
    else if (sid === "3" || sid === "pelisplushd") s += 12;
    else if (sid === "1" || sid === "lamovie") s += 6;
    else if (sid === "2" || sid === "hackstore") s += 2;
  } else {
    if (sid === "3" || sid === "pelisplushd") s += 2;
    if (sid === "1" || sid === "lamovie") s += 1;
  }
  return s;
}

/** Deduplica por título: 1 resultado aunque venga de 3 fuentes (ej. Acaramelados) */

/** Si hay "Título" y "Título Season 2", deja solo el base (ya trae ambas temps en detalle) */
function colapsarTemporadasAnimeAv1(lista) {
  const bySlug = new Map();
  for (const it of lista || []) {
    if (it.slug) bySlug.set(String(it.slug).toLowerCase(), it);
  }
  const out = [];
  for (const it of lista || []) {
    const slug = String(it.slug || "").toLowerCase();
    const m = slug.match(/^(.*?)-season-(\d+)$/i);
    if (m && bySlug.has(m[1])) {
      // Heredar portada del base si el season no tiene
      const base = bySlug.get(m[1]);
      if (base && !esPortadaValida(it.portada) && esPortadaValida(base.portada)) {
        // no lo añadimos, solo el base
      }
      continue; // omitir season suelto
    }
    // Si este es base y su season-2 no tiene portada, ya está bien
    out.push(it);
  }
  // Rellenar portadas de seasons huérfanos (sin base en lista)
  for (const it of out) {
    if (esPortadaValida(it.portada)) continue;
    const slug = String(it.slug || "").toLowerCase();
    const m = slug.match(/^(.*?)-season-\d+$/i);
    if (m && bySlug.has(m[1]) && esPortadaValida(bySlug.get(m[1]).portada)) {
      it.portada = bySlug.get(m[1]).portada;
    }
  }
  return out;
}

function dedupeListItems(lista) {
  // Deduplicar catálogo API + Supabase: misma obra no dos veces
  if (!Array.isArray(lista) || !lista.length) return [];
  const byKey = new Map();

  function keyOf(item) {
    if (!item) return null;
    // slug + tipo + año (Serie y Anime del mismo slug NO se fusionan)
    const slug = String(item.slug || "").toLowerCase().trim();
    const year = (String(item.year || "").match(/(19|20)\d{2}/) || [])[0] || "";
    const tipo = normalizarTipo(item.tipo || "").toLowerCase();
    if (slug) return "slug:" + slug + ":tipo:" + tipo + ":y:" + year;
    const t = normalizeTitleKey(item.nombre || item.titulo || "");
    if (t) return "t:" + tipo + ":" + t + ":y:" + year;
    if (item.link) return "link:" + String(item.link).replace(/\/+$/, "").toLowerCase();
    return null;
  }

  function better(a, b) {
    // Preferir el que tiene players / más datos
    const sa = (a.tiene_player ? 20 : 0) + (itemTieneContenidoValido(a) ? 15 : 0) +
      (a.embeds && a.embeds.length ? 10 : 0) + (a.descripcion && String(a.descripcion).length > 40 ? 5 : 0) +
      (a.calificacion != null ? 2 : 0) + (a.portada ? 1 : 0) + scoreItem(a);
    const sb = (b.tiene_player ? 20 : 0) + (itemTieneContenidoValido(b) ? 15 : 0) +
      (b.embeds && b.embeds.length ? 10 : 0) + (b.descripcion && String(b.descripcion).length > 40 ? 5 : 0) +
      (b.calificacion != null ? 2 : 0) + (b.portada ? 1 : 0) + scoreItem(b);
    return sa >= sb ? a : b;
  }

  for (const item of lista) {
    if (!item) continue;
    const k = keyOf(item);
    if (!k) continue;
    const prev = byKey.get(k);
    if (!prev) byKey.set(k, item);
    else byKey.set(k, better(prev, item));
  }
  return Array.from(byKey.values());
}

/** Une listas de episodios por (season, episode); conserva embeds si ya existían */
function mergeEpisodiosLists(a, b) {
  const map = new Map();
  const put = (ep) => {
    if (!ep) return;
    const s = Number(ep.season || ep.temporada || 1);
    const e = Number(ep.episode || ep.episodio || ep.episode_number || 0);
    if (!e) return;
    const k = `${s}-${e}`;
    const prev = map.get(k);
    if (!prev) {
      map.set(k, {
        ...ep,
        season: s,
        episode: e,
        embeds: mapEmbeds(ep.embeds || ep.reproductores || []),
        video: ep.video || ep.reproductor || null,
      });
      return;
    }
    const tieneNuevos = Array.isArray(ep.embeds) && ep.embeds.length > 0;
    const embeds = tieneNuevos
      ? mapEmbeds(ep.embeds)
      : mapEmbeds(prev.embeds || []);
    map.set(k, {
      ...prev,
      ...ep,
      season: s,
      episode: e,
      nombre: ep.nombre || prev.nombre,
      embeds,
      video: (tieneNuevos ? (ep.video || ep.reproductor) : null) || prev.video || prev.reproductor || ep.video || null,
      source_id: ep.source_id || prev.source_id,
    });
  };
  (a || []).forEach(put);
  (b || []).forEach(put);
  return Array.from(map.values()).sort(
    (x, y) => (x.season - y.season) || (x.episode - y.episode)
  );
}

/** Si total_episodios >> lista parcial (animeav1), generar stubs 1..N o del rango activo */
function expandirEpisodiosAnime(item) {
  if (!item) return item;
  const total = parseInt(item.total_episodios, 10) || 0;
  const eps = Array.isArray(item.episodios) ? item.episodios : [];
  if (total <= 1 || eps.length >= total) return item;

  // Id screenshots animeav1 (si alguna cap lo trae)
  let shotId = null;
  for (const e of eps) {
    const b = e && (e.back_img || e.screenshot);
    if (!b) continue;
    const m = String(b).match(/cdn\.animeav1\.com\/screenshots\/(\d+)\//i);
    if (m) {
      shotId = m[1];
      break;
    }
  }
  const stubBack = (n) =>
    shotId ? `https://cdn.animeav1.com/screenshots/${shotId}/${n}.jpg` : null;

  const rangos = item.rangos_episodios;
  if (Array.isArray(rangos) && rangos.length > 1) {
    const desde = parseInt(item.episodio_desde, 10) || (rangos[0] && rangos[0].desde) || 1;
    const hasta = parseInt(item.episodio_hasta, 10) || (rangos[0] && rangos[0].hasta) || Math.min(100, total);
    const byEp = new Map(eps.map((e) => [Number(e.episode || e.episodio), e]));
    const out = [];
    for (let n = desde; n <= hasta && n <= total; n++) {
      const prev = byEp.get(n);
      if (prev) {
        if (!prev.back_img && stubBack(n)) prev.back_img = stubBack(n);
        out.push(prev);
      } else {
        out.push({
          season: 1,
          episode: n,
          nombre: `Episodio ${n}`,
          embeds: [],
          video: null,
          source_id: item.source_id,
          back_img: stubBack(n),
        });
      }
    }
    item.episodios = out;
    return item;
  }

  const maxExpand = Math.min(total, 300);
  if (eps.length >= maxExpand) return item;
  const byEp = new Map(eps.map((e) => [Number(e.episode || e.episodio), e]));
  const out = [];
  for (let n = 1; n <= maxExpand; n++) {
    const prev = byEp.get(n);
    if (prev) {
      if (!prev.back_img && stubBack(n)) prev.back_img = stubBack(n);
      out.push(prev);
    } else {
      out.push({
        season: 1,
        episode: n,
        nombre: `Episodio ${n}`,
        embeds: [],
        video: null,
        source_id: item.source_id,
        back_img: stubBack(n),
      });
    }
  }
  item.episodios = out;
  if (!item.temporadas || !item.temporadas.length) item.temporadas = [1];
  return item;
}

/** Fusiona dos items privilegiando datos del más completo */
function mergeItems(base, extra) {
  if (!base) return extra;
  if (!extra) return base;
  const out = { ...base };
  for (const [k, v] of Object.entries(extra)) {
    if (v == null || v === "" || (Array.isArray(v) && !v.length)) continue;
    const cur = out[k];
    if (cur == null || cur === "" || (Array.isArray(cur) && !cur.length)) {
      out[k] = v;
    } else if (k === "embeds" || k === "downloads") {
      // unir únicos por url
      const urls = new Set((Array.isArray(cur) ? cur : []).map((e) => (e && e.url) || e));
      const merged = Array.isArray(cur) ? [...cur] : [];
      for (const e of Array.isArray(v) ? v : []) {
        const u = (e && e.url) || e;
        if (u && !urls.has(u)) {
          urls.add(u);
          merged.push(e);
        }
      }
      out[k] = mapEmbeds(merged);
    } else if (k === "episodios") {
      out[k] = mergeEpisodiosLists(cur, v);
    } else if (k === "temporadas") {
      const set = new Set([...(Array.isArray(cur) ? cur : []), ...(Array.isArray(v) ? v : [])].map(Number).filter(Boolean));
      out[k] = Array.from(set).sort((a, b) => a - b);
    } else if (k === "temporadas_raw") {
      // quedarse con el array más largo (más episodios dentro)
      const len = (arr) =>
        (arr || []).reduce((s, t) => s + ((t && t.episodios && t.episodios.length) || 0), 0);
      out[k] = len(v) > len(cur) ? v : cur;
    } else if (k === "total_episodios") {
      out[k] = Math.max(Number(cur) || 0, Number(v) || 0) || cur || v;
    } else if (k === "total_temporadas") {
      out[k] = Math.max(Number(cur) || 0, Number(v) || 0) || cur || v;
    } else if (k === "rangos_episodios") {
      // preferir el set que llegue más lejos (One Piece 1176 vs parcial 326)
      const maxHasta = (arr) =>
        (arr || []).reduce((m, r) => Math.max(m, Number(r.hasta) || 0), 0);
      const sumR = (arr) =>
        (arr || []).reduce((s, r) => s + (Number(r.hasta || 0) - Number(r.desde || 0) + 1), 0);
      if (Array.isArray(v) && v.length) {
        if (!Array.isArray(cur) || !cur.length) out[k] = v;
        else if (maxHasta(v) > maxHasta(cur) || (maxHasta(v) === maxHasta(cur) && sumR(v) >= sumR(cur))) out[k] = v;
      }
    } else if (k === "descripcion") {
      out[k] = elegirMejorDescripcion(cur, v);
    } else if (k === "calificacion" && Number(v) > 0 && !Number(cur)) {
      out[k] = v;
    } else if (k === "portada") {
      out[k] = elegirPortada(cur, v, out.source_id || extra.source_id || base.source_id);
    }
  }
  // Asegurar portada coherente con source_id de quien tiene los embeds
  out.portada = elegirPortada(out.portada, extra?.portada || base?.portada, out.source_id);
  out.tiene_player = itemTieneContenidoValido(out) || !!(out.episodios && out.episodios.length);
  return out;
}

/** Normaliza fila de Supabase al formato del frontend */
function normalizeItemFromDB(row) {
  if (!row) return null;
  const embeds = mapEmbeds(row.embeds);
  const downloads = mapEmbeds(row.downloads); // same shape if objects
  let episodios = row.episodios || [];
  if (typeof episodios === "string") {
    try { episodios = JSON.parse(episodios); } catch { episodios = []; }
  }
  if (Array.isArray(episodios)) {
    episodios = episodios.map((ep) => ({
      ...ep,
      embeds: mapEmbeds(ep.embeds || ep.reproductores),
      video: ep.video || ep.reproductor || (mapEmbeds(ep.embeds)[0] && mapEmbeds(ep.embeds)[0].url) || null,
    }));
  }
  let temporadas = row.temporadas || [];
  if (typeof temporadas === "string") {
    try { temporadas = JSON.parse(temporadas); } catch { temporadas = []; }
  }
  const reproductor = row.reproductor || (embeds[0] && embeds[0].url) || null;
  const calificacion = row.calificacion != null ? Number(row.calificacion) : null;
  const imdb_id = row.imdb_id || null;
  const tmdb_id = row.tmdb_id || null;
  const rating_source = row.rating_source || (imdb_id && calificacion ? "imdb" : (tmdb_id && calificacion ? "tmdb" : null));

  // Reconstruir objetos ligeros para la UI (badge IMDb / TMDB)
  let imdb = null;
  if (imdb_id || (rating_source === "imdb" && calificacion != null)) {
    imdb = { id: imdb_id || undefined };
    if (rating_source === "imdb" && calificacion != null && calificacion >= 0) imdb.rating = calificacion;
    if (row.votos && rating_source === "imdb") imdb.votos = row.votos;
  }
  let tmdb = null;
  if (tmdb_id || (rating_source === "tmdb" && calificacion != null)) {
    tmdb = { id: tmdb_id || undefined };
    if (rating_source === "tmdb" && calificacion != null && calificacion >= 0) tmdb.rating = calificacion;
  }

  return {
    ...row,
    nombre: limpiarTitulo(row.nombre || row.titulo || "Sin título"),
    titulo: limpiarTitulo(row.nombre || row.titulo || "Sin título"),
    descripcion: limpiarTexto(row.descripcion || ""),
    genero: limpiarTexto(row.genero || "") || null,
    calificacion: calificacion != null && !Number.isNaN(calificacion) ? calificacion : null,
    rating: calificacion != null && !Number.isNaN(calificacion) ? calificacion : null,
    rating_source,
    imdb_id,
    tmdb_id,
    imdb,
    tmdb,
    embeds,
    downloads: Array.isArray(row.downloads) ? row.downloads : [],
    episodios,
    temporadas,
    reproductor,
    soloTrailer: !!(row.solo_trailer || row.soloTrailer),
    tiene_player: !!(row.tiene_player || reproductor || embeds.length || (Array.isArray(episodios) && episodios.length)),
  };
}

async function buscarEnSupabase({ link, slug, postId }) {
  const sb = getSupabase();
  if (!sb) return null;
  try {
    if (link) {
      const { data } = await sb.from("movies").select("*").eq("link", link).maybeSingle();
      if (data) return normalizeItemFromDB(data);
    }
    if (slug) {
      const { data } = await sb.from("movies").select("*").eq("slug", slug).limit(1);
      if (data && data[0]) return normalizeItemFromDB(data[0]);
      // fallback: link contains slug
      const { data: data2 } = await sb.from("movies").select("*").ilike("link", `%${slug}%`).limit(1);
      if (data2 && data2[0]) return normalizeItemFromDB(data2[0]);
    }
    if (postId) {
      const { data } = await sb.from("movies").select("*").eq("postId", String(postId)).limit(1);
      if (data && data[0]) return normalizeItemFromDB(data[0]);
    }
  } catch (err) {
    console.warn("buscarEnSupabase:", err.message);
  }
  return null;
}


/** Extrae bloques imdb/tmdb/omdb de la API Worker (formato compacto o plano) */
function extraerMetaFuentes(r) {
  r = r || {};
  const imdb = r.imdb && typeof r.imdb === "object" ? { ...r.imdb } : {};
  const tmdb = r.tmdb && typeof r.tmdb === "object" ? { ...r.tmdb } : {};
  const omdb = r.omdb && typeof r.omdb === "object" ? { ...r.omdb } : {};

  if (!imdb.id && r.imdb_id) imdb.id = r.imdb_id;
  if (imdb.rating == null && r.rating_imdb != null) imdb.rating = r.rating_imdb;
  if (!imdb.votos && r.votos_imdb) imdb.votos = r.votos_imdb;
  if (!imdb.portada && r.portada_imdb) imdb.portada = r.portada_imdb;
  if (!imdb.generos && Array.isArray(r.generos_imdb)) imdb.generos = r.generos_imdb;
  if (imdb.duracion == null && r.duracion_imdb != null) imdb.duracion = r.duracion_imdb;
  if (!imdb.duracion_texto && r.duracion_texto_imdb) imdb.duracion_texto = r.duracion_texto_imdb;
  if (!imdb.certificacion && r.certificacion_imdb) imdb.certificacion = r.certificacion_imdb;

  if (!tmdb.id && r.tmdb_id) tmdb.id = r.tmdb_id;
  if (tmdb.rating == null && r.rating_tmdb != null) tmdb.rating = r.rating_tmdb;
  if (!tmdb.portada && r.portada_tmdb) tmdb.portada = r.portada_tmdb;
  if (!tmdb.generos && Array.isArray(r.generos_tmdb)) tmdb.generos = r.generos_tmdb;
  if (tmdb.duracion == null && r.duracion_tmdb != null) tmdb.duracion = r.duracion_tmdb;
  if (!tmdb.certificacion && r.certificacion_tmdb) tmdb.certificacion = r.certificacion_tmdb;
  if (!tmdb.titulo && r.titulo_tmdb) tmdb.titulo = r.titulo_tmdb;
  if (!tmdb.backdrop && r.backdrop) tmdb.backdrop = r.backdrop;

  if (omdb.rating == null && r.rating_omdb != null) omdb.rating = r.rating_omdb;
  if (!omdb.votos && r.votos_omdb) omdb.votos = r.votos_omdb;

  return { imdb, tmdb, omdb };
}

/** Resultado de listado / search → item ligero (API v2 con TMDB) */
function mapListItem(r) {
  if (!r || typeof r !== "object") return null;
  // Datos tal cual los manda la API Worker (no inventar ni mezclar)
  const titulo = elegirTituloPrincipal({
    nombre: r.nombre || r.titulo || r.title,
    titulo: r.titulo || r.title,
    titulo_original: r.titulo_original || r.original_title,
    slug: r.slug,
  });
  const tituloOrigList = elegirTituloOriginal(
    titulo,
    r.titulo_original || r.original_title,
    [r.title, r.titulo]
  );
  // Conservar type/tipo de la API (Pelicula, Anime, OVA, ONA, Especial…)
  const tipoRaw = String(r.tipo || r.type || "Pelicula").trim();
  let tipo;
  if (/^ova$/i.test(tipoRaw) || /\bova\b/i.test(tipoRaw)) tipo = "OVA";
  else if (/^ona$/i.test(tipoRaw) || /\bona\b/i.test(tipoRaw)) tipo = "ONA";
  else if (/especial|special/i.test(tipoRaw)) tipo = "Especial";
  else if (/anime/i.test(tipoRaw)) tipo = "Anime";
  else if (/serie|tv|dorama/i.test(tipoRaw)) tipo = "Serie";
  else if (/pel[ií]cula|movie|film/i.test(tipoRaw)) tipo = "Película";
  else tipo = tipoRaw || "Película";
  const slug = r.slug ? String(r.slug) : null;
  const sourceId = resolverSourceId(r.source_id || r.source || r.fuente);
  const year = r.year
    ? String(r.year).match(/(19|20)\d{2}/)?.[0] || String(r.year).slice(0, 4)
    : null;
  // Ruta worker: si la API ya trae url con /pelicula/ u /anime/, usarla; si no, inferir
  const urlHint = String(r.url || r.link || r.url_extract || "");
  let kindPath = "pelicula";
  if (/\/anime\//i.test(urlHint)) kindPath = "anime";
  else if (/\/serie\//i.test(urlHint)) kindPath = "serie";
  else if (/\/pelicula\//i.test(urlHint)) kindPath = "pelicula";
  else if (tipo === "Anime" || tipo === "OVA" || tipo === "ONA" || tipo === "Especial") {
    // OVA/ONA suelen vivir bajo /anime/ salvo que type sea Pelicula
    kindPath = (tipo === "Película") ? "pelicula" : "anime";
  } else if (tipo === "Serie") kindPath = "serie";
  else kindPath = "pelicula";
  if (tipo === "Película") kindPath = /\/anime\//i.test(urlHint) ? "anime" : "pelicula";
  const link =
    r.url_extract ||
    r.link ||
    r.url ||
    (slug ? `${API_BASE}/${sourceId}/${kindPath}/${slug}` : null);

  const generos = Array.isArray(r.generos)
    ? r.generos
    : r.genero
      ? String(r.genero).split(",").map((g) => g.trim()).filter(Boolean)
      : [];
  const genero = generos.length ? generos.join(", ") : r.genero || null;

  let calificacion =
    r.rating != null
      ? r.rating
      : r.calificacion != null
        ? r.calificacion
        : r.imdb && r.imdb.rating != null
          ? r.imdb.rating
          : null;
  if (calificacion != null && calificacion !== "") {
    const n = Number(String(calificacion).replace(",", "."));
    calificacion = Number.isFinite(n) && n >= 0 && n <= 10 ? Math.round(n * 10) / 10 : null;
  } else {
    calificacion = null;
  }

  const esMetaPortada = (u) =>
    /metahub\.space|media-amazon\.com|m\.media-amazon/i.test(String(u || ""));

  const portadaFuente =
    r.portada_fuente_raw ||
    (r.portada && !esMetaPortada(r.portada) ? r.portada : null) ||
    (r.image && !esMetaPortada(r.image) ? r.image : null);

  const portada =
    portadaFuente ||
    r.portada ||
    r.image ||
    r.portada_imdb ||
    (r.imdb && r.imdb.portada) ||
    r.portada_tmdb ||
    (r.tmdb && r.tmdb.portada) ||
    null;

  return {
    id: r.postId || r.id || r.tmdb_id || r.imdb_id || `${sourceId}-${slug || titulo}`,
    postId: r.postId || null,
    tmdb_id: r.tmdb_id || (r.tmdb && r.tmdb.id) || null,
    imdb_id: r.imdb_id || (r.imdb && r.imdb.id) || null,
    nombre: titulo,
    titulo: titulo,
    titulo_original: tituloOrigList || r.titulo_original || null,
    slug,
    tipo,
    descripcion: r.descripcion || null,
    portada,
    backdrop: r.backdrop || (r.tmdb && r.tmdb.backdrop) || null,
    year,
    genero,
    generos,
    calificacion,
    rating: r.rating != null ? r.rating : calificacion,
    votos: r.votos || (r.imdb && r.imdb.votos) || null,
    fecha_estreno: r.fecha_estreno || null,
    duracion: r.duracion || (r.imdb && r.imdb.duracion) || null,
    duracion_texto:
      r.duracion_texto || (r.imdb && r.imdb.duracion_texto) || null,
    certificacion:
      r.certificacion || (r.imdb && r.imdb.certificacion) || null,
    imdb: r.imdb || null,
    tmdb: r.tmdb || null,
    omdb: r.omdb || null,
    link,
    url_extract: r.url_extract || link,
    source_id: sourceId,
    fuente: r.source || r.fuente || null,
    estado: r.estado || r.status || null,
    en_emision: r.en_emision != null
      ? !!r.en_emision
      : (/emisi|airing|ongoing|en curso|returning/i.test(String(r.estado || r.status || ""))
          ? true
          : (/final|ended|complet|conclu/i.test(String(r.estado || r.status || "")) ? false : null)),
    finalizado: r.finalizado != null
      ? !!r.finalizado
      : (/final|ended|complet|conclu/i.test(String(r.estado || r.status || "")) ? true : null),
    tiene_player: false,
    embeds: [],
    downloads: [],
    episodios: [],
    temporadas: [],
  };
}

/** Detalle de película / serie / capítulo → item completo */
function mapDetail(data, fallback = {}) {
  const tipo = normalizarTipo(data.tipo || data.type || fallback.tipo);
  const sourceId = resolverSourceId(data.source_id || data.fuente || fallback.source_id || fallback.fuente);
  const slug = data.slug || fallback.slug || null;
  // Principal = título local/ES; original = inglés u otro (nunca invertir)
  const titulo = elegirTituloPrincipal({
    nombre: data.nombre || data.titulo || data.title,
    titulo: data.titulo || data.title,
    titulo_original: data.titulo_original || data.original_title,
    slug,
    cachedNombre: fallback.nombre || fallback.titulo,
  });
  const tituloOriginal = elegirTituloOriginal(
    titulo,
    data.titulo_original || data.original_title,
    [data.title, data.titulo, fallback.titulo_original].filter(Boolean)
  );
  const embedsArr = mapEmbeds([
    ...(Array.isArray(data.reproductores) ? data.reproductores : []),
    ...(Array.isArray(data.embeds) ? data.embeds : []),
  ]);
  // Preferir stream_url HLS si el Worker lo trajo
  const reproductor = embedsArr[0]?.stream_url || embedsArr[0]?.url || data.reproductor || null;

  // Descargas con idioma / calidad
  let downloadsRaw = data.descargas || data.downloads || [];
  if (typeof downloadsRaw === "string") {
    try { downloadsRaw = JSON.parse(downloadsRaw); } catch { downloadsRaw = []; }
  }
  const downloadsMapped = Array.isArray(downloadsRaw)
    ? downloadsRaw.map((d) => {
        if (typeof d === "string" && d.startsWith("http")) return { url: d, idioma: null, calidad: null, servidor: null };
        if (d && typeof d === "object") {
          return {
            url: d.url || d.link || d.href || null,
            idioma: d.idioma || d.lang || null,
            calidad: d.calidad || d.quality || null,
            servidor: d.servidor || d.server || d.name || null,
          };
        }
        return null;
      }).filter((d) => d && d.url)
    : [];

  let episodios = [];
  let temporadas = [];
  let temporadas_raw = [];
  if (Array.isArray(data.temporadas) && data.temporadas.length) {
    temporadas_raw = data.temporadas;
    temporadas = data.temporadas.map((t) => Number(t.temporada || t.season || t)).filter(Boolean);
    for (const temp of data.temporadas) {
      // API nueva: episodios = número, lista = array de caps
      // API vieja: episodios = array
      let eps = [];
      if (Array.isArray(temp.lista)) eps = temp.lista;
      else if (Array.isArray(temp.episodios)) eps = temp.episodios;
      else if (Array.isArray(temp.episodes)) eps = temp.episodes;
      else if (Array.isArray(temp.caps)) eps = temp.caps;
      for (const ep of eps) {
        if (!ep || typeof ep !== "object") continue;
        const seasonNum = Number(ep.temporada || temp.temporada || data.temporada_principal || 1) || 1;
        const epNum = Number(ep.episodio || ep.episode || 1) || 1;
        const epEmbeds = mapEmbeds(ep.reproductores || ep.embeds || []);
        episodios.push(
          asegurarUrlCapitulo(
            {
              id: `${slug}-t${seasonNum}-e${epNum}`,
              nombre: ep.titulo || ep.nombre || `T${seasonNum}E${String(epNum).padStart(2, "0")}`,
              season: seasonNum,
              episode: epNum,
              video: epEmbeds[0]?.stream_url || epEmbeds[0]?.url || ep.reproductor || null,
              embeds: epEmbeds,
              downloads: ep.descargas || ep.downloads || [],
              soloTrailer: false,
              url_video: ep.url_video || ep.link || null,
              source_id: sourceId,
              slug_media: ep.slug_media || temp.slug_media || slug || null,
              formato: ep.formato || temp.formato || data.formato || null,
              episode_id: ep.episode_id || null,
              // AnimeAV1 screenshot por episodio
              back_img: ep.back_img || ep.screenshot || ep.still || null,
              still: ep.still || ep.back_img || null,
              imagen: ep.imagen || ep.image || ep.back_img || null,
              url_capitulo:
                ep.url_capitulo ||
                ep.link ||
                urlCapituloWorker(sourceId, tipo === "Anime" ? "anime" : "serie", slug, seasonNum, epNum),
            },
            { source_id: sourceId, tipo, slug }
          )
        );
      }
    }
  }

  const metaF = extraerMetaFuentes({ ...fallback, ...data });
  let calificacion = data.rating != null ? data.rating : (data.calificacion != null ? data.calificacion : (fallback.rating != null ? fallback.rating : (fallback.calificacion != null ? fallback.calificacion : null)));
  if (metaF.imdb.rating != null && Number(metaF.imdb.rating) > 0) {
    calificacion = metaF.imdb.rating;
  } else if (metaF.omdb.rating != null && Number(metaF.omdb.rating) > 0) {
    calificacion = metaF.omdb.rating;
  }
  if (calificacion != null && calificacion !== "") {
    const n = Number(String(calificacion).replace(",", "."));
    calificacion = Number.isFinite(n) && n >= 0 && n <= 10 ? Math.round(n * 10) / 10 : null;
  } else {
    calificacion = null;
  }

  return {
    id: data.postId || fallback.postId || fallback.id || `${sourceId}-${slug || titulo}`,
    postId: data.postId || fallback.postId || null,
    nombre: titulo,
    titulo: titulo,
    titulo_original: tituloOriginal || data.titulo_original || data.original_title || fallback.titulo_original || null,
    slug,
    tipo: tipo === "Capitulo" ? (data.formato === "OVA" || tipo === "Anime" ? "Anime" : "Serie") : tipo,
    formato: data.formato || fallback.formato || null,
    descripcion: limpiarDescripcion(data.descripcion || fallback.descripcion || "", titulo),
    // Portada: NO dejar que "data.portada" (a veces Metahub roto) gane por defecto
    // sobre la portada ya buena del listado (fallback, ej. TMDB). Se dejan competir
    // ambos candidatos reales en elegirPortada() para que el scoring decida.
    portada: elegirPortada(
      fallback.portada || null,
      data.portada || data.portada_imdb || data.portada_tmdb || data.tmdb_poster || null,
      sourceId
    ),
    portada_tmdb: data.portada_tmdb || null,
    portada_imdb: data.portada_imdb || null,
    poster_source: data.poster_source || null,
    backdrop: data.backdrop || fallback.backdrop || null,
    year: (function () {
      const yData = extraerAnio(titulo, data.year || data.fecha_estreno || null);
      const yFall = extraerAnio(titulo, fallback.year || null);
      // Si API y fallback tienen años distintos, quedarse con el de la API (no mezclar 2012/2026)
      if (yData) return yData;
      return yFall || null;
    })(),
    genero: extraerGenero(data) || extraerGenero(fallback) || (Array.isArray(data.generos) ? data.generos.join(", ") : null),
    generos: Array.isArray(data.generos) ? data.generos : [],
    idiomas: data.idiomas || [],
    calidad: data.calidad || [],
    calificacion,
    rating: calificacion,
    rating_source: data.rating_source || (metaF.imdb.rating != null ? "imdb" : (metaF.tmdb.rating != null ? "tmdb" : null)),
    tmdb_id: data.tmdb_id || metaF.tmdb.id || fallback.tmdb_id || null,
    imdb_id: data.imdb_id || metaF.imdb.id || fallback.imdb_id || null,
    calificacion_comunidad: null,
    votos: data.votos || metaF.imdb.votos || metaF.tmdb.votos || null,
    fecha_estreno: data.fecha_estreno || fallback.fecha_estreno || null,
    // Estado de emisión (series / anime / doramas)
    estado: data.estado || data.status || fallback.estado || null,
    en_emision: data.en_emision != null ? !!data.en_emision : (fallback.en_emision != null ? !!fallback.en_emision : null),
    finalizado: data.finalizado != null ? !!data.finalizado : (fallback.finalizado != null ? !!fallback.finalizado : null),
    duracion: data.duracion || metaF.imdb.duracion || metaF.tmdb.duracion || null,
    duracion_texto: data.duracion_texto || metaF.imdb.duracion_texto || metaF.tmdb.duracion_texto || null,
    certificacion: data.certificacion || metaF.imdb.certificacion || metaF.tmdb.certificacion || null,
    imdb: Object.keys(metaF.imdb).length ? metaF.imdb : null,
    tmdb: Object.keys(metaF.tmdb).length ? metaF.tmdb : null,
    omdb: Object.keys(metaF.omdb).length ? metaF.omdb : null,
    paises: [],
    ultimo_episodio: data.ultimo_episodio || null,
    link: data.link || fallback.link || (slug ? (`${API_BASE}/${sourceId}/${tipo === "Anime" ? "anime" : tipo === "Serie" ? "serie" : "pelicula"}/${slug}`) : null),
    url_extract: data.url_extract || data.link || fallback.link || null,
    source_id: sourceId,
    fuente: data.fuente || fallback.fuente || null,
    temporada_principal: data.temporada_principal || null,
    reproductor,
    embeds: embedsArr,
    downloads: downloadsMapped.length ? downloadsMapped : (data.descargas || data.downloads || []),
    soloTrailer: false,
    episodios,
    temporadas: temporadas.length ? [...new Set(temporadas)].sort((a, b) => a - b) : [],
    temporadas_raw: temporadas_raw.length ? temporadas_raw : null,
    total_temporadas: data.total_temporadas || null,
    total_episodios: data.total_episodios || (episodios.length ? episodios.length : null),
    rangos_episodios: data.rangos_episodios || null,
    temporadas_tmdb: data.temporadas_tmdb || null,
    episodio_desde: data.episodio_desde || null,
    episodio_hasta: data.episodio_hasta || null,
    tiene_player: !!(reproductor || embedsArr.length || episodios.length),
    // Campos extra SOLO útiles para JKanime (source 5); otras fuentes quedan null
    studios: (String(sourceId) === "5" || /jkanime/i.test(String(data.fuente || "")))
      ? (data.studios || data.studio || null) : (data.studios || null),
    temporada_anime: (String(sourceId) === "5" || /jkanime/i.test(String(data.fuente || "")))
      ? (data.temporada_anime || data.temporada || null) : (data.temporada_anime || null),
    demografia: data.demografia || null,
    idiomas: data.idiomas || null,
    calidad: data.calidad || null,
    fecha_estreno_texto: data.fecha_estreno_texto || null,
    titulos_alternativos: data.titulos_alternativos || null,
    ultimo_episodio_url: data.ultimo_episodio_url || null,
    proximo_episodio: data.proximo_episodio || null,
    portada_fuente_raw: data.portada_fuente_raw || null,
  };
}

// Cache corta en servidor (Vercel instance) para listados repetidos
const __API_GET_CACHE = new Map();
const API_GET_TTL_MS = 8 * 60 * 60 * 1000; // 8 horas

async function apiGet(path) {
  const key = String(path || "");
  const now = Date.now();
  const hit = __API_GET_CACHE.get(key);
  if (hit && now - hit.ts < API_GET_TTL_MS && hit.data) {
    return hit.data;
  }
  const { data } = await api.get(path);
  try {
    // Solo cachear listados (no detalle/episodio pesado si falla vacío)
    if (data && (data.resultados || data.results || data.items)) {
      __API_GET_CACHE.set(key, { ts: now, data });
      // limitar tamaño
      if (__API_GET_CACHE.size > 800) {
        const first = __API_GET_CACHE.keys().next().value;
        __API_GET_CACHE.delete(first);
      }
    }
  } catch (_) {}
  return data;
}

const PELIS_CATALOG_PAGES = 761; // worker /3/peliculas
// OJO: a diferencia de /peliculas, el worker /9/series?page=N por ahora
// IGNORA el page (siempre devuelve la misma página 1). Dejamos esto listo
// para cuando el Worker soporte paginación real; mientras tanto, si migras
// /api/series a esta función, todas las páginas mostrarán lo mismo.
const SERIES_CATALOG_PAGES = 200; // ajustar si el worker confirma el total real

async function obtenerSeriesSeccion(page = 1, limit = 24) {
  page = Math.max(1, parseInt(page, 10) || 1);
  limit = Math.min(48, Math.max(12, parseInt(limit, 10) || 24));
  await ensureMoviesDB().catch(() => {});

  try {
    const data = await apiGet(`/${DEFAULT_SOURCE}/series?page=${page}`);

    let lista = (data.results || data.resultados || [])
      .map(mapListItem)
      .filter(Boolean)
      .slice(0, limit);

    lista = lista.map((item) => {
      const local = moviesDB.find(
        (m) =>
          (item.link && m.link === item.link) ||
          (item.slug && m.slug === item.slug)
      );
      if (!local) return item;
      return mergeItems(item, {
        tiene_player: local.tiene_player,
        descripcion: elegirMejorDescripcion(item.descripcion, local.descripcion),
        calificacion: local.calificacion || item.calificacion,
        portada: elegirPortada(item.portada, local.portada, item.source_id || local.source_id),
      });
    });

    lista = filtrarDescartados(lista);
    guardarEnSupabase(lista).catch(() => {});

    return {
      resultados: lista,
      page,
      limit,
      total: SERIES_CATALOG_PAGES * limit,
      totalPages: SERIES_CATALOG_PAGES,
      pages: SERIES_CATALOG_PAGES,
      fuente: data.fuente || "pelisplushd_bz",
      modo: page === 1 ? "estrenos" : "catalogo",
    };
  } catch (err) {
    console.error("obtenerSeriesSeccion:", err.message);
    return {
      resultados: [],
      page,
      limit,
      total: 0,
      totalPages: SERIES_CATALOG_PAGES,
      pages: SERIES_CATALOG_PAGES,
      error: err.message,
    };
  }
}


/**
 * Sección Películas:
 *  page 1 → estrenos (/3/peliculas/estrenos)
 *  page 2..761 → /3/peliculas?page=N
 * Sin mezclar búsquedas de Supabase.
 */
async function obtenerPeliculasSeccion(page = 1, limit = 24) {
  page = Math.max(1, parseInt(page, 10) || 1);
  limit = Math.min(48, Math.max(12, parseInt(limit, 10) || 24));
  await ensureMoviesDB().catch(() => {});

  try {
    let data;
    if (page === 1) {
      // Estrenos primero (bz/to según DEFAULT_SOURCE); fallback a page=1 del listado
      try {
        data = await apiGet(`/${DEFAULT_SOURCE}/peliculas/estrenos`);
        const n = (data && (data.resultados || data.results) || []).length;
        if (!n) data = await apiGet(`/${DEFAULT_SOURCE}/peliculas?page=1`);
      } catch (_) {
        data = await apiGet(`/${DEFAULT_SOURCE}/peliculas?page=1`);
      }
    } else {
      data = await apiGet(`/${DEFAULT_SOURCE}/peliculas?page=${page}`);
    }

    let lista = (data.results || data.resultados || [])
      .map(mapListItem)
      .filter(Boolean)
      .slice(0, limit);

    lista = lista.map((item) => {
      const local = moviesDB.find(
        (m) =>
          (item.link && m.link === item.link) ||
          (item.slug && m.slug === item.slug)
      );
      if (!local) return item;
      return mergeItems(item, {
        tiene_player: local.tiene_player,
        descripcion: elegirMejorDescripcion(item.descripcion, local.descripcion),
        calificacion: local.calificacion || item.calificacion,
        portada: item.portada || local.portada,
      });
    });

    lista = filtrarDescartados(lista);
    // Guardar en Supabase (antes no se hacía en esta sección): sin esto, el
    // detalle de una peli vista solo aquí nunca tenía un fallback de portada
    // buena en caché y terminaba usando la del detalle (a veces rota).
    guardarEnSupabase(lista).catch(() => {});

    return {
      resultados: lista,
      page,
      limit,
      total: PELIS_CATALOG_PAGES * limit,
      totalPages: PELIS_CATALOG_PAGES,
      pages: PELIS_CATALOG_PAGES,
      fuente: data.fuente || "pelisplushd",
      modo: page === 1 ? "estrenos" : "catalogo",
    };
  } catch (err) {
    console.error("obtenerPeliculasSeccion:", err.message);
    return {
      resultados: [],
      page,
      limit,
      total: 0,
      totalPages: PELIS_CATALOG_PAGES,
      pages: PELIS_CATALOG_PAGES,
      error: err.message,
    };
  }
}

// ---------- Lógica de negocio ----------
async function obtenerEstrenos(tipo = "peliculas", limit = 24) {
  // tipo: peliculas | series | animes
  // Anime → AnimeAV1 en emisión (/4/animes/emision); resto → PelisPlus estrenos
  await ensureMoviesDB(); // datos frescos de Supabase (Disponible, etc.)
  const path =
    tipo === "animes"
      ? `/4/animes/emision`
      : `/${DEFAULT_SOURCE}/${tipo}/estrenos`;
  try {
    const data = await apiGet(path);
    let lista = (data.results || data.resultados || []).map(mapListItem).filter(Boolean).slice(0, limit);
    // Anime desde /emision → marcar en emisión
    if (tipo === "animes") {
      lista = lista.map((item) => {
        if (!item) return item;
        if (item.en_emision == null && item.finalizado !== true) {
          item.en_emision = true;
          item.estado = item.estado || "En emisión";
        }
        return item;
      });
    }
    // Enriquecer con datos ya guardados
    lista = lista.map((item) => {
      const local = moviesDB.find(
        (m) =>
          (item.link && m.link === item.link) ||
          (item.slug && m.slug === item.slug) ||
          (normalizeTitleKey(m.nombre) === normalizeTitleKey(item.nombre) &&
            ((tipo === "series" && m.tipo === "Serie") ||
              (tipo === "animes" && (
                String(m.source_id || "") === "4" || /animeav1/i.test(String(m.source_id || m.fuente || "")) ||
                m.tipo === "Anime" || m.tipo === "OVA" || m.tipo === "ONA" || m.tipo === "Especial"
              )) ||
              (tipo === "peliculas" && (m.tipo === "Película" || !m.tipo))))
      );
      if (local) {
        return mergeItems(item, {
          tiene_player: local.tiene_player,
          embeds: local.embeds,
          reproductor: local.reproductor,
          descripcion: elegirMejorDescripcion(item.descripcion, local.descripcion),
          calificacion: local.calificacion || item.calificacion,
          portada: item.portada || local.portada,
          downloads: local.downloads,
          episodios: local.episodios,
          estado: local.estado || item.estado,
          en_emision: local.en_emision != null ? local.en_emision : item.en_emision,
          finalizado: local.finalizado != null ? local.finalizado : item.finalizado,
        });
      }
      return item;
    });
    lista = filtrarDescartados(lista);

    // Añadir al inicio ítems de Supabase del mismo tipo (búsquedas guardadas: Acaramelados → Series, etc.)
 /*   const tipoMatch = (m) => {
      const t = String(m.tipo || "").toLowerCase();
      if (tipo === "series") return t === "serie" || t === "dorama" || t === "tv";
      if (tipo === "animes") return t === "anime";
      return t === "película" || t === "pelicula" || t === "movie" || !t;
    };
    const seenSlug = new Set(
      lista.map((it) => String(it.slug || "").toLowerCase()).filter(Boolean)
    );
    const seenTitle = new Set(
      lista.map((it) => normalizeTitleKey(it.nombre || it.titulo || "")).filter(Boolean)
    );
    const extras = [];
    for (const m of moviesDB) {
      if (!m || esDescartado(m) || !tipoMatch(m)) continue;
      const slug = String(m.slug || "").toLowerCase();
      const tk = normalizeTitleKey(m.nombre || "");
      if (slug && seenSlug.has(slug)) continue;
      if (tk && seenTitle.has(tk)) continue;
      if (slug) seenSlug.add(slug);
      if (tk) seenTitle.add(tk);
      const mapped = normalizeItemFromDB(m);
      if (mapped) extras.push(mapped);
      if (extras.length >= Math.min(12, limit)) break;
    }
    // Preferir recién guardados al frente de la sección
    lista = dedupeListItems([...extras, ...lista]).slice(0, limit);
*/

        // Series/animes: seguir mostrando búsquedas guardadas en su sección.
    // Películas: NO mezclar búsquedas — la sección irá con paginación de catálogo.
    if (tipo === "series" || tipo === "animes") {
      const tipoMatch = (m) => {
        const t = String(m.tipo || "").toLowerCase();
        if (tipo === "series") return t === "serie" || t === "dorama" || t === "tv";
        return t === "anime";
      };
      const seenSlug = new Set(
        lista.map((it) => String(it.slug || "").toLowerCase()).filter(Boolean)
      );
      const seenTitle = new Set(
        lista.map((it) => normalizeTitleKey(it.nombre || it.titulo || "")).filter(Boolean)
      );
      const extras = [];
      for (const m of moviesDB) {
        if (!m || esDescartado(m) || !tipoMatch(m)) continue;
        const slug = String(m.slug || "").toLowerCase();
        const tk = normalizeTitleKey(m.nombre || "");
        if (slug && seenSlug.has(slug)) continue;
        if (tk && seenTitle.has(tk)) continue;
        if (slug) seenSlug.add(slug);
        if (tk) seenTitle.add(tk);
        const mapped = normalizeItemFromDB(m);
        if (mapped) extras.push(mapped);
        if (extras.length >= Math.min(12, limit)) break;
      }
      lista = dedupeListItems([...extras, ...lista]).slice(0, limit);
    } else {
      lista = lista.slice(0, limit);
    }
    // Guardar en Supabase en background (solo metadatos)
    guardarEnSupabase(lista).catch(() => {});
    return { resultados: lista, total: data.total || lista.length, page: 1, limit };
  } catch (err) {
    console.error("Error estrenos:", err.message);
    // Fallback: recientes de Supabase
    const locales = moviesDB
      .filter((m) => {
        if (tipo === "series") {
          const t = String(m.tipo || "").toLowerCase();
          return t === "serie" || t === "dorama" || t === "tv";
        }
        if (tipo === "animes") return String(m.tipo || "").toLowerCase() === "anime";
        const t = String(m.tipo || "").toLowerCase();
        return t === "película" || t === "pelicula" || t === "movie" || !t;
      })
      .slice(0, limit)
      .map((m) => normalizeItemFromDB(m));
    return { resultados: filtrarDescartados(locales), total: locales.length, page: 1, limit, source: "local" };
  }
}

async function obtenerPopulares(tipo = "peliculas", limit = 24) {
  try {
    const data = await apiGet(`/${DEFAULT_SOURCE}/${tipo}/populares`);
    const lista = (data.resultados || []).map(mapListItem).slice(0, limit);
    guardarEnSupabase(lista).catch(() => {});
    return { resultados: lista, total: data.total || lista.length, page: 1, limit };
  } catch (err) {
    return obtenerEstrenos(tipo, limit);
  }
}

/** Catálogo PelisPlus paginado: /3/peliculas?page=N (page 1..761) */
async function obtenerPeliculasCatalogo(page = 2, limit = 24) {
  page = Math.max(1, parseInt(page, 10) || 1);
  limit = Math.min(48, Math.max(6, parseInt(limit, 10) || 24));
  await ensureMoviesDB().catch(() => {});
  try {
    const data = await apiGet(`/${DEFAULT_SOURCE}/peliculas?page=${page}`);
    let lista = (data.results || data.resultados || [])
      .map(mapListItem)
      .filter(Boolean)
      .slice(0, limit);

    lista = lista.map((item) => {
      const local = moviesDB.find(
        (m) =>
          (item.link && m.link === item.link) ||
          (item.slug && m.slug === item.slug)
      );
      if (local) {
        return mergeItems(item, {
          tiene_player: local.tiene_player,
          descripcion: elegirMejorDescripcion(item.descripcion, local.descripcion),
          calificacion: local.calificacion || item.calificacion,
          portada: item.portada || local.portada,
        });
      }
      return item;
    });
    lista = filtrarDescartados(lista);
    // Catálogo completo: siempre reportar todas las páginas del worker (no solo esta página)
    const pages = typeof PELIS_CATALOG_PAGES === "number" ? PELIS_CATALOG_PAGES : 761;
    return {
      resultados: lista,
      total: pages * limit,
      page,
      pages,
      totalPages: pages,
      limit,
      fuente: data.fuente || "pelisplushd_bz",
    };
  } catch (err) {
    console.error("Error catalogo peliculas:", err.message);
    const pages = typeof PELIS_CATALOG_PAGES === "number" ? PELIS_CATALOG_PAGES : 761;
    return { resultados: [], total: pages * limit, page, pages, totalPages: pages, limit, error: err.message };
  }
}

/** Relevancia de un item respecto al query (mayor = mejor) */
function scoreSearchRelevance(item, termino) {
  const qNorm = normalizeTitleKey(termino);
  const title = normalizeTitleKey(item.nombre || item.titulo || "");
  const slug = String(item.slug || "").toLowerCase().replace(/-/g, " ");
  const qTokens = qNorm.split(/\s+/).filter((t) => t.length > 1);
  let s = 0;
  if (!title && !slug) return 0;
  if (title === qNorm) s += 100;
  else if (title.startsWith(qNorm) || qNorm.startsWith(title)) s += 60;
  else if (title.includes(qNorm) || qNorm.includes(title)) s += 40;
  // tokens del query presentes en título o slug
  let hit = 0;
  for (const t of qTokens) {
    if (title.includes(t) || slug.includes(t)) hit += 1;
  }
  if (qTokens.length) s += Math.round((hit / qTokens.length) * 30);
  if (esPortadaValida(item.portada)) s += 8;
  if (item.descripcion && String(item.descripcion).length > 40) s += 4;
  if (item.tiene_player) s += 6;
  s += Math.min(scoreItem(item), 20);
  return s;
}

/** ¿Es película/OVA/especial y no la serie principal? */
function esSpinoffOFilmSlug(slug, titulo) {
  const x = `${slug || ""} ${titulo || ""}`.toLowerCase();
  return /film|movie|pelicula|estampida|stampede|strong.?world|heroines|episode of|episode-of|fan.?letter|3d2y|\bgold\b|aventura en|heart of|chopper|gyojin|sorajima|recap|\bova\b|special|movie \d|film:/.test(x)
    || /-(film|movie|ova|special|estampida|stampede|heroines|fan-letter|episode-of|3d2y|gold|z)(-|$)/i.test(String(slug || ""));
}

/**
 * Clave de dedupe en búsqueda (misma obra entre fuentes / idiomas):
 * - Serie principal: one-piece-1999 + one-piece → una sola
 * - Live action: one-piece-2023 (Serie) distinta del anime
 * - Films: strong-world / movie-10-strong-world → una
 * - Películas: título normalizado + año (2001 odisea espacial)
 */
function normalizeWorkKey(slug, titulo, tipo) {
  let s = String(slug || "").toLowerCase().trim();
  let t = normalizeTitleKey(titulo || "");
  let tipoKey = String(tipo || "").toLowerCase().replace(/[íÍ]/g, "i");

  let year = null;
  const ym = s.match(/-(\d{4})$/);
  if (ym) { year = ym[1]; s = s.replace(/-\d{4}$/, ""); }
  const yt = t.match(/\b((?:19|20)\d{2})\b/);
  if (!year && yt) year = yt[1];
  t = t.replace(/\b(?:19|20)\d{2}\b/g, " ").replace(/\s+/g, " ").trim();

  s = s
    .replace(/-the-missing-pieces?(?:-ova)?$/, "-piece")
    .replace(/-missing-pieces?(?:-ova)?$/, "-piece")
    .replace(/-pieces$/, "-piece");
  t = t
    .replace(/\bthe missing pieces?\b/g, "piece")
    .replace(/\bmissing pieces?\b/g, "piece")
    .replace(/\bpieces\b/g, "piece")
    .replace(/\s+/g, " ")
    .trim();

  s = s
    .replace(/-movie-\d+-/g, "-")
    .replace(/-movie-\d+$/g, "")
    .replace(/-la-pelicula$/i, "")
    .replace(/-the-movie$/i, "")
    .replace(/^one-piece-film-/, "one-piece-")
    .replace(/estampida/g, "stampede")
    .replace(/-episode-of-/g, "-")
    .replace(/--+/g, "-")
    .replace(/^-|-$/g, "");

  t = t
    .replace(/\ba space odyssey\b/g, "odisea espacial")
    .replace(/\bodisea del espacio\b/g, "odisea espacial")
    .replace(/\s+/g, " ")
    .trim();

  const esPeli = /pelicul/.test(tipoKey);
  const esAnime = /anime/.test(tipoKey);
  const esSerie = /serie|dorama|tv/.test(tipoKey) && !esAnime;

  if (esPeli) {
    let base = t;
    if (!base || base.length < 3) base = s.replace(/-/g, " ").trim();
    base = base.replace(/\bmovie\s*\d+\b/g, "").replace(/\bfilm\b/g, "").replace(/\s+/g, " ").trim();
    // one piece films as pelicula
    if (/one.?piece/.test(base + s) && esSpinoffOFilmSlug(s, t)) {
      let filmId = s.replace(/^one-piece-/, "").replace(/-/g, " ").trim() || base.replace(/one piece/g, "").trim();
      filmId = filmId.replace(/\bla pelicula\b/g, "").replace(/\s+/g, " ").trim();
      return `film:${filmId || base}`;
    }
    return `peli:${base}:${year || ""}`;
  }

  // Serie y Anime NO comparten clave → no se mezclan ni se reetiquetan
  if (esSerie || esAnime) {
    const bucket = esAnime ? "anime" : "serie";
    if (/one.?piece/.test(s + t) && year === "2023" && esSerie) {
      return `${bucket}:one-piece-live:2023`;
    }
    if (esSpinoffOFilmSlug(s, t)) {
      let filmId = s.replace(/^one-piece-/, "").replace(/-/g, " ").trim();
      if (!filmId || filmId.length < 2) filmId = t.replace(/one piece/g, "").trim();
      filmId = filmId.replace(/\bla pelicula\b/g, "").replace(/\bmovie\s*\d+\b/g, "").replace(/\s+/g, " ").trim();
      return `film:${filmId || s}`;
    }
    const core = s.replace(/-/g, " ").trim() || t;
    return `${bucket}:${core}`;
  }

  if (s) return `slug:${s}:${year || ""}`;
  if (t) return `t:${tipoKey}:${t}:${year || ""}`;
  return null;
}

/** Clave dedupe búsqueda */
function searchDedupeKey(item) {
  const key = normalizeWorkKey(item.slug, item.nombre || item.titulo, item.tipo);
  if (key) return key;
  return item.link || String(Math.random());
}

/** Mejor resultado de la misma obra (portada, Anime, fuente 4, descripción) */
function pickBestSearchItem(a, b) {
  const score = (it) => {
    let s = scoreItem(it);
    if (esPortadaValida(it.portada)) s += 20;
    if (it.descripcion && String(it.descripcion).length > 40) s += 10;
    if (it.tiene_player) s += 8;
    const t = String(it.tipo || "").toLowerCase();
    if (t === "anime") s += 15;
    else if (t === "serie") s += 5;
    const sid = String(it.source_id || "");
    if (sid === "4") s += 12;
    else if (sid === "3") s += 6;
    else if (sid === "1") s += 2;
    return s;
  };
  const preferA = score(a) >= score(b);
  const winner = preferA ? { ...a } : { ...b };
  const loser = preferA ? b : a;

  winner.portada = elegirPortada(winner.portada, loser.portada, winner.source_id);
  winner.descripcion = elegirMejorDescripcion(winner.descripcion, loser.descripcion);

  if (!winner.calificacion && loser.calificacion) winner.calificacion = loser.calificacion;
  if (loser.tiene_player && !winner.tiene_player) winner.tiene_player = true;
  if ((!winner.total_episodios || winner.total_episodios < (loser.total_episodios || 0)) && loser.total_episodios) {
    winner.total_episodios = loser.total_episodios;
  }
  // Respetar el tipo del ganador; NUNCA convertir Serie → Anime
  const tw = String(winner.tipo || "");
  const tl = String(loser.tipo || "");
  if (/serie|dorama/i.test(tw)) winner.tipo = "Serie";
  else if (/anime/i.test(tw)) winner.tipo = "Anime";
  else if (/serie|dorama/i.test(tl) && !/anime/i.test(tw)) winner.tipo = "Serie";
  else if (/anime/i.test(tl) && !/serie|dorama/i.test(tw)) winner.tipo = "Anime";

  const nW = limpiarTitulo(winner.nombre || "");
  const nL = limpiarTitulo(loser.nombre || "");
  if (nL && (!nW || nL.length <= nW.length || /ver |online|gratis/i.test(String(winner.nombre || "")))) {
    winner.nombre = nL;
  } else {
    winner.nombre = nW || winner.nombre;
  }
  if (!winner.link && loser.link) winner.link = loser.link;
  if (!winner.slug && loser.slug) winner.slug = loser.slug;
  const alts = new Set(
    [...(winner._alt_sources || []), ...(loser._alt_sources || []), String(loser.source_id || ""), String(winner.source_id || "")].filter(Boolean)
  );
  winner._alt_sources = Array.from(alts);
  return winner;
}

/**
 * Dedupe duplicados reales entre fuentes:
 * - mismo slug (horimiya en 3 y 4 → 1)
 * - piece === missing pieces → 1
 * - horimiya-2021 (peli mal tipada) se une a horimiya serie/anime
 * Mantiene aparte: obra base ≠ spin-off piece
 */
function dedupeSearchResults(lista) {
  // Sin dedupe: la API ya devuelve resultados correctos
  return Array.isArray(lista) ? lista.slice() : [];
}

/** Mapeo mínimo: nunca perder un hit del worker por fallos de mapListItem */
function mapListItemMinimal(r) {
  if (!r || typeof r !== "object") return null;
  const slug = r.slug ? String(r.slug) : null;
  const titulo =
    r.nombre || r.titulo || r.title || (slug ? String(slug).replace(/-/g, " ") : null);
  if (!titulo && !slug) return null;
  const tipoRaw = String(r.tipo || r.type || "").trim();
  let tipo = "Película";
  if (/serie|tv|dorama/i.test(tipoRaw)) tipo = "Serie";
  else if (/anime/i.test(tipoRaw)) tipo = "Anime";
  else if (/ova/i.test(tipoRaw)) tipo = "OVA";
  else if (/ona/i.test(tipoRaw)) tipo = "ONA";
  else if (/pel|movie|film/i.test(tipoRaw)) tipo = "Película";
  else if (tipoRaw) tipo = tipoRaw;
  let sourceId = "3";
  try {
    sourceId = String(resolverSourceId(r.source_id || r.source || r.fuente) || "3");
  } catch (_) {}
  const link =
    r.url_extract ||
    r.link ||
    r.url ||
    (slug ? `${API_BASE}/${sourceId}/${tipo === "Serie" ? "serie" : tipo === "Anime" || tipo === "OVA" || tipo === "ONA" ? "anime" : "pelicula"}/${slug}` : null);
  return {
    id: sourceId + "-" + (slug || titulo),
    nombre: titulo,
    titulo: titulo,
    slug: slug,
    tipo: tipo,
    portada: r.portada || r.poster || r.image || null,
    year: r.year || null,
    link: link,
    url_extract: link,
    source_id: sourceId,
    fuente: r.source || r.fuente || null,
    tiene_player: true,
    embeds: [],
    downloads: [],
    episodios: [],
    temporadas: [],
  };
}

async function buscarOnline(termino, page = 1, limit = 48, animeSource = null) {
  const qRaw = String(termino || "").trim();
  if (!qRaw) return { resultados: [], total: 0, page, limit, source: "online" };

  function extraerLista(data) {
    if (!data) return [];
    if (Array.isArray(data.results)) return data.results;
    if (Array.isArray(data.resultados)) return data.resultados;
    if (Array.isArray(data.items)) return data.items;
    if (Array.isArray(data)) return data;
    return [];
  }

  /** GET al worker: fetch nativo primero (más fiable en Vercel), axios de respaldo */
  async function workerSearch(path, params) {
    const qs = new URLSearchParams();
    Object.entries(params || {}).forEach(([k, v]) => {
      if (v != null && v !== "") qs.set(k, String(v));
    });
    const rel = String(path || "/").startsWith("/") ? path : "/" + path;
    const url = API_BASE + rel + (qs.toString() ? "?" + qs.toString() : "");
    // 1) fetch nativo (Node 18+ / Vercel)
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 22000);
      const res = await fetch(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          "User-Agent": "MovieZone/2.0",
        },
        signal: ctrl.signal,
        cache: "no-store",
      });
      clearTimeout(t);
      if (res.ok) {
        const data = await res.json();
        const list = extraerLista(data);
        if (list.length) return list;
      }
    } catch (eFetch) {
      console.warn("workerSearch fetch", path, eFetch.message || eFetch);
    }
    // 2) axios
    try {
      const { data } = await api.get(rel, { params: params || {}, timeout: 22000 });
      return extraerLista(data);
    } catch (e) {
      console.warn("workerSearch axios", path, e.message);
      return [];
    }
  }

  function mergeRaw(into, list) {
    const seen = into._seen || new Set();
    into._seen = seen;
    for (const r of list || []) {
      if (!r) continue;
      const sid = String(r.source_id || r.source || r.fuente || "");
      const slug = String(r.slug || r.url || r.link || r.title || r.titulo || "");
      const k = sid + "|" + slug.toLowerCase();
      if (!slug || seen.has(k)) continue;
      seen.add(k);
      into.push(r);
    }
    return into;
  }

  // Solo JK fuerza fuente 5. Todo lo demás = buscador UNIVERSAL del worker.
  // (3 vs 9 lo decide el worker con PELISPLUS_UNIVERSAL; MovieZone no elige 9 aquí)
  const soloJk =
    animeSource === "jk" ||
    animeSource === "5" ||
    animeSource === "jkanime";

  const limQ = Math.min(80, Math.max(limit, 40));
  let raw = [];
  raw._seen = new Set();

  try {
    if (soloJk) {
      let list = await workerSearch("/5", { q: qRaw, limit: limQ });
      if (!list.length) list = await workerSearch("/5/buscar", { q: qRaw, limit: limQ });
      if (!list.length) list = await workerSearch("/search", { q: qRaw, source: "jkanime", limit: limQ });
      mergeRaw(raw, list);
    } else {
      // UNIVERSAL → worker /search (incluye pelis 3 o 9 según config del worker + AV1 + doramas)
      mergeRaw(raw, await workerSearch("/search", { q: qRaw, limit: limQ }));
      if (!raw.length) {
        mergeRaw(raw, await workerSearch("/", { q: qRaw, limit: limQ }));
      }
    }
  } catch (err) {
    console.warn("search:", err.message);
  }

  delete raw._seen;

  let lista = (raw || [])
    .map((r) => {
      try {
        const m = mapListItem(r);
        if (m && (m.slug || m.link || m.nombre || m.titulo)) return m;
      } catch (eMap) {
        console.warn("mapListItem:", eMap.message);
      }
      try {
        return mapListItemMinimal(r);
      } catch (_) {
        return null;
      }
    })
    .filter((item) => item && (item.slug || item.link || item.url_extract || item.nombre || item.titulo));

  // 4/5: conservar tipo de la API (Anime|Película|OVA|…). NO forzar "Anime".
  // NO guardar en Supabase aquí (listado incompleto); solo al abrir detalle.
  lista = lista.map((it) => {
    const sid = String(it.source_id || it.fuente || "").toLowerCase();
    if (sid === "4" || sid === "animeav1" || /animeav1/i.test(String(it.fuente || it.source || ""))) {
      it.source_id = "4";
      it.fuente = it.fuente || "animeav1";
      // tipo ya viene de mapListItem (Película/OVA/Anime…)
      if (!it.link && it.slug) {
        const k = /pel[ií]cula|movie|film/i.test(String(it.tipo || "")) ? "pelicula" : "anime";
        it.link = `${API_BASE}/4/${k}/${it.slug}`;
      }
    }
    if (sid === "5" || sid === "jkanime" || /jkanime/i.test(String(it.fuente || it.source || ""))) {
      it.source_id = "5";
      it.fuente = it.fuente || "jkanime";
      if (!it.link && it.slug) {
        const k = /pel[ií]cula|movie|film/i.test(String(it.tipo || "")) ? "pelicula" : "anime";
        it.link = `${API_BASE}/5/${k}/${it.slug}`;
      }
    }
    return it;
  });

  // Marcar Disponible si ya está en Supabase/memoria con players (sin pisar meta API)
  try {
    await ensureMoviesDB().catch(() => {});
  } catch (_) {}
  lista = lista.map((item) => {
    const tipoItem = normalizarTipo(item.tipo || "");
    const local =
      moviesDB.find(
        (m) =>
          (item.link && m.link === item.link) ||
          (item.slug &&
            m.slug === item.slug &&
            String(m.source_id || "") === String(item.source_id || "") &&
            normalizarTipo(m.tipo || "") === tipoItem) ||
          (item.slug &&
            m.slug === item.slug &&
            normalizarTipo(m.tipo || "") === tipoItem)
      ) || null;
    if (!local || esDescartado(local)) return item;
    // No mezclar meta de un Anime guardado con una Serie del mismo slug
    if (normalizarTipo(local.tipo || "") !== tipoItem && tipoItem) return item;
    if (local.tiene_player || itemTieneContenidoValido(local)) {
      item.tiene_player = true;
      if ((!item.embeds || !item.embeds.length) && local.embeds?.length) {
        item.embeds = local.embeds;
      }
    }
    // Conservar nombre bueno de DB si el listado trae slug
    if (local.nombre && !esSlugComoTitulo(local.nombre, local.slug)) {
      if (!item.nombre || esSlugComoTitulo(item.nombre, item.slug)) {
        item.nombre = local.nombre;
        item.titulo = local.nombre;
      }
    }
    return item;
  });

  // Paginación simple
  const lim = Math.min(Math.max(parseInt(limit, 10) || 48, 1), 100);
  const p = Math.max(parseInt(page, 10) || 1, 1);
  const startIdx = (p - 1) * lim;
  const pageLista = lista.slice(startIdx, startIdx + lim);

  return {
    resultados: pageLista,
    total: lista.length,
    page: p,
    limit: lim,
    source: "online",
  };
}


async function refreshAnimeMetaFromSource4(cached, id) {
  if (!cached) return null;
  const baseSlug = String(id?.slug || cached.slug || "")
    .replace(/-\d{4}$/, "")
    .trim();
  const slugsTry = [...new Set([cached.slug, id?.slug, baseSlug].filter(Boolean))];
  let bestMeta = null;
  for (const s of slugsTry) {
    // Pasar la portada ya buena en caché como fallback: si no, mapDetail()
    // no tiene con qué competir contra la de la fuente 4 y puede traer una
    // rota (el score de fuente le gana a TMDB aunque esté caída).
    const item = await fetchDetailFromSource("4", "anime", s, {
      slug: s,
      tipo: "Anime",
      portada: cached.portada,
    });
    if (!item) continue;
    const better =
      !bestMeta ||
      (Number(item.total_episodios) || 0) > (Number(bestMeta.total_episodios) || 0) ||
      (item.temporadas || []).length > (bestMeta.temporadas || []).length;
    if (better) bestMeta = item;
  }
  if (!bestMeta) return null;

  const oldTotal = Number(cached.total_episodios) || 0;
  const newTotal = Number(bestMeta.total_episodios) || 0;
  const oldTemps = Math.max(
    Number(cached.total_temporadas) || 0,
    Array.isArray(cached.temporadas) ? cached.temporadas.length : 0
  );
  const newTemps = Math.max(
    Number(bestMeta.total_temporadas) || 0,
    Array.isArray(bestMeta.temporadas) ? bestMeta.temporadas.length : 0
  );
  const needsUpdate =
    newTotal > oldTotal ||
    newTemps > oldTemps ||
    (!cached.rangos_episodios && bestMeta.rangos_episodios);

  if (!needsUpdate) {
    // Aun así asegurar expandir con total actual
    return expandirEpisodiosAnime({ ...cached });
  }

  let merged = mergeItems(cached, bestMeta);
  // Esta función solo refresca episodios/temporadas, no la portada: si ya
  // había una válida en caché, se conserva tal cual (no competir por score).
  if (esPortadaValida(cached.portada)) merged.portada = cached.portada;
  // Preferir fuente 4 y slug sin año cuando aporta más episodios/temps
  merged.source_id = "4";
  merged.slug = bestMeta.slug || baseSlug || merged.slug;
  if (bestMeta.link) merged.link = bestMeta.link;
  merged.total_episodios = Math.max(oldTotal, newTotal);
  merged.total_temporadas = Math.max(oldTemps, newTemps);
  if (newTemps > oldTemps) {
    merged.temporadas = bestMeta.temporadas?.length ? bestMeta.temporadas : merged.temporadas;
    merged.temporadas_raw = bestMeta.temporadas_raw || merged.temporadas_raw;
  }
  if (bestMeta.rangos_episodios) merged.rangos_episodios = bestMeta.rangos_episodios;
  merged = expandirEpisodiosAnime(merged);
  // Guardar totales actualizados
  try {
    await guardarEnSupabase([merged]);
  } catch (_) {}
  return merged;
}

async function fetchDetailFromSource(sourceId, kind, slug, fallback = {}) {
  // animeav1 (4) y jkanime (5): paginar episodios con ep_from/ep_to
  let path = `/${sourceId}/${kind}/${slug}`;
  const qs = [];
  if ((String(sourceId) === "4" || String(sourceId) === "5") && kind === "anime") {
    if (fallback.ep_from) qs.push(`ep_from=${encodeURIComponent(fallback.ep_from)}`);
    if (fallback.ep_to) qs.push(`ep_to=${encodeURIComponent(fallback.ep_to)}`);
  }
  if (qs.length) path += `?${qs.join("&")}`;
  try {
    const data = await apiGet(path);
    if (!data || data.success === false) return null;
    let item = mapDetail(data, { ...fallback, slug, source_id: String(sourceId) });
    if (!item.link) item.link = data.link || `${API_BASE}/${sourceId}/${kind}/${slug}`;
    if (!item.slug) item.slug = slug;
    // Garantizar players desde respuesta cruda si mapDetail falló en embeds
    if ((!item.embeds || !item.embeds.length) && (data.reproductores || data.embeds)) {
      item.embeds = mapEmbeds([
        ...(Array.isArray(data.reproductores) ? data.reproductores : []),
        ...(Array.isArray(data.embeds) ? data.embeds : []),
      ]);
      if (item.embeds.length) {
        item.tiene_player = true;
        item.reproductor = item.embeds[0].stream_url || item.embeds[0].url || item.reproductor;
      }
    }
    // Anime: rellenar stubs si total_episodios > lista parcial
    if (item.tipo === "Anime" || kind === "anime") {
      item = expandirEpisodiosAnime(item);
    }
    return item;
  } catch (err) {
    console.warn(`Detalle ${sourceId}/${kind}/${slug}:`, err.message);
    return null;
  }
}


/** La API manda en título/año/rating/géneros; nunca usar slug como nombre */
function preferApiMeta(apiItem, cached) {
  if (!apiItem) return cached || null;
  if (!cached) {
    if (apiItem.nombre && apiItem.slug &&
        String(apiItem.nombre).toLowerCase().replace(/\s+/g, "-") === String(apiItem.slug).toLowerCase()) {
      if (apiItem.titulo) apiItem.nombre = apiItem.titulo;
    }
    // Asegurar que el principal no sea el original inglés
    apiItem.nombre = elegirTituloPrincipal({
      nombre: apiItem.nombre,
      titulo: apiItem.titulo,
      titulo_original: apiItem.titulo_original,
      slug: apiItem.slug,
    });
    apiItem.titulo = apiItem.nombre;
    return apiItem;
  }
  const out = { ...cached, ...apiItem };
  // Título principal fijo: preferir el local/ES ya conocido; no pisar con original inglés
  out.nombre = elegirTituloPrincipal({
    nombre: apiItem.nombre,
    titulo: apiItem.titulo,
    titulo_original: apiItem.titulo_original || cached.titulo_original,
    slug: apiItem.slug || cached.slug,
    cachedNombre: cached.nombre,
  });
  out.titulo = out.nombre;
  out.titulo_original = elegirTituloOriginal(
    out.nombre,
    apiItem.titulo_original || cached.titulo_original,
    [apiItem.titulo, apiItem.nombre, cached.titulo_original]
  );
  // Año / rating / géneros / imdb: API gana si trae valor
  if (apiItem.year) out.year = apiItem.year;
  if (apiItem.calificacion != null && apiItem.calificacion !== "") out.calificacion = apiItem.calificacion;
  if (apiItem.rating != null && (out.calificacion == null || out.calificacion === "")) out.calificacion = apiItem.rating;
  if (apiItem.genero) out.genero = apiItem.genero;
  if (apiItem.generos && apiItem.generos.length) out.generos = apiItem.generos;
  if (apiItem.imdb_id) out.imdb_id = apiItem.imdb_id;
  if (apiItem.tmdb_id) out.tmdb_id = apiItem.tmdb_id;
  if (apiItem.imdb) out.imdb = apiItem.imdb;
  if (apiItem.tmdb) out.tmdb = apiItem.tmdb;
  if (apiItem.votos) out.votos = apiItem.votos;
  if (apiItem.duracion) out.duracion = apiItem.duracion;
  if (apiItem.duracion_texto) out.duracion_texto = apiItem.duracion_texto;
  if (apiItem.certificacion) out.certificacion = apiItem.certificacion;
  if (apiItem.titulo_original) out.titulo_original = apiItem.titulo_original;
  if (apiItem.fecha_estreno) out.fecha_estreno = apiItem.fecha_estreno;
  // Descripción: preferir español (elegirMejorDescripcion ya prioriza ES)
  out.descripcion = elegirMejorDescripcion(apiItem.descripcion, cached.descripcion);
  // Portada API si es válida
  // Portada: fuente de la API primero; no dejar que Metahub de cache gane
  out.portada = elegirPortada(
    apiItem.portada_fuente_raw || apiItem.portada,
    out.portada_fuente_raw || out.portada,
    out.source_id
  );
  if (apiItem.portada_fuente_raw) {
    out.portada_fuente_raw = apiItem.portada_fuente_raw;
  }
  // Players: el que tenga más
  if (apiItem.embeds && apiItem.embeds.length) {
    out.embeds = apiItem.embeds;
    out.tiene_player = true;
    out.reproductor = apiItem.reproductor || apiItem.embeds[0]?.stream_url || apiItem.embeds[0]?.url || out.reproductor;
  }
  // Si años distintos → NO mezclar meta de cache (obra distinta con mismo slug)
  const yA = apiItem.year && String(apiItem.year).match(/(19|20)\d{2}/);
  const yC = cached.year && String(cached.year).match(/(19|20)\d{2}/);
  if (yA && yC && yA[0] !== yC[0]) {
    out.year = yA[0];
    out.calificacion = apiItem.calificacion ?? apiItem.rating ?? null;
    out.genero = apiItem.genero || null;
    out.generos = apiItem.generos || [];
    out.imdb = apiItem.imdb || null;
    out.tmdb = apiItem.tmdb || null;
    out.imdb_id = apiItem.imdb_id || null;
    out.votos = apiItem.votos || null;
    out.duracion = apiItem.duracion || null;
    out.duracion_texto = apiItem.duracion_texto || null;
    out.certificacion = apiItem.certificacion || null;
    out.descripcion = apiItem.descripcion || out.descripcion;
  }
  return out;
}

/** true si el item se sincronizó hoy (UTC) */
function fueSincronizadoHoy(item) {
  if (!item) return false;
  const ts = item.episodios_synced_at || item.meta_synced_at || item.updated_at || item.synced_at;
  if (!ts) return false;
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return false;
  const now = new Date();
  return (
    d.getUTCFullYear() === now.getUTCFullYear() &&
    d.getUTCMonth() === now.getUTCMonth() &&
    d.getUTCDate() === now.getUTCDate()
  );
}

/**
 * Wrapper: garantiza que si el cliente (o el listado) nos pasó una portada ya
 * conocida/buena (ej. TMDB del listado), esa SIEMPRE gane sobre lo que el
 * detalle de la fuente traiga (ej. Metahub roto). "Siempre" = override duro,
 * no scoring, para no depender de que elegirPortada() adivine bien.
 */
async function obtenerDetalle(params) {
  const portadaListado =
    params.portada && esPortadaValida(params.portada) ? params.portada : null;
  const out = await obtenerDetalleInterno(params);
  if (out && portadaListado) {
    out.portada = portadaListado;
    out.portada_fuente_raw = portadaListado;
    // Persistir para que la próxima vez (deep-link directo, sin listado) ya
    // salga cacheada correctamente en Supabase.
    try { await guardarEnSupabase([out]); } catch (_) {}
  }
  return out;
}

async function obtenerDetalleInterno(params) {
  const { link, postId, source_id, slug, tipo } = params;
  const force = params.force === "1" || params.force === true;

  let cached = null;

  // 1) SIEMPRE Supabase primero (fuente de verdad entre instancias de Vercel)
  const fromDb = await buscarEnSupabase({ link, slug, postId });
  if (fromDb) {
    cached = fromDb;
    const idx = moviesDB.findIndex((m) => m.link === fromDb.link);
    if (idx >= 0) moviesDB[idx] = cached;
    else moviesDB.unshift(cached);
  }

  // 2) Memoria local solo como complemento si Supabase no tenía el registro
  if (!cached && link) {
    const local = moviesDB.find((m) => m.link === link);
    if (local) cached = normalizeItemFromDB(local);
  }
  if (!cached && slug) {
    const local = moviesDB.find((m) => m.slug === slug || (m.link && m.link.includes(slug)));
    if (local) cached = normalizeItemFromDB(local);
  }

  // 3) Identidad
  const id = parseIdentidad({ link, slug, source_id: source_id || cached?.source_id, tipo: tipo || cached?.tipo });
  if (!id) {
    if (cached) return cached;
    if (postId) {
      const local = moviesDB.find((m) => String(m.postId) === String(postId));
      if (local) return normalizeItemFromDB(local);
    }
    throw new Error("No se pudo identificar la película/serie");
  }

  // Si el cliente pide fuente 5 (JK) o 4 (AV1), no usar caché de la otra fuente
  const sidPedido = source_id != null && source_id !== "" ? String(resolverSourceId(source_id)) : null;
  if (cached && sidPedido && String(resolverSourceId(cached.source_id || "")) !== sidPedido) {
    cached = null;
  }

  const esAnimeKind = id.kind === "anime" || /anime/i.test(String(tipo || cached?.tipo || ""));

  // Si ya tenemos contenido válido y no force → devolver cache
  // EXCEPCIÓN anime: refrescar totales desde fuente 4 (One Piece sigue subiendo; Wistoria T2)
  const tieneDesc = cached && cached.descripcion && String(cached.descripcion).length > 20;
  const tieneContenido = cached && (itemTieneContenidoValido(cached) || (cached.episodios && cached.episodios.length));
  const yaFunciona =
    cached &&
    itemTieneContenidoValido(cached) &&
    cached.descripcion &&
    String(cached.descripcion).length > 40 &&
    cached.portada &&
    !String(cached.portada).includes("placeholder");

  // Cache solo si realmente hay players (película) o episodios (serie/anime)
  const esSerieCache = esAnimeKind || /serie/i.test(String(cached?.tipo || ""));
  const cacheTienePlayers =
    !!cached &&
    (itemTieneContenidoValido(cached) ||
      (esSerieCache &&
        ((cached.episodios && cached.episodios.length) ||
          (cached.temporadas && cached.temporadas.length) ||
          (cached.temporadas_raw && cached.temporadas_raw.length))));

  // Si el nombre parece slug (la-captura), forzar refresco desde API
  const nombreEsSlug =
    cached &&
    cached.nombre &&
    cached.slug &&
    String(cached.nombre).toLowerCase().replace(/\s+/g, "-") === String(cached.slug).toLowerCase();

  // Lista incompleta (ej. solo 1 temporada de 3) → ir a la API
  const epsCache = Array.isArray(cached?.episodios) ? cached.episodios.length : 0;
  const totalEpsCache = Number(cached?.total_episodios) || 0;
  const tempsCache = Array.isArray(cached?.temporadas) ? cached.temporadas.length : 0;
  const totalTempsCache = Number(cached?.total_temporadas) || 0;
  const seasonsInEps = cached?.episodios
    ? new Set(
        cached.episodios.map((e) => Number(e.season || e.temporada || 1) || 1)
      ).size
    : 0;
  const listaIncompleta =
    esSerieCache &&
    (
      (totalTempsCache > 1 && tempsCache > 0 && tempsCache < totalTempsCache) ||
      (totalEpsCache > 0 && epsCache > 0 && epsCache < Math.floor(totalEpsCache * 0.85)) ||
      (seasonsInEps <= 1 && epsCache > 0 && epsCache <= 14)
    );

  // Serie/anime: si YA se actualizó hoy → usar caché; si NO → ir a la API
  const syncHoy = fueSincronizadoHoy(cached);
  const debeRefrescarSerie = esSerieCache && !syncHoy && !force;

  if (
    !force &&
    cached &&
    cacheTienePlayers &&
    (tieneDesc || yaFunciona) &&
    !nombreEsSlug &&
    !listaIncompleta &&
    !debeRefrescarSerie
  ) {
    if (esAnimeKind) {
      try {
        const refreshed = await refreshAnimeMetaFromSource4(cached, id);
        if (refreshed) return refreshed;
      } catch (err) {
        console.warn("refreshAnimeMeta:", err.message);
      }
    }
    return cached;
  }
  // force | lista incompleta | serie/anime sin sync hoy → seguir a la API
  // force = botón "Actualizar": detectar episodios/temporadas nuevas + meta; conservar players
  if (force && id && id.slug) {
    try {
      const sid = String(id.source_id || cached?.source_id || "3");
      const kind = id.kind || (esAnimeKind ? "anime" : /serie/i.test(String(tipo || cached?.tipo || "")) ? "serie" : "pelicula");
      const candidate = await fetchDetailFromSource(sid, kind, id.slug, {
        link: link || cached?.link,
        slug: id.slug,
        source_id: sid,
        tipo: tipo || cached?.tipo,
        nombre: cached?.nombre,
        portada: cached?.portada,
        descripcion: cached?.descripcion,
        year: cached?.year,
        genero: cached?.genero,
        postId: postId || cached?.postId,
      });

      const base = cached ? { ...cached } : (candidate ? { ...candidate } : null);
      if (base || candidate) {
        const out = preferApiMeta(candidate || base, base);
        // Conservar título legible (nunca slug)
        const goodName = (cached && cached.nombre && cached.slug &&
          String(cached.nombre).toLowerCase().replace(/\s+/g, "-") !== String(cached.slug).toLowerCase())
          ? cached.nombre
          : (out.nombre && out.slug && String(out.nombre).toLowerCase().replace(/\s+/g, "-") !== String(out.slug).toLowerCase()
            ? out.nombre
            : (out.titulo || cached?.nombre || out.nombre));
        out.nombre = goodName;
        // Portada: comparar caché vs. la fresca del detalle, no quedarse a ciegas con la vieja
        if (cached && esPortadaValida(cached.portada)) {
          out.portada = elegirPortada(cached.portada, candidate?.portada, out.source_id);
        }
        // Año/rating/géneros: conservar caché SOLO si es la misma fuente (no mezclar JK con AV1)
        const sameSrc = !sidPedido || String(resolverSourceId(cached?.source_id || "")) === String(sidPedido);
        if (sameSrc) {
          if (cached?.year && !out.year) out.year = cached.year;
          if (cached?.calificacion != null && out.calificacion == null) out.calificacion = cached.calificacion;
          if (cached?.genero && !out.genero) out.genero = cached.genero;
          if (cached?.generos?.length && !(out.generos && out.generos.length)) out.generos = cached.generos;
          if (cached?.imdb && !out.imdb) out.imdb = cached.imdb;
          if (cached?.imdb_id && !out.imdb_id) out.imdb_id = cached.imdb_id;
          if (cached?.votos && !out.votos) out.votos = cached.votos;
          if (cached?.duracion && !out.duracion) out.duracion = cached.duracion;
          if (cached?.duracion_texto && !out.duracion_texto) out.duracion_texto = cached.duracion_texto;
          if (cached?.certificacion && !out.certificacion) out.certificacion = cached.certificacion;
          if (cached?.titulo_original && !out.titulo_original) out.titulo_original = cached.titulo_original;
        }
        // Descripción: fuente/caché en español primero; no pisar con inglés de IMDb
        out.descripcion = elegirMejorDescripcion(cached?.descripcion, candidate?.descripcion);
        // Players: del fetch fresco
        if (candidate?.embeds?.length) {
          out.embeds = candidate.embeds;
          out.tiene_player = true;
          out.reproductor = candidate.reproductor || candidate.embeds[0]?.stream_url || candidate.embeds[0]?.url || out.reproductor;
        }
        if (candidate?.downloads?.length) out.downloads = candidate.downloads;
        // Episodios: fusionar si serie
        if (candidate?.episodios?.length) {
          // Añadir episodios/temporadas NUEVAS; conservar players ya guardados
          out.episodios = mergeEpisodiosLists(cached?.episodios || [], candidate.episodios);
          out.total_episodios = Math.max(
            Number(cached?.total_episodios) || 0,
            Number(candidate.total_episodios) || 0,
            out.episodios.length
          );
        }
        if (candidate?.temporadas?.length) {
          const set = new Set([
            ...(Array.isArray(cached?.temporadas) ? cached.temporadas : []),
            ...candidate.temporadas,
          ].map(Number).filter(Boolean));
          out.temporadas = Array.from(set).sort((a, b) => a - b);
          out.total_temporadas = Math.max(
            Number(cached?.total_temporadas) || 0,
            Number(candidate.total_temporadas) || 0,
            out.temporadas.length
          );
        }
        if (candidate?.temporadas_raw?.length) out.temporadas_raw = candidate.temporadas_raw;
        if (candidate?.rangos_episodios) out.rangos_episodios = candidate.rangos_episodios;
        // Estado emisión + fecha
        if (candidate?.estado) out.estado = candidate.estado;
        if (candidate?.en_emision != null) out.en_emision = !!candidate.en_emision;
        if (candidate?.finalizado != null) out.finalizado = !!candidate.finalizado;
        if (candidate?.fecha_estreno) out.fecha_estreno = candidate.fecha_estreno;
        if (!out.link) out.link = candidate?.link || cached?.link || link;
        out.tiene_player = true;
        await guardarEnSupabase([out]);
        return out;
      }
    } catch (errForce) {
      console.warn("force refresh servers:", errForce.message);
      if (cached) return cached;
    }
  }

  // force con players OK: solo refrescar meta (descripcion/genero) de la fuente actual, no rehacer todo
  const soloMeta =
    force &&
    cached &&
    itemTieneContenidoValido(cached) &&
    (cached.tipo === "Película" || (cached.episodios && cached.episodios.length));

  // Anime: si el usuario eligió JK(5) o AV1(4), SOLO esa fuente (no mezclar)
  // También si source_id viene en query aunque tipo no diga anime (deep link /detalle/5/slug)
  let sourcesToTry;
  const sidForce = sidPedido || (id.source_id != null ? String(resolverSourceId(id.source_id)) : null);
  if (sidForce === "5" || sidForce === "jkanime") {
    sourcesToTry = ["5"];
  } else if (sidForce === "4" || sidForce === "animeav1") {
    sourcesToTry = ["4"];
  } else if (esAnimeKind) {
    sourcesToTry = [resolverSourceId(id.source_id), "5", "4"].filter((v, i, a) => v && a.indexOf(v) === i);
    for (const s of ["5", "4"]) {
      if (!sourcesToTry.includes(s)) sourcesToTry.push(s);
    }
  } else {
    sourcesToTry = [resolverSourceId(id.source_id), "6", "3", "1", "2"].filter((v, i, a) => a.indexOf(v) === i && v !== "4");
    for (const s of ["6", "3", "1", "2"]) {
      if (!sourcesToTry.includes(s)) sourcesToTry.push(s);
    }
  }
  const fuentes = soloMeta && !esAnimeKind ? sourcesToTry.slice(0, 1) : sourcesToTry;

  const slugSinAnio = String(id.slug || "").replace(/-\d{4}$/, "");
  const slugsTryBase = [...new Set([id.slug, slugSinAnio].filter(Boolean))];

  let best = null;
  let triedSource4 = false;
  for (const sid of fuentes) {
    if (String(sid) === "4") triedSource4 = true;
    for (const slugTry of slugsTryBase) {
      const kindFetch = esAnimeKind ? "anime" : (id.kind === "pelicula" ? "pelicula" : "serie");
      const candidate = await fetchDetailFromSource(sid, kindFetch, slugTry, {
        link,
        slug: slugTry,
        source_id: sid,
        tipo: tipo || cached?.tipo || (esAnimeKind ? "Anime" : (kindFetch === "serie" ? "Serie" : null)),
        nombre: cached?.nombre,
        portada: cached?.portada,
        descripcion: cached?.descripcion,
        year: cached?.year,
        genero: cached?.genero,
        postId: postId || cached?.postId,
      });
      if (!candidate) continue;
      // Rechazar si la fuente cambió el tipo (Serie ≠ Anime)
      const tipoEsp = normalizarTipo(tipo || cached?.tipo || (esAnimeKind ? "Anime" : "Serie"));
      const tipoCand = normalizarTipo(candidate.tipo || "");
      if (!esAnimeKind && tipoCand === "Anime") continue;
      if (esAnimeKind && tipoCand === "Serie" && String(sid) !== "4") continue;
      if (tipoEsp === "Serie" && tipoCand === "Anime") continue;
      if (tipoEsp === "Anime" && tipoCand === "Serie" && String(sid) !== "4") continue;
      // Título = slug → basura (ej. animeav1 con our-sticky-love)
      const nomCand = String(candidate.nombre || candidate.titulo || "");
      if (candidate.slug && esSlugComoTitulo(nomCand, candidate.slug)) {
        if (cached?.nombre && !esSlugComoTitulo(cached.nombre, cached.slug)) {
          candidate.nombre = cached.nombre;
          candidate.titulo = cached.nombre;
        } else if (tipoEsp === "Serie") {
          continue; // no contaminar series con ficha anime vacía
        }
      }
      best = best
        ? scoreItem(candidate) > scoreItem(best)
          ? mergeItems(best, candidate) // base = best (conserva tipo/nombre)
          : mergeItems(best, candidate)
        : candidate;
      // Forzar tipo esperado
      if (tipoEsp === "Serie" || tipoEsp === "Anime") best.tipo = tipoEsp;
      if (best && candidate.descripcion) {
        best.descripcion = elegirMejorDescripcion(best.descripcion, candidate.descripcion);
      }
      if (candidate.genero && !best.genero) best.genero = candidate.genero;

      // Preferir la fuente con MÁS episodios/temporadas (no la primera que responda)
      const tBest = Number(best.total_episodios) || (best.episodios || []).length || 0;
      const tCand = Number(candidate.total_episodios) || (candidate.episodios || []).length || 0;
      const sBest = Math.max(Number(best.total_temporadas) || 0, (best.temporadas || []).length || 0);
      const sCand = Math.max(Number(candidate.total_temporadas) || 0, (candidate.temporadas || []).length || 0);
      // No saltar a fuente 4 en series; solo cambiar fuente si realmente aporta más episodios
      if ((tCand > tBest || sCand > sBest) && !(String(sid) === "4" && !esAnimeKind)) {
        best.source_id = String(sid);
        best.slug = candidate.slug || best.slug;
        best.link = candidate.link || best.link;
        best.url_extract = candidate.url_extract || best.url_extract;
        if (sCand >= sBest && candidate.temporadas?.length) {
          best.temporadas = candidate.temporadas;
          best.temporadas_raw = candidate.temporadas_raw || best.temporadas_raw;
          best.total_temporadas = Math.max(sBest, sCand);
        }
        if (tCand >= tBest) best.total_episodios = Math.max(tBest, tCand);
        if (candidate.rangos_episodios) best.rangos_episodios = candidate.rangos_episodios;
      }
      best.portada = elegirPortada(best.portada, candidate.portada, best.source_id);
    }
    // Anime: no cortar hasta haber intentado fuente 4
    if (esAnimeKind && !triedSource4) continue;
    if (soloMeta && best && !esAnimeKind) break;
    // Películas: cortar si ya hay bastantes embeds
    const nEmbeds = Array.isArray(best?.embeds) ? best.embeds.length : 0;
    if (
      !esAnimeKind &&
      !force &&
      best &&
      itemTieneContenidoValido(best) &&
      best.descripcion &&
      best.portada &&
      nEmbeds >= 4
    ) {
      break;
    }
    // Anime: cortar solo si ya tenemos fuente 4 + totales razonables
    if (
      esAnimeKind &&
      triedSource4 &&
      best &&
      (Number(best.total_episodios) > 0 || (best.temporadas || []).length > 0) &&
      best.descripcion
    ) {
      // seguir con 3/1/2 solo si aún faltan players a nivel ficha (raro en anime)
      if ((best.temporadas || []).length >= 1 && Number(best.total_episodios) >= 1) {
        // ya tenemos meta de anime; no hace falta más fuentes para temporadas
        break;
      }
    }
  }

  if (!best) {
    if (cached) return cached;
    throw new Error("Sin datos del detalle");
  }

  // Fusionar con cache para no perder datos previos
  best = mergeItems(cached, best);
  // Anime/serie: no perder listado de episodios ni players ya guardados por capítulo
  if (cached && Array.isArray(cached.episodios) && cached.episodios.length) {
    if (!best.episodios || !best.episodios.length) {
      best.episodios = cached.episodios;
    } else if (best.episodios.length < cached.episodios.length) {
      // No dejar que una respuesta más corta pise la lista completa
      best.episodios = mergeEpisodiosLists(cached.episodios, best.episodios);
    } else {
      // Preservar embeds/video de episodios ya cacheados (API suele devolver stubs sin players)
      const byKey = new Map();
      for (const ep of cached.episodios) {
        const k = `${Number(ep.season) || 1}-${Number(ep.episode || ep.episodio) || 0}`;
        if (ep.embeds?.length || ep.video || ep.reproductor) byKey.set(k, ep);
      }
      best.episodios = best.episodios.map((ep) => {
        const k = `${Number(ep.season) || 1}-${Number(ep.episode || ep.episodio) || 0}`;
        const prev = byKey.get(k);
        if (!prev) return ep;
        const tieneNuevos = Array.isArray(ep.embeds) && ep.embeds.length > 0;
        if (tieneNuevos) return ep;
        return {
          ...ep,
          embeds: prev.embeds || [],
          video: prev.video || prev.reproductor || ep.video || null,
          reproductor: prev.reproductor || prev.video || ep.reproductor || null,
          downloads: (ep.downloads && ep.downloads.length) ? ep.downloads : (prev.downloads || []),
        };
      });
      // Añadir episodios cacheados que no vengan en la respuesta nueva
      const seen = new Set(best.episodios.map((ep) => `${Number(ep.season) || 1}-${Number(ep.episode || ep.episodio) || 0}`));
      for (const ep of cached.episodios) {
        const k = `${Number(ep.season) || 1}-${Number(ep.episode || ep.episodio) || 0}`;
        if (!seen.has(k) && (ep.embeds?.length || ep.video || ep.reproductor)) {
          best.episodios.push(ep);
        }
      }
    }
  }
  if (cached && (!best.temporadas || !best.temporadas.length) && cached.temporadas?.length) {
    best.temporadas = cached.temporadas;
  }
  if (cached && (!best.temporadas_raw || !best.temporadas_raw.length) && cached.temporadas_raw?.length) {
    best.temporadas_raw = cached.temporadas_raw;
  }
  // Preferir español de la API sobre inglés cacheado (aunque el inglés sea más largo)
  best.descripcion = elegirMejorDescripcion(best.descripcion, cached?.descripcion);
  // Serie/anime: marcar que hoy ya se sincronizó (para no repetir en el día)
  if (/serie|anime/i.test(String(best.tipo || ""))) {
    best.episodios_synced_at = new Date().toISOString();
    best.updated_at = best.episodios_synced_at;
  }
  best.descripcion = limpiarDescripcion(best.descripcion, best.nombre);
  // Portada final: siempre alineada a la fuente de los reproductores
  best.portada = elegirPortada(best.portada, cached?.portada, best.source_id);
  if (!best.slug) best.slug = id.slug;
  if (!best.slug && best.link) {
    const m = String(best.link).match(/\/(?:serie|anime|pelicula|series|animes|peliculas)\/([^/?#]+)/i);
    if (m) best.slug = m[1];
  }

  // Bloquear tipo y nombre (evitar Serie → Anime y título = slug)
  {
    const tipoLock = normalizarTipo(tipo || cached?.tipo || best.tipo || "");
    if (tipoLock === "Serie" || tipoLock === "Anime" || tipoLock === "Película") {
      best.tipo = tipoLock;
    }
    if (cached?.nombre && !esSlugComoTitulo(cached.nombre, cached.slug)) {
      if (!best.nombre || esSlugComoTitulo(best.nombre, best.slug) || best.nombre === "Sin título") {
        best.nombre = cached.nombre;
        best.titulo = cached.nombre;
      }
    }
    best.nombre = elegirTituloPrincipal({
      nombre: best.nombre,
      titulo: best.titulo,
      titulo_original: best.titulo_original,
      slug: best.slug,
      cachedNombre: cached?.nombre,
    });
    best.titulo = best.nombre;
    // Link coherente con tipo (no /4/anime/ para una Serie)
    if (best.slug && best.source_id) {
      const k =
        best.tipo === "Anime" ? "anime" : best.tipo === "Serie" ? "serie" : "pelicula";
      if (!esAnimeKind && String(best.source_id) === "4") {
        best.source_id = resolverSourceId(id.source_id || cached?.source_id || "6");
      }
      const expected = `${API_BASE}/${best.source_id}/${k}/${best.slug}`;
      if (!best.link || /\/4\/anime\//.test(String(best.link)) && best.tipo === "Serie") {
        best.link = expected;
      }
    }
  }

  best.tiene_player = itemTieneContenidoValido(best)
    || !!(best.episodios && best.episodios.length)
    || !!(best.temporadas && best.temporadas.length)
    || !!(best.temporadas_raw && best.temporadas_raw.length);

  // Anime: totales / rangos; preferir fuente 4
  if (best.tipo === "Anime" || id.kind === "anime") {
    best = expandirEpisodiosAnime(best);
    // Preferencia de fuente: respetar JK (5) si se pidió
    best._prefer_source_anime = (sidPedido === "5" || sidPedido === "jkanime") ? "5" : (sidPedido === "4" ? "4" : (String(best.source_id || "4")));
    const nEps = Number(best.total_episodios) || 0;
    const tieneRangos = Array.isArray(best.rangos_episodios) && best.rangos_episodios.length > 1;
    // One Piece AV1: muchos eps → 1 temporada (rangos). No aplicar a JK.
    if ((nEps > 50 || tieneRangos) && sidPedido !== "5" && sidPedido !== "jkanime") {
      best.temporadas = [1];
      best.total_temporadas = 1;
      best.source_id = "4";
      if (best.slug) best.slug = String(best.slug).replace(/-\d{4}$/, "");
    } else if (sidPedido !== "5" && sidPedido !== "jkanime") {
      const nTemps = Math.max(Number(best.total_temporadas) || 0, (best.temporadas || []).length || 0);
      if (nTemps > 1 || nEps > 24) {
        best.source_id = "4";
        if (best.slug) best.slug = String(best.slug).replace(/-\d{4}$/, "");
      }
    }
    if (sidPedido === "5" || sidPedido === "jkanime") {
      best.source_id = "5";
      best._prefer_source_anime = "5";
    }
  }
  const sinPortada = !best.portada || String(best.portada).includes("placeholder");
  const sinContenido = !best.tiene_player;
  const esSerieOAnime = best.tipo === "Serie" || best.tipo === "Anime";

  // NO borrar de Supabase por falta temporal de players (evita perder fichas).
  // Solo marcar flag para el front; se reintentará en el próximo force/detalle.
  if (!esSerieOAnime && sinContenido) {
    best._sin_players = true;
    best = preferApiMeta(best, cached);
    if (best.link && (best.descripcion || best.portada || best.calificacion)) {
      try { if (sidPedido) {
      best.source_id = sidPedido;
      // Asegurar link de la fuente pedida
      if (best.slug && (sidPedido === "5" || sidPedido === "4")) {
        best.link = `https://moviezone.tvjz.workers.dev/${sidPedido}/anime/${best.slug}`;
      }
    }
    await guardarEnSupabase([best]); } catch (_) {}
    }
    return best;
  }
  if (sinPortada && sinContenido && !esSerieOAnime) {
    best._sin_players = true;
    best = preferApiMeta(best, cached);
    return best;
  }

  // Rellenar portada si falta (pelisplus / otras fuentes)
  if (!esPortadaValida(best.portada)) {
    try {
      best = await asegurarPortada(best);
    } catch (_) {}
  }

  // API gana sobre caché vieja (2012 vs 2026, slug como título, etc.)
  best = preferApiMeta(best, cached);

  // Nunca dejar nombre = slug
  if (best.nombre && best.slug &&
      String(best.nombre).toLowerCase().replace(/\s+/g, "-") === String(best.slug).toLowerCase()) {
    if (best.titulo) best.nombre = best.titulo;
    else best.nombre = String(best.slug).replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }

  await guardarEnSupabase([best]);
  return best;
}

async function borrarDeSupabase(link) {
  if (!link) return;
  try {
    const sb = getSupabase();
    if (sb) {
      // Marcar como descartado (sin borrar la fila) para filtrarlo en listados
      // y no vuelva a aparecer desde estrenos/API
      await sb.from("movies").upsert(
        [
          {
            link,
            tiene_player: false,
            embeds: [],
            reproductor: null,
            episodios: [],
            certificacion: "DESCARTADO",
            descripcion: "__DISCARDED__",
          },
        ],
        { onConflict: "link" }
      );
    }
    moviesDB = moviesDB.filter((m) => m.link !== link);
    knownLinks.delete(link);
    discardedLinks.add(link);
    console.log("Descartado (sin reproductor):", link);
  } catch (err) {
    console.warn("No se pudo descartar en Supabase:", err.message);
  }
}

async function borrarDeSupabasePorSlug(slug) {
  if (!slug) return;
  try {
    const sb = getSupabase();
    if (!sb) return;
    const { data } = await sb.from("movies").select("link").eq("slug", slug).limit(5);
    for (const row of data || []) {
      if (row.link) await borrarDeSupabase(row.link);
    }
  } catch (err) {
    console.warn("borrarDeSupabasePorSlug:", err.message);
  }
}


/** Extrae slugs alternos desde temporadas_tmdb / urls pelisplus */
function extraerSlugsAlternos(serie, slug) {
  const out = new Set();
  if (slug) out.add(String(slug));
  const tmdb = serie && (serie.temporadas_tmdb || serie.temporadasTmdb);
  if (Array.isArray(tmdb)) {
    for (const s of tmdb) {
      for (const ep of s.episodios || s.episodes || []) {
        const u = String(ep.url || ep.link || "");
        const m = u.match(/\/(?:anime|serie|pelicula)\/([a-z0-9-]+)\//i);
        if (m) out.add(m[1]);
      }
    }
  }
  // título inglés típico → slug
  const tit = String(serie?.titulo_tmdb || serie?.nombre || "").toLowerCase();
  if (tit) {
    const approx = tit
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    if (approx.length > 3) out.add(approx);
  }
  return [...out];
}

function mergeEmbedLists(...lists) {
  const seen = new Set();
  const out = [];
  for (const list of lists) {
    for (const e of list || []) {
      const url = (e && e.url) || (typeof e === "string" ? e : null);
      if (!url || seen.has(url)) continue;
      seen.add(url);
      out.push(typeof e === "string" ? { url: e } : e);
    }
  }
  return mapEmbeds(out);
}

async function obtenerEpisodio(sourceId, slug, temporada, episodio, kind = "serie", serieCtx = null) {
  const preferred = String(resolverSourceId(sourceId || (serieCtx && serieCtx.source_id) || DEFAULT_SOURCE));
  const kinds = kind === "anime" ? ["anime", "serie"] : ["serie", "anime"];
  // Preferir la fuente real de la serie; el resto solo si hace falta
  const ordenCap =
    kind === "anime" ? ["4", "5", "3", "1", "2", "6"] : ["3", "6", "1", "2", "4", "5"];
  const sources = [preferred];
  for (const s of ordenCap) {
    if (!sources.includes(s)) sources.push(s);
  }
  const slugsTry = extraerSlugsAlternos(serieCtx, slug);
  if (slug && !slugsTry.includes(slug)) slugsTry.unshift(slug);
  // Parsear slug desde link si hace falta
  if ((!slugsTry.length || !slugsTry[0]) && serieCtx && serieCtx.link) {
    const id = parseIdentidad(serieCtx);
    if (id && id.slug) slugsTry.unshift(id.slug);
  }

  let lastErr = null;
  let best = null;
  let allEmbeds = [];
  let allDownloads = [];

  // 1) Fuente preferida primero (rápido, evita 404 en cadena)
  for (const k of kinds) {
    for (const trySlug of slugsTry) {
      if (!trySlug) continue;
      try {
        const path = `/${preferred}/${k}/${trySlug}/${temporada}/${episodio}`;
        const data = await apiGet(path);
        if (!data || data.success === false) continue;
        const mapped = mapDetail(data, {
          slug: trySlug,
          source_id: preferred,
          tipo: k === "anime" ? "Anime" : "Serie",
        });
        const emb = mapEmbeds(
          (data.reproductores && data.reproductores.length)
            ? data.reproductores
            : (data.embeds || mapped.embeds || [])
        );
        if (emb.length) {
          allEmbeds = mergeEmbedLists(allEmbeds, emb);
          best = mapped;
          best.embeds = allEmbeds;
          best.reproductor = allEmbeds[0]?.url || best.reproductor;
          best.tiene_player = true;
          // Con players de la fuente correcta, no hace falta spamear el resto
          if (allEmbeds.length >= 2) {
            return best;
          }
        } else if (!best) {
          best = mapped;
        }
      } catch (err) {
        lastErr = err;
        // 404/timeout de esta fuente → seguir
      }
    }
  }

  // 2) Otras fuentes en paralelo limitado (solo si aún faltan players)
  if (allEmbeds.length < 2) {
    const otros = sources.filter((s) => s !== preferred).slice(0, 3);
    const jobs = [];
    for (const sid of otros) {
      for (const k of kinds.slice(0, 1)) {
        for (const trySlug of slugsTry.slice(0, 2)) {
          if (!trySlug) continue;
          jobs.push({ sid, k, trySlug });
        }
      }
    }
    const results = await Promise.all(
      jobs.map(async ({ sid, k, trySlug }) => {
        try {
          const path = `/${sid}/${k}/${trySlug}/${temporada}/${episodio}`;
          const data = await apiGet(path);
          if (!data || data.success === false) return null;
          const mapped = mapDetail(data, {
            slug: trySlug,
            source_id: sid,
            tipo: k === "anime" ? "Anime" : "Serie",
          });
          const emb = mapEmbeds(
            (data.reproductores && data.reproductores.length)
              ? data.reproductores
              : (data.embeds || mapped.embeds || [])
          );
          const dl = mapped.downloads || data.descargas || data.downloads || [];
          return { mapped, emb, dl, sid };
        } catch (err) {
          lastErr = err;
          return null;
        }
      })
    );
    for (const r of results) {
      if (!r) continue;
      if (r.emb && r.emb.length) allEmbeds = mergeEmbedLists(allEmbeds, r.emb);
      if (Array.isArray(r.dl) && r.dl.length) {
        allDownloads = mergeEmbedLists(
          allDownloads,
          r.dl.map((d) => (typeof d === "string" ? { url: d } : d))
        );
      }
      if (!best || scoreItem(r.mapped) > scoreItem(best)) {
        best = best ? mergeItems(best, r.mapped) : r.mapped;
      } else {
        best = mergeItems(best, r.mapped);
      }
    }
  }

  if (best || allEmbeds.length) {
    if (!best) best = { slug, source_id: preferred, tipo: kind === "anime" ? "Anime" : "Serie" };
    if (allEmbeds.length) {
      best.embeds = allEmbeds;
      best.reproductor = allEmbeds[0]?.url || best.reproductor;
      best.tiene_player = true;
    }
    if (allDownloads.length) best.downloads = allDownloads;
    return best;
  }
  const msg = lastErr && lastErr.response
    ? `Request failed with status code ${lastErr.response.status}`
    : (lastErr && lastErr.message) || "No se pudo cargar el episodio";
  throw new Error(msg);
}

function mismoEpisodio(ep, season, episode) {
  const s = Number(ep.season || ep.temporada || 1);
  const e = Number(ep.episode || ep.episodio || ep.episode_number || 0);
  return s === Number(season) && e === Number(episode);
}

/** Link directo del capítulo en el Worker: /{source}/{serie|anime}/{slug}/{temp}/{ep} */
function urlCapituloWorker(sourceId, kind, slug, season, episode) {
  const sid = resolverSourceId(sourceId || DEFAULT_SOURCE);
  const k = kind === "anime" || kind === "Anime" ? "anime" : "serie";
  const s = String(slug || "").replace(/^\/+|\/+$/g, "");
  if (!s) return null;
  const t = Number(season) || 1;
  const e = Number(episode) || 1;
  return `${API_BASE}/${sid}/${k}/${s}/${t}/${e}`;
}

function asegurarUrlCapitulo(ep, meta) {
  if (!ep) return ep;
  const season = Number(ep.season || ep.temporada || 1) || 1;
  const episode = Number(ep.episode || ep.episodio || 0) || 0;
  if (!episode) return ep;
  const sid = ep.source_id || meta?.source_id || DEFAULT_SOURCE;
  const kind =
    meta?.tipo === "Anime" || meta?.kind === "anime" || /anime/i.test(String(meta?.tipo || ""))
      ? "anime"
      : "serie";
  const slug = ep.slug_media || meta?.slug || null;
  if (!ep.url_capitulo && slug) {
    ep.url_capitulo = urlCapituloWorker(sid, kind, slug, season, episode);
  }
  if (!ep.source_id) ep.source_id = String(resolverSourceId(sid));
  return ep;
}

/** Guarda players de un episodio dentro del registro de la serie en Supabase */
async function guardarPlayersEpisodio(serieItem, season, episode, embeds, reproductor) {
  if (!serieItem || !serieItem.link) return;
  const eps = Array.isArray(serieItem.episodios) ? [...serieItem.episodios] : [];
  const kind = serieItem.tipo === "Anime" ? "anime" : "serie";
  const urlCap = urlCapituloWorker(
    serieItem.source_id,
    kind,
    serieItem.slug,
    season,
    episode
  );
  let found = false;
  for (let i = 0; i < eps.length; i++) {
    if (mismoEpisodio(eps[i], season, episode)) {
      eps[i] = {
        ...eps[i],
        season: Number(season),
        episode: Number(episode),
        embeds: embeds || [],
        video: reproductor || (embeds && embeds[0] && embeds[0].url) || null,
        reproductor: reproductor || null,
        url_capitulo: eps[i].url_capitulo || urlCap,
        source_id: eps[i].source_id || serieItem.source_id,
      };
      found = true;
      break;
    }
  }
  if (!found) {
    eps.push({
      season: Number(season),
      episode: Number(episode),
      nombre: `T${season}E${String(episode).padStart(2, "0")}`,
      embeds: embeds || [],
      video: reproductor || null,
      url_capitulo: urlCap,
      source_id: serieItem.source_id,
    });
  }
  const updated = {
    ...serieItem,
    episodios: eps,
    tiene_player: true,
  };
  await guardarEnSupabase([updated]);
  // memoria
  const idx = moviesDB.findIndex((m) => m.link === updated.link);
  if (idx >= 0) moviesDB[idx] = { ...moviesDB[idx], ...updated };
  else moviesDB.unshift(updated);
  return updated;
}

app.get("/api/peliculas", async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(48, Math.max(6, parseInt(req.query.limit, 10) || 24));
    // page 1 del home = estrenos; el catálogo empieza en 2 en el front
    const data = await obtenerPeliculasCatalogo(page, limit);
    res.set("Cache-Control", "public, max-age=3600, s-maxage=28800"); // navegador 1h, CDN 8h
    res.json(data);
  } catch (err) {
    console.error("/api/peliculas", err.message);
    res.status(500).json({ error: "No se pudo cargar el catálogo", resultados: [] });
  }
});

// ---------- Rutas API ----------
app.get("/api/estrenos", async (req, res) => {
  try {
    const tipo = (req.query.tipo || "peliculas").toLowerCase(); // peliculas|series|animes
    const limit = Math.min(48, Math.max(6, parseInt(req.query.limit) || 24));
    const data = await obtenerEstrenos(tipo, limit);
    res.set("Cache-Control", "public, max-age=1800, s-maxage=28800");
    res.json(data);
  } catch (err) {
    console.error("/api/estrenos", err.message);
    res.status(500).json({ error: "No se pudieron cargar los estrenos", resultados: [] });
  }
});

/** Catálogo: listado API como base; Supabase solo ENRIQUECE (no duplica filas) */
function catalogoPaginado(tipoApi, tipoItem, page, limit) {
  return (async () => {
    await ensureMoviesDB().catch(() => {});
    const data = await obtenerEstrenos(tipoApi, 48);
    let apiItems = Array.isArray(data.resultados) ? data.resultados : [];

    const locales = moviesDB.filter((m) => {
      if (!m || esDescartado(m)) return false;
      if (tipoItem === "Serie") {
        const t = String(m.tipo || "").toLowerCase();
        return t === "serie" || t === "dorama" || t === "tv";
      }
      if (tipoItem === "Anime") {
        // Sección AnimeAV1: SOLO source 4 (cualquier tipo: Anime, Película, OVA…)
        // JK (5) tiene su propia sección. Otras fuentes: solo tipo anime/ova/ona/especial.
        const t = String(m.tipo || "").toLowerCase();
        const sid = String(m.source_id || m.fuente || m.source || "").toLowerCase();
        if (sid === "5" || /jkanime|^jk$/.test(sid)) return false;
        if (sid === "4" || sid === "animeav1" || /animeav1/.test(sid)) return true;
        return t === "anime" || t === "ova" || t === "ona" || t === "especial";
      }
      // Películas
      {
        const t = String(m.tipo || "").toLowerCase();
        return t === "película" || t === "pelicula" || t === "movie" || !t;
      }
    });

    function matchLocal(item) {
      if (!item) return null;
      const slug = String(item.slug || "").toLowerCase();
      const link = String(item.link || item.url_extract || "").replace(/\/+$/, "").toLowerCase();
      return (
        locales.find((m) => link && String(m.link || "").replace(/\/+$/, "").toLowerCase() === link) ||
        locales.find((m) => slug && String(m.slug || "").toLowerCase() === slug) ||
        locales.find((m) => {
          const sameTitle =
            normalizeTitleKey(m.nombre || "") === normalizeTitleKey(item.nombre || item.titulo || "");
          if (!sameTitle) return false;
          const y1 = String(m.year || "").match(/(19|20)\d{2}/);
          const y2 = String(item.year || "").match(/(19|20)\d{2}/);
          if (y1 && y2) return y1[0] === y2[0];
          return true;
        }) ||
        null
      );
    }

    // 1) Una fila por ítem de la API; si ya está en Supabase → Disponible + rating de DB
    const usedLocal = new Set();
    const merged = [];
    for (const item of apiItems) {
      if (!item) continue;
      const local = matchLocal(item);
      if (local) {
        usedLocal.add(local.link || local.slug || local.nombre);
        if (local.slug) usedLocal.add("slug:" + String(local.slug).toLowerCase());
        if (item.slug) usedLocal.add("slug:" + String(item.slug).toLowerCase());
        const row = { ...item };
        // "Disponible" depende solo de si hay reproductor real.
        // La metadata enriquecida (portada IMDb/TMDB, sinopsis, rating...) se
        // aplica igual aunque todavía no haya players, para que el listado
        // muestre la misma portada que ya se ve en el detalle.
        const tieneContenido = local.tiene_player || itemTieneContenidoValido(local);
        row.tiene_player = !!tieneContenido;
        if (local.embeds?.length) row.embeds = local.embeds;
        if (local.reproductor) row.reproductor = local.reproductor;
        if (local.calificacion != null) row.calificacion = local.calificacion;
        if (local.imdb_id) row.imdb_id = local.imdb_id;
        if (local.imdb) row.imdb = local.imdb;
        if (local.votos) row.votos = local.votos;
        if (local.estado) row.estado = local.estado;
        if (local.en_emision != null) row.en_emision = !!local.en_emision;
        if (local.finalizado != null) row.finalizado = !!local.finalizado;
        if (local.descripcion) row.descripcion = local.descripcion;
        if (local.genero) row.genero = local.genero;
        if (local.generos?.length) row.generos = local.generos;
        if (local.year) row.year = local.year;
        if (local.nombre && String(local.nombre).toLowerCase() !== String(local.slug || "").toLowerCase()) {
          row.nombre = local.nombre;
        }
        // No pisar ciegamente con la de caché: dejar que compitan por score
        // (así una Metahub vieja cacheada no le gana a un TMDB fresco del listado).
        if (local.portada && esPortadaValida(local.portada)) {
          row.portada = elegirPortada(item.portada, local.portada, item.source_id || local.source_id);
        }
        if (local.duracion) row.duracion = local.duracion;
        if (local.duracion_texto) row.duracion_texto = local.duracion_texto;
        if (local.certificacion) row.certificacion = local.certificacion;
        if (local.titulo_original) row.titulo_original = local.titulo_original;
        merged.push(row);
      } else {
        // Aún no abierto en detalle: mostrar meta IMDb de la API, sin marcar Disponible
        merged.push({
          ...item,
          tiene_player: false,
          embeds: [],
          // Conservar calificacion / imdb_id / duracion de la API Worker
        });
      }
    }

    // 2) Ítems solo en Supabase (búsqueda/detalle) que NO están en estrenos API
    // Van AL FINAL para no tapar estrenos del listado
    const soloDb = [];
    for (const local of locales) {
      const key = local.link || local.slug || local.nombre;
      const slugKey = local.slug ? "slug:" + String(local.slug).toLowerCase() : null;
      if (!key || usedLocal.has(key) || (slugKey && usedLocal.has(slugKey))) continue;
      // AnimeAV1 (4) / JK (5): SIEMPRE incluir si están en DB (abiertos desde búsqueda/detalle)
      const sidLoc = String(local.source_id || local.fuente || local.source || "").toLowerCase();
      const esAnimeSrc =
        sidLoc === "4" || sidLoc === "5" ||
        sidLoc === "animeav1" || sidLoc === "jkanime" ||
        /animeav1|jkanime|^jk$/i.test(sidLoc);
      const tieneCont = local.tiene_player || itemTieneContenidoValido(local);
      if (!esAnimeSrc && !tieneCont) continue;
      const slug = String(local.slug || "").toLowerCase();
      if (slug && merged.some((m) => String(m.slug || "").toLowerCase() === slug)) continue;
      const tLocal = normalizeTitleKey(local.nombre || "");
      const yLocal = (String(local.year || "").match(/(19|20)\d{2}/) || [])[0] || "";
      if (tLocal && merged.some((m) => {
        const same = normalizeTitleKey(m.nombre || m.titulo || "") === tLocal;
        if (!same) return false;
        const ym = (String(m.year || "").match(/(19|20)\d{2}/) || [])[0] || "";
        return !yLocal || !ym || yLocal === ym;
      })) continue;
      const row = normalizeItemFromDB(local) || local;
      row._soloDb = true;
      soloDb.push(row);
    }
    // Dentro de los solo-DB: más antiguos primero, los recién abiertos al final
    soloDb.sort((a, b) => {
      const ta = new Date(a.updated_at || a.created_at || 0).getTime() || 0;
      const tb = new Date(b.updated_at || b.created_at || 0).getTime() || 0;
      return ta - tb;
    });

    // Estrenos API primero (orden del worker); guardados por detalle/búsqueda al final
    let all = dedupeListItems(filtrarDescartados(merged.concat(soloDb)));

    const total = all.length;
    const start = (page - 1) * limit;
    return {
      resultados: all.slice(start, start + limit),
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  })();
}

app.get("/api/catalogo", async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(48, Math.max(12, parseInt(req.query.limit) || 24));
    // Sección Películas → paginación worker (estrenos + page 2..761)
    const data = await obtenerPeliculasSeccion(page, limit);
    res.json(data);
  } catch (err) {
    console.error("/api/catalogo", err.message);
    res.status(500).json({ error: "No se pudo cargar el catálogo", resultados: [] });
  }
});

app.get("/api/series", async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(48, Math.max(12, parseInt(req.query.limit) || 24));
    const data = await obtenerSeriesSeccion(page, limit);
    res.json(data);
  } catch (err) {
    console.error("/api/series", err.message);
    res.status(500).json({ error: "No se pudieron cargar las series", resultados: [] });
  }
});

app.get("/api/animes", async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(48, Math.max(12, parseInt(req.query.limit) || 24));
    const sid = String(req.query.source_id || req.query.source || "").trim();
    if (sid === "5" || /jkanime|^jk$/i.test(sid)) {
      // Sección JK: solo source jkanime (5)
      await ensureMoviesDB().catch(() => {});
      let all = (typeof moviesDB !== "undefined" && moviesDB ? moviesDB : []).filter((m) => {
        if (typeof esDescartado === "function" && esDescartado(m)) return false;
        const s = String(m.source_id || m.fuente || m.source || "");
        return s === "5" || /jkanime/i.test(s);
      });
      all = all.map((m) => (typeof normalizeItemFromDB === "function" ? normalizeItemFromDB(m) : m) || m);
      // Recién abiertos al final (no tapan lo que ya había)
      all.sort((a, b) => {
        const ta = new Date(a.updated_at || a.created_at || 0).getTime() || 0;
        const tb = new Date(b.updated_at || b.created_at || 0).getTime() || 0;
        return ta - tb;
      });
      const total = all.length;
      const start = (page - 1) * limit;
      return res.json({
        resultados: all.slice(start, start + limit),
        total,
        page,
        limit,
        totalPages: Math.max(1, Math.ceil(total / limit) || 1),
        fuente: "jkanime",
      });
    }
    // Sección Anime / AnimeAV1: estrenos primero; sin mezclar JK (5)
    const data = await catalogoPaginado("animes", "Anime", page, limit);
    if (Array.isArray(data.resultados)) {
      data.resultados = data.resultados.filter((it) => {
        const ss = String(it.source_id || it.fuente || it.source || "");
        return ss !== "5" && !/jkanime/i.test(ss);
      });
    }
    // Asegurar que AnimeAV1 guardados en DB (source 4) aparezcan al final si faltan
    try {
      await ensureMoviesDB().catch(() => {});
      const ya = new Set(
        (data.resultados || []).map((it) =>
          String((it.slug || "") + "|" + (it.link || "")).toLowerCase()
        )
      );
      const extras = (moviesDB || []).filter((m) => {
        if (!m || (typeof esDescartado === "function" && esDescartado(m))) return false;
        const ss = String(m.source_id || m.fuente || m.source || "").toLowerCase();
        if (!(ss === "4" || ss === "animeav1" || /animeav1/i.test(ss))) return false;
        if (ss === "5" || /jkanime/i.test(ss)) return false;
        const k = String((m.slug || "") + "|" + (m.link || "")).toLowerCase();
        return k && !ya.has(k);
      }).map((m) => (typeof normalizeItemFromDB === "function" ? normalizeItemFromDB(m) : m) || m);
      // Más antiguos primero entre extras; van al final de la página 1
      extras.sort((a, b) => {
        const ta = new Date(a.updated_at || a.created_at || 0).getTime() || 0;
        const tb = new Date(b.updated_at || b.created_at || 0).getTime() || 0;
        return ta - tb;
      });
      if (page === 1 && extras.length) {
        data.resultados = (data.resultados || []).concat(extras);
        data.total = (data.total || 0) + extras.length;
      }
    } catch (eEx) {
      console.warn("animes extras AV1:", eEx.message || eEx);
    }
    res.json(data);
  } catch (err) {
    console.error("/api/animes", err.message);
    res.status(500).json({ error: "No se pudieron cargar los animes", resultados: [] });
  }
});


// Catálogo rápido (Koiflix-style) → worker /catalog/keys | /catalog/batch
app.get("/api/catalog/keys", async (req, res) => {
  try {
    const source = String(req.query.source || req.query.source_id || "4");
    const qs = new URLSearchParams({ source });
    if (req.query.type || req.query.tipo || req.query.seccion) {
      qs.set("type", String(req.query.type || req.query.tipo || req.query.seccion));
    }
    const r = await fetch(`${API_BASE}/catalog/keys?${qs}`, {
      headers: { Accept: "application/json", "User-Agent": "MovieZone/2.0" },
      cache: "no-store",
    });
    const data = await r.json();
    res.json(data);
  } catch (err) {
    console.error("/api/catalog/keys", err.message);
    res.status(502).json({ success: false, keys: [], error: err.message });
  }
});

app.get("/api/catalog/batch", async (req, res) => {
  try {
    const source = String(req.query.source || req.query.source_id || "4");
    const ids = String(req.query.ids || req.query.batch || "");
    const qs = new URLSearchParams({ source, ids });
    if (req.query.type || req.query.tipo || req.query.seccion) {
      qs.set("type", String(req.query.type || req.query.tipo || req.query.seccion));
    }
    const r = await fetch(`${API_BASE}/catalog/batch?${qs}`, {
      headers: { Accept: "application/json", "User-Agent": "MovieZone/2.0" },
      cache: "no-store",
    });
    const data = await r.json();
    // Normalizar a formato grid MovieZone
    const raw = data.results || data.items || [];
    const resultados = raw.map((it) => {
      try {
        return typeof mapListItem === "function" ? mapListItem(it) : it;
      } catch (_) {
        return {
          id: (it.source_id || "4") + "-" + (it.slug || ""),
          nombre: it.titulo || it.nombre || it.title,
          titulo: it.titulo || it.nombre || it.title,
          slug: it.slug,
          tipo: it.tipo || "Anime",
          portada: it.portada,
          logo: it.logo,
          backdrop: it.backdrop,
          source_id: String(it.source_id || source),
          fuente: it.fuente || it.source,
          link: it.url_extract || it.link || it.url,
          url_extract: it.url_extract || it.link,
          tiene_player: true,
        };
      }
    });
    res.json({
      success: true,
      source_id: source,
      resultados,
      total: resultados.length,
      count: resultados.length,
    });
  } catch (err) {
    console.error("/api/catalog/batch", err.message);
    res.status(502).json({ success: false, resultados: [], error: err.message });
  }
});

app.get("/api/buscar", limiterBusqueda, async (req, res) => {
  try {
    const termino = String(req.query.q || "").trim();
    const soloLocal = req.query.source === "local" || req.query.local === "1";
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(60, Math.max(12, parseInt(req.query.limit) || 48));

    let animeSource = req.query.anime_source || req.query.animeSource || null;
    const sidQ = String(req.query.source_id || "").trim();
    if (!animeSource && (sidQ === "5" || sidQ === "jkanime")) animeSource = "jk";
    if (!animeSource && req.query.source && !["local", "online", "1"].includes(String(req.query.source))) {
      const s = String(req.query.source);
      if (s === "5" || /jkanime|jk/i.test(s)) animeSource = "jk";
    }

    if (!termino) {
      return res.status(400).json({ error: "Escribe algo para buscar" });
    }

    if (soloLocal) {
      await ensureMoviesDB();
      return res.json(buscarLocal(termino, req.query.type || null, page, limit));
    }

    const soloJk = animeSource === "jk" || animeSource === "5" || animeSource === "jkanime";
    // Inicio / Películas / Series / Anime AV1 → worker /?q=
    // JK → worker /5/?q=
    const workerPath = soloJk ? "/5/" : "/";
    const limQ = Math.min(80, Math.max(limit, 40));
    const qs = new URLSearchParams({ q: termino, limit: String(limQ) });
    const url = API_BASE + workerPath + "?" + qs.toString();

    let lista = [];
    let rawHits = 0;
    let fetchStatus = 0;
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 28000);
      const r = await fetch(url, {
        headers: {
          Accept: "application/json",
          "User-Agent": "Mozilla/5.0 (compatible; MovieZone/2.0)",
        },
        signal: ctrl.signal,
        cache: "no-store",
      });
      clearTimeout(t);
      fetchStatus = r.status;
      const textBody = await r.text();
      let dataW = null;
      try {
        dataW = JSON.parse(textBody);
      } catch (_) {
        dataW = null;
      }
      const hits = (dataW && (dataW.results || dataW.resultados || dataW.items)) || [];
      rawHits = Array.isArray(hits) ? hits.length : 0;

      for (const row of hits) {
        if (!row) continue;
        let item = null;
        try {
          item = mapListItem(row);
        } catch (_) {}
        if (!item || !(item.slug || item.link || item.nombre)) {
          try {
            item = mapListItemMinimal(row);
          } catch (_) {}
        }
        if (!item || !(item.slug || item.link || item.nombre || item.titulo)) {
          const slug = row.slug || null;
          const titulo = row.nombre || row.titulo || row.title || (slug ? String(slug).replace(/-/g, " ") : null);
          if (!titulo && !slug) continue;
          const tipoRaw = String(row.tipo || row.type || "");
          let tipo = "Película";
          if (/serie|dorama|tv/i.test(tipoRaw)) tipo = "Serie";
          else if (/anime/i.test(tipoRaw)) tipo = "Anime";
          else if (/ova/i.test(tipoRaw)) tipo = "OVA";
          else if (/ona/i.test(tipoRaw)) tipo = "ONA";
          const sid = String(row.source_id || (typeof resolverSourceId === "function" ? resolverSourceId(row.source || row.fuente) : "3") || "3");
          const kind = tipo === "Serie" ? "serie" : /anime|ova|ona/i.test(tipo) ? "anime" : "pelicula";
          const link = row.url || row.link || (slug ? `${API_BASE}/${sid}/${kind}/${slug}` : null);
          item = {
            id: sid + "-" + (slug || titulo),
            nombre: titulo,
            titulo: titulo,
            slug,
            tipo,
            portada: row.portada || null,
            year: row.year || null,
            link,
            url_extract: link,
            source_id: sid,
            fuente: row.source || row.fuente || null,
            tiene_player: true,
            embeds: [],
            downloads: [],
            episodios: [],
            temporadas: [],
          };
        }
        lista.push(item);
      }
    } catch (eFetch) {
      console.warn("api/buscar", workerPath, eFetch.message || eFetch);
    }

    const startIdx = (page - 1) * limit;
    const pageLista = lista.slice(startIdx, startIdx + limit);
    const out = {
      resultados: pageLista,
      total: lista.length,
      page,
      limit,
      source: "online",
    };
    if (req.query.debug === "1") {
      out._debug = {
        api_base: API_BASE,
        url,
        soloJk,
        fetchStatus,
        rawHits,
        mapped: lista.length,
        sample: pageLista[0] ? pageLista[0].nombre || pageLista[0].titulo : null,
      };
    }
    return res.json(out);
  } catch (err) {
    console.error("/api/buscar", err.message);
    res.status(500).json({ error: "No se pudo realizar la búsqueda", resultados: [] });
  }
});


app.get("/api/recien", async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 12, 40);
    // Directo a Supabase (no confiar en memoria de Vercel)
    const sb = getSupabase();
    if (!sb) {
      await ensureMoviesDB();
      return res.json({
        resultados: moviesDB.slice(0, limit).map((m) => normalizeItemFromDB(m)),
      });
    }
    const { data, error } = await sb
      .from("movies")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    const resultados = filtrarDescartados(
      (data || []).map((row) => normalizeItemFromDB(row)).filter(Boolean)
    );
    // Actualizar espejo en memoria
    for (const item of resultados) {
      if (!item.link) continue;
      const idx = moviesDB.findIndex((m) => m.link === item.link);
      if (idx >= 0) moviesDB[idx] = { ...moviesDB[idx], ...item };
      else moviesDB.unshift(item);
    }
    res.json({ resultados });
  } catch (err) {
    console.error("/api/recien", err.message);
    res.status(500).json({ error: "No se pudieron cargar los recién añadidos", resultados: [] });
  }
});

app.get("/api/detalle", async (req, res) => {
  try {
    const link = req.query.link || null;
    const postId = req.query.postId || null;
    const slug = req.query.slug || null;
    const source_id = req.query.source_id || req.query.source || null;
    const tipo = req.query.tipo || null;
    // Portada ya conocida por el cliente (la del listado/tarjeta). Si viene,
    // manda siempre sobre lo que traiga el detalle de la fuente.
    const portada = req.query.portada || req.query.portada_listado || null;

    if (!link && !postId && !slug) {
      return res.status(400).json({ error: "Falta link, postId o slug" });
    }

    const force = req.query.force === "1";
    const item = await obtenerDetalle({ link, postId, slug, source_id, tipo, force, portada });
    // Tras abrir detalle: persistir ficha completa (descripcion, tipo, eps…) para la sección
    if (item && (item.link || item.slug)) {
      try {
        await guardarEnSupabase([item]);
      } catch (eSave) {
        console.warn("detalle save:", eSave.message || eSave);
      }
    }
    // No dejar que el cliente/caché confunda JK(5) con AV1(4)
    if (item && source_id != null && source_id !== "") {
      const sid = String(source_id).replace(/\D/g, "") || String(source_id);
      if (sid === "5" || /jkanime/i.test(String(source_id))) {
        item.source_id = "5";
        item.fuente = item.fuente || "jkanime";
        if (!item.tipo || /serie/i.test(String(item.tipo))) item.tipo = "Anime";
      } else if (sid === "4" || /animeav1/i.test(String(source_id))) {
        item.source_id = "4";
        item.fuente = item.fuente || "animeav1";
        if (!item.tipo || /serie/i.test(String(item.tipo))) item.tipo = "Anime";
      } else {
        item.source_id = String(resolverSourceId(source_id));
      }
    }
    res.json(item);
  } catch (err) {
    console.error("/api/detalle", err.message);
    res.status(500).json({ error: "No se pudo cargar el detalle", detalle: err.message });
  }
});

app.get("/api/episodios", async (req, res) => {
  try {
    const postId = req.query.postId || null;
    const season = parseInt(req.query.season) || 1;
    const link = req.query.link || null;
    const slug = req.query.slug || null;
    const tipo = req.query.tipo || "Serie";
    const isAnime = tipo === "Anime" || /anime/i.test(String(tipo));
    // Respetar source_id del cliente (JK=5, AV1=4)
    const source_id = req.query.source_id || (isAnime ? "4" : DEFAULT_SOURCE);
    const sidEps = String(resolverSourceId(source_id));
    const loadPlayers = req.query.players === "1";
    const epFrom = parseInt(req.query.ep_from, 10) || null;
    const epTo = parseInt(req.query.ep_to, 10) || null;

    let item = null;
    try {
      if (isAnime && slug && (epFrom || epTo || ["4", "5"].includes(sidEps))) {
        const from = epFrom || 1;
        const to = epTo || (epFrom ? epFrom + 99 : 100);
        // Usar la fuente pedida (5=JK, 4=AV1), no forzar siempre 4
        item = await fetchDetailFromSource(sidEps, "anime", slug, {
          ep_from: from,
          ep_to: to,
          tipo: "Anime",
          slug,
        });
        if (item) {
          try {
            const full = await obtenerDetalle({
              link,
              postId,
              slug,
              source_id: sidEps,
              tipo: "Anime",
              force: false,
            });
            if (full) {
              item = mergeItems(item, full);
              item = expandirEpisodiosAnime(item);
            }
          } catch (_) {}
        }
      }
      if (!item) {
        item = await obtenerDetalle({ link, postId, slug, source_id: sidEps, tipo });
      }
    } catch (err) {
      console.warn("episodios detalle:", err.message);
    }

    if (!item) {
      return res.json({ temporadas: [1], seasonActual: season, episodios: [] });
    }

    item = expandirEpisodiosAnime(item);

    let eps = Array.isArray(item.episodios)
      ? item.episodios.filter((e) => Number(e.season || 1) === season)
      : [];
    if (!eps.length && Array.isArray(item.episodios)) {
      eps = item.episodios.filter((e) => !e.season || Number(e.season) === season);
    }

    // Filtrar por rango si viene en query
    if (epFrom || epTo) {
      const from = epFrom || 1;
      const to = epTo || from + 99;
      eps = eps.filter((e) => {
        const n = Number(e.episode || e.episodio || 0);
        return n >= from && n <= to;
      });
      // Si tras filtrar no hay, generar stubs del rango
      if (!eps.length) {
        for (let n = from; n <= to; n++) {
          eps.push({
            season,
            episode: n,
            nombre: `Episodio ${n}`,
            embeds: [],
            video: null,
            source_id: item.source_id || source_id,
          });
        }
      }
    }

    const id = parseIdentidad(item) || {
      sourceId: String(item.source_id || source_id),
      slug: item.slug || slug,
      kind: isAnime || item.tipo === "Anime" ? "anime" : "serie",
    };

    // NO precargar players del ep1: el reproductor se pide al pulsar el episodio (/api/capitulo)
    // Guardar listado de temporadas/episodios (stubs) en Supabase para la próxima visita
    if (item.link || item.slug) {
      try {
        // Fusionar eps de esta temporada en el item completo
        const allEps = Array.isArray(item.episodios) ? [...item.episodios] : [];
        const byKey = new Map();
        for (const ep of allEps) {
          const k = `${Number(ep.season) || 1}-${Number(ep.episode || ep.episodio) || 0}`;
          byKey.set(k, ep);
        }
        for (const ep of eps) {
          const k = `${Number(ep.season) || season}-${Number(ep.episode || ep.episodio) || 0}`;
          const prev = byKey.get(k);
          let mergedEp;
          if (prev && (prev.embeds?.length || prev.video || prev.reproductor)) {
            mergedEp = {
              ...ep,
              embeds: prev.embeds,
              video: prev.video || prev.reproductor,
              reproductor: prev.reproductor || prev.video,
              url_capitulo: prev.url_capitulo || ep.url_capitulo,
            };
          } else {
            mergedEp = { ...ep, season: Number(ep.season) || season };
          }
          byKey.set(
            k,
            asegurarUrlCapitulo(mergedEp, {
              source_id: item.source_id || id.sourceId || source_id,
              tipo: item.tipo,
              slug: item.slug || id.slug || slug,
            })
          );
        }
        item.episodios = Array.from(byKey.values()).map((ep) =>
          asegurarUrlCapitulo(ep, {
            source_id: item.source_id || id.sourceId || source_id,
            tipo: item.tipo,
            slug: item.slug || id.slug || slug,
          })
        ).sort((a, b) => {
          const sa = Number(a.season) || 1;
          const sb = Number(b.season) || 1;
          if (sa !== sb) return sa - sb;
          return (Number(a.episode || a.episodio) || 0) - (Number(b.episode || b.episodio) || 0);
        });
        if (!item.temporadas || !item.temporadas.length) {
          item.temporadas = [...new Set(item.episodios.map((e) => Number(e.season) || 1))].sort((a, b) => a - b);
        }
        item.tiene_player = true; // serie con listado = "Disponible" en catálogo
        await guardarEnSupabase([item]);
      } catch (saveErr) {
        console.warn("guardar listado episodios:", saveErr.message);
      }
    }

    res.json({
      temporadas: item.temporadas?.length ? item.temporadas : [season],
      seasonActual: season,
      episodios: eps,
      slug: item.slug || slug,
      source_id: item.source_id || source_id,
      link: item.link,
      total_episodios: item.total_episodios || eps.length,
      rangos_episodios: item.rangos_episodios || null,
      estado: item.estado || null,
      en_emision: item.en_emision != null ? !!item.en_emision : null,
      finalizado: item.finalizado != null ? !!item.finalizado : null,
      fecha_estreno: item.fecha_estreno || null,
    });
  } catch (err) {
    console.error("/api/episodios", err.message);
    res.status(500).json({ error: "No se pudieron cargar los episodios", detalle: err.message });
  }
});

/** Players de un capítulo: Supabase primero → si no, API → guarda → responde */
app.get("/api/capitulo", async (req, res) => {
  try {
    const sourceId = req.query.source_id || DEFAULT_SOURCE;
    const slug = req.query.slug;
    const link = req.query.link || null;
    const tipo = req.query.tipo || "Serie";
    const temporada = parseInt(req.query.temporada || req.query.season) || 1;
    const episodio = parseInt(req.query.episodio || req.query.episode) || 1;
    if (!slug && !link) return res.status(400).json({ error: "Falta slug o link" });

    // 1) Supabase / memoria: ¿ya tenemos este capítulo con players?
    let serie = null;
    try {
      // Solo cache (no re-scrape): buscarEnSupabase + memoria
      serie = await buscarEnSupabase({ link, slug, postId: null });
      if (!serie && link) {
        const local = moviesDB.find((m) => m.link === link);
        if (local) serie = normalizeItemFromDB(local);
      }
      if (!serie && slug) {
        const local = moviesDB.find((m) => m.slug === slug || (m.link && String(m.link).includes(slug)));
        if (local) serie = normalizeItemFromDB(local);
      }
    } catch (_) {}

    // Cache: si el episodio ya tiene players en Supabase → servirlos ya
    // (el resto de episodios se cargan al pulsarlos, como pediste)
    let cachedEmb = [];
    let cachedEp = null;
    if (serie && Array.isArray(serie.episodios)) {
      cachedEp = serie.episodios.find(
        (e) => mismoEpisodio(e, temporada, episodio) && (e.embeds?.length || e.video || e.reproductor)
      );
      if (cachedEp) {
        cachedEmb = mapEmbeds(cachedEp.embeds || []);
        if (!cachedEmb.length && (cachedEp.video || cachedEp.reproductor)) {
          cachedEmb = mapEmbeds([{ url: cachedEp.video || cachedEp.reproductor }]);
        }
        // ≥1 player guardado → devolver de Supabase (sin ir al Worker)
        if (cachedEmb.length >= 1) {
          return res.json({
            season: temporada,
            episode: episodio,
            embeds: cachedEmb,
            downloads: cachedEp.downloads || cachedEp.descargas || [],
            reproductor: cachedEp.video || cachedEp.reproductor || (cachedEmb[0] && cachedEmb[0].url) || null,
            from: "supabase",
          });
        }
      }
    }

    // 2) API externa del episodio (link guardado en el episodio o reconstruido)
    const kind = (tipo === "Anime" || serie?.tipo === "Anime") ? "anime" : "serie";
    const resolvedSlug = slug || serie?.slug || (parseIdentidad(serie || { link }) || {}).slug;
    const resolvedSource = resolverSourceId(
      sourceId || serie?.source_id || (parseIdentidad(serie || { link }) || {}).sourceId || DEFAULT_SOURCE
    );
    if (!resolvedSlug) return res.status(400).json({ error: "Falta slug" });

    // Preferir url_capitulo ya guardada en el listado (ej. .../6/serie/our-sticky-love/1/1)
    let epStub =
      (serie &&
        Array.isArray(serie.episodios) &&
        serie.episodios.find((e) => mismoEpisodio(e, temporada, episodio))) ||
      null;
    const urlCap =
      (req.query.url_capitulo && String(req.query.url_capitulo)) ||
      (epStub && epStub.url_capitulo) ||
      urlCapituloWorker(resolvedSource, kind, resolvedSlug, temporada, episodio);

    let det = null;
    let embeds = [];
    try {
      // 2a) Llamada directa al link del capítulo si lo tenemos
      if (urlCap && String(urlCap).includes(API_BASE.replace(/https?:\/\//, "").split("/")[0] || "workers.dev")) {
        try {
          const pathOnly = String(urlCap).replace(API_BASE, "").replace(/^https?:\/\/[^/]+/, "");
          const dataCap = await apiGet(pathOnly.startsWith("/") ? pathOnly : `/${pathOnly}`);
          if (dataCap && dataCap.success !== false) {
            det = mapDetail(dataCap, {
              slug: resolvedSlug,
              source_id: resolvedSource,
              tipo: kind === "anime" ? "Anime" : "Serie",
            });
            embeds = mapEmbeds(
              (dataCap.reproductores && dataCap.reproductores.length)
                ? dataCap.reproductores
                : (dataCap.embeds || det.embeds || [])
            );
          }
        } catch (_) {}
      }
      // 2b) Fallback: obtenerEpisodio (varias fuentes)
      if (!embeds.length) {
        det = await obtenerEpisodio(resolvedSource, resolvedSlug, temporada, episodio, kind, serie);
        embeds = mapEmbeds(det.embeds || []);
      }
    } catch (apiErr) {
      // Si había cache parcial o falla el Worker, no tumbar al usuario con 500
      if (cachedEmb.length) {
        return res.json({
          season: temporada,
          episode: episodio,
          embeds: cachedEmb,
          downloads: (cachedEp && (cachedEp.downloads || cachedEp.descargas)) || [],
          reproductor: (cachedEp && (cachedEp.video || cachedEp.reproductor)) || cachedEmb[0].url,
          from: "supabase-fallback",
          warning: apiErr.message,
        });
      }
      console.error("/api/capitulo", apiErr.message);
      return res.status(502).json({
        error: "No se pudo cargar el capítulo",
        detalle: apiErr.message,
        season: temporada,
        episode: episodio,
        embeds: [],
      });
    }

    if (cachedEmb.length) embeds = mergeEmbedLists(cachedEmb, embeds);

    // 3) Guardar en Supabase para la próxima vez
    if (embeds.length) {
      if (!serie) {
        serie = {
          link: link || `${API_BASE}/${resolvedSource}/${kind}/${resolvedSlug}`,
          slug: resolvedSlug,
          source_id: String(resolvedSource),
          tipo: kind === "anime" ? "Anime" : "Serie",
          nombre: (det && det.nombre) || resolvedSlug,
          episodios: [],
          tiene_player: true,
        };
      }
      try {
        await guardarPlayersEpisodio(serie, temporada, episodio, embeds, det && det.reproductor);
      } catch (saveErr) {
        console.warn("guardarPlayersEpisodio:", saveErr.message);
      }
    }

    res.json({
      season: temporada,
      episode: episodio,
      embeds,
      downloads: (det && (det.downloads || det.descargas)) || [],
      reproductor: (det && det.reproductor) || (embeds[0] && embeds[0].url) || null,
      nombre: det && det.nombre,
      from: "api",
    });
  } catch (err) {
    console.error("/api/capitulo", err.message);
    res.status(500).json({ error: "No se pudo cargar el capítulo", detalle: err.message });
  }
});

// ============================================================
// TV Zone (cable + países) — no altera flujo de películas
// ============================================================
const TV_API = (process.env.TV_API || "https://tv-zone-api.tvjz.workers.dev/").replace(/\/$/, "");


// Fútbol (worker /7 — futbollibrefullhd.org)
app.get("/api/tv/futbol", async (req, res) => {
  try {
    const r = await fetch(`${API_BASE}/7/agenda`, {
      headers: { Accept: "application/json", "User-Agent": "MovieZone/2.0" },
      cache: "no-store",
    });
    const data = await r.json();
    res.json(data);
  } catch (err) {
    console.error("/api/tv/futbol", err.message);
    res.status(502).json({ success: false, items: [], error: err.message });
  }
});

app.get("/api/tv/futbol/agenda", async (req, res) => {
  try {
    const r = await fetch(`${API_BASE}/7/agenda`, {
      headers: { Accept: "application/json", "User-Agent": "MovieZone/2.0" },
      cache: "no-store",
    });
    const data = await r.json();
    res.json(data);
  } catch (err) {
    console.error("/api/tv/futbol/agenda", err.message);
    res.status(502).json({ success: false, items: [], error: err.message });
  }
});

app.get("/api/tv/futbol/canales", async (req, res) => {
  try {
    const r = await fetch(`${API_BASE}/7/canales`, {
      headers: { Accept: "application/json", "User-Agent": "MovieZone/2.0" },
      cache: "no-store",
    });
    const data = await r.json();
    res.json(data);
  } catch (err) {
    console.error("/api/tv/futbol/canales", err.message);
    res.status(502).json({ success: false, items: [], error: err.message });
  }
});

app.get("/api/tv/cable", async (req, res) => {
  try {
    const r = await fetch(`${TV_API}/tv/cable`);
    const data = await r.json();
    res.json(data);
  } catch (err) {
    console.error("/api/tv/cable", err.message);
    res.status(500).json({ success: false, error: err.message || "Error TV cable" });
  }
});

app.get("/api/tv/countries", async (req, res) => {
  try {
    const r = await fetch(`${TV_API}/tv/countries`);
    const data = await r.json();
    res.json(data);
  } catch (err) {
    console.error("/api/tv/countries", err.message);
    res.status(500).json({ success: false, error: err.message || "Error TV countries" });
  }
});

app.get("/api/tv/countries/:code", async (req, res) => {
  try {
    const code = String(req.params.code || "").toLowerCase();
    const r = await fetch(`${TV_API}/tv/countries/${encodeURIComponent(code)}`);
    const data = await r.json();
    res.json(data);
  } catch (err) {
    console.error("/api/tv/countries/:code", err.message);
    res.status(500).json({ success: false, error: err.message || "Error TV país" });
  }
});

// Proxy HLS para TV (evita mixed content HTTP en sitio HTTPS)
app.get("/api/tv/proxy", async (req, res) => {
  try {
    let target = req.query.url || "";
    try {
      target = decodeURIComponent(String(target));
    } catch (_) {}
    if (!/^https?:\/\//i.test(target)) {
      return res.status(400).json({ success: false, error: "url inválida" });
    }

    const upstream = await fetch(target, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        Accept: "*/*",
      },
      redirect: "follow",
    });

    if (!upstream.ok) {
      return res.status(upstream.status).send("upstream error");
    }

    const ct = (upstream.headers.get("content-type") || "").toLowerCase();
    const isPlaylist =
      ct.includes("mpegurl") ||
      ct.includes("m3u") ||
      /\.m3u8?(?:\?|$)/i.test(target);

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "no-store");

    if (isPlaylist) {
      let body = await upstream.text();
      if (!body.includes("#EXT")) {
        res.setHeader("Content-Type", ct || "application/octet-stream");
        return res.send(body);
      }

      const base = target.replace(/[^\/?#]+(\?.*)?$/, "");
      let origin = "";
      try {
        origin = new URL(target).origin;
      } catch (_) {}

      const lines = body.split(/\r?\n/).map((line) => {
        const t = line.trim();
        if (!t || t.startsWith("#")) {
          if (/URI="/i.test(line)) {
            return line.replace(/URI="([^"]+)"/gi, (_, uri) => {
              let abs = uri;
              if (uri.startsWith("//")) abs = "https:" + uri;
              else if (uri.startsWith("/")) abs = origin + uri;
              else if (!/^https?:\/\//i.test(uri)) {
                try {
                  abs = new URL(uri, base).href;
                } catch (_) {
                  abs = base + uri;
                }
              }
              return `URI="/api/tv/proxy?url=${encodeURIComponent(abs)}"`;
            });
          }
          return line;
        }
        let abs = t;
        if (t.startsWith("//")) abs = "https:" + t;
        else if (t.startsWith("/")) abs = origin + t;
        else if (!/^https?:\/\//i.test(t)) {
          try {
            abs = new URL(t, base).href;
          } catch (_) {
            abs = base + t;
          }
        }
        return `/api/tv/proxy?url=${encodeURIComponent(abs)}`;
      });

      res.setHeader("Content-Type", "application/vnd.apple.mpegurl; charset=utf-8");
      return res.send(lines.join("\n"));
    }

    res.setHeader("Content-Type", ct || "application/octet-stream");
    const buf = Buffer.from(await upstream.arrayBuffer());
    return res.send(buf);
  } catch (err) {
    console.error("/api/tv/proxy", err.message);
    res.status(502).json({ success: false, error: err.message || "proxy error" });
  }
});

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "MovieZone",
    api: API_BASE,
    supabase: !!getSupabase(),
    items: moviesDB.length,
    telegram: isTelegramEnabled(),
  });
});

// ---------- Telegram: aviso de visitas (apagable) ----------
function isTelegramEnabled() {
  // TELEGRAM_NOTIFY=0 | false | off → apagado
  const flag = String(process.env.TELEGRAM_NOTIFY || "1").toLowerCase();
  if (flag === "0" || flag === "false" || flag === "off" || flag === "no") return false;
  return !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
}

async function enviarTelegram(texto) {
  if (!isTelegramEnabled()) return false;
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  try {
    await axios.post(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        chat_id: chatId,
        text: texto,
        disable_web_page_preview: true,
      },
      { timeout: 8000 }
    );
    return true;
  } catch (err) {
    console.warn("Telegram:", err.message);
    return false;
  }
}

// Rate limit simple en memoria por IP (1 aviso cada 30 min)
const visitCooldown = new Map();
app.post("/api/visit", express.json({ limit: "8kb" }), async (req, res) => {
  try {
    if (!isTelegramEnabled()) {
      return res.json({ ok: true, sent: false, reason: "telegram_off" });
    }
    const ip =
      (req.headers["x-forwarded-for"] && String(req.headers["x-forwarded-for"]).split(",")[0].trim()) ||
      req.ip ||
      "unknown";
    const now = Date.now();
    const last = visitCooldown.get(ip) || 0;
    if (now - last < 30 * 60 * 1000) {
      return res.json({ ok: true, sent: false, reason: "cooldown" });
    }
    visitCooldown.set(ip, now);

    const d = req.body || {};
    const lineas = [
      "👁 Nueva visita MovieZone",
      `• IP: ${ip}`,
      `• Dispositivo: ${d.device || "—"}`,
      `• SO: ${d.os || "—"}`,
      `• Navegador: ${d.browser || "—"}`,
      `• Pantalla: ${d.screen || "—"}`,
      `• Idioma: ${d.lang || "—"}`,
      `• Zona: ${d.timezone || "—"}`,
      `• URL: ${d.url || "—"}`,
      `• Referrer: ${d.referrer || "directo"}`,
      `• Hora: ${new Date().toISOString()}`,
    ];
    const sent = await enviarTelegram(lineas.join("\n"));
    res.json({ ok: true, sent });
  } catch (err) {
    console.error("/api/visit", err.message);
    res.status(500).json({ ok: false, error: "visit_failed" });
  }
});

app.get("/api/telegram-status", (_req, res) => {
  res.json({ enabled: isTelegramEnabled() });
});

// ---------- Frontend estático ----------
// En Vercel el working dir es /var/task; includeFiles copia public ahí
const publicDir = path.join(__dirname, "public");
const publicDirAlt = path.join(process.cwd(), "public");
const fs = require("fs");
const resolvedPublic = fs.existsSync(publicDir)
  ? publicDir
  : fs.existsSync(publicDirAlt)
    ? publicDirAlt
    : publicDir;

app.use(express.static(resolvedPublic));

function sendIndex(res) {
  const indexPath = path.join(resolvedPublic, "index.html");
  if (!fs.existsSync(indexPath)) {
    return res.status(500).send(
      "index.html no encontrado. Revisa vercel.json includeFiles: public/**"
    );
  }
  res.sendFile(indexPath);
}

app.get(["/peliculas", "/series", "/animes"], (_req, res) => sendIndex(res));
app.get(
  ["/:tipo(serie|pelicula|anime)/:slug", "/:tipo(serie|pelicula|anime)/:slug/:season/:episode"],
  (_req, res) => sendIndex(res)
);
// Deep links: /detalle/slug | /detalle/slug/t/e | /detalle/5/slug | /detalle/5/slug/t/e
app.get(
  [
    "/detalle/:sourceId/:slug/:season/:episode",
    "/detalle/:sourceId/:slug",
    "/detalle/:slug/:season/:episode",
    "/detalle/:slug",
  ],
  (_req, res) => sendIndex(res)
);
app.get("/", (_req, res) => sendIndex(res));

// SPA fallback: cualquier ruta no-API → index (evita Cannot GET al recargar)
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api")) return next();
  if (req.method !== "GET" && req.method !== "HEAD") return next();
  return sendIndex(res);
});

// ---------- Arranque ----------
cargarDatosSupabase().catch(() => {});

// En Vercel no escuchamos puerto; el export sirve.
if (require.main === module || !process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`MovieZone v2 escuchando en :${PORT}`);
    console.log(`API fuente: ${API_BASE}`);
  });
}

module.exports = app;
