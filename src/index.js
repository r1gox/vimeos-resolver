const CONFIG = {
  // Cambia esto por una API o fuente que tengas autorizada.
  API_BASE: "https://www.pelisplushd.la"
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // CORS
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: corsHeaders()
      });
    }

    // API
    if (url.pathname.startsWith("/api/")) {
      return handleAPI(request, url, env);
    }

    // Frontend
    return env.ASSETS.fetch(request);
  }
};


// ======================================================
// API ROUTER
// ======================================================

async function handleAPI(request, url, env) {

  try {

    // Estado
    if (url.pathname === "/api/status") {
      return json({
        success: true,
        service: "MovieZone Worker",
        status: "online"
      });
    }


    // ==================================================
    // CATÁLOGO
    // ==================================================

    if (url.pathname === "/api/catalogo") {

      const type = url.searchParams.get("type") || "all";
      const page = url.searchParams.get("page") || "1";

      const endpoint =
        `${CONFIG.API_BASE}/catalogo?type=${encodeURIComponent(type)}&page=${page}`;

      const data = await fetchJSON(endpoint);

      return json(data);
    }


    // ==================================================
    // PELÍCULAS
    // ==================================================

    if (url.pathname === "/api/peliculas") {

      const page = url.searchParams.get("page") || "1";

      const endpoint =
        `${CONFIG.API_BASE}/peliculas?page=${page}`;

      return json(await fetchJSON(endpoint));
    }


    // ==================================================
    // SERIES
    // ==================================================

    if (url.pathname === "/api/series") {

      const page = url.searchParams.get("page") || "1";

      const endpoint =
        `${CONFIG.API_BASE}/series?page=${page}`;

      return json(await fetchJSON(endpoint));
    }


    // ==================================================
    // ANIME
    // ==================================================

    if (url.pathname === "/api/anime") {

      const page = url.searchParams.get("page") || "1";

      const endpoint =
        `${CONFIG.API_BASE}/anime?page=${page}`;

      return json(await fetchJSON(endpoint));
    }


    // ==================================================
    // BUSCADOR
    // ==================================================

    if (url.pathname === "/api/buscar") {

      const q = url.searchParams.get("q");

      if (!q) {
        return json({
          success: false,
          error: "Falta ?q="
        }, 400);
      }

      const endpoint =
        `${CONFIG.API_BASE}/buscar?q=${encodeURIComponent(q)}`;

      return json(await fetchJSON(endpoint));
    }


    // ==================================================
    // DETALLE
    // ==================================================

    if (url.pathname === "/api/detalle") {

      const id = url.searchParams.get("id");

      if (!id) {
        return json({
          success: false,
          error: "Falta ?id="
        }, 400);
      }

      const endpoint =
        `${CONFIG.API_BASE}/detalle?id=${encodeURIComponent(id)}`;

      return json(await fetchJSON(endpoint));
    }


    // ==================================================
    // RESOLVER
    // ==================================================

    if (url.pathname === "/api/resolve") {

      const id = url.searchParams.get("id");

      if (!id) {
        return json({
          success: false,
          error: "Falta ?id="
        }, 400);
      }

      const endpoint =
        `${CONFIG.API_BASE}/resolve?id=${encodeURIComponent(id)}`;

      return json(await fetchJSON(endpoint));
    }


    return json({
      success: false,
      error: "Endpoint no encontrado"
    }, 404);

  } catch (error) {

    return json({
      success: false,
      error: error.message || "Error interno"
    }, 500);
  }
}


// ======================================================
// FETCH JSON
// ======================================================

async function fetchJSON(url) {

  const response = await fetch(url, {
    headers: {
      "Accept": "application/json"
    }
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return await response.json();
}


// ======================================================
// JSON RESPONSE
// ======================================================

function json(data, status = 200) {

  return new Response(
    JSON.stringify(data, null, 2),
    {
      status,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        ...corsHeaders()
      }
    }
  );
}


function corsHeaders() {

  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "*"
  };
}
