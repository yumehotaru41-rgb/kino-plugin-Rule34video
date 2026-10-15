/// <reference path="./kino.d.ts" />

const BASE = "https://rule34video.com";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function headers(extra) {
  const h = {
    "User-Agent": UA,
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    Referer: BASE + "/",
  };
  if (extra) {
    for (const k in extra) h[k] = extra[k];
  }
  return h;
}

function sanitizeQuery(q) {
  if (!q || typeof q !== "string") return "";
  let s = q.trim().replace(/\s+/g, " ");
  if (s.length > 80) s = s.slice(0, 80).trim();
  return s;
}

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

/** Soft login: never blocks public videos. */
async function ensureLogin(force) {
  await null;
  if (!hasCredentials()) return false;
  try {
    const probe = await kino.fetch(BASE + "/edit-profile/", {
      headers: headers(),
      redirect: "manual",
    });
    if (probe.status === 200) {
      cacheMemberId(probe.text());
      return true;
    }
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
      headers: headers({
        "Content-Type": "application/x-www-form-urlencoded",
        Referer: BASE + "/login/",
      }),
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
      if (force)
        throw kino.error("auth_required", "usuario o contraseña incorrectos");
      return false;
    }
    const check = await kino.fetch(BASE + "/edit-profile/", {
      headers: headers(),
      redirect: "manual",
    });
    if (check.status === 200) {
      cacheMemberId(check.text());
      return true;
    }
    if (force) throw kino.error("auth_required", "no se pudo iniciar sesión");
    return false;
  } catch (e) {
    if (force && e && e.code) throw e;
    return false;
  }
}

function cacheMemberId(html) {
  if (!html) return;
  const m =
    html.match(/href="https?:\/\/rule34video\.com\/members\/(\d+)\/"/) ||
    html.match(/href="\/members\/(\d+)\/"/) ||
    html.match(/\/members\/(\d+)\/favourites/);
  if (m) kino.storage.set("memberId", m[1]);
}

async function getMemberId() {
  let id = kino.storage.get("memberId");
  if (id) return id;
  try {
    const r = await kino.fetch(BASE + "/edit-profile/", {
      headers: headers(),
      redirect: "manual",
    });
    if (r.status !== 200) return null;
    cacheMemberId(r.text());
    return kino.storage.get("memberId") || null;
  } catch (e) {
    return null;
  }
}

/**
 * Parse listing cards. ref = "id" or "id/slug" so resolve can open the page.
 * Site requires slug on /video/{id}/{slug}/ ; /video/{id}/ alone is 404 on many titles.
 * /popup-video/{id}/ works with id only and is the primary resolve path.
 */
function parseListing(html) {
  const items = [];
  const seen = {};

  function push(id, slug, title, poster, runtimeMinutes) {
    if (!id || seen[id]) return;
    seen[id] = true;
    const ref = slug ? id + "/" + slug : id;
    items.push({
      id: id,
      ref: ref,
      title: (title || "").trim() || "Video " + id,
      kind: "movie",
      poster: poster || undefined,
      runtimeMinutes: runtimeMinutes,
      adult: true,
    });
  }

  // Favourites grid
  const favRe =
    /data-video-card-id="(\d+)"[^>]*data-title="([^"]*)"[^>]*data-url="([^"]+)"/g;
  let fm;
  while ((fm = favRe.exec(html)) !== null) {
    const id = fm[1];
    const url = fm[2] ? fm[3] : fm[3];
    const title = fm[2];
    const slugM = String(url).match(/\/video\/\d+\/([^/?#]+)/);
    let poster;
    const around = html.slice(Math.max(0, fm.index - 50), fm.index + 1500);
    const imgM = around.match(
      /src="(https:\/\/rule34video\.com\/contents\/videos_screenshots\/[^"]+)"/
    );
    if (imgM) poster = imgM[1];
    const durM = around.match(/data-dur="(\d+)"/);
    let runtimeMinutes;
    if (durM) {
      const secs = parseInt(durM[1], 10);
      if (!isNaN(secs) && secs > 0)
        runtimeMinutes = Math.max(1, Math.round(secs / 60));
    }
    push(id, slugM ? slugM[1] : null, title, poster, runtimeMinutes);
  }

  // Standard cards: item thumb video_*
  const blocks = html.split(/<div class="item thumb video_/);
  for (let i = 1; i < blocks.length; i++) {
    const block = blocks[i];
    const hrefM = block.match(
      /href="https?:\/\/rule34video\.com\/video\/(\d+)\/([^"/?#]+)\/?"/
    );
    if (!hrefM) {
      const idOnly = block.match(
        /href="https?:\/\/rule34video\.com\/video\/(\d+)\/?"/
      );
      if (!idOnly) continue;
      const titleM =
        block.match(/class="thumb_title">([^<]+)/) ||
        block.match(/title="([^"]+)"/);
      let poster;
      const imgM = block.match(
        /src="(https:\/\/rule34video\.com\/contents\/videos_screenshots\/[^"]+)"/
      );
      if (imgM) poster = imgM[1];
      const timeM = block.match(/class="time">([^<]+)/);
      push(
        idOnly[1],
        null,
        titleM ? titleM[1] : null,
        poster,
        timeM ? parseRuntime(timeM[1]) : undefined
      );
      continue;
    }
    const id = hrefM[1];
    const slug = hrefM[2];
    const titleM =
      block.match(/class="thumb_title">([^<]+)/) ||
      block.match(/title="([^"]+)"/);
    let poster;
    const imgM = block.match(
      /src="(https:\/\/rule34video\.com\/contents\/videos_screenshots\/[^"]+)"/
    );
    if (imgM) poster = imgM[1];
    const timeM = block.match(/class="time">([^<]+)/);
    push(
      id,
      slug,
      titleM ? titleM[1] : slug.replace(/-/g, " "),
      poster,
      timeM ? parseRuntime(timeM[1]) : undefined
    );
  }

  // Fallback: any video links
  if (items.length === 0) {
    const linkRe =
      /href="https?:\/\/rule34video\.com\/video\/(\d+)\/([^"?#]+)\/?"/g;
    let lm;
    while ((lm = linkRe.exec(html)) !== null) {
      push(lm[1], lm[2], lm[2].replace(/-/g, " "), null, undefined);
    }
  }

  return items;
}

