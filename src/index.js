const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS });
    }

    try {
      if (url.pathname === "/") {
        return json({
          status: "ok",
          service: "vimeos-resolver",
          version: "1.0.0",
          endpoints: [
            "/",
            "/health",
            "/movies",
            "/series",
            "/anime",
            "/search?q=texto",
          ],
        });
      }

      if (url.pathname === "/health") {
        return json({
          status: "ok",
          worker: "vimeos-resolver",
          time: new Date().toISOString(),
        });
      }

      if (url.pathname === "/movies") {
        return getCatalog(env, "movies");
      }

      if (url.pathname === "/series") {
        return getCatalog(env, "series");
      }

      if (url.pathname === "/anime") {
        return getCatalog(env, "anime");
      }

      if (url.pathname === "/search") {
        const q = url.searchParams.get("q")?.trim();

        if (!q) {
          return json({
            status: "error",
            message: "Falta el parámetro q",
          }, 400);
        }

        return searchCatalog(env, q);
      }

      return json({
        status: "error",
        message: "Endpoint no encontrado",
      }, 404);

    } catch (error) {
      return json({
        status: "error",
        message: error.message,
      }, 500);
    }
  },
};

async function getCatalog(env, type) {
  /*
   * Aquí se conecta la fuente autorizada de tu catálogo.
   *
   * Puedes definir, por ejemplo:
   *
   * MOVIES_API_URL
   * SERIES_API_URL
   * ANIME_API_URL
   */

  const key = {
    movies: "MOVIES_API_URL",
    series: "SERIES_API_URL",
    anime: "ANIME_API_URL",
  }[type];

  const endpoint = env[key];

  if (!endpoint) {
    return json({
      status: "ok",
      type,
      page: 1,
      results: [],
      total: 0,
      message: `Configura ${key} en las variables del Worker`,
    });
  }

  const response = await fetch(endpoint);

  if (!response.ok) {
    throw new Error(
      `La fuente respondió HTTP ${response.status}`
    );
  }

  const data = await response.json();

  return json({
    status: "ok",
    type,
    results: data.results ?? data,
  });
}

async function searchCatalog(env, query) {
  const endpoints = [
    env.MOVIES_API_URL,
    env.SERIES_API_URL,
    env.ANIME_API_URL,
  ].filter(Boolean);

  const results = [];

  for (const endpoint of endpoints) {
    try {
      const separator = endpoint.includes("?") ? "&" : "?";
      const response = await fetch(
        `${endpoint}${separator}q=${encodeURIComponent(query)}`
      );

      if (!response.ok) continue;

      const data = await response.json();
      const items = data.results ?? data;

      if (Array.isArray(items)) {
        results.push(...items);
      }
    } catch {
      // Continúa con la siguiente fuente
    }
  }

  return json({
    status: "ok",
    query,
    results,
    total: results.length,
  });
}

function json(data, status = 200) {
  return new Response(
    JSON.stringify(data, null, 2),
    {
      status,
      headers: {
        ...CORS,
        "Content-Type": "application/json; charset=utf-8",
      },
    }
  );
}
