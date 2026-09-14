// ======================================================
// MOVIEZONE — app.js (adaptado al template "Cypher")
// ======================================================

import { initWakeupNotice } from './js/ui/wakeup.js';
import { getCatalog, searchCatalog } from './js/data/catalogo.js';

// ===== Koi PC detail (inline) =====
/**
 * MovieZone — Modo detalle/player estilo Koiflix SOLO en PC
 * para series y animes. Usa los mismos datos que ya pinta app.js.
 * No cambia el flujo: solo clases CSS + relleno del hero.
 */

const KOI_MQ = window.matchMedia("(min-width: 1025px)");

function isKoiDesktop() {
  return (typeof window !== "undefined" && window.innerWidth >= 1025) || KOI_MQ.matches;
}

function isSerieOrAnime(item) {
  if (!item) return false;
  const t = String(item.tipo || item.type || "").toLowerCase();
  return /serie|anime|dorama|tv|ova|ona/.test(t);
}

/** Activa/desactiva el layout Koiflix en body */
function setKoiMode(item) {  
  const on = isKoiDesktop() && !!(item && (
    isSerieOrAnime(item) ||
    /pel[ií]cula|movie|film/i.test(String(item.tipo || item.type || ""))
  ));
  document.body.classList.toggle("koi-desktop", on);
  const esPeliMode = !!(item && /pel[ií]cula|movie|film/i.test(String(item.tipo || item.type || "")));
  document.body.classList.toggle("koi-movie", on && esPeliMode);
  const hero = document.getElementById("koi-hero");
  if (hero) hero.setAttribute("aria-hidden", on ? "false" : "true");
  const h4 = document.querySelector("#seasons-section > h4");
  if (h4) {
    if (esPeliMode) h4.textContent = "Reproductores";
    else h4.textContent = on ? "Episodios" : "Temporadas y Capítulos";
  }
  const serversTitle = document.getElementById("servers-section-title");
  if (serversTitle) serversTitle.textContent = "Reproductores";
  // Series/animes en detalle: NUNCA mostrar bloque Reproductores
  try {
    const ss = document.getElementById("servers-section");
    const ds = document.getElementById("downloads-section");
    const tg = document.getElementById("mz-servers-toggle");
    if (on && !esPeliMode && !document.body.classList.contains("player-open")) {
      if (ss) ss.classList.add("hidden");
      if (ds) ds.classList.add("hidden");
      if (tg) tg.remove();
    }
  } catch (_) {}
  try { bindKoiBackBtn(); } catch (_) {}
  return on;
}

function mzScrollPanelTo(el) {
  if (!el) return;
  try {
    const body =
      document.querySelector("#details-panel .details-content") ||
      document.querySelector("#details-panel .details-body") ||
      document.getElementById("details-panel");
    if (body && body.scrollHeight > body.clientHeight + 20) {
      const top =
        el.getBoundingClientRect().top -
        body.getBoundingClientRect().top +
        body.scrollTop -
        20;
      body.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
    } else {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  } catch (_) {
    try { el.scrollIntoView({ behavior: "smooth", block: "start" }); } catch (__) {}
  }
}

function clearKoiMode() {
  document.body.classList.remove("koi-desktop", "koi-movie", "player-open");
  const hero = document.getElementById("koi-hero");
  if (hero) hero.setAttribute("aria-hidden", "true");
  const h4 = document.querySelector("#seasons-section > h4");
  if (h4) h4.textContent = "Temporadas y Capítulos";
}


function bindKoiBackBtn() {
  const btn = document.getElementById("koi-btn-back");
  if (!btn || btn.dataset.koiBound) return;
  btn.dataset.koiBound = "1";
  btn.addEventListener("click", () => {
    // Si está en player → volver al detalle (hero + episodios)
    if (document.body.classList.contains("player-open")) {
      document.body.classList.remove("player-open");
      try {
        const iframe = document.getElementById("player-iframe");
        if (iframe) iframe.src = "about:blank";
        document.getElementById("video-player-container")?.classList.add("hidden");
        document.getElementById("servers-section")?.classList.add("hidden");
        setKoiPlayerEpisodeTitle("");
      } catch (_) {}
      // Scroll al hero / episodios
      try {
        document.getElementById("koi-hero")?.scrollIntoView({ behavior: "smooth", block: "start" });
      } catch (_) {}
      return;
    }
    // Si está en detalle → cerrar panel
    try { cerrarDetalle(); } catch (_) {}
  });
}

function firstEpisodeLabel(item) {
  const eps = item?.episodios || item?.episodes || [];
  if (Array.isArray(eps) && eps.length) {
    const n = Number(eps[0].episode || eps[0].episodio || eps[0].episode_number || 1) || 1;
    return `COMENZAR A VER E${n}`;
  }
  return "COMENZAR A VER E1";
}

function genresText(item) {
  let lista = [];
  if (Array.isArray(item.generos) && item.generos.length) {
    lista = item.generos.map((g) => String(g).trim()).filter(Boolean);
  } else if (item.genero) {
    lista = String(item.genero).split(",").map((g) => g.trim()).filter(Boolean);
  }
  return lista.slice(0, 6).join(", ");
}

function langLabel(item) {
  const l = item.idioma || item.audio || item.language || "";
  if (/jap|jpn|ja/i.test(String(l))) return "Japonés";
  if (/lat|es-la|latino/i.test(String(l))) return "Latino";
  if (/cast|es-es|español/i.test(String(l))) return "Castellano";
  if (/en|ingl/i.test(String(l))) return "Inglés";
  if (/anime/i.test(String(item.tipo || ""))) return "Japonés";
  return l || "Español";
}

/**
 * Rellena el hero Koiflix con los datos del item actual.
 * Llamar después de pintar el detalle normal.
 */
function fillKoiHero(item) {
    if (!item || !isKoiDesktop()) return;
    const esPeli = /pel[ií]cula|movie|film/i.test(String(item.tipo || item.type || ""));
    const esSA = isSerieOrAnime(item);
    if (!esPeli && !esSA) return;

  const bg =
    item.backdrop ||
    item.fondo ||
    item.banner ||
    item.portada_imdb ||
    item.portada ||
    item.poster ||
    "";

  const hero = document.getElementById("koi-hero");
  if (hero) {
    if (bg) {
      hero.style.backgroundImage = `url("${bg}")`;
      hero.classList.remove("no-bg");
    } else {
      hero.style.backgroundImage = "";
      hero.classList.add("no-bg");
    }
  }

  const logoEl = document.getElementById("koi-hero-logo");
  const titleEl = document.getElementById("koi-hero-title");
  const logoUrl = item.logo || item.logo_url || (document.getElementById("details-logo")?.src) || "";

  if (logoEl && logoUrl && !/placeholder|via\.placeholder/i.test(logoUrl)) {
    logoEl.src = logoUrl;
    logoEl.alt = item.nombre || item.titulo || "";
    logoEl.classList.remove("hidden");
    if (titleEl) titleEl.classList.add("hidden");
  } else {
    if (logoEl) {
      logoEl.src = "";
      logoEl.classList.add("hidden");
    }
    if (titleEl) {
      titleEl.textContent = item.nombre || item.titulo || "Sin título";
      titleEl.classList.remove("hidden");
    }
  }


  // Título original debajo del título/logo
  let origHero = document.getElementById("koi-hero-original");
  if (!origHero) {
    origHero = document.createElement("p");
    origHero.id = "koi-hero-original";
    origHero.className = "koi-hero-original";
    const titleEl2 = document.getElementById("koi-hero-title");
    const metaAnchor = document.getElementById("koi-hero-meta");
    if (metaAnchor && metaAnchor.parentNode) {
      metaAnchor.parentNode.insertBefore(origHero, metaAnchor);
    } else if (titleEl2 && titleEl2.parentNode) {
      titleEl2.parentNode.insertBefore(origHero, titleEl2.nextSibling);
    }
  }
  const mainT = String(item.nombre || item.titulo || "").trim();
  const origT = String(item.titulo_original || (item.tmdb && item.tmdb.titulo) || "").trim();
  if (origT && origT.toLowerCase() !== mainT.toLowerCase()) {
    origHero.textContent = origT;
    origHero.classList.remove("hidden");
    origHero.style.display = "";
  } else {
    origHero.textContent = "";
    origHero.classList.add("hidden");
    origHero.style.display = "none";
  }

  const metaEl = document.getElementById("koi-hero-meta");
  if (metaEl) {
    const bits = [];
    const push = (html) => {
      if (bits.length) bits.push('<span class="koi-meta-sep">•</span>');
      bits.push(html);
    };

    // Idioma
    if (typeof langLabel === "function") {
      const lang = langLabel(item);
      if (lang) push('<span class="koi-meta-lang">' + lang + "</span>");
    }

    // Año
    const year = item.year || item.anio || (item.fecha_estreno ? String(item.fecha_estreno).slice(0, 4) : "");
    if (year) push("<span>" + year + "</span>");

    // Fecha estreno dd/mm/yyyy
    if (item.fecha_estreno) {
      const f = String(item.fecha_estreno).slice(0, 10);
      let releaseLabel = null;
      if (/^\d{4}-\d{2}-\d{2}$/.test(f)) {
        const [yy, mm, dd] = f.split("-");
        releaseLabel = dd + "/" + mm + "/" + yy;
      } else if (f && f !== String(year)) {
        releaseLabel = f;
      }
      if (releaseLabel) push("<span>" + releaseLabel + "</span>");
    }

    // IMDb rating
    let scoreLabel = "";
    if (typeof ratingInfo === "function") {
      const r = ratingInfo(item);
      if (r && r.value) scoreLabel = r.label;
    } else if (item.imdb && item.imdb.rating) {
      scoreLabel = Number(item.imdb.rating).toFixed(1);
    } else if (item.calificacion != null && item.calificacion !== "") {
      scoreLabel = Number(item.calificacion).toFixed(1);
    } else if (item.rating != null && item.rating !== "") {
      scoreLabel = Number(item.rating).toFixed(1);
    }
    if (scoreLabel && !isNaN(Number(scoreLabel))) {
      push(
        '<span class="koi-imdb-inline" title="IMDb ' + scoreLabel + '">' +
          '<span class="koi-imdb-score">' + scoreLabel + "</span>" +
          '<span class="koi-imdb-tag">IMDb</span></span>'
      );
    }

    // Duración
    let durTxt = item.duracion_texto || null;
    if (!durTxt && item.imdb && item.imdb.duracion_texto) durTxt = item.imdb.duracion_texto;
    if (!durTxt && item.tmdb && item.tmdb.duracion_texto) durTxt = item.tmdb.duracion_texto;
    if (!durTxt && item.duracion) {
      const m = Number(item.duracion);
      if (m >= 60) {
        const h = Math.floor(m / 60);
        const mins = m % 60;
        durTxt = mins ? h + "h " + mins + "min" : h + "h";
      } else if (m > 0) durTxt = m + " min";
    }
    if (durTxt) push("<span>" + durTxt + "</span>");

    // Certificación (B15, TV-14, R…)
    const cert = item.certificacion || (item.imdb && item.imdb.certificacion) || null;
    if (cert) push("<span>" + String(cert) + "</span>");

    // Estado: En emisión / Finalizado
    let statusLabel = null;
    if (item.finalizado === true || /final|ended|complet/i.test(String(item.estado || ""))) {
      statusLabel = "Finalizado";
    } else if (
      item.en_emision === true ||
      /emisi[oó]n|airing|ongoing|returning/i.test(String(item.estado || ""))
    ) {
      statusLabel = "En emisión";
    } else if (item.estado) {
      statusLabel = String(item.estado);
    }
    if (statusLabel) {
      push(
        '<span class="koi-meta-status' +
          (/emis/i.test(statusLabel) ? " koi-meta-air" : " koi-meta-end") +
          '">' +
          statusLabel +
          "</span>"
      );
    }

    // Votos
    const votos = item.votos || (item.imdb && item.imdb.votos) || null;
    if (votos) push("<span>" + String(votos) + " votos</span>");

    // Géneros
    const gens = typeof genresText === "function" ? genresText(item) : (item.genero || "");
    if (gens) push("<span>" + gens + "</span>");

    metaEl.innerHTML = bits.join("");
  }


  const synEl = document.getElementById("koi-hero-synopsis");
  const toggleBtn = document.getElementById("koi-toggle-details");
  const fullSyn =
    (item.descripcion && String(item.descripcion).trim()) ||
    document.getElementById("details-synopsis")?.textContent ||
    "";
  if (synEl) {
    synEl.textContent = fullSyn;
    synEl.dataset.full = fullSyn;
    // Si es larga, clamp + botón MÁS DETALLES
    if (fullSyn.length > 220) {
      synEl.classList.add("koi-syn-clamp");
      synEl.classList.remove("koi-syn-open");
      if (toggleBtn) {
        toggleBtn.classList.remove("hidden");
        toggleBtn.textContent = "MÁS DETALLES";
      }
    } else {
      synEl.classList.remove("koi-syn-clamp", "koi-syn-open");
      if (toggleBtn) toggleBtn.classList.add("hidden");
    }
  }

  const playText = document.getElementById("koi-btn-play-text");
  if (playText) {
    const esPeli = /pel[ií]cula|movie|film/i.test(String(item.tipo || item.type || ""));
    playText.textContent = esPeli ? "REPRODUCIR" : firstEpisodeLabel(item);
  }

}

/** Actualiza título de episodio en layout player PC */
function setKoiPlayerEpisodeTitle(label) {
  const el = document.getElementById("koi-player-ep-title");
  if (el) el.textContent = label || "";
}

/** Marca player abierto / cerrado para CSS */
function setKoiPlayerOpen(on) {
  document.body.classList.toggle("player-open", !!on);
}

/** Enlaza botones del hero (una sola vez) */
function bindKoiHeroControls(handlers = {}) {
  const playBtn = document.getElementById("koi-btn-play");
  const bookmarkBtn = document.getElementById("koi-btn-bookmark");

  if (playBtn && !playBtn.dataset.koiBound) {
    playBtn.dataset.koiBound = "1";
    playBtn.addEventListener("click", () => {
      if (typeof handlers.onPlay === "function") handlers.onPlay();
      else {
        const first =
          document.querySelector("#episodes-container [data-ep]") ||
          document.querySelector("#episodes-container button") ||
          document.querySelector("#episodes-container > *");
        first?.click?.();
      }
    });
  }

  if (bookmarkBtn && !bookmarkBtn.dataset.koiBound) {
    bookmarkBtn.dataset.koiBound = "1";
    bookmarkBtn.addEventListener("click", () => {
      const fav = document.getElementById("btn-favorito");
      if (fav) fav.click();
      else if (typeof handlers.onBookmark === "function") handlers.onBookmark();
    });
  }

  const toggleBtn = document.getElementById("koi-toggle-details");
  if (toggleBtn && !toggleBtn.dataset.koiBound) {
    toggleBtn.dataset.koiBound = "1";
    toggleBtn.addEventListener("click", () => {
      const synEl = document.getElementById("koi-hero-synopsis");
      if (!synEl) return;
      const open = synEl.classList.toggle("koi-syn-open");
      if (open) synEl.classList.remove("koi-syn-clamp");
      else synEl.classList.add("koi-syn-clamp");
      toggleBtn.textContent = open ? "MENOS DETALLES" : "MÁS DETALLES";
    });
  }
}

// ===== fin Koi =====

const LIMIT = 48;

// ======================================================
// PERFILES · HOME PREMIUM · BADGES · NOTIFY · ORDEN EPS
// ======================================================
const MZ_PROFILES_KEY = "mz_profiles_v1";
const MZ_ACTIVE_PROFILE = "mz_active_profile";
const MZ_ONBOARDED = "mz_onboarded_v1";

function defaultProfiles() {
  return [];
}
function getProfiles() {
  try {
    const raw = JSON.parse(localStorage.getItem(MZ_PROFILES_KEY) || "null");
    if (Array.isArray(raw)) return raw;
  } catch (_) {}
  return [];
}
function saveProfiles(list) {
  localStorage.setItem(MZ_PROFILES_KEY, JSON.stringify(list));
}
function getActiveProfile() {
  const list = getProfiles();
  const id = localStorage.getItem(MZ_ACTIVE_PROFILE);
  return list.find((p) => p.id === id) || list[0] || null;
}
function setActiveProfile(id) {
  if (!id) return;
  localStorage.setItem(MZ_ACTIVE_PROFILE, id);
  localStorage.setItem(MZ_ONBOARDED, "1");
  try { hideProfileGate(); } catch (_) {}
  // Evitar que el formulario quede abierto y el gate reaparezca
  try {
    const form = document.getElementById("mz-create-form");
    if (form) {
      form.classList.add("hidden");
      form.classList.remove("mz-create-open");
      form.reset?.();
    }
    document.getElementById("mz-profile-list")?.classList.remove("mz-dimmed");
  } catch (_) {}
  // Recarga limpia para aplicar pk() de favoritos/lista del perfil
  location.replace(location.pathname + location.search + location.hash);
}
function pk(key) {
  const p = getActiveProfile();
  return `mz_${p ? p.id : "guest"}_${key}`;
}
function uid() {
  return "p_" + Math.random().toString(36).slice(2, 9);
}
const PROFILE_COLORS = ["#7c3aed", "#22c55e", "#e50914", "#0ea5e9", "#f59e0b", "#ec4899"];

function showProfileGate(mode) {
  // mode: "pick" | "first"
  const gate = document.getElementById("mz-profile-gate");
  if (!gate) return;
  gate.classList.remove("hidden");
  gate.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";

  const title = document.getElementById("mz-gate-title");
  const sub = document.getElementById("mz-gate-sub");
  const listEl = document.getElementById("mz-profile-list");
  const form = document.getElementById("mz-create-form");
  if (form) form.classList.add("hidden");

  const profiles = getProfiles();
  if (title) title.textContent = "¿Quién está viendo?";
  if (sub) {
    sub.textContent = profiles.length
      ? "Selecciona un perfil para continuar"
      : "Crea un perfil para personalizar tu experiencia";
  }

  if (listEl) {
    listEl.innerHTML = "";
    profiles.forEach((p) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "mz-profile-card";
      const letter = (p.nombre || "?")[0].toUpperCase();
      const kids = p.tipo === "kids" ? '<span class="mz-kids-tag">Niños</span>' : "";
      btn.innerHTML = `<div class="av" style="background:${p.color || "#7c3aed"}">${letter}</div><span class="mz-profile-label">${p.nombre || "Perfil"}</span>${kids}`;
      btn.onclick = () => setActiveProfile(p.id);
      listEl.appendChild(btn);
    });
    if (profiles.length < 5) {
      const add = document.createElement("button");
      add.type = "button";
      add.className = "mz-profile-card mz-profile-add";
      add.innerHTML = `<div class="av av-add"><ion-icon name="add-outline"></ion-icon></div><span class="mz-profile-label">Agregar perfil</span>`;
      add.onclick = () => document.getElementById("mz-btn-create")?.click();
      listEl.appendChild(add);
    }
  }
}

function hideProfileGate() {
  const gate = document.getElementById("mz-profile-gate");
  if (!gate) return;
  gate.classList.add("hidden");
  gate.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
}

function ensureProfileAccess() {
  const profiles = getProfiles();
  const active = getActiveProfile();
  const onboarded = localStorage.getItem(MZ_ONBOARDED) === "1";

  // Primera visita o sin perfil activo → gate
  if (!profiles.length) {
    showProfileGate("first");
    return false;
  }
  if (!active) {
    // Hay perfiles pero ninguno activo → elegir, no forzar crear
    showProfileGate("pick");
    return false;
  }
  if (!onboarded) {
    localStorage.setItem(MZ_ONBOARDED, "1");
  }
  return true;
}

function initProfilesUi() {
  const chip = document.getElementById("mz-profile-chip");
  const nameEl = document.getElementById("mz-profile-name");
  const avEl = document.getElementById("mz-profile-avatar");

  const ok = ensureProfileAccess();
  const p = getActiveProfile();

  if (p) {
    if (nameEl) nameEl.textContent = p.nombre || "Perfil";
    if (avEl) {
      avEl.textContent = (p.nombre || "?")[0].toUpperCase();
      avEl.style.background = p.color || "#7c3aed";
    }
    if (chip) chip.style.borderColor = p.color || "#7c3aed";
  }

  if (chip) {
    chip.onclick = () => showProfileGate("pick");
  }

  const btnGuest = document.getElementById("mz-btn-guest");
  const btnCreate = document.getElementById("mz-btn-create");
  const form = document.getElementById("mz-create-form");
  const cancel = document.getElementById("mz-create-cancel");

  if (btnGuest) {
    btnGuest.onclick = () => {
      let list = getProfiles();
      let guest = list.find((x) => x.tipo === "guest");
      if (!guest) {
        guest = { id: "guest", nombre: "Invitado", tipo: "guest", color: "#64748b" };
        list = list.concat([guest]);
        saveProfiles(list);
      }
      setActiveProfile(guest.id);
    };
  }
  if (btnCreate) {
    btnCreate.onclick = () => {
      if (form) {
        form.classList.remove("hidden");
        form.classList.add("mz-create-open");
      }
      document.getElementById("mz-profile-list")?.classList.add("mz-dimmed");
      document.getElementById("mz-create-name")?.focus();
      const prev = document.getElementById("mz-create-preview");
      const inp = document.getElementById("mz-create-name");
      if (inp && prev && !inp._mzBound) {
        inp._mzBound = true;
        inp.addEventListener("input", () => {
          const v = (inp.value || "?").trim();
          prev.textContent = (v[0] || "?").toUpperCase();
        });
      }
    };
  }
  if (cancel) {
    cancel.onclick = () => {
      form?.classList.add("hidden");
      form?.classList.remove("mz-create-open");
      document.getElementById("mz-profile-list")?.classList.remove("mz-dimmed");
    };
  }
  if (form) {
    form.onsubmit = (e) => {
      e.preventDefault();
      const input = document.getElementById("mz-create-name");
      const nombre = (input?.value || "").trim().slice(0, 18);
      if (!nombre) return;
      const kids = !!document.getElementById("mz-create-kids")?.checked;
      const list = getProfiles();
      const color = kids ? "#22c55e" : PROFILE_COLORS[list.length % PROFILE_COLORS.length];
      const neu = { id: uid(), nombre, tipo: kids ? "kids" : "adult", color };
      list.push(neu);
      saveProfiles(list);
      // Confirmar que el perfil quedó guardado antes de activar
      const ok = getProfiles().some((p) => p.id === neu.id);
      if (!ok) {
        saveProfiles(list);
      }
      setActiveProfile(neu.id);
    };
  }

  return ok;
}

function badgesHtml(item) {
  const bits = [];
  const airing =
    item.en_emision === true ||
    (item.finalizado !== true && /emisi|airing|en curso|ongoing|returning/i.test(String(item.estado || "")));
  if (airing) {
    bits.push(`<span class="mz-badge mz-badge-air">En emisión</span>`);
  }
  if (item._trendingRank && item._trendingRank <= 10) {
    bits.push(`<span class="mz-badge mz-badge-top">Top ${item._trendingRank}</span>`);
  }
  if (/4k|2160|uhd/i.test(String(item.calidad || item.quality || ""))) {
    bits.push(`<span class="mz-badge mz-badge-4k">4K</span>`);
  }
  if (!bits.length) return "";
  return `<div class="mz-badges">${bits.join("")}</div>`;
}

function obtenerMiLista() {
  try { return JSON.parse(localStorage.getItem(pk("mi_lista")) || "[]"); }
  catch { return []; }
}
function guardarMiLista(lista) {
  localStorage.setItem(pk("mi_lista"), JSON.stringify(lista || []));
}
function toggleMiLista(item) {
  let lista = obtenerMiLista();
  const i = lista.findIndex((x) => x.link === item.link);
  if (i >= 0) lista.splice(i, 1);
  else lista.unshift(item);
  guardarMiLista(lista);
  return i < 0;
}
function cargarMiLista() {
  const row = document.getElementById("row-mi-lista");
  const cont = document.getElementById("carousel-mi-lista");
  if (!row || !cont) return;
  const lista = obtenerMiLista().slice(0, 12);
  if (!lista.length) { row.classList.add("hidden"); return; }
  row.classList.remove("hidden");
  cont.innerHTML = "";
  lista.forEach((item) => cont.appendChild(crearMediaCard(item)));
}

function porqueViste(ultimo, catalogo) {
  if (!ultimo || !Array.isArray(catalogo)) return [];
  const gens = (ultimo.generos || (ultimo.genero ? String(ultimo.genero).split(",") : []))
    .map((g) => String(g).toLowerCase().trim()).filter(Boolean);
  const tipo = ultimo.tipo;
  return catalogo
    .filter((x) => x && x.link && x.link !== ultimo.link && (!tipo || x.tipo === tipo))
    .map((x) => {
      const g2 = (x.generos || (x.genero ? String(x.genero).split(",") : []))
        .map((g) => String(g).toLowerCase().trim());
      const score = gens.filter((g) => g2.includes(g)).length;
      return { x, score };
    })
    .filter((t) => t.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 12)
    .map((t) => t.x);
}

function cargarPorqueViste() {
  const row = document.getElementById("row-porque");
  const cont = document.getElementById("carousel-porque");
  const titulo = document.getElementById("titulo-porque");
  if (!row || !cont) return;
  const prog = typeof obtenerProgreso === "function" ? obtenerProgreso() : {};
  const ultimo = Object.values(prog || {})
    .filter((x) => x && x.link)
    .sort((a, b) => (b.updated || 0) - (a.updated || 0))[0];
  if (!ultimo) { row.classList.add("hidden"); return; }
  const pool = []
    .concat(window.__mzLastPelis || [])
    .concat(window.__mzLastSeries || [])
    .concat(window.__mzLastAnime || []);
  const lista = porqueViste(ultimo, pool);
  if (!lista.length) { row.classList.add("hidden"); return; }
  if (titulo) titulo.textContent = `Porque viste ${ultimo.nombre || ultimo.titulo || "esto"}`;
  row.classList.remove("hidden");
  cont.innerHTML = "";
  lista.forEach((item) => cont.appendChild(crearMediaCard(item)));
}

function filtrarMood(items, moodId) {
  const list = (items || []).filter(Boolean);
  if (moodId === "maraton") {
    return list.filter((i) => /comedia|acción|accion|aventura|anime/i.test(
      `${i.genero || ""} ${(i.generos || []).join(" ")} ${i.tipo || ""}`
    )).slice(0, 12);
  }
  if (moodId === "terror") {
    return list.filter((i) => /terror|horror|suspenso|thriller/i.test(
      `${i.genero || ""} ${(i.generos || []).join(" ")}`
    )).slice(0, 12);
  }
  return list.slice(0, 12);
}

function cargarMoodsHome(peliculas, series, anime) {
  window.__mzLastPelis = peliculas || [];
  window.__mzLastSeries = series || [];
  window.__mzLastAnime = anime || [];
  const pool = [].concat(peliculas || [], series || [], anime || []);
  const map = [
    ["row-mood-maraton", "carousel-mood-maraton", "maraton"],
    ["row-mood-terror", "carousel-mood-terror", "terror"],
  ];
  map.forEach(([rowId, carId, mood]) => {
    const row = document.getElementById(rowId);
    const cont = document.getElementById(carId);
    if (!row || !cont) return;
    const lista = filtrarMood(pool, mood);
    if (!lista.length) { row.classList.add("hidden"); return; }
    row.classList.remove("hidden");
    cont.innerHTML = "";
    lista.forEach((item) => cont.appendChild(crearMediaCard(item)));
  });
}

// --- Orden Airing / Absolute ---
let _epOrderMode = "airing";
function getEpOrderMode() {
  try { return localStorage.getItem(pk("ep_order")) || "airing"; }
  catch { return "airing"; }
}
function setEpOrderMode(mode) {
  _epOrderMode = mode === "absolute" ? "absolute" : "airing";
  localStorage.setItem(pk("ep_order"), _epOrderMode);
  document.querySelectorAll(".mz-ep-order-btn").forEach((b) => {
    b.classList.toggle("active", b.getAttribute("data-order") === _epOrderMode);
  });
}
function ordenarEpisodiosParaUI(item, lista) {
  const eps = (lista || []).slice();
  const mode = getEpOrderMode();
  const forceAbs = (parseInt(item?.total_episodios || item?.totalEpisodios || 0, 10) || 0) > 50;
  if (mode === "absolute" || forceAbs) {
    return eps.sort((a, b) =>
      Number(a.episode || a.episodio || a.episode_number || 0) -
      Number(b.episode || b.episodio || b.episode_number || 0)
    );
  }
  return eps.sort((a, b) => {
    const sa = Number(a.season || a.temporada || 1);
    const sb = Number(b.season || b.temporada || 1);
    if (sa !== sb) return sa - sb;
    return Number(a.episode || a.episodio || a.episode_number || 0) -
           Number(b.episode || b.episodio || b.episode_number || 0);
  });
}
function initEpOrderUi(item) {
  const wrap = document.getElementById("mz-ep-order");
  if (!wrap) return;
  _epOrderMode = getEpOrderMode();
  wrap.querySelectorAll(".mz-ep-order-btn").forEach((b) => {
    b.classList.toggle("active", b.getAttribute("data-order") === _epOrderMode);
    b.onclick = () => {
      setEpOrderMode(b.getAttribute("data-order"));
      const season = item?._seasonActiva || 1;
      if (item) renderEpisodios(item, season);
    };
  });
}

