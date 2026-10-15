/// <reference path="./kino.d.ts" />

const BASE = "https://rule34video.com";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function headers() {
  return {
    "User-Agent": UA,
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
  };
}

/** Trim query to stay under ~80 chars for the site search path. */
function sanitizeQuery(q) {
  if (!q || typeof q !== "string") return "";
  let s = q.trim().replace(/\s+/g, " ");
  if (s.length > 80) s = s.slice(0, 80).trim();
  return s;
}

/** Parse "M:SS" or "H:MM:SS" into minutes (integer). */
function parseRuntime(timeStr) {
  if (!timeStr) return undefined;
  const parts = String(timeStr)
    .trim()
    .split(":")
    .map((x) => parseInt(x, 10));
  if (parts.some((n) => isNaN(n))) return undefined;
  let secs = 0;
  if (parts.length === 3) secs = parts[0] * 3600 + parts[1] * 60 + parts[2];
  else if (parts.length === 2) secs = parts[0] * 60 + parts[1];
  else if (parts.length === 1) secs = parts[0];
  return Math.max(1, Math.round(secs / 60));
}

function hasCredentials() {
  const user = (kino.config.get("user") || "").trim();
  const password = kino.config.get("password") || "";
  return !!(user && password);
}

/**
 * Login if credentials are set. Returns true when session is active.
 * Stores memberId in kino.storage when known.
 */
async function ensureLogin() {
  await null;
  if (!hasCredentials()) return false;

  // Already logged in? edit-profile is private.
  const probe = await kino.fetch(BASE + "/edit-profile/", {
    headers: headers(),
    redirect: "manual",
  });
  if (probe.status === 200) {
    const html = probe.text();
    cacheMemberId(html);
    return true;
  }

  // Need CSRF from login page
  const loginPage = await kino.fetch(BASE + "/login/", { headers: headers() });
  const loginHtml = loginPage.text();
  const csrfM = loginHtml.match(
    /name="remember_me_csrf_token"\s+value="([^"]+)"/
  );
  const csrf = csrfM ? csrfM[1] : "";

  const user = (kino.config.get("user") || "").trim();
  const password = kino.config.get("password") || "";

  const r = await kino.fetch(BASE + "/login/", {
    method: "POST",
    headers: {
      ...headers(),
      "Content-Type": "application/x-www-form-urlencoded",
      Referer: BASE + "/login/",
    },
    body: {
      form: {
        username: user,
        pass: password,
        action: "login",
        email_link: BASE + "/email/",
        remember_me: "1",
        remember_me_csrf_token: csrf,
        redirect_to: "/",
      },
    },
    redirect: "manual",
  });

  if (r.status === 401 || r.status === 403) {
    throw kino.error("auth_required", "usuario o contraseña incorrectos");
  }

  // Confirm session
  const check = await kino.fetch(BASE + "/edit-profile/", {
    headers: headers(),
    redirect: "manual",
  });
  if (check.status !== 200) {
    throw kino.error("auth_required", "no se pudo iniciar sesión");
  }
  cacheMemberId(check.text());
  return true;
}

function cacheMemberId(html) {
  if (!html) return;
  // Profile / edit links often contain /members/ID/
  const m =
    html.match(/href="https?:\/\/rule34video\.com\/members\/(\d+)\/"/) ||
    html.match(/href="\/members\/(\d+)\/"/) ||
    html.match(/\/members\/(\d+)\/favourites/);
  if (m) {
    kino.storage.set("memberId", m[1]);
  }
}

async function getMemberId() {
  let id = kino.storage.get("memberId");
  if (id) return id;
  const r = await kino.fetch(BASE + "/edit-profile/", {
    headers: headers(),
    redirect: "manual",
  });
  if (r.status !== 200) return null;
  const html = r.text();
  cacheMemberId(html);
  return kino.storage.get("memberId") || null;
}

/**
 * Parse video cards from listing pages (search, home) and member favourites.
 * Supports:
 *  - div.item.thumb.video_* (main listings)
 *  - div.item.ma-v.video_* with data-video-card-id / data-title / data-url (favourites)
 */
