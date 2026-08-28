const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

const LAMOVIE = "https://lamovie.org";
const API = `${LAMOVIE}/wp-api/v1`;

const GENRES = {
  17: "Drama",
  18: "Comedia",
  33: "Suspense",
  32: "Acción",
  520: "Animación",
  96: "Terror",
  180: "Crimen",
  130: "Aventura",
  398: "Familia",
  115: "Romance",
  97: "Misterio",
  131: "Ciencia ficción",
  229: "Fantasía",
  164: "Documental",
  165: "Historia",
  8: "Música",
  6787: "Película de TV",
  3056: "Bélica",
  674: "Western",
  703: "Kids"
};

const QUALITIES = {
  495: "Full HD",
  496: "Dual 1080p",
  88953: "HD 720p",
  58679: "BDRip",
  58681: "HDTV",
  59268: "Dual 720p",
  649: "HD",
  58683: "WEB-DL 720p",
  53691: "DVDRip",
  58678: "WEB-DL 1080p",
  88954: "4K Ultra HD",
  69831: "WEB-DL 4k",
  49673: "1080P",
  82756: "4K HDR"
};

const LANGS = {
  58651: "Latino",
  58652: "Inglés",
  58654: "Japonés",
  58655: "Subtitulado",
  58653: "Castellano",
  58667: "Coreano",
  58661: "Portugués"
};

const YEARS = {
  4: "2025",
  1461: "2022",
  2236: "2023",
  74006: "2026",
  2169: "2021",
  1354: "2024",
  2792: "2020",
  1816: "2019",
  1926: "2018",
  1874: "2017"
};

const COUNTRIES = {
  457: "Estados Unidos",
  774: "Reino Unido",
  787: "Canadá",
  617: "Francia",
  5436: "México",
  2499: "España",
  733: "Japón",
  4601: "Corea del Sur",
  1431: "Alemania",
  7746: "Argentina"
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      ...CORS,
      "Content-Type": "application/json; charset=utf-8"
    }
  });
}

function resolveIds(ids, mapping) {
  if (!ids) return [];

  if (!Array.isArray(ids)) {
    ids = [ids];
  }

  return ids
    .map(id => mapping[parseInt(id)] || String(id))
    .filter(Boolean);
}

function extraerAnio(titulo, releaseDate, years) {
  const texto = String(titulo || "");

  const match = texto.match(/\b((?:19|20)\d{2})\b/);

  if (match) {
    return match[1];
  }

  const yearArr = resolveIds(years, YEARS);

  if (yearArr.length) {
    return yearArr[0];
  }

  if (releaseDate) {
    return String(releaseDate).substring(0, 4);
  }

  return null;
}

function formatItem(p) {
  const images = p.images || {};

  let poster = images.poster || "";
  let backdrop = images.backdrop || "";

  if (poster && !poster.startsWith("http")) {
    poster = `${LAMOVIE}/wp-content/uploads${poster}`;
  }

  if (backdrop && !backdrop.startsWith("http")) {
    backdrop = `${LAMOVIE}/wp-content/uploads${backdrop}`;
  }

  const type = p.type || "";

  let tipo = "Película";
  let link = null;

  if (type === "movies") {
    tipo = "Película";
    link = `${LAMOVIE}/peliculas/${p.slug}/`;
  }

  if (type === "tvshows") {
    tipo = "Serie";
    link = `${LAMOVIE}/series/${p.slug}/`;
  }

  if (type === "animes") {
    tipo = "Anime";
    link = `${LAMOVIE}/animes/${p.slug}/`;
  }

  const nombre = p.title || "Sin título";

  return {
    id: p._id || null,
    postId: p._id || null,

    nombre,

    titulo_original:
      p.original_title ||
      null,

    slug:
      p.slug ||
      null,

    tipo,

    descripcion:
      p.overview ||
      "",

    portada:
      poster ||
      null,

    backdrop:
      backdrop ||
      null,

    year:
      extraerAnio(
        nombre,
        p.release_date,
        p.years
      ),

    genero:
      resolveIds(
        p.genres,
        GENRES
      ).join(", ") || null,

    idiomas:
      resolveIds(
        p.lang,
        LANGS
      ),

    calidad:
      resolveIds(
        p.quality,
        QUALITIES
      ),

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
      resolveIds(
        p.countries,
        COUNTRIES
      ),

    ultimo_episodio:
      p.latest_episode ||
      null,

    link,

    reproductor: null,

    embeds: [],

    downloads: [],

    soloTrailer: false,

    episodios: [],

    temporadas: []
  };
}