// --- Notificar nuevo capítulo ---
function obtenerNotifyMap() {
  try { return JSON.parse(localStorage.getItem(pk("notify_series")) || "{}"); }
  catch { return {}; }
}
function guardarNotifyMap(map) {
  localStorage.setItem(pk("notify_series"), JSON.stringify(map || {}));
}
function notifyKey(item) {
  return String(item.slug || item.link || item.nombre || "").slice(0, 180);
}
function esNotifyActivo(item) {
  const k = notifyKey(item);
  return !!(obtenerNotifyMap()[k]);
}
function toggleNotifySerie(item) {
  const map = obtenerNotifyMap();
  const k = notifyKey(item);
  if (map[k]) delete map[k];
  else {
    map[k] = {
      titulo: item.nombre || item.titulo || k,
      lastEp: 0,
      updated: Date.now(),
    };
  }
  guardarNotifyMap(map);
  actualizarBotonNotify(item);
  return !!map[k];
}
function actualizarBotonNotify(item) {
  const btn = document.getElementById("btn-notify-ep");
  const icon = document.getElementById("btn-notify-ep-icon");
  if (!btn) return;
  const on = item && esNotifyActivo(item);
  btn.classList.toggle("active", !!on);
  if (icon) icon.setAttribute("name", on ? "notifications" : "notifications-outline");
}
function maxEpDeItem(item) {
  const eps = item?.episodios || [];
  let m = 0;
  eps.forEach((e) => {
    const n = Number(e.episode || e.episodio || e.episode_number || 0);
    if (n > m) m = n;
  });
  return m;
}
function checkNuevoCapitulo(item) {
  if (!item || !esNotifyActivo(item)) return;
  const map = obtenerNotifyMap();
  const k = notifyKey(item);
  const entry = map[k];
  if (!entry) return;
  const maxEp = maxEpDeItem(item);
  if (maxEp > (entry.lastEp || 0)) {
    const prev = entry.lastEp || 0;
    entry.lastEp = maxEp;
    entry.updated = Date.now();
    map[k] = entry;
    guardarNotifyMap(map);
    if (prev > 0) {
      const msg = `Nuevo capítulo: ${entry.titulo} · E${maxEp}`;
      try {
        if (Notification.permission === "granted") new Notification("MovieZone", { body: msg });
        else alert(msg);
      } catch (_) {
        alert(msg);
      }
    } else {
      entry.lastEp = maxEp;
      guardarNotifyMap(map);
    }
  }
}
function initNotifyBtn() {
  const btn = document.getElementById("btn-notify-ep");
  if (!btn || btn.dataset.bound === "1") return;
  btn.dataset.bound = "1";
  btn.addEventListener("click", async () => {
    if (!seleccionActual) return;
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      try { await Notification.requestPermission(); } catch (_) {}
    }
    const on = toggleNotifySerie(seleccionActual);
    if (on) {
      const map = obtenerNotifyMap();
      const k = notifyKey(seleccionActual);
      if (map[k]) {
        map[k].lastEp = maxEpDeItem(seleccionActual);
        guardarNotifyMap(map);
      }
    }
  });
}


// Estado de paginación
let gridTotalItems = 0;
let gridTotalPages = 1;

const PLACEHOLDER = "https://via.placeholder.com/300x450/0a0611/ffffff?text=Sin+portada";

// ---------- Elementos ----------
const homeView = document.getElementById("home-view");
const gridView = document.getElementById("grid-view");
const detailsPanel = document.getElementById("details-panel");
const detailsEmpty = document.getElementById("details-empty");
const detailsContent = document.getElementById("details-content");

const searchInput = document.getElementById("search-input");
const searchForm = document.getElementById("search-form");
const statusBadge = document.getElementById("status-badge");


/** Rating con fuente: "IMDb 6.7" / "TMDB 8.8" */
function ratingInfo(item) {
    if (!item) return { label: "—", value: null, source: null, secondary: null };

    const imdbR = item.imdb && item.imdb.rating != null ? Number(item.imdb.rating) : null;
    const tmdbR = item.tmdb && item.tmdb.rating != null ? Number(item.tmdb.rating) : null;
    const omdbR = item.omdb && item.omdb.rating != null ? Number(item.omdb.rating) : null;
    const mainRaw = item.rating != null ? item.rating : (item.calificacion != null ? item.calificacion : null);
    const main = mainRaw != null ? Number(mainRaw) : null;
    const hasImdbId = !!(item.imdb_id || (item.imdb && (item.imdb.id || item.imdb.imdb_id)));
    const srcApi = String(item.rating_source || "").toLowerCase();

    let primary;

    // Prioridad: rating_source imdb de la API (ej. rating: 3.9, rating_source: "imdb")
    if (srcApi === "imdb" && main != null && !isNaN(main) && main > 0) {
      primary = { label: main.toFixed(1), value: main, source: "imdb" };
    } else if (imdbR != null && !isNaN(imdbR) && imdbR > 0) {
      primary = { label: imdbR.toFixed(1), value: imdbR, source: "imdb" };
    } else if (omdbR != null && !isNaN(omdbR) && omdbR > 0) {
      primary = { label: omdbR.toFixed(1), value: omdbR, source: "omdb" };
    } else if (hasImdbId && main != null && !isNaN(main) && main > 0 && main <= 10) {
      primary = { label: main.toFixed(1), value: main, source: "imdb" };
    } else if (srcApi === "tmdb" && main != null && !isNaN(main) && main > 0) {
      primary = { label: main.toFixed(1), value: main, source: "tmdb" };
    } else if (tmdbR != null && !isNaN(tmdbR) && tmdbR > 0) {
      primary = { label: tmdbR.toFixed(1), value: tmdbR, source: "tmdb" };
    } else if (main != null && !isNaN(main) && main > 0) {
      primary = { label: main.toFixed(1), value: main, source: "fuente" };
    } else {
      primary = { label: "—", value: null, source: null };
    }

    return Object.assign({ secondary: null }, primary);
}

function ratingBadgeHtml(item) {
    const r = ratingInfo(item);
    if (!r.value) {
        return '<div class="rating-badge rating-empty" title="Sin rating"><span class="rating-main">—</span></div>';
    }
    const srcClass = r.source ? (" rating-src-" + r.source) : "";
    const title = (r.source === "imdb" || r.source === "omdb" || !r.source)
      ? ("IMDb " + r.label)
      : (String(r.source).toUpperCase() + " " + r.label);
    // Mismo look para películas, series y anime (placa tipo Stremio)
    return (
        '<div class="rating-badge rating-imdb-logo' + srcClass + '" title="' + escapeHtml(title) + '">' +
        '<span class="rating-main">' + escapeHtml(r.label) + "</span>" +
        '<span class="imdb-mark">IMDb</span>' +
        "</div>"
    );
}


/** Rellena meta del panel de detalle (rating IMDb preferido, géneros, duración, cert, votos, título original) */
function rellenarMetaDetalle(item) {
    if (!item) return;

    const originalEl = document.getElementById("details-original-title");
    if (originalEl) {
        const orig = item.titulo_original || (item.tmdb && item.tmdb.titulo) || null;
        const mainTitle = String(item.nombre || item.titulo || "").trim().toLowerCase();
        if (orig && String(orig).trim() && String(orig).trim().toLowerCase() !== mainTitle) {
            originalEl.textContent = String(orig).trim();
            originalEl.style.display = "block";
        } else {
            originalEl.textContent = "";
            originalEl.style.display = "none";
        }
    }

    const yearEl = document.getElementById("details-year");
    if (yearEl) {
        // Año; si hay fecha completa se muestra también en details-release
        yearEl.textContent = item.year || (item.fecha_estreno ? String(item.fecha_estreno).slice(0, 4) : "—");
    }

    // Un solo rating estilo Stremio: chip IMDb (ocultar estrellas duplicadas)
    const ri = ratingInfo(item);
    const ratingWrap = document.getElementById("details-rating-wrap");
    const typeRating = document.getElementById("details-type-rating");
    if (ratingWrap) ratingWrap.classList.add("hidden");
    if (typeRating) typeRating.classList.add("hidden");
    if (typeof setDetalleImdb === "function") setDetalleImdb(item);

    // Duración
    const durEl = document.getElementById("details-duration");
    const durWrap = document.getElementById("details-duration-wrap");
    let durTxt = item.duracion_texto || null;
    if (!durTxt && item.imdb && item.imdb.duracion_texto) durTxt = item.imdb.duracion_texto;
    if (!durTxt && item.tmdb && item.tmdb.duracion_texto) durTxt = item.tmdb.duracion_texto;
    if (!durTxt && item.duracion) {
        const m = Number(item.duracion);
        if (m >= 60) {
            const h = Math.floor(m / 60);
            const mins = m % 60;
            durTxt = mins ? (h + "h " + mins + "min") : (h + "h");
        } else if (m > 0) durTxt = m + " min";
    }
    if (durEl) durEl.textContent = durTxt || "—";
    if (durWrap) {
        if (durTxt) durWrap.classList.remove("hidden");
        else durWrap.classList.add("hidden");
    }

    // Certificación
    const certEl = document.getElementById("details-cert");
    const certWrap = document.getElementById("details-cert-wrap");
    const cert = item.certificacion || (item.imdb && item.imdb.certificacion) || (item.tmdb && item.tmdb.certificacion) || null;
    if (certEl) certEl.textContent = cert || "—";
    if (certWrap) {
        if (cert) certWrap.classList.remove("hidden");
        else certWrap.classList.add("hidden");
    }

    // Votos (preferir IMDb)
    const votosEl = document.getElementById("details-votes");
    const votosWrap = document.getElementById("details-votes-wrap");
    let votosRaw = (item.imdb && item.imdb.votos) || item.votos || (item.tmdb && item.tmdb.votos) || null;
    let votosLabel = null;
    if (votosRaw) {
        const n = Number(String(votosRaw).replace(/[^\d]/g, ""));
        if (Number.isFinite(n) && n > 0) {
            if (n >= 1000000) votosLabel = (n / 1000000).toFixed(1).replace(/\.0$/, "") + "M votos";
            else if (n >= 1000) votosLabel = (n / 1000).toFixed(1).replace(/\.0$/, "") + "k votos";
            else votosLabel = n + " votos";
        } else {
            votosLabel = String(votosRaw) + " votos";
        }
    }
    if (votosEl) votosEl.textContent = votosLabel || "—";
    if (votosWrap) {
        if (votosLabel) votosWrap.classList.remove("hidden");
        else votosWrap.classList.add("hidden");
    }

    // Estado: En emisión / Finalizado (series, anime; también si la API trae estado)
    const statusEl = document.getElementById("details-status");
    const statusWrap = document.getElementById("details-status-wrap");
    let statusLabel = null;
    const tipoLow = String(item.tipo || "").toLowerCase();
    const esSerieTipo = /serie|anime|dorama|tv/.test(tipoLow);
    if (item.finalizado === true || /final|ended|complet/i.test(String(item.estado || ""))) {
        statusLabel = "Finalizado";
    } else if (item.en_emision === true || /emisi[oó]n|airing|ongoing|returning/i.test(String(item.estado || ""))) {
        statusLabel = "En emisión";
    } else if (item.estado) {
        statusLabel = String(item.estado);
    }
    // En películas solo mostrar si hay estado claro; en series/anime siempre si hay dato
    if (!esSerieTipo && statusLabel && statusLabel !== "Finalizado" && statusLabel !== "En emisión") {
        // películas raramente tienen "en emisión"; mantener si viene de API
    }
    if (statusEl) statusEl.textContent = statusLabel || "—";
    if (statusWrap) {
        if (statusLabel) statusWrap.classList.remove("hidden");
        else statusWrap.classList.add("hidden");
    }

    // Fecha de estreno (películas, series y anime)
    const releaseEl = document.getElementById("details-release");
    const releaseWrap = document.getElementById("details-release-wrap");
    let releaseLabel = null;
    if (item.fecha_estreno) {
        const f = String(item.fecha_estreno).slice(0, 10);
        if (/^\d{4}-\d{2}-\d{2}$/.test(f)) {
            const [yy, mm, dd] = f.split("-");
            releaseLabel = dd + "/" + mm + "/" + yy;
        } else if (/^\d{4}$/.test(f)) {
            releaseLabel = f;
        } else {
            releaseLabel = f;
        }
    }
    if (releaseEl) releaseEl.textContent = releaseLabel || "—";
    if (releaseWrap) {
        if (releaseLabel) releaseWrap.classList.remove("hidden");
        else releaseWrap.classList.add("hidden");
    }

    // Géneros: todos
    const generosEl = document.getElementById("details-genres");
    if (generosEl) {
        generosEl.innerHTML = "";
        let lista = [];
        if (Array.isArray(item.generos) && item.generos.length) {
            lista = item.generos.map(function (g) { return String(g).trim(); }).filter(Boolean);
        } else if (item.genero) {
            lista = String(item.genero).split(",").map(function (g) { return g.trim(); }).filter(Boolean);
        } else if (item.imdb && Array.isArray(item.imdb.generos) && item.imdb.generos.length) {
            lista = item.imdb.generos;
        } else if (item.tmdb && Array.isArray(item.tmdb.generos) && item.tmdb.generos.length) {
            lista = item.tmdb.generos;
        }
        const seen = {};
        lista.forEach(function (g) {
            const k = g.toLowerCase();
            if (seen[k]) return;
            seen[k] = true;
            generosEl.innerHTML += '<span class="genre-tag">' + escapeHtml(g) + "</span>";
        });
        if (item.idiomas && item.idiomas.length) {
            generosEl.innerHTML += '<span class="genre-tag genre-tag-extra">' + escapeHtml(item.idiomas.join(", ")) + "</span>";
        }
        if (item.calidad && item.calidad.length) {
            generosEl.innerHTML += '<span class="genre-tag genre-tag-extra">' + escapeHtml(item.calidad.join(", ")) + "</span>";
        }
    }

    const extra = document.getElementById("details-meta-extra");
    if (extra) extra.remove();
}





const resultsGrid = document.getElementById("results-grid");
const resultsTitle = document.getElementById("results-title");
const resultsCount = document.getElementById("results-count");
const resultsLoading = document.getElementById("results-loading");
const resultsEmpty = document.getElementById("results-empty");
const scrollSentinel = document.getElementById("scroll-sentinel");

const heroTitle = document.getElementById("hero-title");
const heroType = document.getElementById("hero-type");
const heroRating = document.getElementById("hero-rating");
const heroYear = document.getElementById("hero-year");
const heroSynopsis = document.getElementById("hero-synopsis");
const heroDots = document.getElementById("hero-dots");
const heroPlayBtn = document.getElementById("hero-play-btn");
const heroInfoBtn = document.getElementById("hero-info-btn");

// ---------- Estado ----------
let seleccionActual = null;
let vistaActual = "home"; // home | grid
let gridModo = "categoria"; // categoria | search | favoritos
let gridSeccion = "movie";
let gridTermino = "";
let gridPage = 1;
let gridCargando = false;
let gridSinMasResultados = false;
let gridSort = "recent";       // recent | rating | az
let gridTypeFilter = "all";    // all | movie | series | anime
let heroItems = [];
let heroIndex = 0;
let heroTimer = null;

// ======================================================
// FAVORITOS (localStorage)
// ======================================================
function obtenerFavoritos() {
    try { return JSON.parse(localStorage.getItem(pk("favoritos")) || "[]"); }
    catch { return []; }
}
function guardarFavoritos(lista) {
    localStorage.setItem(pk("favoritos"), JSON.stringify(lista || []));
}
function esFavorito(link) {
    return obtenerFavoritos().some(f => f.link === link);
}
function toggleFavoritoItem(item) {
    let favoritos = obtenerFavoritos();
    const existe = favoritos.findIndex(f => f.link === item.link);
    if (existe >= 0) {
        favoritos.splice(existe, 1);
    } else {
        favoritos.unshift(item);
    }
    guardarFavoritos(favoritos);
    return existe < 0; // true si quedó agregado
}

