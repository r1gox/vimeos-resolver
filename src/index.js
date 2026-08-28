const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...CORS,
    },
  });
}

function decodeJsString(s) {
  return s
    .replace(/\\x([0-9a-fA-F]{2})/g, (_, h) =>
      String.fromCharCode(parseInt(h, 16))
    )
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) =>
      String.fromCharCode(parseInt(h, 16))
    )
    .replace(/\\'/g, "'")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\")
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t");
}

/*
 * Desofuscador del Packer de Dean Edwards.
 * No utiliza eval().
 */
function unpackPacker(code) {
  const marker = "eval(function(p,a,c,k,e,d)";

  const start = code.indexOf(marker);
  if (start === -1) return null;

  const section = code.slice(start);

  /*
   * Busca:
   *
   * }('payload',36,338,'word|word|word'.split('|')))
   */

  const re =
    /\}\(\s*'([\s\S]*?)'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*'([\s\S]*?)'\.split\('\|'\)\s*\)\)/;

  const match = section.match(re);

  if (!match) {
    return null;
  }

  const payload = decodeJsString(match[1]);
  const base = parseInt(match[2], 10);
  const count = parseInt(match[3], 10);
  const words = match[4].split("|");

  let result = payload;

  /*
   * Packer:
   *
   * while(c--)
   *   if(k[c])
   *      p=p.replace(new RegExp('\\b'+c.toString(a)+'\\b','g'),k[c])
   */

  for (let i = count - 1; i >= 0; i--) {
    const word = words[i];

    if (!word) continue;

    const token = i.toString(base);

    /*
     * Escape para RegExp.
     */
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    result = result.replace(
      new RegExp("\\b" + escaped + "\\b", "g"),
      word
    );
  }

  return result;
}

function findHls(text) {
  if (!text) return [];

  const found = [];

  /*
   * URLs HLS completas.
   */
  const urlRegex =
    /https?:\/\/[^\s"'<>\\]+?\.m3u8(?:\?[^\s"'<>\\]+)?/gi;

  for (const match of text.matchAll(urlRegex)) {
    let url = match[0];

    /*
     * Limpieza de escapes.
     */
    url = url
      .replace(/\\u0026/g, "&")
      .replace(/\\x26/g, "&")
      .replace(/\\&/g, "&");

    if (!found.includes(url)) {
      found.push(url);
    }
  }

  return found;
}

async function resolveVimeos(embedUrl) {
  const response = await fetch(embedUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/139 Safari/537.36",
      "Referer": "https://vimeos.net/",
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} obteniendo embed`);
  }

  const html = await response.text();

  /*
   * Primero buscamos directamente en HTML.
   */
  let hls = findHls(html);

  /*
   * Si no aparece, buscamos Packer.
   */
  if (hls.length === 0) {
    const decoded = unpackPacker(html);

    if (decoded) {
      hls = findHls(decoded);
    }
  }

  /*
   * Último intento:
   * algunos embeds contienen el Packer dentro de
   * una zona HTML que puede necesitar otra pasada.
   */
  if (hls.length === 0) {
    const packed = html.match(
      /eval\(function\(p,a,c,k,e,d\)[\s\S]*?\.split\('\|'\)\)\)/
    );

    if (packed) {
      const decoded = unpackPacker(packed[0]);

      if (decoded) {
        hls = findHls(decoded);
      }
    }
  }

  if (hls.length === 0) {
    throw new Error("No encontré una fuente HLS");
  }

  return {
    html,
    hls,
  };
}

async function getBestQuality(masterUrl) {
  const response = await fetch(masterUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      "Referer": "https://vimeos.net/",
    },
  });

  if (!response.ok) {
    throw new Error(`Master HTTP ${response.status}`);
  }

  const text = await response.text();

  const variants = [];

  /*
   * Capturamos:
   *
   * #EXT-X-STREAM-INF:...RESOLUTION=1280x720...
   * https://...m3u8
   */

  const regex =
    /#EXT-X-STREAM-INF:([^\n]*)\n([^\n]+)/g;

  for (const match of text.matchAll(regex)) {
    const info = match[1];
    const url = match[2].trim();

    const resolution = info.match(
      /RESOLUTION=(\d+)x(\d+)/i
    );

    const bandwidth = info.match(
      /BANDWIDTH=(\d+)/i
    );

    if (!resolution) continue;

    variants.push({
      width: parseInt(resolution[1], 10),
      height: parseInt(resolution[2], 10),
      bandwidth: bandwidth
        ? parseInt(bandwidth[1], 10)
        : 0,
      url,
    });
  }

  /*
   * Ordenamos de mayor a menor.
   */
  variants.sort((a, b) => {
    if (b.height !== a.height) {
      return b.height - a.height;
    }

    return b.bandwidth - a.bandwidth;
  });

  /*
   * Preferimos 720p.
   */
  let selected =
    variants.find(v => v.height === 720) ||
    variants.find(v => v.height < 720) ||
    variants[0];

  if (!selected) {
    return {
      quality: "unknown",
      resolution: null,
      url: masterUrl,
      variants: [],
    };
  }

  return {
    quality:
      selected.height >= 720
        ? "720p"
        : `${selected.height}p`,
    resolution:
      `${selected.width}x${selected.height}`,
    url: selected.url,
    variants,
  };
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

    if (url.pathname === "/" || url.pathname === "/health") {
      return json({
        success: true,
        service: "Vimeos Resolver",
        status: "online",
      });
    }

    if (url.pathname !== "/resolve") {
      return json({
        success: false,
        error: "Ruta no encontrada",
        usage:
          "/resolve?url=https://vimeos.net/embed-xxxxx.html",
      }, 404);
    }

    const embed = url.searchParams.get("url");

    if (!embed) {
      return json({
        success: false,
        error: "Falta el parámetro url",
      }, 400);
    }

    /*
     * Seguridad básica:
     * solamente permitimos embeds de Vimeos.
     */
    let parsed;

    try {
      parsed = new URL(embed);
    } catch {
      return json({
        success: false,
        error: "URL inválida",
      }, 400);
    }

    if (
      parsed.hostname !== "vimeos.net" &&
      !parsed.hostname.endsWith(".vimeos.net")
    ) {
      return json({
        success: false,
        error: "Dominio no permitido",
      }, 403);
    }

    try {
      console.log("Resolviendo:", embed);

      const result = await resolveVimeos(embed);

      /*
       * Puede haber más de un HLS.
       */
      const master = result.hls.find(u =>
        u.includes("master.m3u8")
      ) || result.hls[0];

      const quality = await getBestQuality(master);

      return json({
        success: true,
        source: embed,
        type: "hls",
        quality: quality.quality,
        resolution: quality.resolution,
        url: quality.url,
        master: master,
        variants: quality.variants,
      });

    } catch (error) {
      console.log("ERROR:", error);

      return json({
        success: false,
        source: embed,
        error: error.message || "Error resolviendo video",
      }, 500);
    }
  },
};
