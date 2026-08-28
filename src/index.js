const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

const LAMOVIE = "https://lamovie.org";
const LAMOVIE_API = "https://lamovie.org/wp-api/v1";
const HACKSTORE = "https://www.hackstore.fo";

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...CORS,
    },
  });
}

function normalizar(texto) {
  return String(texto || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extraerAnio(titulo) {
  const m = String(titulo || "").match(/\b((?:19|20)\d{2})\b/);
  return m ? m[1] : null;
}

function dedup(items) {
  const mapa = new Map();

  for (const item of items) {
    const titulo = normalizar(item.nombre);
    const year = item.year || extraerAnio(item.nombre);

    if (!titulo) continue;

    const key = `${titulo}|${year || ""}`;

    if (!mapa.has(key)) {
      mapa.set(key, item);
    } else {
      const anterior = mapa.get(key);

      // Preferir el que tenga reproductor
      if (
        !anterior.reproductor &&
        item.reproductor
      ) {
        mapa.set(key, item);
      }
    }
  }

  return [...mapa.values()];
}

function formatLamovie(p) {
  const images = p.images || {};

  let poster = images.poster || p.poster || "";
  let backdrop = images.backdrop || p.backdrop || "";

  if (poster && !poster.startsWith("http")) {
    poster = "https://lamovie.org/wp-content/uploads" + poster;
  }

  if (backdrop && !backdrop.startsWith("http")) {
    backdrop = "https://lamovie.org/wp-content/uploads" + backdrop;
  }

  const tipoRaw = p.type || "";

  let tipo = "Película";
  let link = null;

  if (tipoRaw === "movies") {
    tipo = "Película";
    link = `${LAMOVIE}/peliculas/${p.slug}/`;
  }

  if (tipoRaw === "tvshows") {
    tipo = "Serie";
    link = `${LAMOVIE}/series/${p.slug}/`;
  }

  if (tipoRaw === "animes") {
    tipo = "Anime";
    link = `${LAMOVIE}/animes/${p.slug}/`;
  }

  const nombre =
    p.title ||
    p.name ||
    "Sin título";

  let year = null;

  if (p.release_date) {
    year = String(p.release_date).substring(0, 4);
  }

  if (!year) {
    year = extraerAnio(nombre);
  }

  return {
    id: p._id || p.id || null,
    postId: p._id || p.id || null,

    nombre,

    titulo_original:
      p.original_title ||
      p.originalTitle ||
      null,

    slug: p.slug || null,

    tipo,

    descripcion:
      p.overview ||
      p.description ||
      "",

    portada: poster || null,

    backdrop: backdrop || null,

    year,

    genero:
      Array.isArray(p.genres)
        ? p.genres.join(", ")
        : p.genres || null,

    idiomas:
      Array.isArray(p.lang)
        ? p.lang
        : Array.isArray(p.languages)
          ? p.languages
          : [],

    calidad:
      Array.isArray(p.quality)
        ? p.quality
        : [],

    calificacion:
      p.rating ||
      p.imdb_rating ||
      null,

    calificacion_comunidad:
      p.community_rating ||
      null,

    votos:
      p.vote_count ||
      p.community_vote_count ||
      null,

    fecha_estreno:
      p.release_date ||
      null,

    duracion:
      p.runtime ||
      null,

    certificacion:
      p.certification ||
      null,

    paises:
      Array.isArray(p.countries)
        ? p.countries
        : [],

    ultimo_episodio:
      p.latest_episode ||
      null,

    link,

    reproductor:
      null,

    embeds: [],

    downloads: [],

    soloTrailer: false,

    episodios: [],

    temporadas: [],

    fuente: "lamovie",
  };
}

async function lamovieListing(type, page, limit) {
  let postType = "movies";

  if (type === "series") {
    postType = "tvshows";
  }

  if (type === "anime") {
    postType = "animes";
  }

  const url =
    `${LAMOVIE_API}/listing/${postType}` +
    `?page=${page}` +
    `&orderBy=latest` +
    `&order=desc` +
    `&postType=${postType}` +
    `&postsPerPage=${limit}`;

  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      "Accept": "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Lamovie HTTP ${response.status}`);
  }

  const data = await response.json();

  const posts =
    data?.data?.posts ||
    data?.posts ||
    [];

  return posts.map(formatLamovie);
}

async function lamovieSearch(q, limit) {
  const url =
    `${LAMOVIE_API}/search` +
    `?postType=any` +
    `&q=${encodeURIComponent(q)}` +
    `&postsPerPage=${limit}`;

  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      "Accept": "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Lamovie search HTTP ${response.status}`);
  }

  const data = await response.json();

  const posts =
    data?.data?.posts ||
    data?.data ||
    [];

  return Array.isArray(posts)
    ? posts.map(formatLamovie)
    : [];
}

/*
 * Hackstore:
 * Obtiene resultados de búsqueda/listado.
 *
 * Lo dejamos separado para poder cambiar fácilmente
 * el selector si Hackstore cambia su HTML.
 */