// ======================================================
// UTILIDADES
// ======================================================
function escapeHtml(texto) {
    return String(texto ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function tipoLabel(tipo) {
    if (tipo === "Serie") return "Serie";
    if (tipo === "Anime") return "Anime";
    return "Película";
}

const REPRODUCTORES_PERMITIDOS = [
    "vimeos.net", "player.vimeos", "goodstream", "streamwish", "filemoon",
    "voe.sx", "voe.", "doodstream", "dood.", "ds2play", "dsvplay", "doods.pro",
    "streamtape", "mixdrop", "upstream", "vidmoly", "mp4upload", "uqload",
    "vidhide", "vidguard", "lulustream", "filelions", "yourupload",
    "supervideo", "krakenfiles", "ok.ru",
    "zilla-networks", "mega.nz", "mega.co", "mega.io",
    // animeav1 / latino frecuentes
    "hls.", "upnshare", "upns", "waaw.", "hqq.", "netu.", "vizcloud",
    "mycloud", "vidplay", "megaf", "pixeldrain", "burstcloud", "streamhub",
    "doodcdn", "voe.sx", "jilliandescribe",
    // aliases / mirrors frecuentes de la API
    "streamhg", "flaswish", "strwish", "ahvsh", "earnvids", "smoothpre",
    "callistanise", "wish", "vidhidepro", "luluvid",
    "filemoon.", "moon.", "streamvid", "rutube", "vk.com", "vk.ru",
    "iframe.", "embed.", "player.", "stream.", "cdn."
];

const REPRODUCTORES_BLOQUEADOS = [
    "sblongvu", "sblanh", "sbfull", "sbfast", "sbthe", "sbanh",
    "lvturbo", "diasfem", "fembed", "4shared",
    "youtube.com", "youtu.be", "play.php", "example.com", "hackstore.fo"
    // NO bloquear lamovie.org embeds si aparecen; solo meta JSON del worker
];

/** URL de la API del worker (detalle/capítulo) — NO es un iframe de video */
function esUrlApiWorker(url) {
    if (!url) return false;
    const u = String(url).toLowerCase();
    // Endpoints de datos JSON del worker (al ponerlos en iframe sale el JSON crudo)
    if (/moviezone\.tvjz\.workers\.dev/i.test(u)) {
        // Resolver de stream sí es válido como API de play, pero no como iframe directo
        if (/\/(resolve|wish|goodstream|vidhide|voe)\//i.test(u)) return false;
        // /3/serie/slug/1/1 o /3/pelicula/slug → JSON, inválido como player
        if (/\/\d+\/(serie|anime|pelicula)\//i.test(u)) return true;
        if (/\/(serie|anime|pelicula)\//i.test(u)) return true;
        return true; // cualquier otra ruta del worker no es embed de video
    }
    return false;
}

function esEmbedInvalido(url) {
    if (!url) return true;
    const u = String(url).toLowerCase().trim();
    if (!/^https?:\/\//i.test(u) && !u.startsWith("//")) return true;
    if (esUrlApiWorker(u)) return true;
    if (REPRODUCTORES_BLOQUEADOS.some(d => u.includes(d))) return true;
    // Permitir cualquier https de host conocido O cualquier http(s) que no esté bloqueado
    if (REPRODUCTORES_PERMITIDOS.some(d => u.includes(d))) return false;
    try {
        const host = new URL(u.startsWith("//") ? "https:" + u : u).hostname;
        if (host && host.includes(".")) return false;
    } catch (_) {}
    return true;
}

function embedsValidosDe(episodio) {
    const raw = normalizarEmbeds(episodio?.embeds);
    const ok = raw.filter(e => e && e.url && !esEmbedInvalido(e.url));
    if (ok.length) return ok;
    // Si hay URLs pero el filtro las tumbó, devolverlas igual (mejor mostrar que decir "no disponible")
    const conUrl = raw.filter(e => e && e.url && /^https?:\/\//i.test(String(e.url)));
    return conUrl;
}


function normalizarEmbeds(raw) {
    if (!raw) return [];
    if (typeof raw === "string") {
        try { raw = JSON.parse(raw); } catch { return []; }
    }
    if (!Array.isArray(raw)) return [];
    return raw.map(e => {
        if (typeof e === "string" && e.startsWith("http")) {
            if (esUrlApiWorker(e)) return null;
            return { url: e };
        }
        if (e && e.url) {
            if (esUrlApiWorker(e.url)) return null;
            return {
                ...e,
                url: e.url,
                server: e.server || e.servidor || e.name || null,
                servidor: e.servidor || e.server || e.name || null,
                idioma: e.idioma || e.lang || null,
                lang: e.lang || e.idioma || null,
                stream_url: e.stream_url || null,
            };
        }
        return null;
    }).filter(Boolean);
}

function itemTieneVideo(item) {
    const embedsValidos = normalizarEmbeds(item.embeds)
        .filter(e => e && e.url && !esEmbedInvalido(e.url));
    return (
        (item.reproductor && !esEmbedInvalido(item.reproductor)) ||
        embedsValidos.length > 0 ||
        (Array.isArray(item.episodios) && item.episodios.some(e =>
            (e.video && !esEmbedInvalido(e.video)) ||
            (Array.isArray(e.embeds) && e.embeds.some(em => em && em.url && !esEmbedInvalido(em.url)))
        ))
    );
}

// Mapa de dominios conocidos -> nombre bonito
const SERVIDORES_CONOCIDOS = {
    "goodstream.one": "GoodstreamOne", "goodstream.uno": "GoodstreamOne",
    "vimeos.net": "MovieZone",
    "voe.sx": "Voe",
    "doodstream.com": "Doodstream", "dood.to": "Doodstream", "dood.wf": "Doodstream", "dood.la": "Doodstream",
    "streamtape.com": "Streamtape",
    "streamwish.com": "StreamWish", "streamwish.to": "StreamWish", "streamhg.com": "StreamWish",
    "filemoon.sx": "Filemoon", "filemoon.to": "Filemoon",
    "mixdrop.co": "Mixdrop", "mixdrop.to": "Mixdrop",
    "vidhide.com": "VidHide", "vidhidepro.com": "VidHide",
    "vidguard.to": "VidGuard",
    "uqload.com": "Uqload",
    "streamsb.com": "StreamSB",
    "fembed.com": "Fembed",
    "upstream.to": "Upstream",
    "vidmoly.me": "Vidmoly", "vidmoly.to": "Vidmoly",
    "mp4upload.com": "Mp4Upload",
    "waaw.to": "Waaw", "netu.tv": "Waaw",
    "mega.nz": "Mega",
    "drive.google.com": "Google Drive",
    "mediafire.com": "Mediafire",
    "pixeldrain.com": "Pixeldrain",
    "1fichier.com": "1Fichier"
};

function detectarServidor(url, serverOriginal) {
    let host = "";
    try { host = new URL(url).hostname.toLowerCase().replace(/^www\./, ""); }
    catch { return serverOriginal || "Servidor"; }

    for (const dominio in SERVIDORES_CONOCIDOS) {
        if (host === dominio || host.endsWith("." + dominio)) return SERVIDORES_CONOCIDOS[dominio];
    }
    const generico = ["online", "server", "servidor", ""].includes((serverOriginal || "").toLowerCase().trim());
    if (serverOriginal && !generico) return serverOriginal;

    const base = host.split(".")[0];
    return base ? base.charAt(0).toUpperCase() + base.slice(1) : "Servidor";
}



// ======================================================
// NO ADS — stream directo vía worker (NO se guarda en Supabase)
// Prioridad: Vimeos → Streamwish → Goodstream → Vidhide → Voe
// ======================================================
const WORKER_STREAM = "https://moviezone.tvjz.workers.dev";

function rankFuenteNoAds(url) {
    const u = String(url || "").toLowerCase();
    if (u.includes("vimeos")) return 1;
    if (
        u.includes("streamwish") || u.includes("flaswish") ||
        u.includes("strwish") || u.includes("ahvsh") || u.includes("streamhg")
    ) return 2;
    if (u.includes("goodstream")) return 3;
    if (
        u.includes("vidhide") || u.includes("earnvids") ||
        u.includes("callistanise") || u.includes("smoothpre") ||
        u.includes("filelions")
    ) return 4;
    if (u.includes("voe") || u.includes("jilliandescribe")) return 5;
    return 99;
}

function streamUrlParaNoAds(embedUrl) {
    const r = rankFuenteNoAds(embedUrl);
    const q = encodeURIComponent(embedUrl);
    if (r === 1) return `${WORKER_STREAM}/resolve/vimeos?url=${q}&proxy=1`;
    if (r === 2) return `${WORKER_STREAM}/wish/streamurl?url=${q}`;
    if (r === 3) return `${WORKER_STREAM}/goodstream/streamurl?url=${q}`;
    if (r === 4) return `${WORKER_STREAM}/vidhide/streamurl?url=${q}`;
    if (r === 5) return `${WORKER_STREAM}/voe/streamurl?url=${q}`;
    return null;
}


/** Idioma de un embed/descarga */
function idiomaDeEmbed(e) {
    const t = `${e?.idioma || ""} ${e?.lang || ""} ${e?.language || ""}`.toLowerCase();
    if (/latino|castellano|español|\bdub\b|audio lat/.test(t)) return "lat";
    if (/sub|subtit/.test(t)) return "sub";
    return "otro";
}

let _idiomaPlayerActivo = "lat"; // preferir latino

// ============================================================
// Autoplay capítulos (Serie/Anime)
// ============================================================
let _epPlayCtx = null; // { item, season, episode, episodio }
let _autoplayEp = localStorage.getItem("mz_autoplay_ep") !== "0"; // default ON

function scoreIdiomaEmbed(e) {
  const t = `${e?.idioma || ""} ${e?.lang || ""} ${e?.language || ""} ${e?.server || ""} ${e?.name || ""}`.toLowerCase();
  if (/latino|castellano|español|espanol|\bdub\b|audio lat/.test(t)) return 0;
  if (/sub|subtit|subtitulado/.test(t)) return 1;
  if (/english|ingles|inglés|\beng\b/.test(t)) return 2;
  return 3; // desconocido
}

function ordenarEmbedsAuto(embeds) {
  return (embeds || [])
    .filter((e) => e && (e.url || e.stream_url) && !esEmbedInvalido(e.url))
    .slice()
    .sort((a, b) => {
      const ia = scoreIdiomaEmbed(a) - scoreIdiomaEmbed(b);
      if (ia !== 0) return ia;
      const ra = rankFuenteNoAds(a.url || "") ;
      const rb = rankFuenteNoAds(b.url || "");
      return ra - rb;
    });
}

function esSerieOAnimeItem(item) {
  const t = String(item?.tipo || "").toLowerCase();
  return t === "serie" || t === "anime" || /serie|anime|dorama/.test(t);
}

function actualizarBotonesEpPlayer() {
  const wrap = document.getElementById("mz-ep-controls");
  const btnNext = document.getElementById("btn-next-ep");
  const btnAuto = document.getElementById("btn-autoplay-ep");

  // Solo series/anime Y con capítulo activo
  const activo =
    _epPlayCtx &&
    _epPlayCtx.item &&
    esSerieOAnimeItem(_epPlayCtx.item);

  if (wrap) {
    wrap.classList.toggle("hidden", !activo);
    wrap.style.display = activo ? "" : "none";
  }

  if (!activo) {
    if (btnNext) btnNext.classList.add("hidden");
    return;
  }

  if (btnAuto) {
    const t = document.getElementById("btn-autoplay-ep-text");
    if (t) t.textContent = _autoplayEp ? "Auto" : "Auto off";
    else btnAuto.textContent = _autoplayEp ? "Auto" : "Auto off";
    btnAuto.classList.toggle("off", !_autoplayEp);
  }

  if (!btnNext) return;
  const next = obtenerSiguienteEpisodioCtx(_epPlayCtx);
  btnNext.classList.toggle("hidden", !next);
}

function obtenerSiguienteEpisodioCtx(ctx) {
  if (!ctx || !ctx.item || !Array.isArray(ctx.item.episodios)) return null;
  const eps = ctx.item.episodios.slice().sort((a, b) => {
    const sa = Number(a.season || a.temporada || 1);
    const sb = Number(b.season || b.temporada || 1);
    if (sa !== sb) return sa - sb;
    const ea = Number(a.episode || a.episodio || a.episode_number || 0);
    const eb = Number(b.episode || b.episodio || b.episode_number || 0);
    return ea - eb;
  });
  const curS = Number(ctx.season || 1);
  const curE = Number(ctx.episode || 0);
  for (let i = 0; i < eps.length; i++) {
    const s = Number(eps[i].season || eps[i].temporada || 1);
    const e = Number(eps[i].episode || eps[i].episodio || eps[i].episode_number || 0);
    if (s === curS && e === curE && i + 1 < eps.length) {
      return eps[i + 1];
    }
  }
  // fallback: siguiente por número en misma temporada
  const same = eps.filter((x) => Number(x.season || x.temporada || 1) === curS);
  const nxt = same.find((x) => Number(x.episode || x.episodio || x.episode_number || 0) > curE);
  return nxt || null;
}

async function asegurarEmbedsEpisodio(item, episodio, seasonNum, epNum) {
  let validos = embedsValidosDe(episodio);
  if (validos.length || (episodio.video && !esEmbedInvalido(episodio.video))) {
    return { embeds: validos.length ? validos : (episodio.embeds || []), video: episodio.video };
  }
  const sNum = Number(seasonNum || episodio?.season || episodio?.temporada || item?._seasonActiva || 1) || 1;
  const eNum = Number(epNum || episodio?.episode || episodio?.episodio || 0) || 0;
  const params = new URLSearchParams();
  params.set("temporada", String(sNum));
  params.set("episodio", String(eNum));
  if (item.postId) params.set("postId", item.postId);
  // Preferir link del episodio (fuentes con URL por capítulo)
  if (episodio && episodio.link) params.set("link", episodio.link);
  else if (item.link) params.set("link", item.link);
  if (item.slug) params.set("slug", item.slug);
  if (item.source_id) params.set("source_id", item.source_id);
  if (item.tipo) params.set("tipo", item.tipo);
  const controller = new AbortController();
  const to = setTimeout(() => controller.abort(), 45000);
  try {
    const res = await fetch(`/api/capitulo?${params.toString()}`, { cache: "no-store", signal: controller.signal });
    const data = await res.json();
    if (data && data.embeds) episodio.embeds = data.embeds;
    if (data && data.reproductores) episodio.embeds = data.reproductores;
    if (data && data.video) episodio.video = data.video;
    if (data && data.downloads) episodio.downloads = data.downloads;
    validos = embedsValidosDe(episodio);
    return { embeds: validos.length ? validos : (episodio.embeds || []), video: episodio.video };
  } finally {
    clearTimeout(to);
  }
}

/** Prueba servidores en orden: Latino → Sub → EN → otro; resolve primero */
/** PEGAR en app.js: reemplaza TODA la función reproducirCapituloAuto existente */
async function reproducirCapituloAuto(item, episodio, seasonNum, epNum) {
  // PC (≥1025) + serie/anime/dorama → vista tipo Koiflix SIN auto-reproducir
  const pc =
    (typeof isKoiDesktop === "function" && isKoiDesktop()) ||
    (typeof window !== "undefined" && window.innerWidth >= 1025);
  const serie =
    (typeof isSerieOrAnime === "function" && isSerieOrAnime(item)) ||
    /serie|anime|dorama|tv|ova|ona/i.test(String(item?.tipo || item?.type || ""));

  if (pc && serie && !window.__mzForceAutoPlay) {
    try {
      document.body.classList.add("koi-desktop", "player-open", "details-open");
      if (typeof setKoiMode === "function") setKoiMode(item);

      const epLabel = episodio.nombre || episodio.titulo || ("Episodio " + epNum);
      setKoiPlayerEpisodeTitle("E" + epNum + " - " + epLabel);

      const titleEl = document.getElementById("details-title");
      if (titleEl) {
        titleEl.textContent = item.nombre || item.titulo || "";
        titleEl.classList.add("koi-anime-link");
      }

      // Nunca poner stream en el iframe aquí
      const iframe = document.getElementById("player-iframe");
      if (iframe) iframe.src = "about:blank";
      try {
        if (typeof destruirHls === "function") destruirHls();
      } catch (_) {}

      const vc = document.getElementById("video-player-container");
      if (vc) {
        vc.classList.remove("hidden");
        vc.classList.add("koi-waiting-server");
      }
      const pt = document.getElementById("player-title");
      if (pt) pt.textContent = "Elige un reproductor para comenzar";

      // Servidores sin pasar video (evita arranque implícito)
      const pack = await asegurarEmbedsEpisodio(item, episodio, seasonNum, epNum);
      renderServidoresYDescargas(
        pack.embeds || [],
        episodio.downloads || [],
        null,
        item,
        { expandido: true, noAutoplay: true }
      );
      document.getElementById("servers-section")?.classList.remove("hidden");

      _epPlayCtx = {
        item,
        season: Number(seasonNum) || 1,
        episode: Number(epNum) || 0,
        episodio,
      };
      actualizarBotonesEpPlayer();

      try {
        function mzScrollAReproductores() {
          var srv = document.getElementById("servers-section");
          if (srv) {
            srv.classList.remove("hidden");
            srv.style.setProperty("display", "block", "important");
          }
          // Abajo: título episodio + sinopsis + chips (no el mensaje del player vacío)
          var target =
            document.getElementById("servers-section") ||
            document.getElementById("servers-container");
          if (target) mzScrollPanelTo(target);
        }
        requestAnimationFrame(function () {
          mzScrollAReproductores();
          setTimeout(mzScrollAReproductores, 150);
          setTimeout(mzScrollAReproductores, 450);
        });
      } catch (_) {}
    } catch (e) {
      console.error("koi prepare ep:", e);
    }
    return false; // no autoplay
  }

  // —— Móvil / película / force: flujo original ——
  const pack = await asegurarEmbedsEpisodio(item, episodio, seasonNum, epNum);
  let embeds = ordenarEmbedsAuto(pack.embeds || []);
  const conNoAds = insertarNoAdsEnLista(embeds);
  embeds = ordenarEmbedsAuto(conNoAds);

  _epPlayCtx = {
    item,
    season: Number(seasonNum) || 1,
    episode: Number(epNum) || 0,
    episodio,
  };
  actualizarBotonesEpPlayer();

  document.getElementById("details-title").textContent =
    (item.nombre || item.titulo || "") + " - " + (episodio.nombre || ("Episodio " + epNum));
  try {
    setKoiPlayerEpisodeTitle("E" + epNum + " - " + (episodio.nombre || ("Episodio " + epNum)));
    document.body.classList.add("player-open");
  } catch (_) {}

  for (const emb of embeds) {
    try {
      if (emb.noAds || (typeof rankFuenteNoAds === "function" && rankFuenteNoAds(emb))) {
        const embedTry = emb;
        if (embedTry && (embedTry.noAds || embedTry.stream_url || streamUrlParaNoAds(embedTry.url))) {
          const playUrl = await resolverPlayUrlNoAds(
            embedTry.noAds
              ? embedTry
              : {
                  ...embedTry,
                  stream_url: embedTry.stream_url || streamUrlParaNoAds(embedTry.url),
                  noAds: true,
                }
          );
          await reproducirHlsNoAds(playUrl, {
            ...item,
            nombre: (item.nombre || item.titulo || "") + " · E" + epNum,
          });
          engancharEndedAutoplay();
          return true;
        }
      }
      await reproducir(emb, {
        ...item,
        nombre: (item.nombre || item.titulo || "") + " · E" + epNum,
      });
      engancharEndedAutoplay();
      return true;
    } catch (err) {
      console.warn("Auto cap falló servidor", emb?.url, err);
    }
  }

  if (pack.video && !esEmbedInvalido(pack.video)) {
    await reproducir({ url: pack.video, server: "Directo" }, item);
    engancharEndedAutoplay();
    return true;
  }

  const t = document.getElementById("player-title");
  if (t) t.textContent = "Sin mirror estable — prueba otro cap o más tarde";
  return false;
}


function engancharEndedAutoplay() {
  const vid = document.getElementById("player-video");
  if (!vid || vid.dataset.mzEndedBound === "1") return;
  vid.dataset.mzEndedBound = "1";
  vid.addEventListener("ended", () => {
    if (!_autoplayEp) return;
    irSiguienteEpisodio(true);
  });
}

async function irSiguienteEpisodio(fromAuto) {
  if (!_epPlayCtx) return;
  const next = obtenerSiguienteEpisodioCtx(_epPlayCtx);
  if (!next) {
    if (!fromAuto) alert("No hay más episodios en la lista cargada.");
    return;
  }
  const item = _epPlayCtx.item;
  const seasonNum = Number(next.season || next.temporada || _epPlayCtx.season || 1);
  const epNum = Number(next.episode || next.episodio || next.episode_number || 0);
  const playerTitle = document.getElementById("player-title");
  if (playerTitle) playerTitle.textContent = `Cargando E${epNum}...`;

  // marcar botón activo si existe
  try {
    document.querySelectorAll(".episode-btn").forEach((b) => {
      b.classList.toggle("active", String(b.textContent).trim() === String(epNum));
    });
  } catch (_) {}

  await reproducirCapituloAuto(item, next, seasonNum, epNum);
}

function initAutoplayEpUi() {
  const wrap = document.getElementById("mz-ep-controls");
  if (wrap) {
    wrap.classList.add("hidden");
    wrap.style.display = "none";
  }
  const btnNext = document.getElementById("btn-next-ep");
  const btnAuto = document.getElementById("btn-autoplay-ep");
  if (btnNext) {
    btnNext.addEventListener("click", () => irSiguienteEpisodio(false));
  }
  if (btnAuto) {
    const t = document.getElementById("btn-autoplay-ep-text");
    if (t) t.textContent = _autoplayEp ? "Auto" : "Auto off";
    else btnAuto.textContent = _autoplayEp ? "Auto" : "Auto off";
    btnAuto.classList.toggle("off", !_autoplayEp);
    btnAuto.addEventListener("click", () => {
      _autoplayEp = !_autoplayEp;
      localStorage.setItem("mz_autoplay_ep", _autoplayEp ? "1" : "0");
      if (t) t.textContent = _autoplayEp ? "Auto" : "Auto off";
      else btnAuto.textContent = _autoplayEp ? "Auto" : "Auto off";
      btnAuto.classList.toggle("off", !_autoplayEp);
    });
  }
}

function esIdiomaLatinoEmbed(e) {
    const t = `${e?.lang || ""} ${e?.idioma || ""} ${e?.language || ""}`.toLowerCase();
    return /latino|castellano|español|\bdub\b|audio lat/.test(t);
}

/** Elige UN solo embed: 1) Latino si hay 2) mejor host funcional (vimeos→wish→gs→vidhide→voe) */
function elegirEmbedNoAds(embeds) {
    if (!Array.isArray(embeds) || !embeds.length) return null;
    const candidatos = embeds.filter(e =>
        e && e.url && !e.noAds && !esEmbedInvalido(e.url) && rankFuenteNoAds(e.url) < 99
    );
    if (!candidatos.length) return null;

    const latinos = candidatos.filter(esIdiomaLatinoEmbed);
    const pool = latinos.length ? latinos : candidatos;

    let best = null;
    let bestRank = 99;
    for (const e of pool) {
        const rank = rankFuenteNoAds(e.url);
        if (rank < bestRank) {
            bestRank = rank;
            best = e;
        }
    }
    if (!best) return null;
    const streamApi = streamUrlParaNoAds(best.url);
    if (!streamApi) return null;
    return {
        url: best.url,
        stream_url: streamApi,
        server: "NO ADS",
        name: "NO ADS",
        noAds: true,
        lang: best.lang || best.idioma || (esIdiomaLatinoEmbed(best) ? "Latino" : ""),
        idioma: best.idioma || best.lang || "",
        sourceEmbed: best.url
    };
}


function attachStreamUrls(embeds) {
    if (!Array.isArray(embeds)) return [];
    return embeds.map((e) => {
        if (!e || !e.url) return e;
        if (e.noAds) return e;
        const su = e.stream_url || streamUrlParaNoAds(e.url);
        return su ? { ...e, stream_url: su } : { ...e };
    });
}

function insertarNoAdsEnLista(embeds) {
    const lista = Array.isArray(embeds) ? embeds.slice() : [];
    // quitar entradas NO ADS previas
    const limpia = lista.filter(e => !e || !e.noAds);
    const noAds = elegirEmbedNoAds(limpia);
    if (!noAds) return limpia;

    // MovieZone (vimeos) primero; NO ADS justo después
    const mzIdx = limpia.findIndex(e =>
        e && e.url && (/vimeos/i.test(e.url) || e.server === "MovieZone" || e.name === "MovieZone")
    );
    if (mzIdx >= 0) {
        limpia.splice(mzIdx + 1, 0, noAds);
    } else {
        limpia.unshift(noAds);
    }
    return limpia;
}

async function resolverPlayUrlNoAds(embed) {
    const api = embed.stream_url || streamUrlParaNoAds(embed.url || embed.sourceEmbed);
    if (!api) throw new Error("Sin stream_url NO ADS");
    const res = await fetch(api, { cache: "no-store" });
    const data = await res.json();
    if (!data || data.success === false) {
        throw new Error((data && data.error) || "No se pudo resolver NO ADS");
    }
    // Preferir play_url / proxy_url (ya filtrados activos en el worker)
    let play = data.play_url || data.proxy_url || null;
    if (!play && Array.isArray(data.qualities) && data.qualities.length) {
        const q720 = data.qualities.find(q => String(q.quality || "").includes("720"));
        play = (q720 && q720.proxy_url) || data.qualities[data.qualities.length - 1].proxy_url;
    }
    if (!play && data.url) {
        play = `${WORKER_STREAM}/proxy?url=${encodeURIComponent(data.url)}`;
    }
    if (!play) throw new Error("Sin URL reproducible");
    return play;
}

function ensurePlayerVideoEl() {
    let vid = document.getElementById("player-video");
    if (vid) return vid;
    const wrap = document.querySelector(".player-iframe-wrapper");
    if (!wrap) return null;
    vid = document.createElement("video");
    vid.id = "player-video";
    vid.className = "player-video hidden";
    vid.controls = true;
    vid.playsInline = true;
    vid.setAttribute("playsinline", "");
    vid.setAttribute("webkit-playsinline", "true");
    vid.setAttribute("x5-playsinline", "true");
    vid.setAttribute("x5-video-player-type", "h5");
    vid.setAttribute("x5-video-player-fullscreen", "false");
    vid.disablePictureInPicture = true;
    // No forzar fullscreen
    vid.addEventListener("webkitbeginfullscreen", (e) => {
        try { e.preventDefault(); } catch (_) {}
        try { if (document.webkitExitFullscreen) document.webkitExitFullscreen(); } catch (_) {}
    });
    wrap.appendChild(vid);
    return vid;
}

let _hlsInstance = null;
function destruirHls() {
    if (_hlsInstance) {
        try { _hlsInstance.destroy(); } catch (_) {}
        _hlsInstance = null;
    }
    const vid = document.getElementById("player-video");
    if (vid) {
        try { vid.pause(); vid.removeAttribute("src"); vid.load(); } catch (_) {}
        vid.classList.add("hidden");
    }
    if (playerIframe) playerIframe.classList.remove("hidden");
    mostrarBotonFullscreen(false);
}


function mostrarBotonFullscreen(mostrar) {
    const btn = document.getElementById("btn-fs-player");
    if (!btn) return;
    btn.classList.toggle("hidden", !mostrar);
    if (!mostrar) {
        // salir de FS si se oculta el botón
        salirPantallaCompletaPlayer();
    }
}

function actualizarIconoFs(enFs) {
    const icon = document.getElementById("btn-fs-player-icon");
    if (icon) icon.setAttribute("name", enFs ? "contract-outline" : "expand-outline");
}

function salirPantallaCompletaPlayer() {
    const box = document.getElementById("video-player-container");
    if (box) box.classList.remove("is-fullscreen");
    actualizarIconoFs(false);
    try {
        if (document.fullscreenElement) document.exitFullscreen();
        else if (document.webkitFullscreenElement) document.webkitExitFullscreen();
    } catch (_) {}
}

async function togglePantallaCompletaPlayer() {
    const box = document.getElementById("video-player-container");
    const vid = document.getElementById("player-video");
    if (!box) return;

    // Preferir Fullscreen API del contenedor (funciona en desktop + muchos móviles)
    const enFs = !!(document.fullscreenElement || document.webkitFullscreenElement || box.classList.contains("is-fullscreen"));

    if (enFs) {
        salirPantallaCompletaPlayer();
        return;
    }

    try {
        if (box.requestFullscreen) await box.requestFullscreen();
        else if (box.webkitRequestFullscreen) box.webkitRequestFullscreen();
        else if (vid && vid.webkitEnterFullscreen) {
            // iOS Safari: fullscreen nativo del video
            vid.webkitEnterFullscreen();
        } else {
            // Fallback CSS
            box.classList.add("is-fullscreen");
        }
        actualizarIconoFs(true);
    } catch (e) {
        // Fallback CSS si el navegador bloquea FS
        box.classList.add("is-fullscreen");
        actualizarIconoFs(true);
    }
}


async function reproducirHlsNoAds(playUrl, item) {
    destruirHls();
    const vid = ensurePlayerVideoEl();
    if (!vid) throw new Error("Sin elemento video");
    playerIframe.classList.add("hidden");
    playerIframe.src = "about:blank";
    vid.classList.remove("hidden");
    videoContainer.classList.remove("hidden");
    mostrarBotonFullscreen(true);
    playerTitle.textContent = (item?.nombre || "NO ADS")
        .split(" ").map(w => w ? w.charAt(0).toUpperCase() + w.slice(1) : w).join(" ");

    // Siempre dentro del wrapper 16:9 (igual que los embeds)
    vid.playsInline = true;
    if (window.Hls && window.Hls.isSupported()) {
        _hlsInstance = new window.Hls({
            enableWorker: true,
            // no auto quality jump que re-layout
            startLevel: -1
        });
        _hlsInstance.loadSource(playUrl);
        _hlsInstance.attachMedia(vid);
        _hlsInstance.on(window.Hls.Events.MANIFEST_PARSED, () => {
            const p = vid.play();
            if (p && p.catch) p.catch(() => {});
        });
    } else if (vid.canPlayType("application/vnd.apple.mpegurl")) {
        vid.src = playUrl;
        const p = vid.play();
        if (p && p.catch) p.catch(() => {});
    } else {
        vid.classList.add("hidden");
        playerIframe.classList.remove("hidden");
        playerIframe.src = playUrl;
    }
    iniciarSeguimientoProgreso(item || seleccionActual);
    document.body.classList.add("player-open");
    requestAnimationFrame(() => {
        try { videoContainer.scrollIntoView({ behavior: "smooth", block: "center" }); }
        catch (_) { videoContainer.scrollIntoView(true); }
    });
}


// ======================================================
// NAVEGACIÓN DE VISTAS
// ======================================================
function mostrarHome() {
    vistaActual = "home";
    homeView.classList.remove("hidden");
    gridView.classList.add("hidden");

    // Cerrar vista TV al volver a Inicio
    const tv = document.getElementById("tv-view");
    if (tv) tv.classList.add("hidden");

    // Cerrar player TV si quedó abierto
    document.body.classList.remove("player-open");

    document.querySelectorAll(".filter-tab, .filter-chip").forEach(el => el.classList.remove("active"));
    const navHome = document.getElementById("nav-item-home");
    if (navHome) navHome.classList.add("active");
    actualizarBotonOnline(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
}

// ============================================================
// TV en vivo (Cable + País) — no altera películas/series/anime
// ============================================================
const TV_FAMOSOS = [
  "las estrellas", "canal 5", "canal5", "azteca uno", "azteca 7", "azteca",
  "imagen", "foro tv", "espn", "fox sports", "tudn", "cnn", "discovery",
  "cartoon network", "disney", "nickelodeon", "hbo", "warner", "sony",
  "history", "national geographic", "mtv", "tlc", "paramount", "star channel",
  "televisa", "milenio", "adn40", "canal once", "once", "a&e", "amc"
];

function scoreCanalFamoso(nombre) {
  const n = String(nombre || "").toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  let score = 0;
  for (let i = 0; i < TV_FAMOSOS.length; i++) {
    if (n.includes(TV_FAMOSOS[i])) {
      score += (TV_FAMOSOS.length - i) * 10;
    }
  }
  // bonus si el nombre es corto y exacto
  if (score > 0 && n.length < 25) score += 5;
  return score;
}

function ordenarCanalesFamososPrimero(lista) {
  return (lista || []).slice().sort((a, b) => {
    const sb = scoreCanalFamoso(b.nombre);
    const sa = scoreCanalFamoso(a.nombre);
    if (sb !== sa) return sb - sa;
    return String(a.nombre || "").localeCompare(String(b.nombre || ""), "es");
  });
}

function ocultarVistasPrincipales() {
  const home = document.getElementById("home-view");
  const grid = document.getElementById("grid-view");
  const tv = document.getElementById("tv-view");
  if (home) home.classList.add("hidden");
  if (grid) grid.classList.add("hidden");
  if (tv) tv.classList.add("hidden");
}

function abrirTvView(tab) {
  ocultarVistasPrincipales();
  const tv = document.getElementById("tv-view");
  if (tv) tv.classList.remove("hidden");
  window.scrollTo({ top: 0, behavior: "smooth" });
  setTvTab(tab || "cable");
}

function cerrarTvView() {
  const tv = document.getElementById("tv-view");
  if (tv) tv.classList.add("hidden");
  if (typeof mostrarHome === "function") mostrarHome();
}

function setTvTab(tab) {
  const cablePanel = document.getElementById("tv-panel-cable");
  const paisPanel = document.getElementById("tv-panel-paises");
  document.querySelectorAll(".tv-tab").forEach((el) => {
    el.classList.toggle("active", el.getAttribute("data-tv-tab") === tab);
  });
  if (tab === "cable") {
    if (cablePanel) cablePanel.classList.remove("hidden");
    if (paisPanel) paisPanel.classList.add("hidden");
    cargarTvCable();
  } else {
    if (paisPanel) paisPanel.classList.remove("hidden");
    if (cablePanel) cablePanel.classList.add("hidden");
    cargarTvPaises();
  }
}

async function cargarTvCable() {
  const box = document.getElementById("tv-canales-cable");
  const gruposEl = document.getElementById("tv-grupos-cable");
  if (!box) return;
  box.innerHTML = '<div class="tv-loading">Cargando canales…</div>';
  try {
    const r = await fetch("/api/tv/cable");
    const data = await r.json();
    if (!data || !data.success) throw new Error((data && data.error) || "Error");
    window.__tvCable = data.canales || [];
    window.__tvCableGrupos = data.grupos || [];

    if (gruposEl) {
      gruposEl.innerHTML =
        '<button type="button" class="tv-chip active" data-grupo="">Todos</button>' +
        window.__tvCableGrupos
          .map(
            (g) =>
              `<button type="button" class="tv-chip" data-grupo="${escapeHtml(g)}">${escapeHtml(g)}</button>`
          )
          .join("");
      gruposEl.querySelectorAll(".tv-chip").forEach((btn) => {
        btn.addEventListener("click", () => {
          gruposEl.querySelectorAll(".tv-chip").forEach((b) => b.classList.remove("active"));
          btn.classList.add("active");
          renderTvCanales(
            box,
            filtrarGrupo(window.__tvCable, btn.getAttribute("data-grupo") || "")
          );
        });
      });
    }

    renderTvCanales(box, window.__tvCable);
  } catch (e) {
    box.innerHTML = `<div class="tv-loading">No se pudo cargar cable: ${escapeHtml(e.message || e)}</div>`;
  }
}

function filtrarGrupo(lista, grupo) {
  if (!grupo) return lista || [];
  const g = grupo.toLowerCase();
  return (lista || []).filter((c) => String(c.grupo || "").toLowerCase() === g);
}

async function cargarTvPaises() {
  const chips = document.getElementById("tv-paises-chips");
  const box = document.getElementById("tv-canales-pais");
  if (!chips || !box) return;

  if (!window.__tvCountries) {
    chips.innerHTML = '<div class="tv-loading">Cargando países…</div>';
    try {
      const r = await fetch("/api/tv/countries");
      const data = await r.json();
      window.__tvCountries = (data && data.countries) || [];
    } catch (e) {
      chips.innerHTML = `<div class="tv-loading">Error países</div>`;
      return;
    }
  }

  // Priorizar LATAM / ES / US al frente
  const priority = ["mx", "es", "ar", "co", "cl", "pe", "us", "ve", "ec"];
  const countries = window.__tvCountries.slice().sort((a, b) => {
    const ia = priority.indexOf(a.code);
    const ib = priority.indexOf(b.code);
    if (ia === -1 && ib === -1) return String(a.name).localeCompare(String(b.name));
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });

  chips.innerHTML = countries
    .map(
      (c) =>
        `<button type="button" class="tv-chip" data-code="${escapeHtml(c.code)}">${escapeHtml(
          (c.name || c.code).toString()
        )}</button>`
    )
    .join("");

  chips.querySelectorAll(".tv-chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      chips.querySelectorAll(".tv-chip").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      cargarTvPais(btn.getAttribute("data-code"));
    });
  });

  // Auto México si existe
  const mx = chips.querySelector('.tv-chip[data-code="mx"]');
  if (mx) mx.click();
  else box.innerHTML = '<div class="tv-hint">Elige un país</div>';
}

async function cargarTvPais(code) {
  const box = document.getElementById("tv-canales-pais");
  if (!box) return;
  box.innerHTML = '<div class="tv-loading">Cargando canales…</div>';
  try {
    const r = await fetch("/api/tv/countries/" + encodeURIComponent(code));
    const data = await r.json();
    if (!data || !data.success) throw new Error((data && data.error) || "Error");
    renderTvCanales(box, data.canales || []);
  } catch (e) {
    box.innerHTML = `<div class="tv-loading">Error: ${escapeHtml(e.message || e)}</div>`;
  }
}

function renderTvCanales(container, lista) {
  // Solo canales que sí se pueden ver en el navegador (https / proxy_ok)
  const reproducibles = (lista || []).filter(function (c) {
    var u = c.play_url || c.url || "";
    return c.proxy_ok === true || /^https:\/\//i.test(u);
  });
  const ordered = ordenarCanalesFamososPrimero(reproducibles); 
  if (!ordered.length) {
    container.innerHTML = '<div class="tv-hint">Sin canales</div>';
    return;
  }
  container.innerHTML = ordered
    .map((c, i) => {
      const logo = c.logo
        ? `<img src="${escapeHtml(c.logo)}" alt="" loading="lazy" onerror="this.style.display='none'">`
        : `<ion-icon name="tv-outline" style="font-size:40px;opacity:.5"></ion-icon>`;
      return `<button type="button" class="tv-canal-card" data-idx="${i}">
        ${logo}
        <div class="tv-canal-nombre">${escapeHtml(c.nombre || "Canal")}</div>
      </button>`;
    })
    .join("");

  container.querySelectorAll(".tv-canal-card").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.getAttribute("data-idx"));
      const canal = ordered[idx];
      if (canal && canal.url) reproducirCanalTv(canal);
    });
  });
}



function abrirPanelPlayerTv() {
  const panel = document.getElementById("details-panel");
  if (panel) panel.classList.remove("hidden");
  if (typeof videoContainer !== "undefined" && videoContainer) {
    videoContainer.classList.remove("hidden");
  }
  document.body.classList.add("player-open");
}

function tvPlayUrl(canal) {
  // La API ya trae play_url lista (con proxy si proxy_ok)
  if (canal && typeof canal === "object") {
    if (canal.play_url) return canal.play_url;
    if (canal.url) return canal.url;
  }
  if (typeof canal === "string") return canal;
  return "";
}

function reproducirCanalTv(canal) {
  if (!canal || !canal.url) return;
  if (window.__tvPlayingLock) return;
  window.__tvPlayingLock = true;
  setTimeout(() => { window.__tvPlayingLock = false; }, 1000);

  try {
    abrirPanelPlayerTv();
    if (typeof destruirHls === "function") destruirHls();

    const vid = typeof ensurePlayerVideoEl === "function" ? ensurePlayerVideoEl() : null;
    const titleEl = document.getElementById("player-title");
    if (titleEl) titleEl.textContent = "Cargando: " + (canal.nombre || "TV");

    if (!vid) {
      window.open(canal.url, "_blank");
      return;
    }

    if (typeof playerIframe !== "undefined" && playerIframe) {
      playerIframe.classList.add("hidden");
      playerIframe.src = "about:blank";
    }
    vid.classList.remove("hidden");
    if (typeof mostrarBotonFullscreen === "function") mostrarBotonFullscreen(true);

    const playUrl = tvPlayUrl(canal);

    const start = () => {
      if (window.Hls && window.Hls.isSupported()) {
        try {
          if (typeof _hlsInstance !== "undefined" && _hlsInstance) {
            _hlsInstance.destroy();
          }
        } catch (_) {}

        const hls = new window.Hls({
          enableWorker: true,
          maxErrorRetry: 3,
          manifestLoadingMaxRetry: 3,
          levelLoadingMaxRetry: 3,
          fragLoadingMaxRetry: 3,
        });
        try { _hlsInstance = hls; } catch (_) { window.__tvHls = hls; }

        hls.on(window.Hls.Events.ERROR, function (_e, data) {
          if (!data || !data.fatal) return;
          console.warn("TV HLS fatal", data);
          if (titleEl) titleEl.textContent = (canal.nombre || "Canal") + " — no disponible";
          try { hls.destroy(); } catch (_) {}
        });

        hls.loadSource(playUrl);
        hls.attachMedia(vid);
        hls.on(window.Hls.Events.MANIFEST_PARSED, function () {
          if (titleEl) titleEl.textContent = canal.nombre || "TV en vivo";
          const p = vid.play();
          if (p && p.catch) p.catch(() => {});
        });
      } else if (vid.canPlayType("application/vnd.apple.mpegurl")) {
        vid.src = playUrl;
        if (titleEl) titleEl.textContent = canal.nombre || "TV en vivo";
        vid.play().catch(() => {});
      } else {
        if (titleEl) titleEl.textContent = "Este navegador no soporta HLS";
      }

      requestAnimationFrame(() => {
        const box = document.getElementById("video-player-container");
        if (box) {
          try { box.scrollIntoView({ behavior: "smooth", block: "center" }); }
          catch (_) { box.scrollIntoView(true); }
        }
      });
    };

    if (window.Hls) {
      start();
    } else {
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/hls.js@1.5.15/dist/hls.min.js";
      s.onload = start;
      s.onerror = () => {
        if (titleEl) titleEl.textContent = "No se pudo cargar hls.js";
      };
      document.head.appendChild(s);
    }
  } catch (err) {
    console.error("reproducirCanalTv", err);
    const titleEl = document.getElementById("player-title");
    if (titleEl) titleEl.textContent = "Error al reproducir";
  }
}