function parseListing(html) {
  const items = [];
  const seen = {};

  // Favourites / member grid: data-video-card-id + data-title + data-url
  const favRe =
    /data-video-card-id="(\d+)"[^>]*data-title="([^"]*)"[^>]*data-url="([^"]+)"/g;
  let fm;
  while ((fm = favRe.exec(html)) !== null) {
    const id = fm[1];
    if (seen[id]) continue;
    seen[id] = true;
    let poster;
    const around = html.slice(Math.max(0, fm.index - 50), fm.index + 1200);
    const imgM = around.match(
      /src="(https:\/\/rule34video\.com\/contents\/videos_screenshots\/[^"]+)"/
    );
    if (imgM) poster = imgM[1];
    const durM = around.match(/data-dur="(\d+)"/);
    let runtimeMinutes;
    if (durM) {
      const secs = parseInt(durM[1], 10);
      if (!isNaN(secs) && secs > 0) runtimeMinutes = Math.max(1, Math.round(secs / 60));
    }
    items.push({
      id: id,
      ref: id,
      title: fm[2].trim() || "Video " + id,
      kind: "movie",
      poster: poster,
      runtimeMinutes: runtimeMinutes,
      adult: true,
    });
  }

  // Standard listing cards
  const blocks = html.split(/<div class="item thumb video_/);
  for (let i = 1; i < blocks.length; i++) {
    const block = blocks[i];
    const hrefM = block.match(
      /href="(https?:\/\/rule34video\.com\/video\/(\d+)\/[^"]+)"/
    );
    if (!hrefM) continue;
    const id = hrefM[2];
    if (seen[id]) continue;
    seen[id] = true;

    const titleM =
      block.match(/class="thumb_title">([^<]+)/) ||
      block.match(/title="([^"]+)"/);
    const title = titleM ? titleM[1].trim() : "Video " + id;

    let poster;
    const imgM = block.match(
      /src="(https:\/\/rule34video\.com\/contents\/videos_screenshots\/[^"]+)"/
    );
    if (imgM) poster = imgM[1];

    const timeM = block.match(/class="time">([^<]+)/);
    const runtimeMinutes = timeM ? parseRuntime(timeM[1]) : undefined;

    items.push({
      id: id,
      ref: id,
      title: title,
      kind: "movie",
      poster: poster,
      runtimeMinutes: runtimeMinutes,
      adult: true,
    });
  }

  return items;
}

function nextCursor(html, currentPath) {
  // Favourites pagination: ?from_fav_videos=N
  const favNext = html.match(
    /href="(\?from_fav_videos=\d+)"[^>]*>\s*(?:Next|\d+)/i
  );
  if (favNext && currentPath) {
    const base = currentPath.split("?")[0];
    return base + favNext[1];
  }
  // Generic from_fav_videos in absolute/relative links
  const favLink = html.match(
    /href="(\/members\/\d+\/favourites\/videos\/\?from_fav_videos=\d+)"/
  );
  if (favLink) return favLink[1];

  const m =
    html.match(/href="(\/search\/\d+\/[^"]*)"/) ||
    html.match(/href="(\/search\/\?[^"]*from=\d+[^"]*)"/) ||
    html.match(/href="(\/latest-updates\/\d+\/)"/) ||
    html.match(/href="(\/top-rated\/\d+\/)"/) ||
    html.match(/href="(\/most-popular\/\d+\/)"/);
  if (m) return m[1];
  const next = html.match(/href="([^"]+)"[^>]*>\s*Next/i);
  if (next) return next[1];
  return undefined;
}

async function fetchPage(path) {
  const url = path.startsWith("http") ? path : BASE + path;
  const r = await kino.fetch(url, { headers: headers() });
  if (r.status === 429) throw kino.error("rate_limited", "demasiadas peticiones");
  if (r.status === 404) throw kino.error("not_found");
  if (r.status === 401 || r.status === 403)
    throw kino.error("auth_required", "necesitas iniciar sesión");
  if (!r.ok) throw kino.error("unavailable", "el sitio respondió " + r.status);
  return r.text();
}

export async function search(query) {
  await ensureLogin();
  const q = sanitizeQuery(query.q || "");
  if (!q) return [];

  let path;
  if (query.cursor) {
    path = query.cursor;
  } else {
    path = "/search/" + encodeURIComponent(q) + "/";
  }

  const html = await fetchPage(path);
  const items = parseListing(html);
  const next = nextCursor(html, path);

  if (next) {
    return { items: items.slice(0, 100), next: next };
  }
  return items.slice(0, 100);
}