async function apiGet(url) {
  const response = await fetch(url, {
    headers: {
      "Accept": "application/json",
      "User-Agent":
        "Mozilla/5.0 (compatible; MovieZoneWorker/1.0)"
    }
  });

  if (!response.ok) {
    throw new Error(
      `LaMovie HTTP ${response.status}`
    );
  }

  return response.json();
}

async function listar(section, page, limit) {
  let postType = "movies";

  if (
    section === "series" ||
    section === "tvshows"
  ) {
    postType = "tvshows";
  }

  if (
    section === "anime" ||
    section === "animes"
  ) {
    postType = "animes";
  }

  const url =
    `${API}/listing/${postType}` +
    `?page=${page}` +
    `&orderBy=latest` +
    `&order=desc` +
    `&postType=${postType}` +
    `&postsPerPage=${limit}`;

  const data = await apiGet(url);

  const posts =
    data?.data?.posts || [];

  return posts.map(formatItem);
}

async function buscar(q, limit) {
  const url =
    `${API}/search` +
    `?postType=any` +
    `&q=${encodeURIComponent(q)}` +
    `&postsPerPage=${limit}`;

  const data = await apiGet(url);

  let posts =
    data?.data?.posts ||
    data?.data ||
    [];

  if (!Array.isArray(posts)) {
    posts = [];
  }

  return posts.map(formatItem);
}

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: CORS
      });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    try {

      // =========================
      // ROOT
      // =========================

      if (
        path === "/" ||
        path === "/health"
      ) {
        return json({
          status: "ok",
          service: "vimeos-resolver",
          source: "lamovie",
          sourceApi: API,
          endpoints: [
            "/movies",
            "/series",
            "/anime",
            "/search?q=texto",
            "/health"
          ]
        });
      }

      // =========================
      // MOVIES
      // =========================

      if (
        path === "/movies" ||
        path === "/api/catalogo"
      ) {
        const page = Math.max(
          1,
          parseInt(
            url.searchParams.get("page") || "1"
          )
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

        const resultados =
          await listar(
            "movies",
            page,
            limit
          );

        return json({
          resultados,
          total: resultados.length,
          page,
          limit,
          source: "lamovie"
        });
      }

      // =========================
      // SERIES
      // =========================

      if (
        path === "/series" ||
        path === "/api/series"
      ) {
        const page = Math.max(
          1,
          parseInt(
            url.searchParams.get("page") || "1"
          )
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

        const resultados =
          await listar(
            "series",
            page,
            limit
          );

        return json({
          resultados,
          total: resultados.length,
          page,
          limit,
          source: "lamovie"
        });
      }

      // =========================
      // ANIME
      // =========================

      if (
        path === "/anime" ||
        path === "/animes" ||
        path === "/api/animes"
      ) {
        const page = Math.max(
          1,
          parseInt(
            url.searchParams.get("page") || "1"
          )
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

        const resultados =
          await listar(
            "animes",
            page,
            limit
          );

        return json({
          resultados,
          total: resultados.length,
          page,
          limit,
          source: "lamovie"
        });
      }

      // =========================
      // SEARCH
      // =========================

      if (
        path === "/search" ||
        path === "/api/buscar"
      ) {
        const q =
          url.searchParams
            .get("q")
            ?.trim();

        if (!q) {
          return json({
            error: "Falta el parámetro q"
          }, 400);
        }

        const limit = Math.min(
          48,
          Math.max(
            1,
            parseInt(
              url.searchParams.get("limit") || "28"
            )
          )
        );

        const resultados =
          await buscar(q, limit);

        return json({
          resultados,
          total: resultados.length,
          page: 1,
          limit,
          source: "lamovie"
        });
      }

      return json({
        error: "Endpoint no encontrado",
        path
      }, 404);

    } catch (error) {

      return json({
        error: "Error consultando LaMovie",
        detalle: error.message
      }, 502);
    }
  }
};