async function hackstoreSearch(q = "", page = 1) {
  try {
    let url;

    if (q) {
      url =
        `${HACKSTORE}/?s=${encodeURIComponent(q)}`;
    } else {
      url =
        `${HACKSTORE}/page/${page}/`;
    }

    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/139 Safari/537.36",
        "Accept":
          "text/html,application/xhtml+xml",
      },
    });

    if (!response.ok) {
      return [];
    }

    const html = await response.text();

    const resultados = [];

    /*
     * Extraer enlaces de películas/series.
     */
    const regex =
      /href=["']([^"']+)["'][^>]*>/gi;

    const vistos = new Set();

    for (const match of html.matchAll(regex)) {
      let link = match[1];

      if (!link.startsWith("http")) {
        try {
          link = new URL(link, HACKSTORE).href;
        } catch {
          continue;
        }
      }

      if (!link.includes("hackstore.fo")) continue;

      if (
        !/\/(peliculas?|movies?|series?|anime|animes)\//i.test(
          link
        )
      ) {
        continue;
      }

      if (vistos.has(link)) continue;

      vistos.add(link);

      resultados.push({
        id: null,
        postId: null,
        nombre: link
          .split("/")
          .filter(Boolean)
          .pop()
          ?.replace(/[-_]/g, " ") || "Sin título",

        titulo_original: null,
        slug: null,

        tipo: /series/i.test(link)
          ? "Serie"
          : /anime/i.test(link)
            ? "Anime"
            : "Película",

        descripcion: "",
        portada: null,
        backdrop: null,

        year: extraerAnio(link),

        genero: null,
        idiomas: [],
        calidad: [],
        calificacion: null,
        calificacion_comunidad: null,
        votos: null,
        fecha_estreno: null,
        duracion: null,
        certificacion: null,
        paises: [],
        ultimo_episodio: null,

        link,

        reproductor: null,
        embeds: [],
        downloads: [],
        soloTrailer: false,
        episodios: [],
        temporadas: [],

        fuente: "hackstore",
      });

      if (resultados.length >= 24) {
        break;
      }
    }

    return resultados;
  } catch {
    return [];
  }
}

async function obtenerCatalogo(type, page, limit) {
  const lamovie = await lamovieListing(
    type,
    page,
    limit
  ).catch(() => []);

  const hackstore = await hackstoreSearch(
    "",
    page
  ).catch(() => []);

  const combinados =
    dedup([
      ...lamovie,
      ...hackstore,
    ]);

  return combinados.slice(0, limit);
}

async function buscar(q, type, page, limit) {
  let lamovie = [];

  try {
    lamovie =
      await lamovieSearch(q, limit);
  } catch {
    lamovie = [];
  }

  let hackstore = [];

  try {
    hackstore =
      await hackstoreSearch(q, page);
  } catch {
    hackstore = [];
  }

  let resultados = dedup([
    ...lamovie,
    ...hackstore,
  ]);

  if (type === "series") {
    resultados = resultados.filter(
      x => x.tipo === "Serie"
    );
  }

  if (type === "anime") {
    resultados = resultados.filter(
      x => x.tipo === "Anime"
    );
  }

  if (type === "movies") {
    resultados = resultados.filter(
      x => x.tipo === "Película"
    );
  }

  return resultados.slice(
    (page - 1) * limit,
    page * limit
  );
}

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: CORS,
      });
    }

    const url = new URL(request.url);

    if (
      url.pathname === "/" ||
      url.pathname === "/health"
    ) {
      return json({
        status: "ok",
        service: "MovieZone Worker",
        sources: [
          "lamovie",
          "hackstore",
        ],
      });
    }

    const page = Math.max(
      1,
      parseInt(url.searchParams.get("page") || "1")
    );

    const limit = Math.min(
      48,
      Math.max(
        1,
        parseInt(
          url.searchParams.get("limit") || "24"
        )
      )
    );

    /*
     * /api/catalogo
     */
    if (url.pathname === "/api/catalogo") {
      const resultados =
        await obtenerCatalogo(
          "movies",
          page,
          limit
        );

      return json({
        resultados,
        total: resultados.length,
        page,
        limit,
        source: "worker",
      });
    }

    /*
     * /api/series
     */
    if (url.pathname === "/api/series") {
      const resultados =
        await obtenerCatalogo(
          "series",
          page,
          limit
        );

      return json({
        resultados,
        total: resultados.length,
        page,
        limit,
        source: "worker",
      });
    }

    /*
     * /api/animes
     */
    if (url.pathname === "/api/animes") {
      const resultados =
        await obtenerCatalogo(
          "anime",
          page,
          limit
        );

      return json({
        resultados,
        total: resultados.length,
        page,
        limit,
        source: "worker",
      });
    }

    /*
     * /api/buscar?q=
     */
    if (url.pathname === "/api/buscar") {
      const q =
        url.searchParams.get("q")?.trim() || "";

      if (!q) {
        return json({
          resultados: [],
          total: 0,
          error: "Falta q",
        }, 400);
      }

      const type =
        url.searchParams.get("type") || null;

      const resultados =
        await buscar(
          q,
          type,
          page,
          limit
        );

      return json({
        resultados,
        total: resultados.length,
        page,
        limit,
        source: "worker",
      });
    }

    return json({
      status: "ok",
      error: "Ruta no encontrada",
      routes: [
        "/",
        "/health",
        "/api/catalogo?page=1",
        "/api/series?page=1",
        "/api/animes?page=1",
        "/api/buscar?q=spiderman",
      ],
    }, 404);
  },
};