export async function home() {
  const loggedIn = await ensureLogin();
  const rows = [];

  // Favourites only when logged in
  if (loggedIn) {
    try {
      const memberId = await getMemberId();
      if (memberId) {
        const favPath = "/members/" + memberId + "/favourites/videos/";
        const favHtml = await fetchPage(favPath);
        const favItems = parseListing(favHtml);
        if (favItems.length) {
          rows.push({
            id: "favourites",
            title: "Mis favoritos",
            items: favItems.slice(0, 40),
            ref: favPath,
            genre: "otros",
          });
        }
      }
    } catch (e) {
      // Session may have expired; skip favourites row silently
    }
  }

  const latestHtml = await fetchPage("/latest-updates/");
  const latest = parseListing(latestHtml);
  if (latest.length) {
    rows.push({
      id: "latest",
      title: "Lo más nuevo",
      items: latest.slice(0, 40),
      ref: "/latest-updates/",
      genre: "otros",
    });
  }

  const topHtml = await fetchPage("/top-rated/");
  const top = parseListing(topHtml);
  if (top.length) {
    rows.push({
      id: "top",
      title: "Mejor valorados",
      items: top.slice(0, 40),
      ref: "/top-rated/",
      genre: "otros",
    });
  }

  const popHtml = await fetchPage("/most-popular/");
  const pop = parseListing(popHtml);
  if (pop.length) {
    rows.push({
      id: "popular",
      title: "Más populares",
      items: pop.slice(0, 40),
      ref: "/most-popular/",
      genre: "otros",
    });
  }

  return rows;
}

export async function browse(ref, cursor) {
  await ensureLogin();
  const path = cursor || ref;
  const html = await fetchPage(path);
  const items = parseListing(html);
  const next = nextCursor(html, path);
  return { items: items.slice(0, 60), next: next };
}

/**
 * Collect quality -> url from the video page.
 * Prefers the download links (stable tokens) and falls back to player URLs.
 */
function extractFormats(html) {
  const formats = [];

  const re = /href="([^"]+download=true[^"]*)"[^>]*>\s*(?:MP4\s+)?(\d+)p/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const q = parseInt(m[2], 10);
    let url = m[1].replace(/&amp;/g, "&");
    url = url
      .replace(/[?&]download=true/g, "")
      .replace(/[?&]download_filename=[^&]*/g, "");
    formats.push({ quality: q, url: url });
  }

  if (formats.length === 0) {
    const pairs = [
      ["video_url", "video_url_text"],
      ["video_alt_url", "video_alt_url_text"],
      ["video_alt_url2", "video_alt_url2_text"],
      ["video_alt_url3", "video_alt_url3_text"],
      ["video_alt_url4", "video_alt_url4_text"],
    ];
    for (const [uKey, tKey] of pairs) {
      const uM = html.match(new RegExp(uKey + ":\\s*'([^']+)'"));
      const tM = html.match(new RegExp(tKey + ":\\s*'([^']+)'"));
      if (uM) {
        const q = tM ? parseInt(tM[1], 10) : 0;
        formats.push({ quality: isNaN(q) ? 0 : q, url: uM[1] });
      }
    }
  }

  if (formats.length === 0) {
    const cM = html.match(/"contentUrl"\s*:\s*"(https:[^"]+)"/);
    if (cM) formats.push({ quality: 360, url: cM[1].replace(/\\\//g, "/") });
  }

  formats.sort((a, b) => b.quality - a.quality);
  return formats;
}

function pickFormat(formats, preferred) {
  if (!formats.length) return null;
  if (preferred === "best" || !preferred) return formats[0];
  const want = parseInt(preferred, 10);
  const exact = formats.find((f) => f.quality === want);
  if (exact) return exact;
  const lower = formats.filter((f) => f.quality <= want);
  if (lower.length) return lower[0];
  return formats[formats.length - 1];
}

export async function resolve(ref) {
  await ensureLogin();
  const id = String(ref).replace(/[^\d]/g, "");
  if (!id) throw kino.error("not_found");

  const html = await fetchPage("/video/" + id + "/");
  const formats = extractFormats(html);
  if (!formats.length)
    throw kino.error("unavailable", "no se encontró el video");

  const preferred = kino.config.get("quality") || "best";
  const chosen = pickFormat(formats, preferred);
  if (!chosen) throw kino.error("unavailable", "no hay calidad disponible");

  const alternatives = formats
    .filter((f) => f.url !== chosen.url)
    .map((f) => ({
      url: f.url,
      mime: "video/mp4",
      label: f.quality + "p",
    }));

  return {
    url: chosen.url,
    mime: "video/mp4",
    label: chosen.quality ? chosen.quality + "p" : undefined,
    alternatives: alternatives.length ? alternatives : undefined,
  };
}