function scrollPlayerTv() {
  requestAnimationFrame(() => {
    const box = document.getElementById("video-player-container");
    if (!box) return;
    try {
      box.scrollIntoView({ behavior: "smooth", block: "center" });
    } catch (e) {
      box.scrollIntoView(true);
    }
  });
}

// =====================================================
// Fútbol — agenda diaria (Worker /7/agenda)
// =====================================================
const FUTBOL_AGENDA_URL = (typeof WORKER_STREAM !== "undefined" ? WORKER_STREAM : "https://moviezone.tvjz.workers.dev") + "/8/agenda";

const FUTBOL_LIGA_META = {
  CHA: { label: "Champions League", short: "UCL", color: "#1e3a8a" },
  LIB: { label: "Copa Libertadores", short: "LIB", color: "#b45309" },
  SUD: { label: "Copa Sudamericana", short: "SUD", color: "#047857" },
  ENG: { label: "Premier League", short: "ENG", color: "#6d28d9" },
  FIFA: { label: "FIFA", short: "FIFA", color: "#0ea5e9" },
  AR:  { label: "Liga Argentina", short: "ARG", color: "#0369a1" },
  FUT: { label: "Fútbol", short: "FUT", color: "#7c3aed" }
};

function futbolHoyKey() {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
                              
function futbolMatchKey(item) {
  return futbolHoyKey() + "_" + String(item.titulo || "").toLowerCase().replace(/\s+/g, "_").slice(0, 80);
}

/** Espectadores simulados estables por partido (sin backend) */
function futbolViewers(item) {
  const s = String(item.titulo || "") + "|" + (item.hora || "");
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return 180 + (h % 7800);
}

function futbolServerIcon(name) {
  const n = String(name || "").toLowerCase();
  if (/disney/.test(n)) return "🎬";
  if (/espn/.test(n)) return "📺";
  if (/fox/.test(n)) return "FOX";
  if (/paramount/.test(n)) return "★";
  if (/tudn|univision/.test(n)) return "T";
  if (/max|hbo/.test(n)) return "M";
  if (/tyc/.test(n)) return "TYC";
  if (/directv|dsports/.test(n)) return "DTV";
  if (/eventos/.test(n)) return "▶";
  return String(name || "SRV").slice(0, 3).toUpperCase();
}

function futbolParseHora(hhmm) {
  if (!hhmm) return null;
  const m = String(hhmm).match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

function futbolEsEnVivo(item) {
  const mins = futbolParseHora(item.hora);
  if (mins == null) return false;
  const now = new Date();
  const nowM = now.getHours() * 60 + now.getMinutes();
  // ventana: 10 min antes → 2h después
  let d = nowM - mins;
  if (d < -12 * 60) d += 24 * 60;
  if (d > 12 * 60) d -= 24 * 60;
  return d >= -10 && d <= 120;
}



function showFutbolView() {
  document.getElementById("home-view")?.classList.add("hidden");
  document.getElementById("tv-view")?.classList.add("hidden");
  document.getElementById("futbol-partido-view")?.classList.add("hidden");
  document.getElementById("grid-view")?.classList.add("hidden");
  const fv = document.getElementById("futbol-view");
  if (fv) fv.classList.remove("hidden");
  cargarFutbolAgenda();
}

function hideFutbolViews() {
  document.getElementById("futbol-view")?.classList.add("hidden");
  document.getElementById("futbol-partido-view")?.classList.add("hidden");
}

function futbolLigaMeta(code, ligaNombre) {
  const base = FUTBOL_LIGA_META[code] || null;
  if (base) return base;
  const label = ligaNombre || code || "Fútbol";
  const short = String(code || label).slice(0, 4).toUpperCase();
  return { label: label, short: short, color: "#4c1d95" };
}

function futbolCardLogos(it) {
  // StreamXHD: home_logo / away_logo
  const home = it.home_logo || it.homeLogo || null;
  const away = it.away_logo || it.awayLogo || null;
  if (home || away) {
    return (
      '<div class="futbol-logos">' +
        (home ? '<img src="' + escapeHtml(home) + '" alt="" loading="lazy" />' : '<span class="futbol-logo-ph"></span>') +
        '<span class="futbol-vs">vs</span>' +
        (away ? '<img src="' + escapeHtml(away) + '" alt="" loading="lazy" />' : '<span class="futbol-logo-ph"></span>') +
      "</div>"
    );
  }
  const meta = futbolLigaMeta(it.liga, it.liga_nombre);
  return '<div class="futbol-liga-ico" style="background:' + meta.color + '">' + escapeHtml(meta.short) + "</div>";
}

async function cargarFutbolAgenda() {
  const lista = document.getElementById("futbol-lista");
  const fechaEl = document.getElementById("futbol-fecha-texto");
  if (!lista) return;
  lista.innerHTML = '<div class="tv-loading">Cargando partidos…</div>';

  try {
    const r = await fetch(FUTBOL_AGENDA_URL, { cache: "no-store" });
    const data = await r.json();
    const items = Array.isArray(data.items) ? data.items.slice() : [];

      const limpios = items.filter(function (it) {
      const t = String(it.titulo || "").trim();
      if (!t || /^partido$/i.test(t) || t.length < 4) return false;
      const reps = it.reproductores || it.embeds || [];
      return Array.isArray(reps) && reps.length > 0;
    });

    limpios.sort(function (a, b) {
      const ma = futbolParseHora(a.hora);
      const mb = futbolParseHora(b.hora);
      if (ma == null && mb == null) return 0;
      if (ma == null) return 1;
      if (mb == null) return -1;
      return ma - mb;
    });
    limpios.sort(function (a, b) {
      return (futbolEsEnVivo(b) ? 1 : 0) - (futbolEsEnVivo(a) ? 1 : 0);
    });

    window.__futbolAgenda = limpios;
    
    if (fechaEl) {
      fechaEl.textContent = data.fecha_texto || ("Agenda · " + futbolHoyKey());
    }

    // Orden por hora (usa hora, no hora_fuente)
    items.sort(function (a, b) {
      const ma = futbolParseHora(a.hora);
      const mb = futbolParseHora(b.hora);
      if (ma == null && mb == null) return 0;
      if (ma == null) return 1;
      if (mb == null) return -1;
      return ma - mb;
    });

    // En vivo primero
    items.sort(function (a, b) {
      return (futbolEsEnVivo(b) ? 1 : 0) - (futbolEsEnVivo(a) ? 1 : 0);
    });

    window.__futbolAgenda = items;

    if (!items.length) {
      lista.innerHTML = '<div class="tv-hint">No hay partidos hoy</div>';
      return;
    }

    lista.innerHTML = limpios.map(function (it, idx) {
      const meta = futbolLigaMeta(it.liga, it.liga_nombre);
      const vivo = it.status === "en_vivo" || futbolEsEnVivo(it);
      const pronto = it.status === "pronto";
      const ligaTxt = it.liga_nombre || meta.label;
      const subEquipos =
        it.home_team && it.away_team
          ? escapeHtml(it.home_team + " vs " + it.away_team)
          : escapeHtml(it.titulo || "");

      return (
        '<button type="button" class="futbol-card' +
        (vivo ? " en-vivo" : "") +
        (pronto ? " pronto" : "") +
        '" data-fidx="' + idx + '">' +
          futbolCardLogos(it) +
          '<div class="futbol-card-body">' +
            '<div class="futbol-liga-row"><span class="futbol-liga-pill" style="background:' +
            meta.color +
            '">' +
            escapeHtml(ligaTxt) +
            "</span>" +
            (it.deporte_icono
             ? '<span class="futbol-deporte-ico">' + escapeHtml(it.deporte_icono) + "</span>"
             : "") +
            "</div>" +
            '<p class="futbol-card-titulo">' +
            escapeHtml(it.titulo || subEquipos) +
            "</p>" +
            '<div class="futbol-card-sub">' + 
        (vivo ? '<span class="futbol-badge-vivo">En vivo</span>' : "") +
        (pronto ? '<span class="futbol-badge-pronto">Pronto</span>' : "") + 
        '<span class="futbol-serv-count">' + (it.reproductores || []).length + " servidores</span>" +
            "</div>" +
          "</div>" +
          '<div class="futbol-hora">' +
          escapeHtml(it.hora || "--:--") +
          "</div>" +
        "</button>"
      );
    }).join("");

    lista.querySelectorAll(".futbol-card").forEach(function (btn) {
      btn.addEventListener("click", function () {
        const i = parseInt(btn.getAttribute("data-fidx"), 10);
        const item = window.__futbolAgenda && window.__futbolAgenda[i];
        if (item) abrirFutbolPartido(item);
      });
    });
  } catch (e) {
    lista.innerHTML = '<div class="tv-hint">No se pudo cargar la agenda</div>';
  }
}

function abrirFutbolPartido(item) {
  document.getElementById("futbol-view")?.classList.add("hidden");
  document.getElementById("futbol-partido-view")?.classList.remove("hidden");
  window.__futbolPartidoActual = item;

  const t = document.getElementById("futbol-partido-titulo");
  if (t) t.textContent = item.titulo || "Partido";

  const metaL = futbolLigaMeta(item.liga, item.liga_nombre);
  const meta = document.getElementById("futbol-partido-meta");
  if (meta) {
    const vivo = item.status === "en_vivo" || futbolEsEnVivo(item);
    const pronto = item.status === "pronto";
    meta.innerHTML =
      '<div class="futbol-detalle-top">' +
      futbolCardLogos(item) +
      "<div>" +
      '<span class="futbol-liga-pill" style="background:' +
      metaL.color +
      '">' +
      escapeHtml(item.liga_nombre || metaL.label) +
      "</span> " +
      (item.hora ? "<strong>" + escapeHtml(item.hora) + "</strong> " : "") +
      (vivo ? '<span class="futbol-badge-vivo">En vivo</span>' : "") +
      (pronto ? '<span class="futbol-badge-pronto">Pronto</span>' : "") +
      (item.timezone ? '<span class="futbol-tz"> · ' + escapeHtml(item.timezone) + "</span>" : "") +
      "</div></div>";
  }

  // Reset player
  const iframe = document.getElementById("futbol-player-iframe");
  const ph = document.getElementById("futbol-player-placeholder");
  if (iframe) {
    iframe.src = "";
    iframe.classList.add("hidden");
  }
  if (ph) ph.classList.remove("hidden");
  document.getElementById("futbol-chat-block")?.classList.add("hidden");

  const box = document.getElementById("futbol-reproductores");
  const reps = Array.isArray(item.reproductores) ? item.reproductores : [];
  if (!box) return;
  if (!reps.length) {
    box.innerHTML = '<div class="tv-hint">Sin reproductores</div>';
    return;
  }

  box.innerHTML = reps.map(function (r, i) {
    const name = r.servidor || "Server";
    const cal = r.calidad ? " · " + r.calidad : "";
    const ico = futbolServerIcon(name);
    return (
      '<button type="button" class="futbol-rep-btn" data-ri="' + i + '">' +
        '<span class="futbol-rep-ico">' + escapeHtml(ico) + "</span>" +
        "<span><strong>" + escapeHtml(name) + "</strong>" + escapeHtml(cal) + "</span>" +
      "</button>"
    );
  }).join("");

  box.querySelectorAll(".futbol-rep-btn").forEach(function (btn) {
    btn.addEventListener("click", function () {
      const ri = parseInt(btn.getAttribute("data-ri"), 10);
      const rep = reps[ri];
      if (!rep || !rep.url) return;
      futbolPlayEmbed(rep.url);
    });
  });
}

function futbolPlayEmbed(url) {
  const iframe = document.getElementById("futbol-player-iframe");
  const ph = document.getElementById("futbol-player-placeholder");
  if (!iframe) return;
  if (ph) ph.classList.add("hidden");
  iframe.classList.remove("hidden");
  iframe.src = url;
  // Chat solo al reproducir
  document.getElementById("futbol-chat-block")?.classList.remove("hidden");
  futbolChatRender();
}

function futbolChatStorageKey() {
  const it = window.__futbolPartidoActual;
  if (!it) return null;
  return "mz_fl_chat_" + futbolMatchKey(it);
}

function futbolChatLoad() {
  try {
    const k = futbolChatStorageKey();
    if (!k) return [];
    // Limpiar chats de otros días
    const prefix = "mz_fl_chat_" + futbolHoyKey();
    Object.keys(localStorage).forEach(function (key) {
      if (key.indexOf("mz_fl_chat_") === 0 && key.indexOf(prefix) !== 0) {
        try { localStorage.removeItem(key); } catch (_) {}
      }
    });
    const raw = localStorage.getItem(k);
    return raw ? JSON.parse(raw) : [];
  } catch (_) {
    return [];
  }
}

function futbolChatSave(msgs) {
  try {
    const k = futbolChatStorageKey();
    if (!k) return;
    localStorage.setItem(k, JSON.stringify(msgs.slice(-80)));
  } catch (_) {}
}

function futbolChatRender() {
  const el = document.getElementById("futbol-chat-msgs");
  if (!el) return;
  const msgs = futbolChatLoad();
  if (!msgs.length) {
    el.innerHTML = '<div class="tv-hint">Sé el primero en comentar</div>';
    return;
  }
  el.innerHTML = msgs.map(function (m) {
    return (
      '<div class="futbol-chat-line"><strong>' +
      escapeHtml(m.user || "Anon") +
      ":</strong> " +
      escapeHtml(m.text || "") +
      "</div>"
    );
  }).join("");
  el.scrollTop = el.scrollHeight;
}

function initFutbolUI() {
  document.getElementById("btn-tv-futbol")?.addEventListener("click", function () {
    showFutbolView();
  });
  document.getElementById("futbol-btn-back")?.addEventListener("click", function () {
    hideFutbolViews();
    document.getElementById("home-view")?.classList.remove("hidden");
  });
  document.getElementById("futbol-partido-back")?.addEventListener("click", function () {
    document.getElementById("futbol-partido-view")?.classList.add("hidden");
    document.getElementById("futbol-view")?.classList.remove("hidden");
  });
  document.getElementById("futbol-chat-form")?.addEventListener("submit", function (ev) {
    ev.preventDefault();
    const input = document.getElementById("futbol-chat-input");
    const text = (input && input.value || "").trim();
    if (!text) return;
    const p = typeof getActiveProfile === "function" ? getActiveProfile() : null;
    const user = (p && p.nombre) || "Usuario";
    const msgs = futbolChatLoad();
    msgs.push({ user: user, text: text, ts: Date.now() });
    futbolChatSave(msgs);
    if (input) input.value = "";
    futbolChatRender();
  });
}

// Llamar al iniciar la app (junto al resto de listeners de TV)
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initFutbolUI);
} else {
  initFutbolUI();
}

function initTvUi() {
  const btnCable = document.getElementById("btn-tv-cable");
  const btnPaises = document.getElementById("btn-tv-paises");
  const back = document.getElementById("tv-btn-back");
  const tabCable = document.getElementById("tv-tab-cable");
  const tabPaises = document.getElementById("tv-tab-paises");

  if (btnCable) btnCable.addEventListener("click", () => abrirTvView("cable"));
  if (btnPaises) btnPaises.addEventListener("click", () => abrirTvView("paises"));
  if (back) back.addEventListener("click", cerrarTvView);
  if (tabCable) tabCable.addEventListener("click", () => setTvTab("cable"));
  if (tabPaises) tabPaises.addEventListener("click", () => setTvTab("paises"));
}

function aplicarFiltrosYOrden(lista) {
    let res = [...(lista || [])];

    if (gridTypeFilter !== "all") {
        const map = { movie: "Película", series: "Serie", anime: "Anime" };
        const wanted = map[gridTypeFilter] || gridTypeFilter;
        res = res.filter(i => {
            const t = (i.tipo || "").toString();
            return t === wanted || t.toLowerCase().includes(gridTypeFilter);
        });
    }

    if (gridSort === "rating") {
        res.sort((a, b) => (Number(b.calificacion) || 0) - (Number(a.calificacion) || 0));
    } else if (gridSort === "az") {
        res.sort((a, b) => (a.nombre || "").localeCompare(b.nombre || "", "es", { sensitivity: "base" }));
    } else {
        // más reciente
        res.sort((a, b) => {
            const da = a.created_at ? new Date(a.created_at).getTime() : (Number(a.year) || 0);
            const db = b.created_at ? new Date(b.created_at).getTime() : (Number(b.year) || 0);
            return db - da;
        });
    }
    return res;
}

function mostrarGrid({ modo, seccion = "movie", termino = "" }) {
    vistaActual = "grid";
    gridModo = modo;
    gridSeccion = seccion;
    gridTermino = termino;
    gridPage = 1;
    gridSinMasResultados = false;

    // Si NO es búsqueda → ocultar “Buscar online”
    if (modo !== "search") {
        actualizarBotonOnline(false);
        busquedaEsLocal = true;
    }

    homeView.classList.add("hidden");
    gridView.classList.remove("hidden");

    document.querySelectorAll(".filter-tab").forEach(el => el.classList.remove("active"));
    document.getElementById("nav-item-home").classList.remove("active");
    document.getElementById("nav-item-favoritos")?.classList.toggle("active", modo === "favoritos");

    document.querySelectorAll(".filter-chip").forEach(chip => {
        chip.classList.toggle("active", chip.dataset.type === seccion || (chip.dataset.type === "all" && modo !== "categoria"));
    });

    if (modo === "search") {
        resultsTitle.textContent = `Resultados para "${termino}"`;
        document.getElementById("filter-toolbar").classList.remove("hidden");
        busquedaEsLocal = false; // online
    } else if (modo === "favoritos") {
        resultsTitle.innerHTML = `<ion-icon name="heart" style="vertical-align:-3px;"></ion-icon> Mis Favoritos`;
        document.getElementById("filter-toolbar").classList.add("hidden");
    } else {
        resultsTitle.textContent = seccion === "movie" ? "Películas" : seccion === "series" ? "Series" : "Anime";
        document.getElementById("filter-toolbar").classList.remove("hidden");
        const navMap = { movie: "nav-item-movies", series: "nav-item-series", anime: "nav-item-anime" };
        document.getElementById(navMap[seccion])?.classList.add("active");
    }

    resultsGrid.innerHTML = "";
    resultsEmpty.classList.add("hidden");
    scrollSentinel.classList.add("hidden");
    cargarPaginaGrid();
    window.scrollTo({ top: 0, behavior: "smooth" });
}

// ======================================================
// CARGA DE DATOS (conectado a tu server.js real)
// ======================================================
async function fetchSeccion(seccion, page, limit = LIMIT) {
    const data = await getCatalog(seccion, page, limit);
    const lista = data.resultados || [];

    // Películas: 761 páginas del worker (1 = estrenos)
    if (seccion === "movie" || seccion === "peliculas" || seccion === "pelicula") {
        gridTotalPages = data.totalPages || data.pages || 761;
        gridTotalItems = data.total || gridTotalPages * limit;
    } else {
        gridTotalItems = data.total || 0;
        gridTotalPages = Math.max(1, Math.ceil(gridTotalItems / limit));
    }

    return lista;
}

// Estado extra: por defecto ONLINE (la API tiene muchos más resultados que Supabase local)
let busquedaEsLocal = false;

async function fetchBusqueda(termino, source = "online", page = 1, limit = LIMIT) {
    // Nunca forzar local: el buscador usa la API Worker
    const src = source === "local" ? "local" : "online";
    let data;
    try {
        data = await searchCatalog(termino, src, page, limit);
    } catch (e) {
        // Fallback directo al backend si el módulo falla
        const q = new URLSearchParams({ q: termino, source: src, page: String(page), limit: String(limit) });
        const res = await fetch("/api/buscar?" + q.toString(), { cache: "no-store" });
        data = await res.json();
    }
    const lista = data.resultados || data.results || [];
    return {
        resultados: lista,
        total: data.total ?? data.count ?? lista.length,
        page: data.page ?? page,
        limit: data.limit ?? limit,
        source: data.source || src
    };
}

function actualizarBotonOnline(mostrar) {
    let btn = document.getElementById("btn-buscar-online");
    if (!btn) {
        const header = document.querySelector(".grid-header");
        if (!header) return;

        btn = document.createElement("button");
        btn.id = "btn-buscar-online";
        btn.className = "btn-buscar-online hidden";
        btn.style.display = "none";
        btn.innerHTML = `
            <ion-icon name="search-outline"></ion-icon>
            <span>Buscar online</span>
        `;
        btn.addEventListener("click", async () => {
            if (!gridTermino || gridCargando) return;
            busquedaEsLocal = false;
            btn.disabled = true;
            btn.innerHTML = `<div class="spinner-inline"></div> Buscando online...`;
            await cargarPaginaGrid();
        });
        header.appendChild(btn);
    }

    if (mostrar && gridModo === "search") {
        btn.classList.remove("hidden");
        btn.style.display = "inline-flex";
        btn.disabled = false;
        btn.innerHTML = `
            <ion-icon name="search-outline"></ion-icon>
            <span>Buscar online</span>
        `;
    } else {
        btn.classList.add("hidden");
        btn.style.display = "none";
    }
}

async function cargarPaginaGrid() {
    if (gridCargando) return;
    gridCargando = true;

    // Skeleton en vez de solo spinner
    const skeleton = document.getElementById("results-skeleton");
    if (skeleton) skeleton.classList.remove("hidden");
    resultsLoading.classList.add("hidden");          // ocultamos el spinner viejo
    resultsEmpty.classList.add("hidden");
    resultsGrid.innerHTML = "";
    scrollSentinel.classList.add("hidden");

    try {
        let lista = [];

        if (gridModo === "favoritos") {
            lista = obtenerFavoritos();
            gridTotalItems = lista.length;
            gridTotalPages = 1;
            gridPage = 1;
            actualizarBotonOnline(false);
        } else if (gridModo === "search") {
            // Siempre online primero; local solo si el usuario lo pidiera explícitamente
            const data = await fetchBusqueda(gridTermino, busquedaEsLocal ? "local" : "online", gridPage, LIMIT);
            lista = data.resultados;
            gridTotalItems = data.total || lista.length;
            gridTotalPages = Math.max(1, Math.ceil(gridTotalItems / LIMIT));
            // Botón online ya no hace falta (búsqueda es online por defecto)
            actualizarBotonOnline(false);
        } else {
            actualizarBotonOnline(false);
            // Sección normal → aquí se actualiza gridTotalItems y gridTotalPages
            lista = await fetchSeccion(gridSeccion, gridPage, LIMIT);
        }

        // Aplica filtros de tipo + orden (Más reciente / Calificación / A-Z)
        const listaFinal = aplicarFiltrosYOrden(lista);

        renderGridItems(listaFinal, true);
        resultsCount.textContent = `${listaFinal.length} items` +
            (gridTotalItems > listaFinal.length ? ` (de ${gridTotalItems})` : "");

        if (listaFinal.length === 0) {
            resultsEmpty.classList.remove("hidden");
        }

        actualizarPaginacion();

    } catch (err) {
        console.error(err);
        resultsEmpty.classList.remove("hidden");
        resultsEmpty.querySelector("p").textContent = "No se pudo cargar la sección.";
    } finally {
        // Ocultar skeleton cuando termina de cargar
        if (skeleton) skeleton.classList.add("hidden");
        resultsLoading.classList.add("hidden");
        gridCargando = false;
    }
}

// ---------- Infinite scroll (DESACTIVADO - ahora usamos botones) ----------
// ---------- Infinite scroll ----------
/*
const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting && vistaActual === "grid" && !gridSinMasResultados) {
            cargarPaginaGrid();
        }
    });
}, { rootMargin: "300px" });
observer.observe(scrollSentinel);
*/

// ======================================================
// RENDER: TARJETAS (media-card)
// ======================================================

/** Si la portada de una tarjeta falla, pedir el detalle (que sí la resuelve bien) y usarla */
let __reparacionesPortadaActivas = 0;
const MAX_REPARACIONES_PORTADA_PARALELAS = 10;
async function repararPortadaDesdeDetalle(item, imgEl) {
    if (__reparacionesPortadaActivas >= MAX_REPARACIONES_PORTADA_PARALELAS) return;
    __reparacionesPortadaActivas++;
    try {
        const params = new URLSearchParams();
        if (item.slug) params.set("slug", item.slug);
        if (item.source_id) params.set("source_id", item.source_id);
        if (item.tipo) params.set("tipo", item.tipo);
        if (item.link) params.set("link", item.link);
        if (![...params.keys()].length) return;

        const res = await fetch(`/api/detalle?${params.toString()}`, { cache: "no-store" });
        if (!res.ok) return;
        const completo = await res.json();
        if (completo && completo.portada && !String(completo.portada).includes("placeholder")) {
            imgEl.src = completo.portada;
            imgEl.dataset.failed = "0";
        }
    } catch (err) {
        // Silencioso: se queda con el placeholder genérico si tampoco hay portada en detalle
    } finally {
        __reparacionesPortadaActivas--;
    }
}

function crearMediaCard(item) {
    const card = document.createElement("div");
    card.className = "media-card";

    const portada = item.portada || PLACEHOLDER;
    const nombre = item.nombre || item.titulo || "Sin título";
    const tipo = tipoLabel(item.tipo);
    // Siempre mostrar calificación (0 si no tiene)
    const rating = ratingInfo(item).label;
    const tieneVideo = item.tiene_player === true || itemTieneVideo(item);

    const generoCorto = item.genero
        ? String(item.genero).split(",")[0].trim()
        : "";
    const sublinea = item.episodios && item.episodios.length
        ? `${item.episodios.length} episodios`
        : [item.year, generoCorto || tipo].filter(Boolean).join(" · ");

    const esSerie = /serie|anime/i.test(String(item.tipo || ""));
    const enEmision = esSerie && (
      item.en_emision === true ||
      /emisi|airing|ongoing|en curso/i.test(String(item.estado || ""))
    );

    card.innerHTML = `
        <div class="poster-wrapper">
            <img class="poster-img" src="${escapeHtml(portada)}" alt="${escapeHtml(nombre)}" loading="lazy">
            <div class="poster-overlay"><ion-icon name="play-circle" class="overlay-icon"></ion-icon></div>
            ${ratingBadgeHtml(item)}
            <span class="type-badge">${escapeHtml(tipo)}</span>
            <div class="poster-bottom-row">
              ${enEmision
                ? `<span class="airing-badge">En emisión</span>`
                : (item.finalizado === true || /final|ended|complet|conclu/i.test(String(item.estado || ""))
                    ? `<span class="availability-badge unavailable"><span class="dot"></span> Finalizado</span>`
                    : "")}
            </div>
        </div>
        <div class="media-info">
            <h3>${escapeHtml(nombre)}</h3>
            <p>${escapeHtml(sublinea)}</p>
        </div>
    `;

    const img = card.querySelector("img");
    img.addEventListener("error", (e) => {
        // Evitar bucle de reintentos / parpadeo si la portada no existe
        if (e.target.dataset.failed === "1") return;
        e.target.dataset.failed = "1";
        e.target.src = PLACEHOLDER;
        e.target.style.opacity = "1";
        // La portada de listado a veces falla aunque la de detalle sí funciona:
        // intentar reparar trayendo la portada real desde /api/detalle.
        repararPortadaDesdeDetalle(item, e.target);
    });
    // Si no hay portada real, no forzar carga de URL vacía
    if (!item.portada) {
        img.src = PLACEHOLDER;
        img.dataset.failed = "1";
    }
    card.addEventListener("click", () => abrirDetalle(item));
    return card;
}

function renderGridItems(lista, limpiar) {
    if (limpiar) resultsGrid.innerHTML = "";
    const seen = new Set();
    (lista || []).forEach(function (item) {
        if (!item) return;
        const k = (item.link || "") + "|" + (item.slug || "") + "|" + (item.year || "") + "|" + (item.nombre || item.titulo || "");
        if (seen.has(k)) return;
        seen.add(k);
        resultsGrid.appendChild(crearMediaCard(item));
    });
}

function ensurePelisPaginationUI() {
  const row = document.getElementById("carousel-movies")?.closest(".carousel-row");
  if (!row) return;
  let bar = document.getElementById("pelis-pagination");
  if (!bar) {
    bar = document.createElement("div");
    bar.id = "pelis-pagination";
    bar.className = "pelis-pagination";
    bar.innerHTML =
      '<button type="button" id="pelis-prev" class="pelis-page-btn">Anterior</button>' +
      '<span id="pelis-page-info" class="pelis-page-info"></span>' +
      '<button type="button" id="pelis-next" class="pelis-page-btn">Siguiente</button>';
    row.appendChild(bar);
    document.getElementById("pelis-prev")?.addEventListener("click", () => cargarPaginaPeliculas(-1));
    document.getElementById("pelis-next")?.addEventListener("click", () => cargarPaginaPeliculas(1));
  }
  actualizarPelisPaginationUI();
}