function nextCursor(html, currentPath) {
  const favNext = html.match(
    /href="(\?from_fav_videos=\d+)"[^>]*>\s*(?:Next|\d+)/i
  );
  if (favNext && currentPath) {
    return String(currentPath).split("?")[0] + favNext[1];
  }
  const favLink = html.match(
    /href="(\/members\/\d+\/favourites\/videos\/\?from_fav_videos=\d+)"/
  );
  if (favLink) return favLink[1];

  const allCat = html.match(/href="(\/categories\/[^"/]+\/\d+\/)"/g) || [];
  if (allCat.length) {
    const nums = [];
    for (let i = 0; i < allCat.length; i++) {
      const mm = allCat[i].match(/\/categories\/([^/]+)\/(\d+)\//);
      if (mm)
        nums.push({
          path: "/categories/" + mm[1] + "/" + mm[2] + "/",
          n: parseInt(mm[2], 10),
        });
    }
    nums.sort((a, b) => a.n - b.n);
    let cur = 1;
    const curM = String(currentPath || "").match(/\/categories\/[^/]+\/(\d+)/);
    if (curM) cur = parseInt(curM[1], 10);
    for (let i = 0; i < nums.length; i++) {
      if (nums[i].n > cur) return nums[i].path;
    }
  }

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

/**
 * Load video HTML. Order matters:
 * 1) /popup-video/{id}/  — works with id only (current site)
 * 2) /video/{id}/{slug}/ — classic page when we have slug
 * 3) /video/{id}/        — may 404 on newer uploads
 */
async function fetchVideoHtml(id, slug) {
  const paths = [];
  paths.push("/popup-video/" + id + "/");
  if (slug) paths.push("/video/" + id + "/" + slug + "/");
  paths.push("/video/" + id + "/");
  paths.push("/videos/" + id + "/");

  let lastErr = null;
  for (let i = 0; i < paths.length; i++) {
    try {
      return await fetchPage(paths[i]);
    } catch (e) {
      lastErr = e;
      if (e && e.code === "not_found") continue;
      // network / rate limit: stop
      if (e && (e.code === "rate_limited" || e.code === "unavailable")) throw e;
    }
  }
  if (lastErr) throw lastErr;
  throw kino.error("not_found");
}

export async function search(query) {
  await ensureLogin(false);
  const q = sanitizeQuery(query.q || "");
  if (!q) return [];

  let path;
  if (query.cursor) path = query.cursor;
  else path = "/search/" + encodeURIComponent(q).replace(/%20/g, "+") + "/";

  let html;
  try {
    html = await fetchPage(path);
  } catch (e) {
    if (!query.cursor) {
      html = await fetchPage("/search/?q=" + encodeURIComponent(q));
    } else {
      throw e;
    }
  }

  const items = parseListing(html);
  const next = nextCursor(html, path);
  if (next) return { items: items.slice(0, 100), next: next };
  return items.slice(0, 100);
}

export async function home() {
  const loggedIn = await ensureLogin(false);
  const rows = [];

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
    } catch (e) {}
  }

  try {
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
  } catch (e) {}

  try {
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
  } catch (e) {}

  try {
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
  } catch (e) {}

  // 3D at the end
  try {
    const c3d = await fetchPage("/categories/3d/");
    const items3d = parseListing(c3d);
    if (items3d.length) {
      rows.push({
        id: "cat-3d",
        title: "3D",
        items: items3d.slice(0, 40),
        ref: "/categories/3d/",
        genre: "otros",
      });
    }
  } catch (e) {}

  return rows;
}