function actualizarPelisPaginationUI() {
  const info = document.getElementById("pelis-page-info");
  const prev = document.getElementById("pelis-prev");
  const next = document.getElementById("pelis-next");
  const page = window.__mzPelisPage || 1;
  const pages = window.__mzPelisPages || 761;
  // UI: 1 = estrenos; 2..761 = catálogo worker page 2..761
  if (info) info.textContent = page === 1 ? "Estrenos" : `Página ${page} / ${pages}`;
  if (prev) prev.disabled = page <= 1 || !!window.__mzPelisLoading;
  if (next) next.disabled = page >= pages || !!window.__mzPelisLoading;
}

async function cargarPaginaPeliculas(delta) {
  if (window.__mzPelisLoading) return;
  const page = (window.__mzPelisPage || 1) + delta;
  const pages = window.__mzPelisPages || 761;
  if (page < 1 || page > pages) return;

  window.__mzPelisLoading = true;
  actualizarPelisPaginationUI();

  try {
    if (page === 1) {
      // Estrenos
      const res = await fetch("/api/estrenos?tipo=peliculas&limit=24", { cache: "no-store" });
      const data = await res.json();
      window.__mzPelisItems = data.resultados || [];
    } else {
      // Catálogo worker: page 2..761
      const res = await fetch("/api/peliculas?page=" + page + "&limit=24", { cache: "no-store" });
      const data = await res.json();
      window.__mzPelisItems = data.resultados || [];
      if (data.pages) window.__mzPelisPages = data.pages;
    }
    window.__mzPelisPage = page;
    renderCarousel("carousel-movies", window.__mzPelisItems);
  } catch (e) {
    console.warn("paginacion peliculas", e);
  } finally {
    window.__mzPelisLoading = false;
    actualizarPelisPaginationUI();
  }
}
function renderCarousel(contenedorId, lista) {
    const el = document.getElementById(contenedorId);
    el.innerHTML = "";
    if (!lista.length) {
        el.innerHTML = `<p style="color:var(--text-muted);">No hay contenido disponible por ahora.</p>`;
        return;
    }
    lista.forEach(item => {
        const card = crearMediaCard(item);
        card.classList.add("carousel-card");
        // Textos más cortos en el carrusel de inicio (tarjetas estrechas)
        const badge = card.querySelector(".availability-badge");
        if (badge) {
            const ok = badge.classList.contains("available");
            badge.innerHTML = ok
                ? '<span class="dot"></span> Disponible'
                : '<span class="dot"></span> Sin servers';
        }
        el.appendChild(card);
    });
}

// ======================================================
// HERO BANNER
// ======================================================
function pintarHero(item) {
    if (!item) return;

    // Solo tipo, sin "RECOMENDADA"
    heroType.textContent = tipoLabel(item.tipo).toUpperCase();

    heroTitle.textContent = item.nombre || item.titulo || "Sin título";

    const heroR = ratingInfo(item);
    heroRating.textContent = heroR.label;
    heroRating.title = heroR.secondary ? heroR.label + " · " + heroR.secondary : heroR.label;
    if (heroRating.parentElement) {
        heroRating.parentElement.classList.remove("rating-src-imdb", "rating-src-tmdb", "rating-src-omdb", "rating-src-fuente");
        if (heroR.source) heroRating.parentElement.classList.add("rating-src-" + heroR.source);
    }

    heroYear.textContent = item.year || "-";

    // Estado en series / anime
    const statusEl = document.getElementById("hero-status");
    if (statusEl) {
        const t = String(item.tipo || "").toLowerCase();
        const esSerie = /serie|anime/.test(t);
        let label = "";
        if (esSerie) {
            if (item.en_emision === true || /emisi|airing|ongoing|en curso/i.test(String(item.estado || ""))) {
                label = "En emisión";
            } else if (item.finalizado === true || /final|conclu|ended|finished/i.test(String(item.estado || ""))) {
                label = "Finalizado";
            } else if (item.estado) {
                label = String(item.estado);
            }
        }
        if (label) {
            statusEl.textContent = label;
            statusEl.classList.remove("hidden", "is-air", "is-end");
            if (/emisi/i.test(label)) statusEl.classList.add("is-air");
            else if (/final/i.test(label)) statusEl.classList.add("is-end");
            statusEl.classList.remove("hidden");
        } else {
            statusEl.textContent = "";
            statusEl.classList.add("hidden");
        }
    }

    heroSynopsis.textContent = item.descripcion || "";
    if (item.backdrop || item.portada) {
        document.getElementById("hero-banner").style.backgroundImage =
            `url('${item.backdrop || item.portada}')`;
    }
}

function iniciarHero(lista) {
    heroItems = lista.filter(i => i.portada || i.backdrop).slice(0, 6);
    if (!heroItems.length) return;

    heroDots.innerHTML = heroItems.map((_, i) =>
        `<div class="hero-dot${i === 0 ? " active" : ""}" data-i="${i}"></div>`
    ).join("");

    heroDots.querySelectorAll(".hero-dot").forEach(dot => {
        dot.addEventListener("click", () => {
            heroIndex = parseInt(dot.dataset.i);
            pintarHero(heroItems[heroIndex]);
            heroDots.querySelectorAll(".hero-dot").forEach(d => d.classList.remove("active"));
            dot.classList.add("active");
            reiniciarHeroTimer();
        });
    });

    heroIndex = 0;
    pintarHero(heroItems[0]);
    reiniciarHeroTimer();
}

function reiniciarHeroTimer() {
    clearInterval(heroTimer);
    heroTimer = setInterval(() => {
        heroIndex = (heroIndex + 1) % heroItems.length;
        pintarHero(heroItems[heroIndex]);
        heroDots.querySelectorAll(".hero-dot").forEach((d, i) => d.classList.toggle("active", i === heroIndex));
    }, 7000);
}

heroPlayBtn.addEventListener("click", () => {
    if (heroItems[heroIndex]) abrirDetalle(heroItems[heroIndex], true);
});
heroInfoBtn.addEventListener("click", () => {
    if (heroItems[heroIndex]) abrirDetalle(heroItems[heroIndex], false);
});

// ======================================================
// CARGA INICIAL (home)
// ======================================================
async function cargarHome() {
    if (typeof setBootLoading === "function") setBootLoading(true);
    console.log('🟢 Iniciando cargarHome()');
    try {
        console.log('🟡 Cargando estrenos (películas, series y anime)...');

        // Películas destacadas + hero = estrenos de la API
        const results = await Promise.allSettled([
            fetch('/api/estrenos?tipo=peliculas&limit=24', { cache: 'no-store' }).then(r => r.json()),
            fetchSeccion("series", 1, 12),
            fetchSeccion("anime", 1, 12)
        ]);

        const estrenosData = results[0].status === "fulfilled" ? results[0].value : { resultados: [] };
        const peliculas = estrenosData.resultados || [];
        const series    = results[1].status === "fulfilled" ? results[1].value : [];
        const anime     = results[2].status === "fulfilled" ? results[2].value : [];

        console.log('✅ Datos:', {
            peliculas: peliculas.length,
            series: series.length,
            anime: anime.length
        });

        // Destacadas = estrenos
        const destacadas = peliculas.slice(0, 12);
        renderCarousel("carousel-movies", destacadas);
        renderCarousel("carousel-series", series);
        renderCarousel("carousel-anime", anime);
        cargarContinuarViendo();
        cargarRecienAnadidos();
        cargarMiLista();
        cargarPorqueViste();
        // peliculas, series, anime = variables que ya armas en cargarHome
        cargarMoodsHome(
          typeof peliculas !== "undefined" ? peliculas : [],
          typeof series !== "undefined" ? series : [],
          typeof anime !== "undefined" ? anime : []
        );

        // Hero ("Película recomendada") también con estrenos
        iniciarHero(peliculas.length ? peliculas : series);

        statusBadge.classList.remove("offline");
        statusBadge.classList.add("online");
        statusBadge.querySelector(".status-text").textContent = "Online";
        console.log('✅ Home cargado (estrenos)');
        if (typeof setBootLoading === "function") setBootLoading(false);
    } catch (err) {
        if (typeof setBootLoading === "function") setBootLoading(false);
        console.error('❌ Error en cargarHome:', err);
        statusBadge.classList.remove("online");
        statusBadge.classList.add("offline");
        statusBadge.querySelector(".status-text").textContent = "Offline";
    }
}



async function abrirDesdeProgreso(mini) {
    // 1) Abrir ya con lo que hay (poster, título…)
    await abrirDetalle({
        ...mini,
        tiene_player: true,
        embeds: mini.embeds || [],
        episodios: mini.episodios || []
    }, false, false);

    // 2) Completar desde Supabase / API (misma info que al abrir normal)
    try {
        const params = new URLSearchParams();
        if (mini.postId) params.set("postId", mini.postId);
        if (mini.link) params.set("link", mini.link);
        if (mini.slug) params.set("slug", mini.slug);
        if (mini.source_id) params.set("source_id", mini.source_id);
        if (mini.tipo) params.set("tipo", mini.tipo);
        if (mini.id && !mini.postId) params.set("postId", mini.id);

        if (![...params.keys()].length) return;

        const res = await fetch(`/api/detalle?${params.toString()}`, { cache: "no-store" });
        if (!res.ok) return;
        const completo = await res.json();
        if (completo && (completo.nombre || completo.link)) {
            // Reabrir con datos completos (servidores, sinopsis, etc.)
            await abrirDetalle({ ...completo, tiene_player: true }, false, false);
        }
    } catch (err) {
        console.warn("No se pudo completar desde progreso:", err);
    }
}

// ======================================================
// DETALLE (modal inmersivo)
// ======================================================
const videoContainer = document.getElementById("video-player-container");
const playerIframe = document.getElementById("player-iframe");
const playerTitle = document.getElementById("player-title");


/** Fija título principal (ES/local) y original aparte; no invierte al actualizar */
function fijarTitulosItem(item, preferido) {
    if (!item) return item;
    const slug = item.slug || "";
    const esSlug = (t) => t && slug && String(t).toLowerCase().replace(/\s+/g, "-") === String(slug).toLowerCase();
    const pareceEn = (t) => {
        const s = String(t || "");
        if (/[áéíóúñü¿¡]/i.test(s)) return false;
        const en = (s.match(/\b(the|and|of|love|our|my|with|from|for)\b/gi) || []).length;
        return en >= 1;
    };
    let principal = preferido || item.nombre || item.titulo || null;
    if (esSlug(principal) || !principal) principal = item.titulo || item.nombre;
    // Si el principal es inglés y hay otro nombre local, preferir el local
    if (pareceEn(principal)) {
        const alt = [preferido, item.nombre, item.titulo].find((t) => t && !esSlug(t) && !pareceEn(t));
        if (alt) {
            if (!item.titulo_original || item.titulo_original === alt) item.titulo_original = principal;
            principal = alt;
        }
    }
    // No usar titulo_original como principal
    if (item.titulo_original && principal &&
        String(principal).toLowerCase() === String(item.titulo_original).toLowerCase() &&
        preferido && !pareceEn(preferido)) {
        principal = preferido;
    }
    item.nombre = principal || item.nombre || "Sin título";
    item.titulo = item.nombre;
    if (item.titulo_original && String(item.titulo_original).toLowerCase() === String(item.nombre).toLowerCase()) {
        item.titulo_original = null;
    }
    return item;
}


function mostrarDetalleLoading(on) {
  const el = document.getElementById("details-loading");
  const content = document.getElementById("details-content");
  const empty = document.getElementById("details-empty");
  const body = document.querySelector("#details-panel .details-body");
  const hero = document.getElementById("koi-hero");
  const bg = document.getElementById("mz-stremio-bg");
  const bgImg = document.getElementById("mz-stremio-bg-img");
  if (el) {
    el.classList.toggle("hidden", !on);
    if (on) el.style.display = "";
  }
  if (content) {
    // content-inner: no ocultar todo el shell, solo el interior con datos
  }
  // Mientras carga: ocultar hero, layout y fondo
  if (on) {
    if (body) body.classList.add("mz-loading-detail");
    if (hero) {
      hero.classList.add("hidden");
      hero.style.visibility = "hidden";
    }
    if (bg) {
      bg.style.opacity = "0";
      bg.style.visibility = "hidden";
    }
    if (bgImg) {
      bgImg.classList.remove("is-ready");
    }
    try {
      const inner = document.getElementById("details-content");
      if (inner) {
        inner.classList.add("mz-detail-dimmed");
        // no usar .hidden en details-content (rompe el panel); ocultamos hijos vía CSS
      }
    } catch (_) {}
  } else {
    if (body) body.classList.remove("mz-loading-detail");
    if (hero) {
      hero.classList.remove("hidden");
      hero.style.visibility = "";
    }
    if (bg) {
      bg.style.opacity = "";
      bg.style.visibility = "";
    }
    try {
      const inner = document.getElementById("details-content");
      if (inner) inner.classList.remove("mz-detail-dimmed");
    } catch (_) {}
  }
  if (empty) empty.classList.add("hidden");
}



async function abrirDetalle(item, autoPlay = false, force = false) {
    if (item) fijarTitulosItem(item, item.nombre || item.titulo);
    seleccionActual = item;

    detailsEmpty.classList.add("hidden");
    detailsContent.classList.remove("hidden");
    detailsPanel.classList.remove("hidden");
    document.body.style.overflow = "hidden";

    document.body.classList.add("details-open");
    // Al abrir detalle: nunca entrar en modo player (evita que película abra reproductor solo)
    try {
      document.body.classList.remove("player-open");
      const iframe = document.getElementById("player-iframe");
      if (iframe) iframe.src = "about:blank";
      const vc = document.getElementById("video-player-container");
      if (vc) {
        vc.classList.add("hidden");
      }
      // Scroll del detalle en el body interno
      const db = document.querySelector("#details-panel .details-body");
      if (db) {
        db.style.overflowY = "auto";
        db.style.webkitOverflowScrolling = "touch";
        db.scrollTop = 0;
      }
    } catch (_) {}
    // Modo visual Koiflix solo PC + serie/anime
    try {
      setKoiMode(item);
      bindKoiHeroControls({
        onPlay: () => {
          const esPeli = /pel[ií]cula|movie|film/i.test(String(item.tipo || item.type || ""));
          if (esPeli) {
            try {
              document.getElementById("servers-section")?.classList.remove("hidden");
              document.getElementById("servers-section")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
              const sc = document.getElementById("servers-container");
              const tg = document.getElementById("mz-servers-toggle");
              if (sc) {
                sc.classList.remove("mz-collapsed-content");
                sc.classList.add("mz-expanded-content");
              }
              if (tg) tg.classList.add("open");
            } catch (_) {}
            return;
          }
          const first =
            document.querySelector("#episodes-container [data-ep]") ||
            document.querySelector("#episodes-container button") ||
            document.querySelector("#episodes-container .ep-card") ||
            document.querySelector("#episodes-container > *");
          if (first) first.click();
        },
      });
    } catch (_) {}
    // Siempre mostrar loading al entrar; fondo/hero ocultos hasta tener datos
    if (typeof mostrarDetalleLoading === "function") mostrarDetalleLoading(true);

    // Preparar datos en DOM pero sin mostrar fondo aún (loading cubre)
    const __posterEl = document.getElementById("details-poster");
    const __posterCol = document.querySelector(".mz-stremio-poster-col");
    if (__posterEl) __posterEl.classList.add("mz-poster-hidden");
    if (__posterCol) __posterCol.classList.add("mz-hide-poster");
    if (__posterEl) __posterEl.src = item.portada || PLACEHOLDER;
    setDetalleLogo(item);
    document.getElementById("details-type").textContent = tipoLabel(item.tipo);
    document.getElementById("details-title").textContent = item.nombre || item.titulo || "Sin título";
    // backdrop + hero se pintan al terminar carga (abajo)

    const originalEl = document.getElementById("details-original-title");
    if (item.titulo_original && item.titulo_original !== item.nombre) {
        originalEl.textContent = item.titulo_original;
        originalEl.style.display = "block";
    } else {
        originalEl.textContent = "";
        originalEl.style.display = "none";
    }

    document.getElementById("details-year").textContent = item.year || "—";
    rellenarMetaDetalle(item);
    setDetalleImdb(item);

    const _desc = (item.descripcion && String(item.descripcion).trim()) || "";
    const synEl = document.getElementById("details-synopsis");
    if (synEl) {
      synEl.textContent = _desc.length >= 20 ? _desc : "Cargando información…";
      synEl.classList.toggle("mz-syn-loading", _desc.length < 20);
    }

    actualizarBotonFavorito();

    videoContainer.classList.add("hidden");
    playerIframe.src = "about:blank";

  const serversSection = document.getElementById("servers-section");
    if (serversSection) {
      serversSection.classList.add("hidden"); // Stremio: streams solo tras elegir
      const loading = serversSection.querySelector("#servers-loading");
      if (loading) loading.classList.add("hidden");
    }
    document.getElementById("servers-container").innerHTML = "";
    document.getElementById("seasons-section").classList.add("hidden");
    document.getElementById("servers-section")?.classList.add("hidden");
    try {
      const _epc = document.getElementById("episodes-container");
      if (_epc) _epc.innerHTML = "";
      const _sec = document.getElementById("seasons-container");
      if (_sec) _sec.innerHTML = "";
    } catch (_) {}
    document.getElementById("downloads-section").classList.add("hidden");

    const _thinDetail = !item.descripcion || String(item.descripcion).trim().length < 20
      || (!(item.tipo === "Serie" || item.tipo === "Anime") && (!item.embeds || !item.embeds.length))
      || ((item.tipo === "Serie" || item.tipo === "Anime") && (!item.episodios || !item.episodios.length) && (!item.temporadas_raw || !item.temporadas_raw.length));
    if (typeof mostrarDetalleLoading === "function") mostrarDetalleLoading(true);

    // Enriquecer siempre que falte descripción, players o episodios (al entrar, no solo al pulsar Actualizar)
    // También si el listado marcó "Sin servidores" (tiene_player !== true) para películas
    const faltaDescripcion = !item.descripcion || String(item.descripcion).trim().length < 20;
    const esSA = item.tipo === "Serie" || item.tipo === "Anime";

    const _needsEnrich = faltaDescripcion || true; // se ajusta abajo
    // Series/anime no requieren embeds a nivel ficha (van por capítulo)
    const faltaPlayers =
        !esSA && (
            item.tiene_player !== true ||
            !item.embeds || item.embeds.length === 0 ||
            (Array.isArray(item.embeds) && item.embeds.every(e => esEmbedInvalido(e.url)))
        );
    const faltaEpisodios =
        esSA &&
        (!item.episodios || item.episodios.length === 0) &&
        (!item.temporadas_raw || !item.temporadas_raw.length) &&
        (!item.temporadas || !item.temporadas.length);
  

    // Ya completo (Supabase/list con players): NO llamar API de nuevo
    const yaCompleto =
        !force &&
        item.tiene_player === true &&
        item.descripcion && String(item.descripcion).trim().length >= 20 &&
        (
            (item.embeds && item.embeds.length > 0) ||
            (esSA && (item.episodios?.length || item.temporadas?.length || item.temporadas_raw?.length))
        );

    const necesitaEnriquecer =
        force ||
        (!yaCompleto && (faltaDescripcion || faltaPlayers || faltaEpisodios));

    if (necesitaEnriquecer && (item.postId || item.link || item.slug || item.url_extract)) {
        try {
            const params = new URLSearchParams();
            if (item.postId) params.set("postId", item.postId);
            if (item.link) params.set("link", item.link);
            if (item.slug) params.set("slug", item.slug);
            if (item.source_id) params.set("source_id", item.source_id);
            if (item.tipo) params.set("tipo", item.tipo);
            if (item.url_extract && !item.link) params.set("link", item.url_extract);
            if (force) params.set("force", "1");

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 25000);

            const res = await fetch(`/api/detalle?${params.toString()}`, { cache: "no-store", signal: controller.signal });
            clearTimeout(timeoutId);

            if (res.ok) {
                const completo = await res.json();
                if (completo.embeds) completo.embeds = normalizarEmbeds(completo.embeds);
                // No borrar temporadas/episodios si el force devolvió vacío
                if ((!completo.episodios || !completo.episodios.length) && item.episodios?.length) {
                    completo.episodios = item.episodios;
                }
                if ((!completo.temporadas || !completo.temporadas.length) && item.temporadas?.length) {
                    completo.temporadas = item.temporadas;
                }
                if ((!completo.temporadas_raw || !completo.temporadas_raw.length) && item.temporadas_raw?.length) {
                    completo.temporadas_raw = item.temporadas_raw;
                }
                // Preservar embeds de episodios ya cargados en el cliente
                if (item.episodios?.length && completo.episodios?.length) {
                    const byKey = new Map();
                    for (const ep of item.episodios) {
                        const k = `${Number(ep.season) || 1}-${Number(ep.episode || ep.episodio) || 0}`;
                        if (ep.embeds?.length || ep.video) byKey.set(k, ep);
                    }
                    completo.episodios = completo.episodios.map((ep) => {
                        const k = `${Number(ep.season) || 1}-${Number(ep.episode || ep.episodio) || 0}`;
                        const prev = byKey.get(k);
                        if (!prev || (ep.embeds && ep.embeds.length)) return ep;
                        return { ...ep, embeds: prev.embeds || [], video: prev.video || prev.reproductor || null, downloads: prev.downloads || ep.downloads };
                    });
                }
                // force (Actualizar servidores): solo players; conservar título/sinopsis/portada/meta
                if (force) {
                    const keepMeta = {
                        nombre: item.nombre,
                        titulo: item.titulo,
                        titulo_original: item.titulo_original,
                        year: item.year,
                        calificacion: item.calificacion,
                        rating: item.rating,
                        genero: item.genero,
                        generos: item.generos,
                        descripcion: item.descripcion,
                        portada: item.portada,
                        imdb: item.imdb,
                        tmdb: item.tmdb,
                        imdb_id: item.imdb_id,
                        votos: item.votos,
                        duracion: item.duracion,
                        duracion_texto: item.duracion_texto,
                        certificacion: item.certificacion,
                    };
                    if (Array.isArray(completo.embeds) && completo.embeds.length) {
                        item.embeds = completo.embeds;
                        item.tiene_player = true;
                    }
                    if (completo.reproductor) item.reproductor = completo.reproductor;
                    if (Array.isArray(completo.downloads) && completo.downloads.length) {
                        item.downloads = completo.downloads;
                    }
                    if (completo.total_episodios || completo.totalEpisodios) {
                        const tNew = parseInt(completo.total_episodios || completo.totalEpisodios, 10) || 0;
                        const tOld = parseInt(item.total_episodios || item.totalEpisodios, 10) || 0;
                        item.total_episodios = Math.max(tNew, tOld) || tNew || tOld || null;
                    }
                    if (Array.isArray(completo.rangos_episodios) && completo.rangos_episodios.length) {
                        const maxH = (arr) => (arr || []).reduce((m, r) => Math.max(m, Number(r.hasta) || 0), 0);
                        if (!item.rangos_episodios || maxH(completo.rangos_episodios) >= maxH(item.rangos_episodios)) {
                            item.rangos_episodios = completo.rangos_episodios;
                        }
                    }
                    if (Array.isArray(completo.episodios) && completo.episodios.length) {
                        item.episodios = completo.episodios;
                    }
                    // Restaurar meta (no dejar que API ponga slug / inglés)
                    Object.keys(keepMeta).forEach(function (k) {
                        if (keepMeta[k] != null && keepMeta[k] !== "") item[k] = keepMeta[k];
                    });
                    // Descripción: si completo trae español mejor, usarla
                    if (completo.descripcion && String(completo.descripcion).length > 40) {
                        const esComp = /[áéíóúñ¿¡]/i.test(completo.descripcion) ||
                            /\b(el|la|los|las|de|que|una|unos|con|por)\b/i.test(completo.descripcion);
                        const esKeep = item.descripcion && (/[áéíóúñ¿¡]/i.test(item.descripcion) ||
                            /\b(el|la|los|las|de|que|una)\b/i.test(item.descripcion));
                        if (esComp && !esKeep) item.descripcion = completo.descripcion;
                    }
                    if (item.nombre && item.slug &&
                        String(item.nombre).toLowerCase().replace(/\s+/g, "-") === String(item.slug).toLowerCase()) {
                        item.nombre = keepMeta.nombre || item.titulo || item.nombre;
                    }
                } else {
                // Fusionar: el detalle rellena huecos; NUNCA borrar meta buena con null
                const yOld = item.year && String(item.year).match(/(19|20)\d{2}/);
                const yNew = completo.year && String(completo.year).match(/(19|20)\d{2}/);
                if (yOld && yNew && yOld[0] !== yNew[0]) {
                    // Años distintos: confiar en detalle si trae título/nombre
                    if (completo.nombre || completo.titulo) {
                        Object.keys(item).forEach(function (k) { delete item[k]; });
                        Object.assign(item, completo);
                    }
                } else {
                    const keep = Object.assign({}, item);
                    Object.assign(item, completo);
                    // Restaurar campos que el detalle mandó vacíos
                    const fields = [
                        "nombre", "titulo", "titulo_original", "year", "calificacion", "rating",
                        "genero", "generos", "descripcion", "votos", "duracion", "duracion_texto",
                        "certificacion", "imdb_id", "tmdb_id", "imdb", "tmdb", "omdb", "portada", "backdrop",
                        "fecha_estreno", "estado", "en_emision", "finalizado",
                        "embeds", "downloads", "reproductor", "episodios", "temporadas", "temporadas_raw",
                        "tiene_player", "link", "url_extract", "slug", "source_id"
                    ];
                    fields.forEach(function (f) {
                        const v = item[f];
                        const empty = v == null || v === "" || (Array.isArray(v) && !v.length);
                        if (empty && keep[f] != null && keep[f] !== "" && !(Array.isArray(keep[f]) && !keep[f].length)) {
                            item[f] = keep[f];
                        }
                    });
                    // Rellenar huecos desde imdb/tmdb anidados (Chrome a veces pierde campos planos)
                    if (item.imdb) {
                        if (item.votos == null && item.imdb.votos) item.votos = item.imdb.votos;
                        if (item.duracion == null && item.imdb.duracion) item.duracion = item.imdb.duracion;
                        if (!item.duracion_texto && item.imdb.duracion_texto) item.duracion_texto = item.imdb.duracion_texto;
                        if (!item.certificacion && item.imdb.certificacion) item.certificacion = item.imdb.certificacion;
                        if ((item.calificacion == null || item.calificacion === "") && item.imdb.rating != null) {
                            item.calificacion = item.imdb.rating;
                        }
                    }
                    if (item.tmdb) {
                        if (!item.fecha_estreno && item.tmdb.fecha_estreno) item.fecha_estreno = item.tmdb.fecha_estreno;
                        if (item.duracion == null && item.tmdb.duracion) item.duracion = item.tmdb.duracion;
                        if (!item.duracion_texto && item.tmdb.duracion_texto) item.duracion_texto = item.tmdb.duracion_texto;
                    }
                    // Players del detalle siempre ganan si traen algo
                    if (Array.isArray(completo.embeds) && completo.embeds.length) {
                        item.embeds = completo.embeds;
                        item.tiene_player = true;
                    }
                    if (completo.reproductor) item.reproductor = completo.reproductor;
                    if (Array.isArray(completo.downloads) && completo.downloads.length) {
                        item.downloads = completo.downloads;
                    }
                    if (completo.calificacion != null) item.calificacion = completo.calificacion;
                    if (completo.rating != null && (item.calificacion == null || item.calificacion === "")) {
                        item.calificacion = completo.rating;
                    }
                    if (completo.year) item.year = completo.year;
                    if (completo.genero) item.genero = completo.genero;
                    if (completo.generos && completo.generos.length) item.generos = completo.generos;
                    if (completo.imdb) item.imdb = completo.imdb;
                    if (completo.votos) item.votos = completo.votos;
                    if (completo.duracion) item.duracion = completo.duracion;
                    if (completo.duracion_texto) item.duracion_texto = completo.duracion_texto;
                    if (completo.certificacion) item.certificacion = completo.certificacion;
                    // Título: conservar el local/ES del listado; original solo en titulo_original
                    const nombreAntes = keep.nombre || keep.titulo || null;
                    fijarTitulosItem(item, nombreAntes);
                    if (completo.titulo_original && completo.titulo_original !== item.nombre) {
                        item.titulo_original = completo.titulo_original;
                    }
                    // Si años conflictúan, confiar 100% en detalle API
                    if (completo.year && item.year && String(completo.year).slice(0,4) !== String(item.year).slice(0,4)) {
                        item.year = completo.year;
                        if (completo.calificacion != null) item.calificacion = completo.calificacion;
                        if (completo.genero) item.genero = completo.genero;
                        if (completo.generos) item.generos = completo.generos;
                        if (completo.imdb) item.imdb = completo.imdb;
                    }
                }
                } // end !force
                const esSA2 = item.tipo === "Serie" || item.tipo === "Anime";
                if (item.tiene_player || itemTieneVideo(item) ||
                    (esSA2 && (item.episodios?.length || item.temporadas?.length || item.temporadas_raw?.length))) {
                    item.tiene_player = true;
                }
                if (item.embeds && item.embeds.length) item.tiene_player = true;
                seleccionActual = item;

                // Repintar metadatos (título principal fijo; original abajo)
                // Repintar metadatos (título principal fijo; original abajo)
                fijarTitulosItem(item, item.nombre);
                document.getElementById("details-poster").src = item.portada || PLACEHOLDER;
                setDetailBackdrop(item);
                setDetalleImdb(item);
                setDetalleLogo(item);
                document.getElementById("details-title").textContent = item.nombre || item.titulo || "Sin título";
                const origEl2 = document.getElementById("details-original-title");
                if (origEl2) {
                    if (item.titulo_original && item.titulo_original !== item.nombre) {
                        origEl2.textContent = item.titulo_original;
                        origEl2.style.display = "block";
                    } else {
                        origEl2.textContent = "";
                        origEl2.style.display = "none";
                    }
                }
                document.getElementById("details-year").textContent = item.year || "—";
                rellenarMetaDetalle(item);
                document.getElementById("details-synopsis").textContent = item.descripcion || "Sin descripción disponible.";

         /*       // Actualizar badge Disponible en la tarjeta del grid si existe
                try {
                    if (item.tiene_player || (item.embeds && item.embeds.length)) {
                        document.querySelectorAll(".media-card").forEach(function (card) {
                            const h = card.querySelector("h3");
                            if (!h) return;
                            if (h.textContent.trim() !== String(item.nombre || item.titulo || "").trim()) return;
                            const badge = card.querySelector(".availability-badge");
                            if (badge) {
                                badge.classList.remove("unavailable");
                                badge.classList.add("available");
                                badge.innerHTML = '<span class="dot"></span> ▶ Disponible';
                            }
                        });
                    }
                } catch (_) {}*/
            }
        } catch (err) {
            console.error("Error o timeout enriqueciendo detalle:", err);
        }
    }

    document.getElementById("servers-loading").classList.add("hidden");

    setDetalleImdb(item);
    setDetalleLogo(item);
    if (typeof rellenarMetaDetalle === "function") rellenarMetaDetalle(item);
    const _syn2 = document.getElementById("details-synopsis");
    if (_syn2 && item.descripcion && String(item.descripcion).trim().length >= 20) {
      _syn2.textContent = item.descripcion;
      _syn2.classList.remove("mz-syn-loading");
    }
    try { setDetailBackdrop(item); } catch (_) {}
    try {
      setKoiMode(item);
      fillKoiHero(item);
    } catch (_) {}
    if (typeof mostrarDetalleLoading === "function") mostrarDetalleLoading(false);

    const esSerieOAnime =
      item.tipo === "Serie" ||
      item.tipo === "Anime" ||
      (typeof isSerieOrAnime === "function" && isSerieOrAnime(item));
    const esPeli =
      /pel[ií]cula|movie|film/i.test(String(item.tipo || item.type || "")) ||
      (!esSerieOAnime && !item.episodios);

    const seasonsEl = document.getElementById("seasons-section");
    const serversEl = document.getElementById("servers-section");
    const epsCont = document.getElementById("episodes-container");
    const seasonsCont = document.getElementById("seasons-container");

    if (esSerieOAnime && !esPeli && (
      (Array.isArray(item.episodios) && item.episodios.length > 0) ||
      (Array.isArray(item.temporadas) && item.temporadas.length > 0) ||
      (Array.isArray(item.temporadas_raw) && item.temporadas_raw.length > 0)
    )) {
        // Serie / anime: episodios sí, servidores no (van por capítulo)
        if (serversEl) serversEl.classList.add("hidden");
        if (seasonsEl) seasonsEl.classList.remove("hidden");
        renderTemporadas(item);
        cargarProveedoresAlternos(item).then(() => renderProveedorSwitcher(item)).catch(() => {});
        if (item.tipo === "Anime" && item.slug) {
            refrescarTotalAnimeSiHaceFalta(item).catch(() => {});
        }
    } else {
        // Película (u otro sin episodios): limpiar episodios previos y mostrar servidores
        if (seasonsEl) seasonsEl.classList.add("hidden");
        if (epsCont) epsCont.innerHTML = "";
        if (seasonsCont) seasonsCont.innerHTML = "";
        // quitar switcher de proveedores de serie anterior
        try {
          const sw = document.getElementById("mz-proveedor-switcher");
          if (sw) sw.innerHTML = "";
        } catch (_) {}

        if (serversEl) serversEl.classList.remove("hidden");
        document.body.classList.add("koi-movie");
        document.body.classList.remove("player-open");
        const embeds = item.embeds || item.reproductores || [];
        const downloads = item.downloads || item.descargas || [];
        renderServidoresYDescargas(embeds, downloads, item.reproductor, item, { expandido: true });
        try {
          const vc = document.getElementById("video-player-container");
          if (vc) {
            vc.classList.add("hidden"); // CSS de película muestra el cuadro placeholder
            const ifr = document.getElementById("player-iframe");
            if (ifr) ifr.src = "about:blank";
          }
        } catch (_) {}
        // Forzar visibilidad por si el CSS de series ocultó el padre
        try {
          const metaCol = document.querySelector(".mz-meta-col");
          if (metaCol) metaCol.style.setProperty("display", "block", "important");
          if (serversEl) {
            serversEl.classList.remove("hidden");
            serversEl.style.setProperty("display", "block", "important");
          }
          const sc = document.getElementById("servers-container");
          if (sc) {
            sc.style.setProperty("display", "flex", "important");
            sc.style.setProperty("flex-wrap", "wrap", "important");
          }
        } catch (_) {}
        // sin autoplay
    }
}

function cerrarDetalle() {
    if (typeof mostrarDetalleLoading === "function") mostrarDetalleLoading(false);
    const bgImg = document.getElementById("mz-stremio-bg-img");
    if (bgImg) { bgImg.classList.remove("is-ready"); bgImg.removeAttribute("src"); }

    detenerSeguimientoProgreso(true);
    detailsPanel.classList.add("hidden");
    document.body.style.overflow = "";
    document.body.classList.remove("player-open");
    document.body.classList.remove("koi-movie");
    document.body.classList.remove("details-open");
    try { clearKoiMode(); setKoiPlayerEpisodeTitle(""); } catch (_) {}
    destruirHls();
    playerIframe.src = "about:blank";
    videoContainer.classList.add("hidden");

    document.getElementById("servers-section")?.classList.add("hidden");
    document.getElementById("seasons-section")?.classList.add("hidden");
    document.getElementById("downloads-section")?.classList.add("hidden");
    const sc = document.getElementById("servers-container");
    if (sc) sc.innerHTML = "";
    const body = document.querySelector("#details-panel .details-body");
    if (body) body.scrollTop = 0;

    cargarContinuarViendo();
}
document.getElementById("btn-close-modal").addEventListener("click", cerrarDetalle);
document.getElementById("modal-backdrop-close").addEventListener("click", cerrarDetalle);

document.getElementById("btn-fs-player")?.addEventListener("click", () => {
    togglePantallaCompletaPlayer();
});
document.addEventListener("fullscreenchange", () => {
    const on = !!document.fullscreenElement;
    if (!on) {
        document.getElementById("video-player-container")?.classList.remove("is-fullscreen");
    }
    actualizarIconoFs(on || document.getElementById("video-player-container")?.classList.contains("is-fullscreen"));
});
document.addEventListener("webkitfullscreenchange", () => {
    const on = !!document.webkitFullscreenElement;
    if (!on) {
        document.getElementById("video-player-container")?.classList.remove("is-fullscreen");
    }
    actualizarIconoFs(on);
});

document.getElementById("close-player-btn").addEventListener("click", () => {
    detenerSeguimientoProgreso(true);
    destruirHls();
    videoContainer.classList.add("hidden");
    playerIframe.src = "about:blank";
    document.body.classList.remove("player-open");
    _epPlayCtx = null;
    actualizarBotonesEpPlayer();
    // Al cerrar el player vuelve a mostrarse el botón de cerrar detalle (CSS body.player-open)
    cargarContinuarViendo();
});

function setDetalleImdb(item) {
  const wrap = document.getElementById("details-imdb-wrap");
  const btn = document.getElementById("details-imdb-btn");
  const scoreEl = document.getElementById("details-imdb-score");
  if (!btn) return;

  const imdbIdRaw = item.imdb_id || (item.imdb && (item.imdb.id || item.imdb.imdb_id)) || "";
  let imdbId = String(imdbIdRaw || "").trim();
  if (imdbId && !imdbId.startsWith("tt")) imdbId = "tt" + imdbId.replace(/\D/g, "");

  const ri = typeof ratingInfo === "function" ? ratingInfo(item) : null;
  let score = null;
  if (ri && (ri.source === "imdb" || ri.source === "omdb") && ri.value != null) score = ri.value;
  else if (item.imdb && item.imdb.rating != null) score = Number(item.imdb.rating);
  else if (item.rating != null && /imdb/i.test(String(item.rating_source || ""))) score = Number(item.rating);

  const okScore = score != null && !isNaN(score) && score > 0;
  const okId = !!imdbId;

  if (okId || okScore) {
    if (wrap) wrap.classList.remove("hidden");
    btn.classList.remove("hidden");
    if (scoreEl) scoreEl.textContent = okScore ? Number(score).toFixed(1) : "—";
    if (okId) {
      btn.href = "https://www.imdb.com/title/" + imdbId + "/";
      btn.setAttribute("target", "_blank");
      btn.setAttribute("rel", "noopener noreferrer");
    } else {
      btn.href = "#";
      btn.removeAttribute("target");
    }
  } else {
    if (wrap) wrap.classList.add("hidden");
    btn.classList.add("hidden");
    btn.href = "#";
  }
}

// ---------- Favoritos ----------
function actualizarBotonFavorito() {
    const btn = document.getElementById("btn-favorito");
    const icon = document.getElementById("btn-favorito-icon");
    if (!seleccionActual) return;
    const activo = esFavorito(seleccionActual.link);
    icon.setAttribute("name", activo ? "heart" : "heart-outline");
    btn.style.color = activo ? "#e50914" : "";
}
document.getElementById("btn-favorito").addEventListener("click", () => {
    if (!seleccionActual) return;
    toggleFavoritoItem(seleccionActual);
    actualizarBotonFavorito();
});

// ---------- Links cortos compartibles: /serie/slug ----------
function tipoPathFromItem(item) {
    if (!item) return "pelicula";
    const t = String(item.tipo || "").toLowerCase();
    if (t.includes("anime")) return "anime";
    if (t.includes("serie") || t.includes("dorama") || t === "tv") return "serie";
    return "pelicula";
}