export async function browse(ref, cursor) {
  await ensureLogin(false);
  const path = cursor || ref;
  const html = await fetchPage(path);
  const items = parseListing(html);
  const next = nextCursor(html, path);
  return { items: items.slice(0, 60), next: next };
}

function extractFormats(html) {
  const seenQ = {};

  function add(quality, url) {
    if (!url) return;
    url = String(url).replace(/&amp;/g, "&").trim();
    if (url.indexOf("http") !== 0) return;
    url = url
      .replace(/([?&])download=true(&|$)/g, "$1")
      .replace(/([?&])download_filename=[^&]*/g, "$1")
      .replace(/[?&]$/, "")
      .replace(/\?&/, "?");
    const q = quality || 0;
    if (seenQ[q] && seenQ[q].length >= url.length) return;
    seenQ[q] = url;
  }

  const dlRe = /href="([^"]*get_file[^"]*)"[^>]{0,300}>([^<]{0,60})/gi;
  let m;
  while ((m = dlRe.exec(html)) !== null) {
    const label = m[2] || "";
    const qm = label.match(/(\d+)\s*p/i) || m[1].match(/_(\d+)p?\.mp4/i);
    const q = qm ? parseInt(qm[1], 10) : 0;
    if (m[1].indexOf("get_file") !== -1) add(q, m[1]);
  }

  const pairs = [
    ["video_url", "video_url_text"],
    ["video_alt_url", "video_alt_url_text"],
    ["video_alt_url2", "video_alt_url2_text"],
    ["video_alt_url3", "video_alt_url3_text"],
    ["video_alt_url4", "video_alt_url4_text"],
  ];
  for (let i = 0; i < pairs.length; i++) {
    const uM = html.match(new RegExp(pairs[i][0] + ":\\s*'([^']+)'"));
    const tM = html.match(new RegExp(pairs[i][1] + ":\\s*'([^']+)'"));
    if (uM) {
      let q = 0;
      if (tM) {
        const n = parseInt(String(tM[1]).replace(/p/i, ""), 10);
        if (!isNaN(n)) q = n;
      }
      if (!q) {
        const qm = uM[1].match(/_(\d+)p?\.mp4/i);
        if (qm) q = parseInt(qm[1], 10);
      }
      add(q, uM[1]);
    }
  }

  const cM = html.match(/"contentUrl"\s*:\s*"(https:[^"]+)"/);
  if (cM) {
    const u = cM[1].replace(/\\\//g, "/");
    const qm = u.match(/_(\d+)p?\.mp4/i);
    add(qm ? parseInt(qm[1], 10) : 360, u);
  }

  const list = [];
  for (const q in seenQ) {
    list.push({ quality: parseInt(q, 10) || 0, url: seenQ[q] });
  }
  list.sort((a, b) => b.quality - a.quality);
  return list;
}

function pickFormat(formats, preferred) {
  if (!formats.length) return null;
  if (preferred === "best" || !preferred) return formats[0];
  const want = parseInt(preferred, 10);
  if (isNaN(want)) return formats[0];
  const exact = formats.find((f) => f.quality === want);
  if (exact) return exact;
  const lower = formats.filter((f) => f.quality > 0 && f.quality <= want);
  if (lower.length) return lower[0];
  return formats[formats.length - 1];
}

export async function resolve(ref) {
  await ensureLogin(false);

  const raw = String(ref || "").trim();
  // Accept: "123", "123/slug", full URL
  let id = "";
  let slug = "";
  const urlM = raw.match(/\/video\/(\d+)(?:\/([^/?#]+))?/);
  const popM = raw.match(/\/popup-video\/(\d+)/);
  if (urlM) {
    id = urlM[1];
    slug = urlM[2] || "";
  } else if (popM) {
    id = popM[1];
  } else {
    const parts = raw.replace(/^\/+/, "").split("/");
    id = String(parts[0] || "").replace(/[^\d]/g, "");
    slug = parts[1] ? String(parts[1]).replace(/[^a-zA-Z0-9_-]/g, "") : "";
  }
  if (!id) throw kino.error("not_found");

  const html = await fetchVideoHtml(id, slug);
  const formats = extractFormats(html);
  if (!formats.length) {
    throw kino.error("unavailable", "no se encontró el archivo de video");
  }

  const preferred = kino.config.get("quality") || "best";
  const chosen = pickFormat(formats, preferred);
  if (!chosen || !chosen.url) {
    throw kino.error("unavailable", "no hay calidad disponible");
  }

  const alternatives = formats
    .filter((f) => f.url !== chosen.url)
    .map((f) => ({
      url: f.url,
      mime: "video/mp4",
      label: f.quality ? f.quality + "p" : undefined,
    }));

  return {
    url: chosen.url,
    mime: "video/mp4",
    headers: {
      Referer: BASE + "/video/" + id + "/",
      "User-Agent": UA,
    },
    label: chosen.quality ? chosen.quality + "p" : undefined,
    alternatives: alternatives.length ? alternatives : undefined,
  };
}