function slugFromItem(item) {
    if (!item) return null;
    if (item.slug) return String(item.slug).replace(/^\/+|\/+$/g, "");
    const link = item.link || item.url_extract || item.url || "";
    const m = String(link).match(/\/(?:serie|pelicula|anime|doramas?|media)\/([^\/\?#]+)/i)
        || String(link).match(/\/[1-6]\/(?:serie|pelicula|anime)\/([^\/\?#]+)/i);
    if (m) {
        try { return decodeURIComponent(m[1]); } catch { return m[1]; }
    }
    return null;
}

function buildSharePath(item) {
    const slug = slugFromItem(item);
    if (!slug) return null;
    return "/" + tipoPathFromItem(item) + "/" + encodeURIComponent(slug).replace(/%2F/gi, "");
}

document.getElementById("btn-share")?.addEventListener("click", async () => {
    if (!seleccionActual) return;
    const pathShare = buildSharePath(seleccionActual);
    let url;
    if (pathShare) {
        url = location.origin + pathShare;
    } else {
        const link = seleccionActual.link || seleccionActual.id || seleccionActual.postId;
        if (!link) return;
        url = `${location.origin}/?link=${encodeURIComponent(String(link))}`;
    }
    try {
        await navigator.clipboard.writeText(url);
        const btn = document.getElementById("btn-share");
        const prev = btn.innerHTML;
        btn.innerHTML = `<ion-icon name="checkmark-outline"></ion-icon>`;
        setTimeout(() => { btn.innerHTML = prev; }, 1500);
    } catch {
        prompt("Copia este enlace:", url);
    }
});

document.getElementById("btn-refresh-servers")?.addEventListener("click", async () => {
    if (!seleccionActual || gridCargando) return;
    const btn = document.getElementById("btn-refresh-servers");
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<div class="spinner-inline"></div> Actualizando...`;
    }
    try {
        await abrirDetalle(seleccionActual, false, true); // tercer param = force
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = `<ion-icon name="refresh-outline"></ion-icon><span>Actualizar servidores</span>`;
        }
    }
});


// ---------- Proveedores (Doramasflix / PelisPlus) ----------
// ---------- Proveedores (botones 1, 2, 3…) ----------
function nombreProveedor(sid, fuente, index) {
    // Si hay índice en la lista de proveedores → "1", "2", "3"
    if (index != null && index >= 0) return String(index + 1);
    const s = String(sid || fuente || "").toLowerCase();
    if (s === "5" || s.includes("jkanime") || s === "jk") return "JK";
    if (s === "4" || s.includes("animeav1")) return "AV1";
    if (s === "6" || s.includes("dorama")) return "1";
    if (s === "3" || s.includes("pelis")) return "2";
    if (s === "2" || s.includes("hack")) return "3";
    if (s === "1" || s.includes("lamovie")) return "4";
    return String(sid || "?");
}

function ordenPrioridadProveedor(sid, tipo) {
    const s = String(sid || "");
    const t = String(tipo || "");
    if (/anime/i.test(t)) {
        if (s === "4") return 0; // solo animeav1
        return 99;
    }
    if (/serie/i.test(t)) {
        if (s === "6") return 0;
        if (s === "3") return 1;
        if (s === "2") return 2;
        return 5;
    }
    if (s === "3") return 0;
    return 5;
}

/** Busca la misma serie/anime en otras fuentes y las guarda en item._proveedores */
async function cargarProveedoresAlternos(item) {
    if (!item || (item.tipo !== "Serie" && item.tipo !== "Anime")) return [];
    // Anime: solo AnimeAV1, sin fuentes alternas
    if (/anime/i.test(String(item.tipo || ""))) {
        item._proveedores = [];
        return [];
    }
    if (Array.isArray(item._proveedores) && item._proveedores.length) return item._proveedores;

    const q = (item.nombre || item.titulo || "").replace(/\s*\(\d{4}\)\s*$/, "").trim();
    if (!q || q.length < 2) return [];

    const actualSid = String(item.source_id || resolverSidLocal(item) || "");
    const tituloBase = normalizarTituloProveedor(q);

    // Un solo slot por source_id (evita 15× AnimeAV1)
    const bySid = new Map();
    bySid.set(actualSid || "?", {
        source_id: actualSid || "6",
        slug: item.slug,
        link: item.link || item.url_extract,
        nombre: nombreProveedor(actualSid, item.fuente),
        activo: true,
        score: 100,
    });

    try {
        const res = await fetch("/api/buscar?q=" + encodeURIComponent(q), { cache: "no-store" });
        const data = await res.json();
        const results = data.resultados || data.results || [];
        for (const r of results) {
            if (!r) continue;
            const tipo = String(r.tipo || r.type || "");
            if (item.tipo === "Serie" && !/serie/i.test(tipo)) continue;
            if (item.tipo === "Anime" && !/anime/i.test(tipo)) continue;

            const sid = String(r.source_id || resolverSidFromResult(r) || "");
            const slug = r.slug || "";
            if (!sid || !slug) continue;

            const tituloR = normalizarTituloProveedor(r.nombre || r.titulo || r.title || slug);
            const score = scoreTituloProveedor(tituloBase, tituloR);
            // Debe parecer el mismo título (no "One Piece Film", "One Piece OVA", etc. sueltos)
            if (score < 55) continue;

            const prev = bySid.get(sid);
            const cand = {
                source_id: sid,
                slug,
                link: r.link || r.url_extract || r.url,
                nombre: nombreProveedor(sid, r.fuente || r.source),
                activo: false,
                score,
            };
            // Mismo source: quedarse con el mejor match de título
            if (!prev || score > (prev.score || 0)) {
                bySid.set(sid, cand);
            }
        }
    } catch (e) {
        console.warn("proveedores alternos:", e);
    }

    let lista = Array.from(bySid.values());

    // Series: solo tiene sentido 6 vs 3 (y similares). Anime: 4 vs otras.
    // Si tras dedupe solo hay 1 source, no mostrar switcher.
    lista.sort((a, b) => {
        const pa = ordenPrioridadProveedor(a.source_id, item.tipo);
        const pb = ordenPrioridadProveedor(b.source_id, item.tipo);
        if (pa !== pb) return pa - pb;
        return (b.score || 0) - (a.score || 0);
    });

    lista.forEach((p) => {
        p.activo = String(p.source_id) === actualSid && (!item.slug || p.slug === item.slug);
    });
    if (!lista.some((p) => p.activo) && lista.length) {
        const byS = lista.find((p) => String(p.source_id) === actualSid);
        if (byS) byS.activo = true;
        else lista[0].activo = true;
    }

    item._proveedores = lista;
    return lista;
}

function normalizarTituloProveedor(t) {
    return String(t || "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\b(the|el|la|los|las|serie|season|temporada|anime|ova|movie|pelicula)\b/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function scoreTituloProveedor(a, b) {
    if (!a || !b) return 0;
    if (a === b) return 100;
    if (a.includes(b) || b.includes(a)) return 85;
    const ta = a.split(" ").filter(Boolean);
    const tb = new Set(b.split(" ").filter(Boolean));
    if (!ta.length) return 0;
    let hit = 0;
    for (const w of ta) if (tb.has(w)) hit++;
    return Math.round((hit / ta.length) * 100);
}

function resolverSidFromResult(r) {
    const u = String(r.url || r.link || r.url_extract || "");
    const m = u.match(/\/([1-6])\/(?:serie|anime|pelicula)\//i);
    if (m) return m[1];
    return r.source_id || "";
}

function resolverSidLocal(item) {
    const l = String(item.link || item.url_extract || "");
    const m = l.match(/\/([1-6])\/(?:serie|anime|pelicula)\//i);
    if (m) return m[1];
    return item.source_id || "";
}

function renderProveedorSwitcher(item) {
    const box = document.getElementById("mz-provider-switch");
    if (!box) return;
    // Anime: solo AnimeAV1 → no mostrar switcher de fuentes
    if (item && /anime/i.test(String(item.tipo || ""))) {
        box.classList.add("hidden");
        box.innerHTML = "";
        return;
    }
    const list = item._proveedores || [];
    if (list.length < 2) {
        box.classList.add("hidden");
        box.innerHTML = "";
        return;
    }
    box.classList.remove("hidden");
    box.innerHTML =
        `<span class="mz-prov-label">Fuente</span>` +
        list
            .map((p, i) => {
                const act = p.activo ? " active" : "";
                const sid = p.source_id || "";
                const slug = p.slug || "";
                const label = nombreProveedor(sid, p.fuente) || p.nombre || String(i + 1);
                return `<button type="button" class="mz-prov-btn${act}" data-sid="${sid}" data-slug="${slug}" title="Fuente ${label}">${label}</button>`;
            })
            .join("");

    box.querySelectorAll(".mz-prov-btn").forEach((btn) => {
        btn.onclick = async () => {
            const sid = btn.getAttribute("data-sid");
            const slug = btn.getAttribute("data-slug");
            await cambiarProveedor(item, { source_id: sid, slug });
        };
    });
}

async function cambiarProveedor(item, alt) {
    const box = document.getElementById("mz-provider-switch");
    const episodesContainer = document.getElementById("episodes-container");
    if (box) {
        box.querySelectorAll(".mz-prov-btn").forEach((b) => {
            b.disabled = true;
            b.style.opacity = "0.6";
        });
    }
    if (episodesContainer) {
      //  episodesContainer.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>Cambiando a ${nombreProveedor(alt.source_id)}…</p></div>`;
      // antes: Cambiando a ${nombreProveedor(alt.source_id)}…
      episodesContainer.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>Cambiando fuente…</p></div>`;
    }
    try {
        const params = new URLSearchParams();
        params.set("slug", alt.slug);
        params.set("source_id", String(alt.source_id));
        params.set("tipo", item.tipo || "Serie");
        if (alt.link) params.set("link", alt.link);
        const res = await fetch("/api/detalle?" + params.toString(), { cache: "no-store" });
        const data = await res.json();
        if (!data || data.error) throw new Error(data?.error || "No se pudo cargar");

        // Conservar nombre principal en español si el otro trae peor título
        const keepNombre = item.nombre;
        const keepOrig = item.titulo_original;
        Object.assign(item, data);
        if (keepNombre && (!item.nombre || item.nombre.length < 2)) item.nombre = keepNombre;
        if (keepOrig && !item.titulo_original) item.titulo_original = keepOrig;
        item.source_id = String(alt.source_id);
        item.slug = alt.slug;
        if (data.link) item.link = data.link;

        // Re-marcar proveedores
        if (Array.isArray(item._proveedores)) {
            item._proveedores.forEach((p) => {
                p.activo = String(p.source_id) === String(alt.source_id) && p.slug === alt.slug;
            });
            // Reordenar: doramasflix primero
            item._proveedores.sort(
                (a, b) => ordenPrioridadProveedor(a.source_id, item.tipo) - ordenPrioridadProveedor(b.source_id, item.tipo)
            );
        }

        seleccionActual = item;
        document.getElementById("details-title").textContent = item.nombre || item.titulo || "";
        if (item.portada) document.getElementById("details-poster").src = item.portada;

        document.getElementById("seasons-section")?.classList.remove("hidden");
        renderProveedorSwitcher(item);
        renderTemporadas(item);
    } catch (e) {
        console.error(e);
        if (episodesContainer) {
            episodesContainer.innerHTML = `<p style="color:var(--text-muted)">No se pudo cambiar de proveedor.</p>`;
        }
        alert("No se pudo cargar ese proveedor. Prueba Actualizar o el otro título en búsqueda.");
    } finally {
        if (box) {
            box.querySelectorAll(".mz-prov-btn").forEach((b) => {
                b.disabled = false;
                b.style.opacity = "";
            });
        }
    }
}


// ---------- Temporadas y episodios ----------
function buildEpisodiosQuery(item, season) {
    const params = new URLSearchParams();
    params.set("season", String(season));
    if (item.postId) params.set("postId", item.postId);
    if (item.link) params.set("link", item.link);
    if (item.slug) params.set("slug", item.slug);
    if (item.source_id) params.set("source_id", item.source_id);
    if (item.tipo) params.set("tipo", item.tipo);
    if (item.url_extract && !item.link) params.set("link", item.url_extract);
    params.set("players", "1"); // cargar players del 1er episodio
    return params.toString();
}

function normalizarListaTemporadas(item) {
    const totalEps = parseInt(item.total_episodios || item.totalEpisodios || 0, 10) || 0;
    const tieneRangos = Array.isArray(item.rangos_episodios) && item.rangos_episodios.length > 1;
    // One Piece / animes por número continuo: SOLO 1 “temporada” + pestañas 1–50, 51–100…
    // Ignorar lista inflada de arcs TMDB (T1…T22)
    if (totalEps > 50 || tieneRangos) {
        let epsT1 = null;
        const raw0 = (item.temporadas_raw && item.temporadas_raw[0])
            || (Array.isArray(item.temporadas) && item.temporadas.find(t => t && typeof t === "object" && Number(t.temporada || t.season) === 1));
        if (raw0 && Array.isArray(raw0.episodios)) epsT1 = raw0.episodios;
        return [{ num: 1, episodios: epsT1, fromTmdb: false }];
    }

    // 1) Temporadas de la fuente
    const raw = (item.temporadas_raw && item.temporadas_raw.length)
      ? item.temporadas_raw
      : (item.temporadas && item.temporadas.length ? item.temporadas : []);
    const seen = new Set();
    const out = [];
    raw.forEach((s, i) => {
        let num;
        let episodios = null;
        if (typeof s === "number" || typeof s === "string") {
            num = parseInt(s, 10) || (i + 1);
        } else if (s && typeof s === "object") {
            num = parseInt(s.temporada || s.season_number || s.season || (i + 1), 10) || (i + 1);
            if (Array.isArray(s.lista) && s.lista.length) episodios = s.lista;
            else if (Array.isArray(s.episodios)) episodios = s.episodios;
            else if (Array.isArray(s.episodes)) episodios = s.episodes;
            else episodios = null;
        } else {
            num = i + 1;
        }
        if (seen.has(num) || num < 1) return;
        seen.add(num);
        out.push({ num, episodios, fromTmdb: false });
    });
    if (Array.isArray(item.episodios) && item.episodios.length) {
        item.episodios.forEach((ep) => {
            const n = parseInt(ep.season || ep.temporada || 1, 10) || 1;
            if (n < 1 || seen.has(n)) return;
            seen.add(n);
            out.push({ num: n, episodios: null, fromTmdb: false });
        });
        out.sort((a, b) => a.num - b.num);
    }

    // Anime: no inventar temporadas con TMDB
    const esAnime = /anime/i.test(String(item.tipo || ""));
    if (esAnime) {
        out.sort((a, b) => a.num - b.num);
        return out.length ? out : [{ num: 1, episodios: null, fromTmdb: false }];
    }

    // 2) TMDB solo para series (no anime)
    const tmdbSeasons = Array.isArray(item.temporadas_tmdb) ? item.temporadas_tmdb : [];
    let addedFromTmdb = 0;
    const maxTmdbExtra = 2;
    tmdbSeasons.forEach((ts) => {
        if (addedFromTmdb >= maxTmdbExtra) return;
        const num = parseInt(ts.season_number || ts.temporada || 0, 10);
        if (!num || num < 1 || seen.has(num)) return;
        // Si la fuente ya tiene ≥2 temps, no añadir más de TMDB
        if (out.length >= 2) return;
        seen.add(num);
        addedFromTmdb += 1;
        const epsRaw = Array.isArray(ts.episodios) ? ts.episodios : [];
        const episodios = epsRaw.map((ep, idx) => ({
            temporada: num,
            episodio: ep.episode_number || ep.episodio || (idx + 1),
            episode: ep.episode_number || ep.episodio || (idx + 1),
            titulo: ep.name || ep.titulo || ("Episodio " + (ep.episode_number || idx + 1)),
            nombre: ep.name || ep.titulo || ("Episodio " + (ep.episode_number || idx + 1)),
            embeds: [],
            video: null,
            still: ep.still || null
        }));
        if (!episodios.length && ts.episode_count) {
            for (let e = 1; e <= Math.min(Number(ts.episode_count) || 0, 50); e++) {
                episodios.push({
                    temporada: num,
                    episodio: e,
                    episode: e,
                    titulo: "Episodio " + e,
                    nombre: "Episodio " + e,
                    embeds: [],
                    video: null
                });
            }
        }
        out.push({ num, episodios, fromTmdb: true });
    });

    out.sort((a, b) => a.num - b.num);
    return out.length ? out : [{ num: 1, episodios: null, fromTmdb: false }];
}

/** Rangos de episodios (animes largos tipo One Piece) — bloques de 50 */
function construirRangosEpisodios(total, step = 50) {
    const t = parseInt(total, 10) || 0;
    if (t < 1) return [];
    const out = [];
    for (let i = 1; i <= t; i += step) {
        const hasta = Math.min(i + step - 1, t);
        out.push({ desde: i, hasta, label: `${i}–${hasta}` });
    }
    return out;
}

/** Normaliza rangos del API a bloques de 50. Siempre cubre hasta total_episodios. */

async function refrescarTotalAnimeSiHaceFalta(item) {
    if (!item || item.tipo !== "Anime" || item._totalRefrescado) return;
    const total = totalEpisodiosReal(item);
    // Si no hay total o es típico "atascado" bajo, pedir force una vez
    if (total > 0 && total !== 403 && total !== 326 && total !== 1000) {
        // Igual refrescar si lleva tiempo sin sync (opcional: siempre en anime > 50)
        if (total < 50) return;
    }
    item._totalRefrescado = true;
    try {
        const params = new URLSearchParams();
        if (item.slug) params.set("slug", item.slug);
        params.set("source_id", String(item.source_id || "4"));
        params.set("tipo", "Anime");
        params.set("force", "1");
        if (item.link) params.set("link", item.link);
        const res = await fetch("/api/detalle?" + params.toString(), { cache: "no-store" });
        const data = await res.json();
        if (!data || data.error) return;
        const tNew = totalEpisodiosReal(data);
        const tOld = totalEpisodiosReal(item);
        if (tNew > tOld) {
            item.total_episodios = tNew;
            item.totalEpisodios = tNew;
            if (data.rangos_episodios) item.rangos_episodios = data.rangos_episodios;
            if (data.episodio_hasta) item.episodio_hasta = data.episodio_hasta;
            if (data.episodios && data.episodios.length > (item.episodios || []).length) {
                item.episodios = data.episodios;
            }
            // Re-pintar pestañas de rangos
            if (document.getElementById("seasons-section") && !document.getElementById("seasons-section").classList.contains("hidden")) {
                renderTemporadas(item);
            }
        }
    } catch (_) {}
}

function totalEpisodiosReal(item) {
    let total = parseInt(item.total_episodios || item.totalEpisodios || 0, 10) || 0;
    const hasta = parseInt(item.episodio_hasta || item.episode_hasta || 0, 10) || 0;
    if (hasta > total) total = hasta;
    const api = Array.isArray(item.rangos_episodios) ? item.rangos_episodios : [];
    for (let i = 0; i < api.length; i++) {
        const h = Number(api[i].hasta) || 0;
        if (h > total) total = h;
    }
    if (Array.isArray(item.episodios)) {
        for (const ep of item.episodios) {
            const n = Number(ep.episode || ep.episodio || ep.episode_number || 0) || 0;
            if (n > total) total = n;
        }
    }
    return total;
}

function normalizarRangosEpisodios(item) {
    const total = totalEpisodiosReal(item);
    if (total <= 50) return [];
    const api = Array.isArray(item.rangos_episodios) ? item.rangos_episodios : [];
    let maxHasta = 0;
    for (let i = 0; i < api.length; i++) {
        maxHasta = Math.max(maxHasta, Number(api[i].hasta) || 0);
    }
    // Solo confiar en rangos API si cubren el total REAL (no un total viejo de 403)
    if (api.length > 1 && maxHasta >= total - 2 && maxHasta >= total * 0.95) {
        const step0 = Number(api[0].hasta) - Number(api[0].desde) + 1;
        if (step0 > 0 && step0 <= 50) {
            return api.map(function (r) {
                const d = Number(r.desde) || 1;
                const h = Number(r.hasta) || d;
                return { desde: d, hasta: h, label: r.label || (d + "–" + h) };
            });
        }
    }
    // Reconstruir bloques de 50 hasta el total real
    return construirRangosEpisodios(total, 50);
}

function renderTemporadas(item) {
    const tabsContainer = document.getElementById("seasons-tabs-container");
    const listaTemp = normalizarListaTemporadas(item);
    const totalEps = parseInt(item.total_episodios || item.totalEpisodios || 0, 10)
        || (Array.isArray(item.episodios) ? item.episodios.length : 0);
    const rangos = normalizarRangosEpisodios(item);
    // Anime largo (1 temporada / muchos eps): pestañas = rangos 1–50, 51–100…
    const usarRangosComoTabs = rangos.length > 1 && listaTemp.length <= 1;

    if (usarRangosComoTabs) {
        if (!item._epRangoActivo) {
            item._epRangoActivo = { desde: rangos[0].desde, hasta: rangos[0].hasta };
        }
        tabsContainer.innerHTML = rangos.map((r, i) => {
            const act = item._epRangoActivo
                && item._epRangoActivo.desde === r.desde
                && item._epRangoActivo.hasta === r.hasta;
            return `<button class="season-tab${act || (!item._epRangoActivo && i === 0) ? " active" : ""}" data-range-from="${r.desde}" data-range-to="${r.hasta}">${r.label || (r.desde + "–" + r.hasta)}</button>`;
        }).join("");
    } else {
        tabsContainer.innerHTML = listaTemp.map((t, i) =>
            `<button class="season-tab${i === 0 ? " active" : ""}" data-season="${t.num}">Temporada ${t.num}</button>`
        ).join("");
    }

    const loadSeason = async (season, rangoForzado) => {
        const seasonNum = parseInt(season, 10) || 1;
        const episodesContainer = document.getElementById("episodes-container");
        episodesContainer.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>Cargando episodios...</p></div>`;

        if (rangoForzado) {
            item._epRangoActivo = { desde: rangoForzado.desde, hasta: rangoForzado.hasta };
        }

        // Si la fuente ya trajo episodios en temporadas[], usarlos (animeav1)
        const localT = listaTemp.find(t => t.num === seasonNum);
        if (localT && Array.isArray(localT.episodios) && localT.episodios.length && !rangoForzado) {
            const tmdbEps = (() => {
                const ts = (item.temporadas_tmdb || []).find(t =>
                    Number(t.season_number || t.temporada) === Number(seasonNum)
                );
                return Array.isArray(ts?.episodios) ? ts.episodios : [];
            })();
            item.episodios = localT.episodios.map((ep, idx) => {
                const num = ep.episodio || ep.episode || ep.episode_number || (idx + 1);
                const meta = tmdbEps.find(t => Number(t.episode_number || t.episodio) === Number(num));
                return {
                    season: seasonNum,
                    episode: num,
                    nombre: meta?.name || ep.titulo || ep.nombre || ep.name || ("Episodio " + num),
                    embeds: ep.embeds || ep.reproductores || [],
                    video: (() => {
                        const v = ep.video || ep.reproductor || null;
                        if (v && !esUrlApiWorker(v) && !esEmbedInvalido(v)) return v;
                        return null;
                    })(),
                    link: ep.link || null,
                    source_id: ep.source_id || item.source_id
                };
            });
            if (item.totalEpisodios && !item.total_episodios) item.total_episodios = item.totalEpisodios;
            renderEpisodios(item, seasonNum);
            return;
        }

        try {
            const qs = new URLSearchParams(buildEpisodiosQuery(item, seasonNum));
            const rango = item._epRangoActivo;
            if (rango) {
                qs.set("ep_from", String(rango.desde));
                qs.set("ep_to", String(rango.hasta));
            }
            const res = await fetch(`/api/episodios?${qs.toString()}`, { cache: "no-store" });
            const data = await res.json();
            let epsApi = Array.isArray(data.episodios) ? data.episodios : [];
            // Si la API trae varias temporadas mezcladas, quedarnos solo con la pedida
            const tagged = epsApi.some((e) => e && (e.season != null || e.temporada != null));
            if (tagged) {
                epsApi = epsApi.filter((e) => Number(e.season || e.temporada || 1) === seasonNum);
            }
            item.episodios = epsApi.map((ep, idx) => {
                const num = Number(ep.episode || ep.episodio || ep.episode_number || (idx + 1)) || (idx + 1);
                return Object.assign({}, ep, {
                    season: seasonNum,
                    temporada: seasonNum,
                    episode: num,
                    episodio: num,
                    nombre: ep.nombre || ep.titulo || ep.name || ("Episodio " + num),
                    embeds: ep.embeds || ep.reproductores || [],
                    link: ep.link || null,
                    source_id: ep.source_id || item.source_id
                });
            });
            if (data.slug) item.slug = data.slug;
            if (data.source_id) item.source_id = data.source_id;
            if (data.link) item.link = data.link;
            if (data.total_episodios) item.total_episodios = data.total_episodios;
            if (data.rangos_episodios) item.rangos_episodios = data.rangos_episodios;

            // Completar stubs del rango activo (o primer bloque de 50)
            const totalEp = parseInt(item.total_episodios, 10) || 0;
            const byNum = new Map((item.episodios || []).map(e => [Number(e.episode || e.episodio), e]));
            let desde = 1, hasta = Math.min(50, totalEp || 50);
            if (item._epRangoActivo) {
                desde = item._epRangoActivo.desde;
                hasta = item._epRangoActivo.hasta;
            } else if (totalEp > 50) {
                const r0 = normalizarRangosEpisodios(item)[0];
                if (r0) {
                    desde = r0.desde;
                    hasta = r0.hasta;
                    item._epRangoActivo = { desde, hasta };
                }
            } else if (totalEp > (item.episodios || []).length) {
                hasta = totalEp;
            }
            if (totalEp > (item.episodios || []).length || item._epRangoActivo) {
                const filled = [];
                for (let n = desde; n <= hasta; n++) {
                    filled.push(byNum.get(n) || {
                        season: seasonNum,
                        episode: n,
                        nombre: "Episodio " + n,
                        embeds: [],
                        video: null,
                        source_id: item.source_id
                    });
                }
                item.episodios = filled;
            }
            renderEpisodios(item, seasonNum);
        } catch (err) {
            console.error(err);
            episodesContainer.innerHTML = `<p style="color:var(--text-muted);">Error cargando episodios.</p>`;
        }
    };

    tabsContainer.querySelectorAll(".season-tab").forEach(tab => {
        tab.addEventListener("click", async () => {
            tabsContainer.querySelectorAll(".season-tab").forEach(t => t.classList.remove("active"));
            tab.classList.add("active");
            if (tab.dataset.rangeFrom) {
                await loadSeason(1, {
                    desde: parseInt(tab.dataset.rangeFrom, 10),
                    hasta: parseInt(tab.dataset.rangeTo, 10)
                });
            } else {
                item._epRangoActivo = null;
                await loadSeason(parseInt(tab.dataset.season, 10));
            }
        });
    });

    if (usarRangosComoTabs && item._epRangoActivo) {
        loadSeason(1, item._epRangoActivo);
    } else {
        loadSeason(listaTemp[0]?.num || 1);
    }
}

function episodioNumero(ep, index) {
    return parseInt(ep.episode || ep.episodio || ep.episode_number || (index + 1), 10) || (index + 1);
}

function renderEpisodios(item, season = 1) {
    const episodesContainer = document.getElementById("episodes-container");
    episodesContainer.innerHTML = "";
    item._seasonActiva = season;
    initEpOrderUi(item);
    actualizarBotonNotify(item);

    const totalEps = parseInt(item.total_episodios || item.totalEpisodios || 0, 10)
        || (Array.isArray(item.episodios) ? item.episodios.length : 0);

    // Rangos en bloques de 50 (One Piece, etc.)
    let rangos = normalizarRangosEpisodios(item);
    // Si los tabs de temporada YA muestran rangos, no duplicar barra aquí
    const tabsContainer = document.getElementById("seasons-tabs-container");
    const tabsSonRangos = !!(tabsContainer && tabsContainer.querySelector("[data-range-from]"));

    if (!item._epRangoActivo && rangos.length > 1) {
        item._epRangoActivo = { desde: rangos[0].desde, hasta: rangos[0].hasta };
    }
    const rango = item._epRangoActivo || null;

    // Barra de rangos solo si NO están ya en las pestañas (p.ej. multi-temp + muchos eps)
    if (rangos.length > 1 && !tabsSonRangos) {
        const bar = document.createElement("div");
        bar.className = "episode-range-bar";
        bar.style.cssText = "display:flex;flex-wrap:wrap;gap:6px;margin:0 0 12px;width:100%;";
        rangos.forEach((r) => {
            const b = document.createElement("button");
            b.type = "button";
            b.className = "episode-range-btn" + (
                rango && rango.desde === r.desde && rango.hasta === r.hasta ? " active" : ""
            );
            b.textContent = r.label || `${r.desde}–${r.hasta}`;
            b.style.cssText = "padding:6px 10px;border-radius:8px;border:1px solid var(--border-color);background:rgba(255,255,255,0.04);color:var(--text-muted);font-size:12px;cursor:pointer;";
            if (rango && rango.desde === r.desde) {
                b.style.background = "rgba(168,85,247,0.25)";
                b.style.color = "#fff";
                b.style.borderColor = "rgba(168,85,247,0.5)";
            }
            b.addEventListener("click", async () => {
                item._epRangoActivo = { desde: r.desde, hasta: r.hasta };
                episodesContainer.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>Cargando episodios ${r.desde}–${r.hasta}...</p></div>`;
                try {
                    const qs = new URLSearchParams();
                    if (item.slug) qs.set("slug", item.slug);
                    qs.set("source_id", String(item.source_id || "4"));
                    if (item.link) qs.set("link", item.link);
                    if (item.tipo) qs.set("tipo", item.tipo || "Anime");
                    qs.set("season", String(season));
                    qs.set("ep_from", String(r.desde));
                    qs.set("ep_to", String(r.hasta));
                    qs.set("players", "0");
                    const res = await fetch(`/api/episodios?${qs.toString()}`, { cache: "no-store" });
                    const data = await res.json();
                    let lista = data.episodios || [];
                    if (data.total_episodios) item.total_episodios = data.total_episodios;
                    if (data.rangos_episodios) item.rangos_episodios = data.rangos_episodios;
                    const byNum = new Map(lista.map(e => [Number(e.episode || e.episodio), e]));
                    const filled = [];
                    for (let n = r.desde; n <= r.hasta; n++) {
                        filled.push(byNum.get(n) || {
                            season: season,
                            episode: n,
                            nombre: "Episodio " + n,
                            embeds: [],
                            video: null,
                            source_id: item.source_id || "4"
                        });
                    }
                    item.episodios = filled;
                } catch (e) {
                    console.error(e);
                    item.episodios = [];
                    for (let n = r.desde; n <= r.hasta; n++) {
                        item.episodios.push({
                            season: season,
                            episode: n,
                            nombre: "Episodio " + n,
                            embeds: [],
                            video: null
                        });
                    }
                }
                renderEpisodios(item, season);
            });
            bar.appendChild(b);
        });
        episodesContainer.appendChild(bar);
    }

    let lista = ordenarEpisodiosParaUI(item, Array.isArray(item.episodios) ? item.episodios : []);
    const seasonNum = Number(season) || 1;
    // Solo episodios de la temporada activa (nunca mezclar todas)
    if (lista.length) {
        const tabsN = tabsContainer
            ? tabsContainer.querySelectorAll(".season-tab[data-season]").length
            : 0;
        const multiTemp = tabsN > 1
            || (Array.isArray(item.temporadas) && item.temporadas.length > 1)
            || (Array.isArray(item.temporadas_raw) && item.temporadas_raw.length > 1);
        const filtrados = lista.filter((ep) => {
            const s = Number(ep.season != null ? ep.season : (ep.temporada != null ? ep.temporada : seasonNum));
            return s === seasonNum;
        });
        // Multi-temporada: SIEMPRE filtrar (aunque quede vacío)
        // Una sola temporada: filtrar si hay match; si nadie trae season, dejar lista
        if (multiTemp || seasonNum > 1) {
            lista = filtrados;
        } else if (filtrados.length) {
            lista = filtrados;
        }
    }
    // Filtrar por rango activo si aplica
    if (rango && lista.length) {
        lista = lista.filter((ep, idx) => {
            const n = episodioNumero(ep, idx);
            return n >= rango.desde && n <= rango.hasta;
        });
    }
    // Si no hay lista pero hay total + rango → generar stubs
    if ((!lista || !lista.length) && rango) {
        lista = [];
        for (let n = rango.desde; n <= rango.hasta; n++) {
            lista.push({ season: season, episode: n, nombre: "Episodio " + n, embeds: [], video: null });
        }
    }

    if (!lista || lista.length === 0) {
        const msg = document.createElement("p");
        msg.style.color = "var(--text-muted)";
        msg.textContent = totalEps
            ? `Hay ${totalEps} episodios. Elige un rango arriba.`
            : "No hay episodios en esta temporada.";
        episodesContainer.appendChild(msg);
        return;
    }
    checkNuevoCapitulo(item);
    // #episodes-container ya tiene class episodes-grid (no anidar otro)
    lista.forEach((episodio, index) => {
        const tieneVideo = Boolean(episodio.video) || (Array.isArray(episodio.embeds) && episodio.embeds.length > 0);
        const btn = document.createElement("button");
        const num = episodioNumero(episodio, index);
        const epNombre = episodio.nombre || `Episodio ${num}`;
        const koiCards = isKoiDesktop() && isSerieOrAnime(item);
        btn.className = "episode-btn" + (index === 0 ? " active" : "") + (koiCards ? " koi-ep-card" : "");
        btn.title = epNombre;
        btn.setAttribute("data-ep", String(num));
        if (koiCards) {
            const thumb =
                episodio.still ||
                episodio.portada ||
                episodio.imagen ||
                episodio.image ||
                episodio.thumbnail ||
                item.portada ||
                item.backdrop ||
                PLACEHOLDER;
            const dur = episodio.duracion || episodio.runtime || episodio.duration || "";
            // Nombre limpio: evitar "T1E01" crudo si hay nombre mejor
            let labelName = String(epNombre || "").replace(/</g, "");
            if (!labelName || /^T\d+E\d+$/i.test(labelName) || labelName === String(num)) {
              labelName = "Episodio " + num;
            }
            const safeSeries = String(item.nombre || item.titulo || "").replace(/</g, "");
            btn.innerHTML =
                `<span class="koi-ep-thumb"><img src="${String(thumb).replace(/"/g, "")}" alt="" loading="lazy" onerror="this.style.opacity=0.3"/>` +
                `<span class="koi-ep-dur">${dur ? dur : ("E" + num)}</span>` +
                `</span>` +
                `<span class="koi-ep-meta">` +
                `<span class="koi-ep-series">${safeSeries}</span>` +
                `<span class="koi-ep-name">E${num} · ${labelName}</span>` +
                `</span>`;
        } else {
            btn.textContent = num;
        }
        if (!tieneVideo) btn.style.opacity = "0.55";

        btn.addEventListener("click", async () => {
            episodesContainer.querySelectorAll(".episode-btn").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            // Número real del episodio (no el index del rango filtrado)
            const epNum = Number(episodio.episode || episodio.episodio || episodio.episode_number || episodioNumero(episodio, index)) || 1;
            // Temporada de la pestaña activa (evita pedir T1 cuando el ep no trae season)
            const seasonNum = Number(
                item._seasonActiva ||
                episodio.season ||
                episodio.temporada ||
                season ||
                1
            ) || 1;
            episodio.season = seasonNum;
            episodio.temporada = seasonNum;
            episodio.episode = epNum;
            episodio.episodio = epNum;
          {
            const pc =
              (typeof isKoiDesktop === "function" && isKoiDesktop()) ||
              window.innerWidth >= 1025;
            const serie =
              (typeof isSerieOrAnime === "function" && isSerieOrAnime(item)) ||
              /serie|anime|dorama|tv|ova|ona/i.test(String(item?.tipo || item?.type || ""));

            if (pc && serie && typeof window.mzKoiOpenEpisode === "function") {
              window.__mzForceAutoPlay = false;
              await window.mzKoiOpenEpisode(item, episodio, seasonNum, epNum);
              return;
            }
          }

            document.getElementById("details-title").textContent =
                `${item.nombre} - ${episodio.nombre || "Episodio " + epNum}`;
            try {
              setKoiPlayerEpisodeTitle(`E${epNum} - ${episodio.nombre || "Episodio " + epNum}`);
              document.body.classList.add("player-open");
            } catch (_) {}

            const expandirServidores = () => {
                const sc = document.getElementById("servers-container");
                const tg = document.getElementById("mz-servers-toggle");
                if (sc) {
                    sc.classList.remove("mz-collapsed-content");
                    sc.classList.add("mz-expanded-content");
                }
                if (tg) tg.classList.add("open");
            };

            // Si ya tiene players válidos (Supabase / sesión) → mostrar al instante
            // OJO: embeds:[] o embeds sin URL no cuentan → hay que pedir a la API
            const yaValidos = embedsValidosDe(episodio);
            if (yaValidos.length || (episodio.video && !esEmbedInvalido(episodio.video))) {
                renderServidoresYDescargas(yaValidos.length ? yaValidos : (episodio.embeds || []), episodio.downloads || [], episodio.video, item, { expandido: true });
                expandirServidores();
                btn.style.opacity = "1";
                // Auto: Latino → Sub → resolve primero (sin elegir servidor a mano)
                // Siempre pasar por reproducirCapituloAuto (ahí se bloquea autoplay en koi)
                await reproducirCapituloAuto(item, episodio, seasonNum, epNum);
                return;
            }

            // Preferir Latino en cada capítulo (si no hay, el render cae a SUB)
            _idiomaPlayerActivo = "lat";

            // Cargar de API → se guarda en Supabase en el backend
            const serversContainer = document.getElementById("servers-container");
            if (serversContainer) {
                expandirServidores();
                serversContainer.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>Cargando servidores del episodio ${epNum}...</p></div>`;
            }
            try {
                const params = new URLSearchParams();
                params.set("temporada", String(seasonNum));
                params.set("episodio", String(epNum));
                if (item.slug) params.set("slug", item.slug);
                // Anime → fuente 5 (jkanime) prioritaria; 4 = respaldo
                const sidCap = (item.tipo === "Anime")
                    ? (item.source_id || item._prefer_source_anime || "5")
                    : (item.source_id || "");
                if (sidCap) params.set("source_id", String(sidCap));
                else if (item.source_id) params.set("source_id", item.source_id);
                if (item.link) params.set("link", item.link);
                if (item.url_extract && !item.link) params.set("link", item.url_extract);
                if (item.tipo) params.set("tipo", item.tipo);

                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 35000);
                const res = await fetch(`/api/capitulo?${params.toString()}`, { cache: "no-store", signal: controller.signal });
                clearTimeout(timeoutId);
                const data = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(data.error || data.detalle || ("HTTP " + res.status));

                // Preferir objetos reproductores (tienen servidor/idioma); embeds puede ser solo strings
                let embedsNuevos = normalizarEmbeds(
                    (Array.isArray(data.reproductores) && data.reproductores.length)
                        ? data.reproductores
                        : (data.embeds || [])
                );
                if (!embedsNuevos.length && data.reproductor && typeof data.reproductor === "string" && !esUrlApiWorker(data.reproductor)) {
                    embedsNuevos = [{ url: data.reproductor }];
                }
                // Filtrar URLs de la API worker (JSON) que no son iframes de video
                embedsNuevos = embedsNuevos.filter(e => e && e.url && !esUrlApiWorker(e.url));
                episodio.embeds = embedsNuevos.map(e => ({
                    ...e,
                    idioma: e.idioma || e.lang || null,
                    lang: e.lang || e.idioma || null,
                    server: e.server || e.servidor || e.name || null,
                    servidor: e.servidor || e.server || e.name || null,
                    stream_url: e.stream_url || streamUrlParaNoAds(e.url) || null
                }));
                const prim = episodio.embeds[0]?.url || null;
                const rep = (data.reproductor && !esUrlApiWorker(data.reproductor)) ? data.reproductor : prim;
                episodio.video = rep || null;
                episodio.downloads = data.downloads || data.descargas || [];
                episodio.episode = Number(epNum);
                episodio.season = Number(seasonNum);

                // Actualizar también en item.episodios (misma referencia de sesión)
                if (Array.isArray(item.episodios)) {
                    const idx = item.episodios.findIndex(e =>
                        Number(e.season || e.temporada || 1) === Number(seasonNum) &&
                        Number(e.episode || e.episodio || e.episode_number || 0) === Number(epNum)
                    );
                    if (idx >= 0) {
                        item.episodios[idx] = { ...item.episodios[idx], ...episodio };
                    } else {
                        item.episodios.push({ ...episodio });
                    }
                }
                item.tiene_player = true;

                const validos = embedsValidosDe(episodio);
                btn.style.opacity = (validos.length || episodio.video) ? "1" : "0.55";

                if (!validos.length && !episodio.video) {
                    if (serversContainer) {
                        expandirServidores();
                        serversContainer.innerHTML = `<p style="color:var(--text-muted);padding:12px;">Este episodio aún no tiene servidores. Prueba otro o pulsa Actualizar.</p>`;
                    }
                } else {
                    // Pasar embeds crudos + fallback: el render ya no debe vaciar por allowlist estricta
                    renderServidoresYDescargas(
                        validos.length ? validos : episodio.embeds,
                        episodio.downloads,
                        episodio.video,
                        item,
                        { expandido: true }
                    );
                    expandirServidores();
                    await reproducirCapituloAuto(item, episodio, seasonNum, epNum);
                }
            } catch (err) {
                console.error("capitulo:", err);
                if (serversContainer) {
                    expandirServidores();
                    const msg = err.name === "AbortError"
                        ? "Tiempo de espera agotado. Vuelve a pulsar el episodio."
                        : ("No se pudieron cargar los servidores: " + (err.message || "error"));
                    serversContainer.innerHTML = `<p style="color:var(--text-muted);padding:12px;">${escapeHtml(msg)}</p>`;
                }
            }
        });

        episodesContainer.appendChild(btn);
    });
    }

// ---------- Servidores y descargas ----------
async function reproducir(embed, item) {
    if (!embed?.url && !embed?.stream_url) return;

    // NO ADS: resuelve stream en vivo (caduca; no va a Supabase)
    if (embed.noAds || embed.server === "NO ADS" || embed.name === "NO ADS") {
        try {
            playerTitle.textContent = "Cargando NO ADS...";
            videoContainer.classList.remove("hidden");
            const playUrl = await resolverPlayUrlNoAds(embed);
            await reproducirHlsNoAds(playUrl, item);
        } catch (err) {
            console.error("NO ADS:", err);
            alert("NO ADS no disponible: " + (err.message || err));
        }
        return;
    }

    destruirHls();
    mostrarBotonFullscreen(false);
    videoContainer.classList.remove("hidden");
    playerIframe.src = embed.url;
    playerTitle.textContent = (item?.nombre || "Reproduciendo...")
        .split(" ").map(w => w ? w.charAt(0).toUpperCase() + w.slice(1) : w).join(" ");
    iniciarSeguimientoProgreso(item || seleccionActual);
    document.body.classList.add("player-open", "details-open");
    if (isKoiDesktop()) document.body.classList.add("koi-desktop");
    try {
      const it = item || (typeof seleccionActual !== "undefined" ? seleccionActual : null);
      if (it && /pel[ií]cula|movie|film/i.test(String(it.tipo || it.type || ""))) {
        document.body.classList.add("koi-movie");
        // Player se queda ABAJO (donde está en el HTML); solo asegurar scroll del panel
        const db = document.querySelector("#details-panel .details-body");
        if (db) {
          db.style.overflowY = "auto";
          db.style.minHeight = "0";
        }
      } else if (it && isKoiDesktop()) {
        // Series/anime: al elegir servidor, ir al cuadro del player
        requestAnimationFrame(() => {
          const vc = document.getElementById("video-player-container");
          if (vc) {
            vc.classList.remove("hidden");
            mzScrollPanelTo(vc);
          }
        });
        setTimeout(() => {
          const vc = document.getElementById("video-player-container");
          if (vc) mzScrollPanelTo(vc);
        }, 200);
      }
    } catch (_) {}
    try {
      const ctx = typeof _epPlayCtx !== "undefined" ? _epPlayCtx : null;
      const epNum = ctx?.ep || ctx?.episodio || "";
      const label = epNum ? `E${epNum} - Episodio ${epNum}` : (playerTitle?.textContent || "");
      setKoiPlayerEpisodeTitle(label);
    } catch (_) {}
    const scrollPlayer = () => {
      try {
        const vc = document.getElementById("video-player-container") || videoContainer;
        if (!vc) return;
        vc.classList.remove("hidden");
        // Overlay sobre el iframe: captura rueda (el iframe no burbujea wheel)
        if (!vc._mzWheelBound) {
          vc._mzWheelBound = true;
          const bindOverlay = () => {
            const wrap = vc.querySelector(".player-iframe-wrapper") || vc;
            let ov = vc.querySelector(".mz-scroll-catch");
            if (!ov) {
              ov = document.createElement("div");
              ov.className = "mz-scroll-catch";
              ov.setAttribute("aria-hidden", "true");
              ov.style.cssText = "position:absolute;inset:0;z-index:6;background:transparent;cursor:default;";
              wrap.style.position = wrap.style.position || "relative";
              wrap.appendChild(ov);
            }
            const scrollDb = (dy) => {
              const db = document.querySelector("#details-panel .details-body");
              if (db) db.scrollTop += dy;
            };
            ov.onwheel = (e) => {
              scrollDb(e.deltaY);
              e.preventDefault();
              e.stopPropagation();
            };
            // Clic: dejar pasar al iframe un momento (play/controles)
            ov.onmousedown = () => {
              ov.style.pointerEvents = "none";
              const restore = () => {
                ov.style.pointerEvents = "auto";
                window.removeEventListener("mouseup", restore, true);
              };
              window.addEventListener("mouseup", restore, true);
              setTimeout(restore, 800);
            };
          };
          bindOverlay();
          // Por si el wrapper se recrea
          setTimeout(bindOverlay, 200);
          setTimeout(bindOverlay, 600);
        }
        // No centrar servidores con el player: solo asegurar overlay de scroll
      } catch (_) {}
    };
    requestAnimationFrame(() => {
      scrollPlayer();
      setTimeout(scrollPlayer, 200);
    });
}

function renderServidoresYDescargas(embedsRaw, downloadsRaw, fallbackUrl, item, opts) {
    embedsRaw = normalizarEmbeds(embedsRaw);
    const expandido = !!(opts && opts.expandido);
    const esPeli = !!(item && /pel[ií]cula|movie|film/i.test(String(item.tipo || item.type || "")));
    const esSerie = !!(item && (typeof isSerieOrAnime === "function" ? isSerieOrAnime(item) : /serie|anime/i.test(String(item.tipo || ""))));
    // Series/animes: solo mostrar servidores si ya estamos en player (episodio elegido)
    if (esSerie && !esPeli && !document.body.classList.contains("player-open")) {
      document.getElementById("servers-section")?.classList.add("hidden");
      document.getElementById("servers-loading")?.classList.add("hidden");
      return;
    }
    document.getElementById("servers-section")?.classList.remove("hidden");
    document.getElementById("servers-loading")?.classList.add("hidden");
    // Ocultar "Reproductores / Actualizar" del header (los chips ya traen títulos)
    try {
      const sh = document.querySelector("#servers-section .servers-header");
      if (sh) sh.style.display = "none";
      const tg = document.getElementById("mz-servers-toggle");
      if (tg) tg.remove();
    } catch (_) {}

    const serversContainer =
        document.getElementById("servers-container");

    const downloadsSection =
        document.getElementById("downloads-section");

    const downloadsContainer =
        document.getElementById("downloads-list-container");

    if (!serversContainer || !downloadsSection || !downloadsContainer) {
        console.warn("MovieZone: contenedores de servidores no encontrados.");
        return;
    }

    serversContainer.innerHTML = "";
    downloadsContainer.innerHTML = "";

    /* =========================================================
       SERVIDORES
       ========================================================= */

    let embeds = [];

    if (Array.isArray(embedsRaw) && embedsRaw.length > 0) {
        embeds = embedsRaw.filter(e => e && e.url && !esEmbedInvalido(e.url));
        // Si el filtro dejó 0 pero había URLs http, mostrarlas igual (evitar "todavía no está disponible")
        if (!embeds.length) {
            embeds = embedsRaw.filter(e => e && e.url && /^https?:\/\//i.test(String(e.url)));
        }
    } else if (fallbackUrl && /^https?:\/\//i.test(String(fallbackUrl)) && !esEmbedInvalido(fallbackUrl)) {
        embeds = [{ url: fallbackUrl, server: "Servidor" }];
    } else if (fallbackUrl && /^https?:\/\//i.test(String(fallbackUrl))) {
        embeds = [{ url: fallbackUrl, server: "Servidor" }];
    }


    // Deduplicar por URL (todas las fuentes sumadas)
    {
        const seenU = new Set();
        embeds = embeds.filter((e) => {
            const u = String(e.url || "").trim();
            if (!u || seenU.has(u)) return false;
            seenU.add(u);
            return true;
        });
    }

    // Clasificar: Latino / Sub / Otros (desconocido — a veces es español sin etiqueta)
    const grupoLat = embeds.filter(e => !e.noAds && idiomaDeEmbed(e) === "lat");
    const grupoSub = embeds.filter(e => !e.noAds && idiomaDeEmbed(e) === "sub");
    const grupoOtro = embeds.filter(e => !e.noAds && idiomaDeEmbed(e) !== "lat" && idiomaDeEmbed(e) !== "sub");
    const tieneLat = grupoLat.length > 0
        || (Array.isArray(downloadsRaw) && downloadsRaw.some(d => idiomaDeEmbed(d) === "lat"));
    const tieneSub = grupoSub.length > 0
        || (Array.isArray(downloadsRaw) && downloadsRaw.some(d => idiomaDeEmbed(d) === "sub"));
    const tieneOtro = grupoOtro.length > 0;

    // Secciones: mostrar TODOS los reproductores agrupados (no ocultar “desconocido”)
    const secciones = [];
    if (tieneLat) secciones.push({ id: "lat", label: "Latino (DUB)", list: grupoLat });
    if (tieneSub) secciones.push({ id: "sub", label: "Subtitulado (SUB)", list: grupoSub });
    if (tieneOtro) secciones.push({ id: "otro", label: "Otros / Sin etiqueta", list: grupoOtro });
    // Si no hay clasificación, un solo bloque con todos
    if (!secciones.length) secciones.push({ id: "all", label: "Reproductores", list: embeds.filter(e => !e.noAds) });

    // Sin barra Latino/Sub: los chips Reproductores/Directos bastan


    // Lista plana ordenada: LAT → SUB → Otros (para autoplay / NO ADS)
    embeds = [...grupoLat, ...grupoSub, ...grupoOtro];
    embeds = insertarNoAdsEnLista(embeds);
    embeds = attachStreamUrls(embeds);

    // Guardar secciones para el render de botones más abajo
    serversContainer._seccionesPlayers = secciones.map((s) => ({
        ...s,
        list: attachStreamUrls(s.list.slice())
    }));



    /*
     * Crear botón desplegable de servidores
     */

    let serversToggle =
        document.getElementById(
            "mz-servers-toggle"
        );

    if (!serversToggle) {

        serversToggle =
            document.createElement("button");

        serversToggle.id =
            "mz-servers-toggle";

        serversToggle.className =
            "mz-collapse-toggle";

        serversToggle.type =
            "button";

        serversToggle.innerHTML = `
            <span class="mz-collapse-left">
                <ion-icon name="play-circle-outline"></ion-icon>
                <span><!--srv--></span>
            </span>

            <ion-icon
                class="mz-collapse-arrow"
                name="chevron-down-outline">
            </ion-icon>
        `;

        serversContainer.parentNode.insertBefore(
            serversToggle,
            serversContainer
        );

    }


    /*
     * Estado: expandido si venimos de clic en episodio, si no cerrado
     */
    serversContainer.classList.remove("mz-collapsed-content");
    serversContainer.classList.add("mz-expanded-content");
    try { const _tg = document.getElementById("mz-servers-toggle"); if (_tg) _tg.remove(); } catch (_) {}

    /*
     * Abrir / cerrar servidores
     */

    if (serversToggle) {
      try { serversToggle.remove(); } catch (_) {}
    }


    /*
     * Chips: Reproductores / Directos (mismo estilo series y películas)
     */
    const seccionesRender = serversContainer._seccionesPlayers || [
        { id: "all", label: "Reproductores", list: embeds.filter(e => !e.noAds) }
    ];
    const noAds = embeds.find(e => e && e.noAds);

    if (embeds.length > 0) {
        const flatForPlay = [];
        if (noAds) flatForPlay.push(noAds);

        const isDirect = (e) => {
          if (!e) return false;
          if (e.noAds || e.direct || e.stream_url) return true;
          const u = String(e.url || "");
          const s = String(e.server || e.servidor || e.name || e.type || "").toLowerCase();
          if (/\.m3u8(\?|$)|\.mp4(\?|$)/i.test(u)) return true;
          if (/direct|hls|m3u8|mp4|no\s*ads/.test(s)) return true;
          // Algunos providers marcan download/stream aparte del embed
          if (e.download || e.is_direct) return true;
          return false;
        };

        const allList = [];
        seccionesRender.forEach((sec) => {
            const listToShow = sec.id === seccionesRender[0].id && noAds
                ? [noAds, ...sec.list]
                : sec.list;
            listToShow.forEach((embed) => {
                if (!embed || !embed.url) return;
                if (embed.noAds && sec.id !== seccionesRender[0].id) return;
                if (!allList.includes(embed)) allList.push(embed);
            });
        });

        let reps = allList.filter(e => !isDirect(e));
        let dirs = allList.filter(e => isDirect(e));
        // Si no hay "directos" detectados, usar embeds con stream_url/noAds como Directos
        if (!dirs.length) {
          dirs = allList.filter(e => e && (e.stream_url || e.noAds || e.direct));
          reps = allList.filter(e => !dirs.includes(e));
        }
        // Si aún no hay división, primera mitad visual: todos en Reproductores y Directos con los que tengan quality/HD
        if (!dirs.length && reps.length > 1) {
          const maybe = reps.filter(e => /direct|hls|mp4|m3u8|hd|1080|720/i.test(String(e.server||e.name||e.quality||e.url||"")));
          if (maybe.length) {
            dirs = maybe;
            reps = reps.filter(e => !maybe.includes(e));
          }
        }
        const groups = [];
        groups.push({ label: "Reproductores", list: reps.length ? reps : allList });
        if (dirs.length) groups.push({ label: "Directos", list: dirs });
        else if (reps.length && reps !== allList) {
          /* sin directos extra */
        }

        groups.forEach((g) => {
            const wrap = document.createElement("div");
            wrap.className = "koi-servers-block";
            const h = document.createElement("div");
            h.className = "koi-servers-title";
            h.textContent = g.label;
            wrap.appendChild(h);
            const chipWrap = document.createElement("div");
            chipWrap.className = "koi-servers-chips";
            g.list.forEach((embed) => {
                if (!embed || !embed.url) return;
                let idxp = flatForPlay.indexOf(embed);
                if (idxp < 0) { flatForPlay.push(embed); idxp = flatForPlay.length - 1; }
                const nombre = embed.noAds
                    ? "NO ADS"
                    : detectarServidor(embed.url, embed.server || embed.servidor || embed.name);
                const idTag = idiomaDeEmbed(embed);
                let langBadge = "";
                if (!embed.noAds) {
                    if (idTag === "lat") {
                        langBadge = `<span class="koi-lang-badge koi-lang-dub" title="Latino / Doblado">DUB</span>`;
                    } else if (idTag === "sub") {
                        langBadge = `<span class="koi-lang-badge koi-lang-sub" title="Subtitulado">SUB</span>`;
                    } else if (/eng|ingl/i.test(String(embed.lang || embed.idioma || ""))) {
                        langBadge = `<span class="koi-lang-badge koi-lang-eng" title="English">ENG</span>`;
                    } else {
                        const raw = String(embed.lang || embed.idioma || "").trim();
                        if (raw) {
                            langBadge = `<span class="koi-lang-badge koi-lang-other" title="${escapeHtml(raw)}">${escapeHtml(raw.slice(0, 6).toUpperCase())}</span>`;
                        }
                    }
                }
                const chip = document.createElement("button");
                chip.type = "button";
                chip.className = "koi-server-chip" + (idTag === "lat" ? " is-dub" : idTag === "sub" ? " is-sub" : "");
                chip.dataset.index = String(idxp);
                chip.innerHTML =
                    langBadge +
                    `<span class="koi-chip-name">${escapeHtml(nombre)}</span>`;
                chip.addEventListener("click", () => reproducir(embed, item));
                chipWrap.appendChild(chip);
            });
            wrap.appendChild(chipWrap);
            serversContainer.appendChild(wrap);
        });
    } else {
        serversContainer.innerHTML = `
            <div style="color:var(--text-muted);padding:20px 0;text-align:center;">
                Este contenido todavía no está disponible
            </div>
        `;
    }

    /* =========================================================
       DESCARGAS (todas, sin filtrar por idioma)
       ========================================================= */

    const downloads = Array.isArray(downloadsRaw) ? downloadsRaw : [];


    if (downloads.length > 0) {

        downloadsSection.classList.remove(
            "hidden"
        );


        /*
         * Botón de descargas
         */

        let downloadsToggle =
            document.getElementById(
                "mz-downloads-toggle"
            );


        if (!downloadsToggle) {

            downloadsToggle =
                document.createElement(
                    "button"
                );

            downloadsToggle.id =
                "mz-downloads-toggle";

            downloadsToggle.className =
                "mz-collapse-toggle";

            downloadsToggle.type =
                "button";

            downloadsToggle.innerHTML = `

                <span class="mz-collapse-left">

                    <ion-icon
                        name="cloud-download-outline">
                    </ion-icon>

                    <span>
                        Opciones de descarga
                    </span>

                </span>

                <ion-icon
                    class="mz-collapse-arrow"
                    name="chevron-down-outline">
                </ion-icon>

            `;


            /*
             * Lo ponemos antes de la lista
             */

            downloadsContainer.parentNode.insertBefore(
                downloadsToggle,
                downloadsContainer
            );

        }


        /*
         * Inicialmente cerrado
         */

        downloadsContainer.classList.add(
            "mz-collapsed-content"
        );

        downloadsToggle.classList.remove(
            "open"
        );


        /*
         * Abrir / cerrar descargas
         */

        downloadsToggle.onclick =
            function () {

                const abierto =
                    downloadsContainer
                        .classList
                        .contains(
                            "mz-expanded-content"
                        );


                if (abierto) {

                    downloadsContainer
                        .classList
                        .remove(
                            "mz-expanded-content"
                        );

                    downloadsContainer
                        .classList
                        .add(
                            "mz-collapsed-content"
                        );

                    downloadsToggle
                        .classList
                        .remove(
                            "open"
                        );

                } else {

                    downloadsContainer
                        .classList
                        .remove(
                            "mz-collapsed-content"
                        );

                    downloadsContainer
                        .classList
                        .add(
                            "mz-expanded-content"
                        );

                    downloadsToggle
                        .classList
                        .add(
                            "open"
                        );

                }

            };


        /*
         * Crear descargas
         */

        downloads.forEach(
            dl => {

                const url =
                    dl.url ||
                    dl.link ||
                    (
                        typeof dl === "string"
                            ? dl
                            : null
                    );


                if (
                    !url ||
                    typeof url !== "string"
                ) {

                    return;

                }


                const nombre =
                    detectarServidor(
                        url,
                        dl.server ||
                        dl.name ||
                        dl.host
                    );


                const lang =
                    dl.lang ||
                    dl.idioma ||
                    "";


                const quality =
                    dl.quality ||
                    dl.calidad ||
                    "";


                const size =
                    dl.size
                        ? ` (${dl.size})`
                        : "";


                const row =
                    document.createElement(
                        "div"
                    );


                row.className =
                    "server-row";


                row.innerHTML = `

                    <div class="server-name-group">

                        <ion-icon
                            name="cloud-download-outline"
                            class="server-logo">
                        </ion-icon>

                        <div class="server-info">

                            <span class="server-title">

                                ${escapeHtml(nombre)}

                            </span>

                            <span class="server-lang">

                                ${escapeHtml(
                                    [
                                        lang,
                                        quality
                                    ]
                                    .filter(Boolean)
                                    .join(" · ")
                                )}

                                ${escapeHtml(size)}

                            </span>

                        </div>

                    </div>


                    <div class="server-actions">

                        <a
                            class="btn-action download"
                            href="${escapeHtml(url)}"
                            target="_blank"
                            rel="noopener noreferrer"
                        >

                            <ion-icon
                                name="download">
                            </ion-icon>

                            Descargar

                        </a>

                    </div>

                `;


                downloadsContainer.appendChild(
                    row
                );

            }
        );


    } else {

        downloadsSection.classList.add(
            "hidden"
        );


        /*
         * Si no hay descargas, eliminar
         * botón anterior si existiera.
         */

        const oldToggle =
            document.getElementById(
                "mz-downloads-toggle"
            );

        if (oldToggle) {
            oldToggle.remove();
        }

    }

}

// ======================================================
// BÚSQUEDA (solo con Enter)
// ======================================================
searchForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const texto = searchInput.value.trim();
    if (texto) {
        busquedaEsLocal = false; // online por defecto
        mostrarGrid({ modo: "search", termino: texto });
    }
});

// ======================================================
// NAVEGACIÓN (nav-links, filter-tabs, filter-chips)
// ======================================================
document.getElementById("nav-link-home").addEventListener("click", (e) => {
    e.preventDefault();
    mostrarHome();
});

document.getElementById("nav-link-favoritos").addEventListener("click", (e) => {
    e.preventDefault();
    mostrarGrid({ modo: "favoritos" });
});

document.querySelectorAll(".filter-tab").forEach(tab => {
    tab.addEventListener("click", (e) => {
        e.preventDefault();
        mostrarGrid({ modo: "categoria", seccion: tab.dataset.type });
    });
});

document.querySelectorAll(".filter-chip").forEach(chip => {
    chip.addEventListener("click", () => {
        document.querySelectorAll(".filter-chip").forEach(c => c.classList.remove("active"));
        chip.classList.add("active");
        gridTypeFilter = chip.dataset.type || "all";

        // Si estamos en búsqueda o favoritos → solo filtramos lo que ya hay
        if (gridModo === "search" || gridModo === "favoritos") {
            if (vistaActual === "grid") cargarPaginaGrid();
            return;
        }

        // Si es categoría normal → cambiamos de sección
        if (gridTypeFilter === "all") {
            mostrarGrid({ modo: "categoria", seccion: "movie" });
        } else {
            mostrarGrid({ modo: "categoria", seccion: gridTypeFilter });
        }
    });
});

document.getElementById("sort-select")?.addEventListener("change", (e) => {
    gridSort = e.target.value || "recent";
    if (vistaActual === "grid") cargarPaginaGrid();
});

// Efecto de navbar al hacer scroll
window.addEventListener("scroll", () => {
    document.getElementById("netflix-navbar").classList.toggle("scrolled", window.scrollY > 20);
});



function setDetalleFondo(item) {
  const bg = document.getElementById("mz-stremio-bg");
  if (!bg || !item) return;
  const url = item.backdrop || item.portada_imdb || item.portada || "";
  if (url) {
    bg.style.backgroundImage = `url("${String(url).replace(/"/g, "%22")}")`;
  } else {
    bg.style.backgroundImage = "";
  }
}

function setDetailBackdrop(item) {
  const layer = document.getElementById("mz-stremio-bg");
  const img = document.getElementById("mz-stremio-bg-img");
  if (!layer) return;

  const url =
    (item && (
      item.backdrop ||
      item.fondo ||
      item.background ||
      item.backdrop_url ||
      (item.imdb && item.imdb.backdrop) ||
      (item.tmdb && (item.tmdb.backdrop || item.tmdb.fondo)) ||
      item.portada_imdb ||
      item.portada ||
      item.poster ||
      item.image
    )) || "";

  // Limpiar background-image viejo del div (ahora usamos <img> como Stremio)
  layer.style.removeProperty("background-image");
  layer.style.removeProperty("opacity");

  if (img) {
    if (url) {
      const safe = String(url).trim();
      img.onload = function () {
        img.classList.add("is-ready");
      };
      img.onerror = function () {
        img.classList.remove("is-ready");
        img.removeAttribute("src");
      };
      if (img.src !== safe && img.getAttribute("src") !== safe) {
        img.classList.remove("is-ready");
        img.src = safe;
      } else if (img.complete && img.naturalWidth > 0) {
        img.classList.add("is-ready");
      }
    } else {
      img.classList.remove("is-ready");
      img.removeAttribute("src");
    }
  } else if (url) {
    // fallback si no hay img
    const safe = String(url).replace(/"/g, "%22");
    layer.style.setProperty("background-image", `url("${safe}")`, "important");
  }
}

function setDetalleLogo(item) {
  const logoEl = document.getElementById("details-logo");
  const posterEl = document.getElementById("details-poster");
  const posterCol = document.querySelector(".mz-stremio-poster-col");
  const header = document.querySelector(".mz-stremio-header");
  if (!logoEl) return;

  logoEl.onload = null;
  logoEl.onerror = null;

  const imdbIdRaw = item.imdb_id || (item.imdb && (item.imdb.id || item.imdb.imdb_id)) || "";
  const imdbId = String(imdbIdRaw || "").trim();
  const tt = imdbId
    ? (imdbId.startsWith("tt") ? imdbId : "tt" + imdbId.replace(/\D/g, ""))
    : null;

  const logoUrl =
    item.logo ||
    item.logo_url ||
    item.logo_imdb ||
    (tt ? "https://images.metahub.space/logo/medium/" + tt + "/img" : null);

  const showPoster = () => {
    logoEl.classList.add("hidden");
    logoEl.removeAttribute("src");
    if (posterEl) posterEl.classList.remove("mz-poster-hidden");
    if (posterCol) {
      posterCol.classList.remove("mz-hide-poster");
      posterCol.classList.add("mz-poster-top");
    }
    if (header) header.classList.add("mz-has-poster-only");
  };

  const showLogo = () => {
    logoEl.classList.remove("hidden");
    if (posterEl) posterEl.classList.add("mz-poster-hidden");
    if (posterCol) {
      posterCol.classList.add("mz-hide-poster");
      posterCol.classList.remove("mz-poster-top");
    }
    if (header) header.classList.remove("mz-has-poster-only");
  };

  if (!logoUrl) {
    showPoster();
    return;
  }

  logoEl.onload = showLogo;
  logoEl.onerror = showPoster;
  logoEl.src = logoUrl;
  if (logoEl.complete && logoEl.naturalWidth > 0) showLogo();
}

// Donde ya abres/rellenas el detalle:
// setDetailBackdrop(item);

// ======================================================
// PAGINACIÓN CON BOTONES
// ======================================================
function actualizarPaginacion() {
    let paginacion = document.getElementById("pagination-controls");
    
    // Si no existe el contenedor, lo creamos
    if (!paginacion) {
        paginacion = document.createElement("div");
        paginacion.id = "pagination-controls";
        paginacion.className = "pagination-controls";
        // Lo insertamos después del grid
        resultsGrid.parentNode.insertBefore(paginacion, resultsGrid.nextSibling);
    }

    // Mostrar en categoría y búsqueda (no en favoritos)
    if (gridModo === "favoritos" || gridTotalPages <= 1) {
        paginacion.classList.add("hidden");
        paginacion.innerHTML = "";
        return;
    }

    paginacion.classList.remove("hidden");

    paginacion.innerHTML = `
        <div class="pagination-buttons">
            <button class="btn-page" id="btn-prev-page" ${gridPage <= 1 ? "disabled" : ""}>
                ← Anterior
            </button>
            <button class="btn-page" id="btn-next-page" ${gridPage >= gridTotalPages ? "disabled" : ""}>
                Siguiente →
            </button>
        </div>
        <div class="page-info">
            Página <strong>${gridPage}</strong> de <strong>${gridTotalPages}</strong>
        </div>
    `;

    document.getElementById("btn-prev-page")?.addEventListener("click", () => {
        if (gridPage > 1) {
            gridPage--;
            cargarPaginaGrid();
            window.scrollTo({ top: 0, behavior: "smooth" });
        }
    });

    document.getElementById("btn-next-page")?.addEventListener("click", () => {
        if (gridPage < gridTotalPages) {
            gridPage++;
            cargarPaginaGrid();
            window.scrollTo({ top: 0, behavior: "smooth" });
        }
    });
}

// ======================================================
// INICIO
// ======================================================



function setBootLoading(on) {
  const el = document.getElementById("mz-boot-loading");
  if (!el) return;
  el.classList.toggle("hidden", !on);
  document.body.classList.toggle("mz-booting", !!on);
}

function initBrowserWarn() {
  try {
    const el = document.getElementById("mz-browser-warn");
    if (!el) return;
    const isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent || "");
    if (!isMobile) return;
    if (sessionStorage.getItem("mz_browser_warn") === "1") return;
    el.classList.remove("hidden");
    sessionStorage.setItem("mz_browser_warn", "1");
    setTimeout(() => el.classList.add("hidden"), 5000);
  } catch (_) {}
}
initBrowserWarn();

// initWakeupNotice(); // desactivado: sin mensaje de servidores

initProfilesUi();
initNotifyBtn();
cargarHome();
initTvUi();
initAutoplayEpUi();
try { bindKoiBackBtn(); } catch (_) {}


// ---------- Aviso de visita a Telegram (1 vez por sesión, se puede apagar en el server) ----------
(function reportarVisita() {
    try {
        if (sessionStorage.getItem("mz_visit_sent") === "1") return;
        const ua = navigator.userAgent || "";
        const isMobile = /Mobi|Android|iPhone|iPad/i.test(ua);
        const isTablet = /iPad|Tablet/i.test(ua);
        let device = "Desktop";
        if (isTablet) device = "Tablet";
        else if (isMobile) device = "Móvil";

        let os = "Desconocido";
        if (/Windows/i.test(ua)) os = "Windows";
        else if (/Mac OS X|Macintosh/i.test(ua)) os = "macOS";
        else if (/Android/i.test(ua)) os = "Android";
        else if (/iPhone|iPad|iPod/i.test(ua)) os = "iOS";
        else if (/Linux/i.test(ua)) os = "Linux";

        let browser = "Desconocido";
        if (/Edg\//i.test(ua)) browser = "Edge";
        else if (/Chrome\//i.test(ua) && !/Edg\//i.test(ua)) browser = "Chrome";
        else if (/Firefox\//i.test(ua)) browser = "Firefox";
        else if (/Safari\//i.test(ua) && !/Chrome\//i.test(ua)) browser = "Safari";
        else if (/OPR\//i.test(ua) || /Opera/i.test(ua)) browser = "Opera";

        const payload = {
            device,
            os,
            browser,
            screen: `${window.screen?.width || 0}x${window.screen?.height || 0}`,
            lang: navigator.language || "",
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "",
            url: location.href,
            referrer: document.referrer || "",
        };

        fetch("/api/visit", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
            keepalive: true,
        }).then(() => {
            sessionStorage.setItem("mz_visit_sent", "1");
        }).catch(() => {});
    } catch (_) {}
})();



// ---------- Deep link: /serie/slug  |  /?id=  |  /?link= ----------
(async function handleDeepLink() {
    try {
        const pathM = location.pathname.match(
            /^\/(serie|pelicula|anime)\/([^\/]+)(?:\/(\d+)\/(\d+))?\/?$/i
        );
        if (pathM) {
            const tipoPath = pathM[1].toLowerCase();
            let slug = pathM[2];
            try { slug = decodeURIComponent(slug); } catch (_) {}
            const tipo =
                tipoPath === "anime" ? "Anime" :
                tipoPath === "serie" ? "Serie" : "Pelicula";
            const q = new URLSearchParams();
            q.set("slug", slug);
            q.set("tipo", tipo);
            const res = await fetch("/api/detalle?" + q.toString());
            const item = await res.json();
            if (item && (item.nombre || item.titulo || item.link || item.slug)) {
                await abrirDetalle(item);
            }
            return;
        }

        const p = new URLSearchParams(location.search);
        const id = p.get("id");
        const link = p.get("link");
        if (!id && !link) return;
        const q = id ? `id=${encodeURIComponent(id)}` : `link=${encodeURIComponent(link)}`;
        const res = await fetch(`/api/detalle?${q}`);
        const item = await res.json();
        if (item && (item.nombre || item.link || item.slug)) abrirDetalle(item);
    } catch (e) { console.warn("Deep link:", e); }
})();

// ---------- Continuar viendo (localStorage) ----------
let progresoTimer = null;
let progresoActual = null; // { key, item, segundos, duracion }

function claveProgreso(item) {
    return item?.link || (item?.id != null ? String(item.id) : null) || item?.postId || null;
}

function obtenerProgreso() {
    try { return JSON.parse(localStorage.getItem(pk("progreso")) || "{}"); }
    catch { return {}; }
}

function guardarProgreso(item, segundos = 0, duracion = 0) {
    const key = claveProgreso(item);
    if (!key) return;
    const all = obtenerProgreso();
    all[key] = {
        link: item.link || null,
        id: item.id || null,
        postId: item.postId || item.id || null,
        nombre: item.nombre,
        portada: item.portada,
        backdrop: item.backdrop || null,
        tipo: item.tipo,
        year: item.year,
        calificacion: item.calificacion,
        descripcion: item.descripcion || null,
        genero: item.genero || null,
        // importante para el badge
        tiene_player: true,
        // no hace falta guardar todos los embeds (pesan); al abrir se piden a la API
        segundos: Math.max(0, Math.floor(segundos)),
        duracion: Math.max(0, Math.floor(duracion)),
        updated: Date.now()
    };
    const ordenados = Object.entries(all)
        .sort((a, b) => (b[1].updated || 0) - (a[1].updated || 0))
        .slice(0, 30);
    localStorage.setItem("moviezone_progress", JSON.stringify(Object.fromEntries(ordenados)));
}

function iniciarSeguimientoProgreso(item) {
    detenerSeguimientoProgreso();
    const key = claveProgreso(item);
    if (!key) return;
    const prev = obtenerProgreso()[key];
    progresoActual = {
        key,
        item,
        segundos: prev?.segundos || 0,
        duracion: prev?.duracion || 0
    };
    // Cada 15s guarda (los iframes de terceros no dan currentTime fiable)
    progresoTimer = setInterval(() => {
        if (!progresoActual) return;
        progresoActual.segundos += 15;
        guardarProgreso(progresoActual.item, progresoActual.segundos, progresoActual.duracion || progresoActual.segundos + 60);
    }, 15000);
}

function detenerSeguimientoProgreso(guardar = true) {
    if (progresoTimer) {
        clearInterval(progresoTimer);
        progresoTimer = null;
    }
    if (guardar && progresoActual) {
        guardarProgreso(progresoActual.item, progresoActual.segundos, progresoActual.duracion || progresoActual.segundos + 60);
    }
    progresoActual = null;
}

function cargarContinuarViendo() {
    const all = obtenerProgreso();
    const lista = Object.values(all)
        .filter(x => x && (x.segundos || 0) > 10)
        .sort((a, b) => (b.updated || 0) - (a.updated || 0))
        .slice(0, 12);

    const row = document.getElementById("row-continuar");
    const cont = document.getElementById("carousel-continuar");
    if (!row || !cont) return;

    if (!lista.length) {
        row.classList.add("hidden");
        return;
    }
    row.classList.remove("hidden");
    cont.innerHTML = "";

    lista.forEach(item => {
        item.tiene_player = true;
        const card = crearMediaCard(item);

        // barra progreso
        const pct = item.duracion > 0
            ? Math.min(100, Math.round((item.segundos / item.duracion) * 100))
            : Math.min(95, Math.round((item.segundos / 600) * 100));
        const bar = document.createElement("div");
        bar.className = "progress-bar-wrap";
        bar.innerHTML = `<div class="progress-bar-fill" style="width:${pct}%"></div>`;
        card.querySelector(".poster-wrapper")?.appendChild(bar);

        // Reemplazar handler: solo abrirDesdeProgreso
        const clone = card.cloneNode(true);
        clone.addEventListener("click", () => abrirDesdeProgreso(item));
        cont.appendChild(clone);
    });
}

// ---------- Recién añadidos ----------
async function cargarRecienAnadidos() {
    try {
        const res = await fetch("/api/recien?limit=12");
        const data = await res.json();
        renderCarousel("carousel-recien", data.resultados || []);
    } catch {
        const el = document.getElementById("carousel-recien");
        if (el) el.innerHTML = `<p style="color:var(--text-muted)">No disponible</p>`;
    }
}

// Llamar desde cargarHome() después de los carousels normales:
// cargarContinuarViendo();
// cargarRecienAnadidos();

// ---------- PWA ----------
if ("serviceWorker" in navigator) {
    navigator.serviceWor
    ker.register("/sw.js").catch(() => {});
}


window.asegurarEmbedsEpisodio = asegurarEmbedsEpisodio;
window.streamUrlParaNoAds = streamUrlParaNoAds;
window.resolverPlayUrlNoAds = resolverPlayUrlNoAds;
