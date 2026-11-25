// KiraFlix Worker v4.3 - tracks/mp4/play/seg/sub/live + UQLOAD + STREAMTAPE + YOUTUBE (via youtube.php); demais acoes vao para o PHP
const API = "https://kiraflix-api.site.je/api.php";
const ALLOWED = ["https://kiraflix.qd.je", "https://www.kiraflix.qd.je"];
const UA = "Mozilla/5.0 (Linux; Android 11) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36";

const HOSTS = [
  "www3.dramasfree.com","peliculaplay.com","latino.solo-latino.com","es.cuevana4br.com","flixlat.com",
  "video.playspelis.com","ww1.123flmsfree.com","ver.123pelicula.com","play.cuevana19.com","ww20.321moviesfree.com",
];
const SUB_HOST_RE = /(^|\.)(dramasfree|peliculaplay|solo-latino|cuevana4br|cuevana19|flixlat|playspelis|123flmsfree|123pelicula|321moviesfree)\.com$/i;

const LANG = {
  "pt-br":"pt","pt_br":"pt","por":"pt","pt":"pt","en-us":"en","en_us":"en","eng":"en","en":"en",
  "es-419":"es","spa":"es","es":"es","fra":"fr","fre":"fr","fr":"fr","deu":"de","ger":"de","de":"de","ita":"it","it":"it",
  "in_id":"id","id":"id","zh_cn":"zh-Hans","zh_tw":"zh-Hant","ja":"ja","jpn":"ja","ko":"ko","kor":"ko",
};
const NAMES = { pt:"Português", en:"English", es:"Español", ja:"Japonês", ko:"Coreano", fr:"Français", de:"Deutsch", it:"Italiano",
  tr:"Türkçe", ar:"العربية", id:"Bahasa Indonesia", ms:"Bahasa Melayu", th:"ภาษาไทย", vi:"Tiếng Việt", fa:"فارسی", fil:"Filipino",
  "zh-Hans":"中文 (简体)", "zh-Hant":"中文 (繁體)" };
const normLang = v => { const k = String(v || "").trim().toLowerCase(); return LANG[k] || (k || "und"); };

/* ---------- utilidades ---------- */
const decodeEnt = s => String(s).replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
const clean = s => decodeEnt(String(s).replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();

function cleanTarget(raw) {
  let v = String(raw || "").trim();
  for (let i = 0; i < 3; i++) { if (/%3A%2F%2F/i.test(v)) { try { v = decodeURIComponent(v); } catch (e) { break; } } }
  const m = v.match(/https?:\/\/[^\/\s"'<>?]+\/(?:[a-z]{2}\/)?detail\/[a-z]+\/[^\s"'<>&?#]+/i);
  if (m) return m[0].replace(/[.,;]+$/, "");
  const u = v.match(/https?:\/\/[^\s"'<>]+/i);
  return u ? u[0] : "";
}
const hostOk = u => { try { const h = new URL(u).hostname.toLowerCase(); return HOSTS.includes(h) || UQ_HOST_RE.test(h) || ST_HOST_RE.test(h); } catch (e) { return false; } };

function parseDetail(u) {
  const x = new URL(u);
  const m = x.pathname.match(/^\/(?:([a-z]{2})\/)?detail\/([a-z]+)\/([^/]+)(?:\/(\d+))?\/?$/i);
  if (!m) return null;
  return { origin: x.origin, lang: (m[1] || "").toLowerCase(), type: m[2].toLowerCase(), slug: decodeURIComponent(m[3]), num: m[4] ? +m[4] : null };
}
const buildDetail = (d, slug, num) => `${d.origin}/${d.lang ? d.lang + "/" : ""}detail/${d.type}/${encodeURIComponent(slug)}${num != null ? "/" + num : ""}`;

async function getPage(url) {
  const r = await fetch(url, { headers: { "User-Agent": UA, "Accept": "text/html,application/xhtml+xml", "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8" }, redirect: "follow" });
  if (!r.ok) throw new Error("HTTP " + r.status + " ao ler a página");
  const t = await r.text();
  if (/aes\.js/.test(t) && /toNumbers/.test(t)) throw new Error("a página pediu verificação anti-robô");
  return t;
}

/* ---------- extração ---------- */
function attrs(tag) {
  const o = {}; const re = /([a-zA-Z_:][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)')/g; let m;
  while ((m = re.exec(tag))) o[m[1].toLowerCase()] = decodeEnt(m[3] ?? m[4] ?? "");
  return o;
}

function extractMedia(html, pageUrl) {
  const qualities = [], subtitles = [], seenQ = new Set(), seenS = new Set();
  const re = /<button\b([^>]*\bdata-url\s*=[^>]*)>([\s\S]*?)<\/button>/gi; let m;
  while ((m = re.exec(html))) {
    const a = attrs(m[1]); const url = (a["data-url"] || "").trim(); if (!url) continue;
    const text = clean(m[2]);
    const abs = new URL(url, pageUrl).toString();
    const isSub = a["data-language"] != null || /\.(srt|vtt)(\?|$)|-(srt|vtt)(\?|$)/i.test(url);
    if (isSub) {
      if (seenS.has(abs)) continue; seenS.add(abs);
      const lang = normLang(a["data-language"] || "und");
      subtitles.push({ language: lang, label: a["data-text"] || text || NAMES[lang] || lang, url: abs });
    } else if (/\.m3u8|\.mp4/i.test(url) || /^(\d{3,4}\s*p|[248]k|uhd|fhd|qhd|hd|sd)$/i.test(text)) {
      if (seenQ.has(abs)) continue; seenQ.add(abs);
      qualities.push({ label: text || "Auto", height: parseHeight(text, url), url: abs });
    }
  }
  // <track> e <audio> públicos, se existirem
  const tr = /<track\b([^>]*)>/gi;
  while ((m = tr.exec(html))) {
    const a = attrs(m[1]); if (!a.src) continue;
    const abs = new URL(a.src, pageUrl).toString(); if (seenS.has(abs)) continue; seenS.add(abs);
    const lang = normLang(a.srclang || "und");
    subtitles.push({ language: lang, label: a.label || NAMES[lang] || lang, url: abs });
  }
  qualities.sort((x, y) => y.height - x.height);
  return { qualities, subtitles };
}

function balanced(text, start) {
  const open = text[start], close = open === "[" ? "]" : "}"; let d = 0, str = false, esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (str) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') str = false; continue; }
    if (c === '"') str = true; else if (c === open) d++; else if (c === close) { d--; if (d === 0) return text.slice(start, i + 1); }
  }
  return "";
}

const isMovieType = t => /^(movie|film|filme)$/i.test(t);
const slugTitle = wp => { const p = String(wp).indexOf("-"); return String(p < 0 ? wp : wp.slice(p + 1)).replace(/-/g, " ").trim(); };

// lista de idiomas do site: "dubbingList":[{audioLanguageCode,dubMode,dubLang,websiteParam,...}]
// dubMode 1 = dublagem; dubMode 0 = audio original (e e nessas paginas que costumam estar as legendas)
function extractDubs(html, pageUrl) {
  const d = parseDetail(pageUrl); if (!d) return { current: null, dubs: [] };
  const i = html.indexOf('"dubbingList":'); let list = [];
  if (i >= 0) { const j = html.indexOf("[", i); try { list = JSON.parse(balanced(html, j)); } catch (e) {} }
  const cm = html.match(/"audioLanguageCode":"([^"]+)"/);
  const curLang = normLang(cm ? cm[1] : "ja");
  const dubs = [], seen = new Set();
  for (const it of list) {
    const wp = it.websiteParam; if (!wp) continue;
    const isCur = wp.toLowerCase() === d.slug.toLowerCase();
    const real = String(it.dubMode) === "1";
    const lang = normLang(real ? (it.dubLang || it.audioLanguageCode) : (it.audioLanguageCode || curLang));
    const key = lang + (real ? "|d" : "|o"); if (seen.has(key) && !isCur) continue; seen.add(key);
    dubs.push({ language: lang, label: (NAMES[lang] || lang) + (real ? " (dublado)" : " (original)"), dubbed: real, current: isCur, page: buildDetail(d, wp, d.num), slug: wp });
  }
  if (!dubs.some(x => x.current)) dubs.unshift({ language: curLang, label: (NAMES[curLang] || curLang) + " (original)", dubbed: false, current: true, page: pageUrl, slug: d.slug });
  return { current: curLang, dubs };
}

// partes (filmes) / temporadas do site: "seasons":[{name:"Parte 2",seriesNo:2,websiteParam:"..."}]
function extractCollection(html, pageUrl) {
  const d = parseDetail(pageUrl); if (!d) return [];
  const i = html.indexOf('"seasons":['); if (i < 0) return [];
  let list = []; try { list = JSON.parse(balanced(html, html.indexOf("[", i))); } catch (e) { return []; }
  const num = isMovieType(d.type) ? 0 : (d.num ?? 1);
  return list.filter(x => x.websiteParam).map(x => ({ n: x.seriesNo, name: x.name, title: slugTitle(x.websiteParam), slug: x.websiteParam,
    page: buildDetail(d, x.websiteParam, num), current: x.websiteParam.toLowerCase() === d.slug.toLowerCase() }));
}

// altura a partir de "720P", "1080p", "4K", "2K", "UHD", "FHD", "HD", "SD" (ou do próprio link: ..._2160p...)
function parseHeight(text, url) {
  const t = String(text || "").toLowerCase().trim();
  let m = t.match(/(\d{3,4})\s*p/); if (m) return +m[1];
  if (/\b8k\b/.test(t)) return 4320;
  if (/\b4k\b|uhd|2160/.test(t)) return 2160;
  if (/\b2k\b|qhd|1440/.test(t)) return 1440;
  if (/fhd|full\s*hd|1080/.test(t)) return 1080;
  if (/\bhd\b/.test(t)) return 720;
  if (/\bsd\b/.test(t)) return 480;
  const u = String(url || "").toLowerCase();
  m = u.match(/[_\-\/.](2160|1440|1080|720|540|480|360|240)p?(?=[_\-\/.?]|$)/); if (m) return +m[1];
  if (/[_\-\/](4k|uhd)[_\-\/.?]/.test(u)) return 2160;
  return parseInt(t) || 0;
}
const expOf = u => { const m = String(u || "").match(/exp=(\d{9,11})/); return m ? +m[1] : 0; };

async function tracks(target) {
  const html = await getPage(target);
  const media = extractMedia(html, target);
  const { dubs } = extractDubs(html, target);
  const parts = extractCollection(html, target);
  const audio = await Promise.all(dubs.map(async dub => {
    if (dub.current) return { ...dub, qualities: media.qualities, subtitles: media.subtitles };
    try { const h = await getPage(dub.page); const mm = extractMedia(h, dub.page); return { ...dub, qualities: mm.qualities, subtitles: mm.subtitles }; }
    catch (e) { return { ...dub, qualities: [], subtitles: [], error: e.message }; }
  }));
  const seen = new Set(), subtitles = [];
  audio.forEach(a => (a.subtitles || []).forEach(sb => { if (!seen.has(sb.url)) { seen.add(sb.url); subtitles.push(sb); } }));
  audio.forEach(a => { delete a.subtitles; });
  const exps = [media.qualities, ...audio.map(a => a.qualities)].flat().map(q => expOf(q.url)).filter(Boolean);
  return { qualities: media.qualities, subtitles, audio: audio.filter(a => a.qualities.length || a.current), parts, source_url: target, complete: true, worker: 3,
           expires: exps.length ? Math.min(...exps) : 0, fetched_at: Math.floor(Date.now() / 1000) };
}

async function cachedTracks(target, ctx, nocache) {
  const cache = caches.default, key = new Request("https://kf-cache.local/tracks3?u=" + encodeURIComponent(target));
  if (!nocache) {
    const hit = await cache.match(key);
    if (hit) { try { const dd = await hit.json(); if (!(dd.expires && dd.expires - Date.now() / 1000 < 90)) return dd; } catch (e) {} }
  }
  const data = await tracks(target);
  const life = data.expires ? Math.min(240, Math.floor(data.expires - Date.now() / 1000 - 90)) : 240;
  if (life > 0) ctx.waitUntil(cache.put(key, new Response(JSON.stringify(data), { headers: { "Cache-Control": "max-age=" + life } })));
  return data;
}

const BW = h => h >= 2160 ? 16000000 : h >= 1440 ? 9000000 : h >= 1080 ? 5000000 : h >= 720 ? 2800000 : h >= 540 ? 1600000 : 800000;
function toVtt(t) {
  t = String(t).replace(/^﻿/, "").replace(/\r/g, "");
  if (/^WEBVTT/.test(t)) return t;
  return "WEBVTT\n\n" + t.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2");
}

// leitura rápida: página atual + (se pedir outro idioma) só a página desse idioma
async function liteInfo(target, lang, ctx, nocache) {
  const key = new Request("https://kf-cache.local/lite?u=" + encodeURIComponent(target) + "&l=" + (lang || ""));
  if (!nocache) {
    const hit = await caches.default.match(key);
    if (hit) { try { const d = await hit.json(); if (!(d.expires && d.expires - Date.now() / 1000 < 90)) return d; } catch (e) {} }
  }
  const html = await getPage(target);
  const media = extractMedia(html, target);
  const { dubs } = extractDubs(html, target);
  let chosen = (lang && dubs.find(x => x.language === lang)) || dubs.find(x => x.current) || null;
  let m = media, subs = media.subtitles.slice();
  if (chosen && !chosen.current) {
    try { const mm = extractMedia(await getPage(chosen.page), chosen.page); if (mm.qualities.length) m = mm; subs = subs.concat(mm.subtitles); }
    catch (e) { chosen = dubs.find(x => x.current) || null; }
  }
  const exps = m.qualities.map(q => expOf(q.url)).filter(Boolean);
  const info = {
    qualities: m.qualities, subtitles: subs, audio: chosen ? chosen.language : null,
    audios: dubs.map(d => ({ language: d.language, label: d.label, dubbed: d.dubbed, current: d.current })),
    parts: extractCollection(html, target), expires: exps.length ? Math.min(...exps) : 0, fetched_at: Math.floor(Date.now() / 1000),
  };
  const life = info.expires ? Math.min(240, Math.floor(info.expires - Date.now() / 1000 - 90)) : 240;
  if (life > 0) ctx.waitUntil(caches.default.put(key, new Response(JSON.stringify(info), { headers: { "Cache-Control": "max-age=" + life } })));
  return info;
}

function pickFrom(info, q) {
  const list = info.qualities; if (!list || !list.length) return null;
  const want = parseInt(q) || 0; let pick = list[0];
  if (want) pick = list.find(x => x.height === want) || list.find(x => x.height < want) || list[list.length - 1];
  return { url: pick.url, quality: pick.label, height: pick.height, audio: info.audio, expires: expOf(pick.url) };
}

function pickStream(data, lang, q) {
  const a = data.audio.find(x => lang && x.language === lang && x.qualities.length) || data.audio.find(x => x.current && x.qualities.length) || data.audio.find(x => x.qualities.length);
  const list = a ? a.qualities : data.qualities; if (!list || !list.length) return null;
  const want = parseInt(q) || 0;
  let pick = list[0];
  if (want) pick = list.find(x => x.height === want) || list.find(x => x.height < want) || list[list.length - 1];
  return { url: pick.url, quality: pick.label, height: pick.height, audio: a ? a.language : null, expires: expOf(pick.url) };
}

function absolutize(text, base, token, viaSeg) {
  const fix = u => {
    let abs; try { abs = new URL(u, base); } catch (e) { return u; }
    let out = abs.toString();
    if (token && !/hdnts=/.test(abs.search)) out = abs.origin + abs.pathname + (abs.search ? abs.search + "&" : "?") + "hdnts=" + token + abs.hash;   // token cru, igual ao do site
    return viaSeg ? viaSeg + encodeURIComponent(out) : out;
  };
  return text.split("\n").map(line => {
    const t = line.trim(); if (!t) return line;
    if (t.startsWith("#")) return line.replace(/URI="([^"]+)"/g, (m, u) => 'URI="' + fix(u) + '"');
    return fix(t);
  }).join("\n");
}


/* ================= UQLOAD ================= */
// link do vídeo vem dentro da página (jwplayer.setup empacotado). O token vale ~4h (s=início, e=duração) e é renovado sozinho.
const UQ_HOST_RE = /(^|\.)uqload\.[a-z]{2,}$/i;
const UQ_DOMAINS = ["uqload.vc"];                                  // se o site mudar de domínio, adicione os espelhos aqui
const UQ_API = "https://kiraflix-api.site.je/uqload.php";           // PHP de reserva (se o Worker não conseguir ler a página)
const UQ_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const isUq = u => { try { return UQ_HOST_RE.test(new URL(u).hostname); } catch (e) { return false; } };
function uqCode(u) {
  let p = ""; try { p = new URL(u).pathname; } catch (e) { p = "/" + u; }
  const m = p.match(/(?:^|[\/-])([a-z0-9]{12})(?=_[a-z]\b|\.html|\/|$)/i);
  return m ? m[1] : "";
}
function uqHost(u) { try { const h = new URL(u).hostname.toLowerCase(); if (UQ_HOST_RE.test(h)) return h.replace(/^(www\.|strm\d+\.)/, ""); } catch (e) {} return UQ_DOMAINS[0]; }

// Dean Edwards p,a,c,k,e,d  (eval(function(p,a,c,k,e,d){...}('...',36,395,'...'.split('|'))))
function readQ(s, i) {
  let o = "";
  for (let j = i + 1; j < s.length; j++) {
    const ch = s[j];
    if (ch === "\\") { const n = s[j + 1] || ""; o += n === "n" ? "\n" : n === "t" ? "\t" : n === "r" ? "\r" : n; j++; continue; }
    if (ch === "'") return [o, j + 1];
    o += ch;
  }
  return [null, s.length];
}
function unpackJs(src) {
  let out = "", pos = 0;
  for (;;) {
    const i = src.indexOf("eval(function(p,a,c,k,e,d)", pos); if (i < 0) break;
    pos = i + 10;
    const j = src.indexOf("}('", i); if (j < 0) break;
    const [p, n] = readQ(src, j + 2); if (p === null) break;
    const m = /^,(\d+),(\d+),/.exec(src.slice(n, n + 40)); if (!m) continue;
    const a = +m[1], c = +m[2], n2 = n + m[0].length;
    if (src[n2] !== "'") continue;
    const [k, n3] = readQ(src, n2); if (k === null) continue;
    const keys = k.split("|"), dict = new Map();
    const enc = x => (x < a ? "" : enc(Math.floor(x / a))) + ((x = x % a) > 35 ? String.fromCharCode(x + 29) : x.toString(36));
    for (let x = 0; x < c; x++) { const e = enc(x); dict.set(e, keys[x] ? keys[x] : e); }
    out += p.replace(/\b\w+\b/g, w => (dict.has(w) ? dict.get(w) : w)) + "\n";
    pos = n3;
  }
  return out;
}

function uqExtract(html, pageUrl) {
  const all = (unpackJs(html) + "\n" + html).replace(/\\\//g, "/").replace(/&amp;/g, "&");
  let m = all.match(/file\s*:\s*["'](https?:\/\/[^"']+?\.m3u8[^"']*)["']/i) || all.match(/(https?:\/\/[^\s"'<>\\]+\.m3u8[^\s"'<>\\]*)/i);
  const master = m ? m[1] : null;
  m = all.match(/file\s*:\s*["'](https?:\/\/[^"']+?\.mp4[^"']*)["']/i);
  const mp4 = m ? m[1] : null;
  if (!master && !mp4) return null;
  const src = master || mp4;
  let exp = 0;
  try {
    const q = new URL(src).searchParams, e = parseInt(q.get("e") || "", 10), s0 = parseInt(q.get("s") || "", 10);
    if (e > 1e9) exp = e; else if (e > 0 && s0 > 0) exp = s0 + e;
  } catch (e) {}
  let quality = "Auto", height = 0;
  m = all.match(/qualityLabels['"]?\s*:\s*\{([^}]*)\}/);
  if (m) { const l = m[1].match(/"\d+"\s*:\s*"([^"]+)"/); if (l) { quality = l[1]; const hh = l[1].match(/(\d{3,4})\s*p/i); if (hh) height = +hh[1]; } }
  let title = "";
  m = html.match(/<h1[^>]*download-title[^>]*>([\s\S]*?)<\/h1>/i); if (m) title = clean(m[1]);
  if (!title) { m = html.match(/<title>\s*(?:Watch\s+)?([\s\S]*?)\s*<\/title>/i); if (m) title = clean(m[1]); }
  m = all.match(/image\s*:\s*"([^"]+)"/); const poster = m ? m[1] : "";
  m = all.match(/duration\s*:\s*"?([\d.]+)/); const duration = m ? +m[1] : 0;
  const root = new URL(pageUrl).origin;
  const subtitles = [];
  const sre = /\{\s*file\s*:\s*"([^"]+)"\s*,\s*(?:label\s*:\s*"([^"]*)"\s*,\s*)?kind\s*:\s*"(?:captions|subtitles)"/gi;
  while ((m = sre.exec(all))) {
    if (/empty\.srt/i.test(m[1])) continue;
    const lang = normLang(m[2] || "und");
    subtitles.push({ language: lang, label: m[2] || NAMES[lang] || lang, url: new URL(m[1], root + "/").toString() });
  }
  const dl = { page: "", resolution: "", size: "" };
  m = html.match(/href="(https?:\/\/[^"]+\/d\/[a-z0-9]{10,14}_[a-z])"/i); if (m) dl.page = m[1];
  m = html.match(/(\d{3,4}x\d{3,4}),\s*([\d.]+\s*[KMGT]?B)/i); if (m) { dl.resolution = m[1]; dl.size = m[2]; if (!height) { const hh = m[1].match(/x(\d{3,4})/); if (hh) height = +hh[1]; } }
  return { master, mp4, quality, height, title, poster, duration, subtitles, download: dl, expires: exp };
}

async function uqGet(url, opt = {}) {
  const h = { "User-Agent": UQ_UA, "Accept": opt.accept || "text/html,application/xhtml+xml,*/*;q=0.8", "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8" };
  if (opt.referer) { h.Referer = opt.referer; h.Origin = new URL(opt.referer).origin; }
  const init = { headers: h, redirect: "follow" };
  if (opt.post) { init.method = "POST"; init.body = new URLSearchParams(opt.post).toString(); h["Content-Type"] = "application/x-www-form-urlencoded"; }
  const r = await fetch(url, init);
  return { status: r.status, url: r.url || url, text: await r.text() };
}

async function uqScrape(code, hostHint) {
  const hosts = [...new Set([hostHint, ...UQ_DOMAINS].filter(Boolean))], errs = [];
  for (const h of hosts) {
    const base = "https://" + h;
    const tries = [
      { u: base + "/" + code + ".html", ref: base + "/" },
      { u: base + "/dl", post: { op: "embed", file_code: code, auto: "1", referer: "" }, ref: base + "/e/" + code },   // "segundo/terceiro link"
      { u: base + "/embed-" + code + ".html", ref: base + "/" },
    ];
    for (const t of tries) {
      try {
        const r = await uqGet(t.u, { referer: t.ref, post: t.post });
        if (r.status >= 400 || !r.text) { errs.push(h + " " + r.status); continue; }
        const info = uqExtract(r.text, r.url);
        if (info) return { ...info, page: base + "/" + code + ".html", host: h };
        if (/File Not Found|was deleted|has been removed|No such file/i.test(r.text)) { errs.push(h + ": arquivo removido"); break; }
      } catch (e) { errs.push(h + " " + e.message); }
    }
  }
  throw new Error("não achei o link do vídeo (" + errs.slice(0, 4).join("; ") + ")");
}

// reserva: se o Worker não conseguir ler a página, pergunta ao uqload.php
async function uqViaPhp(target) {
  const t = new URL(UQ_API); t.searchParams.set("mode", "json"); t.searchParams.set("nocache", "1"); t.searchParams.set("url", target);
  const r = await callApi(t.toString()); const j = JSON.parse(r.text);
  if (!j.success || !j.data) throw new Error(j.error || "PHP sem resposta");
  const d = j.data;
  return { master: d.url, mp4: d.mp4 || null, quality: d.quality || "Auto", height: d.height || 0, title: d.title || "", poster: d.poster || "", duration: d.duration || 0,
           subtitles: d.subtitles || [], download: d.download || {}, expires: d.expires || 0, page: d.source_page || target, host: uqHost(target) };
}

async function uqInfo(target, ctx, nocache) {
  const code = uqCode(target); if (!code) throw new Error("não achei o código do vídeo no link");
  const key = new Request("https://kf-cache.local/uq?c=" + code);
  if (!nocache) {
    const hit = await caches.default.match(key);
    if (hit) { try { const d = await hit.json(); if (!(d.expires && d.expires - Date.now() / 1000 < 120)) return d; } catch (e) {} }
  }
  let raw;
  try { raw = await uqScrape(code, uqHost(target)); }
  catch (e) { try { raw = await uqViaPhp(target); } catch (e2) { throw new Error(e.message); } }
  const src = raw.master || raw.mp4;
  const info = {
    code, title: raw.title, poster: raw.poster, duration: raw.duration, page: raw.page, master: raw.master, mp4: raw.mp4, download: raw.download,
    qualities: [{ label: raw.quality, height: raw.height, url: src }],
    subtitles: raw.subtitles, audio: null, audios: [], parts: [], expires: raw.expires, fetched_at: Math.floor(Date.now() / 1000),
  };
  const life = info.expires ? Math.min(600, Math.floor(info.expires - Date.now() / 1000 - 120)) : 300;
  if (life > 0) ctx.waitUntil(caches.default.put(key, new Response(JSON.stringify(info), { headers: { "Cache-Control": "max-age=" + life } })));
  return info;
}

// playlist: resolve os links e passa o token da playlist para itens sem token (se o CDN precisar)
function absUq(text, base, viaSeg) {
  const b = new URL(base), inherit = b.search;
  const fix = u => {
    let a; try { a = new URL(u, b); } catch (e) { return u; }
    if (!a.search && /[?&]t=/.test(inherit)) a.search = inherit;
    const out = a.toString();
    return viaSeg ? viaSeg + encodeURIComponent(out) : out;
  };
  return text.split("\n").map(line => {
    const t = line.trim(); if (!t) return line;
    if (t.startsWith("#")) return line.replace(/URI="([^"]+)"/g, (m, u) => 'URI="' + fix(u) + '"');
    return fix(t);
  }).join("\n");
}
const uqReferer = () => "https://" + UQ_DOMAINS[0] + "/";
async function uqFetchPlaylist(u, referer) {
  return fetch(u, { headers: { "User-Agent": UQ_UA, Referer: referer, Origin: referer.replace(/\/$/, ""), Accept: "*/*" } });
}

// /?action=mp4&url=LINK_UQLOAD&mode=json|m3u8(padrão)|master|redirect&proxy=1&nocache=1
async function uqMp4(request, url, target, cors, json, fail, ctx) {
  const mode = url.searchParams.get("mode") || "m3u8", proxy = !!url.searchParams.get("proxy");
  let nocache = !!url.searchParams.get("nocache"), info;
  try { info = await uqInfo(target, ctx, nocache); } catch (e) { return fail("Não consegui ler o Uqload: " + e.message); }
  const self = new URL(request.url);
  const common = "&url=" + encodeURIComponent(target) + (proxy ? "&proxy=1" : "");
  const q = info.qualities[0];
  if (mode === "json") {
    return json({ success: true, data: { url: q.url, quality: q.label, height: q.height, title: info.title, poster: info.poster, duration: info.duration,
      qualities: info.qualities, audios: [], subtitles: info.subtitles, parts: [], download: info.download, mp4: info.mp4,
      expires: info.expires, expires_in: info.expires ? Math.max(0, info.expires - Math.floor(Date.now() / 1000)) : null, fetched_at: info.fetched_at,
      master: self.origin + "/?action=mp4&mode=master" + common + "&x=.m3u8" }, error: null }, 200, { "Cache-Control": "no-store" });
  }
  if (mode === "redirect") return new Response(null, { status: 302, headers: { ...cors, Location: q.url, "Cache-Control": "no-store" } });
  if (!info.master) return fail("Esse vídeo só tem MP4: use mode=redirect", 404);
  const ref = info.page || uqReferer();
  let r = await uqFetchPlaylist(info.master, ref), txt = r.ok ? await r.text() : "";
  if ((!r.ok || !txt.includes("#EXTM3U")) && !nocache) {            // token vencido -> pega outro e tenta de novo (renovação automática)
    try { info = await uqInfo(target, ctx, true); } catch (e) { return fail("Não consegui renovar o link: " + e.message); }
    r = await uqFetchPlaylist(info.master, ref); txt = r.ok ? await r.text() : "";
  }
  if (!r.ok || !txt.includes("#EXTM3U")) return fail("O servidor do vídeo respondeu HTTP " + r.status + " mesmo com token novo.", 502);
  const viaSeg = proxy ? self.origin + "/?action=seg&url=" : "";
  return new Response(absUq(txt, r.url || info.master, viaSeg), { status: 200, headers: { ...cors, "Content-Type": "application/vnd.apple.mpegurl", "Cache-Control": "no-store",
    "X-Quality": q.label, "X-Expires": String(info.expires || 0), "Access-Control-Expose-Headers": "X-Quality, X-Expires" } });
}


/* ================= STREAMTAPE ================= */
// A página monta o link com JavaScript:  '//streamtape.com/ge' + ('xcdt_video?id=..').substring(1).substring(2)
// O Worker lê a página, refaz essa conta e entrega o MP4 por aqui mesmo (com Range), porque o link é amarrado ao IP de quem pediu.
const ST_HOST_RE = /(^|\.)(streamtape|strtape|strtpe|stape|streamta|strcloud|tapeadsenjoyer|tapeblocker|tapewithadblock|shavetape|antiadtape|adblockstrtape|adblockstreamtape|streamadblocker|scloud)\.[a-z.]{2,}$/i;
const ST_DOMAINS = ["streamtape.com"];                                // espelhos extras: adicione aqui
const ST_API = "https://kiraflix-api.site.je/streamtape.php";        // PHP de reserva (varre a página e também faz proxy)
const isSt = u => { try { return ST_HOST_RE.test(new URL(u).hostname); } catch (e) { return false; } };
const stCode = u => { const m = String(u).match(/\/(?:v|e|d)\/([A-Za-z0-9_-]{8,})/); return m ? m[1] : ""; };
function stHost(u) { try { const h = new URL(u).hostname.toLowerCase(); if (ST_HOST_RE.test(h)) return h.replace(/^www\./, ""); } catch (e) {} return ST_DOMAINS[0]; }

function stEval(expr) {
  const re = /'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|\.(?:substring|slice)\((\d+)\)/g, parts = []; let m;
  while ((m = re.exec(expr))) {
    if (m[3] !== undefined) { if (parts.length) parts[parts.length - 1] = parts[parts.length - 1].substring(+m[3]); }
    else parts.push(m[1] !== undefined ? m[1] : m[2]);
  }
  return parts.join("").replace(/\\\//g, "/");
}
function stMeta(html, prop) {
  const m = html.match(new RegExp("<meta[^>]+(?:property|name)=[\"']" + prop + "[\"'][^>]*content=[\"']([^\"']*)[\"']", "i"));
  return m ? decodeEnt(m[1]) : "";
}
function stScan(html, base) {
  const t = html.replace(/\\\//g, "/").replace(/&amp;/g, "&"), found = new Map(), ext = "mp4|m3u8|mpd|webm|mkv|m4v|mov|flv|vtt|srt|ass";
  const abs = u => { try { return new URL(u, base).toString(); } catch (e) { return null; } };
  let m;
  const r1 = new RegExp("(?:https?:)?\\/\\/[^\\s\"'<>\\\\)]+?\\.(" + ext + ")(?:\\?[^\\s\"'<>\\\\)]*)?", "gi");
  while ((m = r1.exec(t))) { const u = abs(m[0]); if (u) found.set(u, m[1].toLowerCase()); }
  const r2 = new RegExp("[\"'](\\/[^\"'\\s<>]+?\\.(" + ext + ")(?:\\?[^\"'\\s<>]*)?)[\"']", "gi");
  while ((m = r2.exec(t))) { const u = abs(m[1]); if (u) found.set(u, m[2].toLowerCase()); }
  const r3 = /(?:https?:)?\/\/[^\s"'<>\\)]+\/get_video\?[^\s"'<>\\)]+/gi;
  while ((m = r3.exec(t))) { const u = abs(m[0]); if (u) found.set(u, "get_video"); }
  return [...found].filter(([u]) => !/\/(js|scss|css|assets|images)\//i.test(u))
    .map(([url, type]) => ({ url, type, kind: /m3u8|mpd/.test(type) ? "stream" : /vtt|srt|ass/.test(type) ? "subtitle" : "video" }));
}
function stExtract(html, pageUrl) {
  const c = {}, re = /getElementById\(\s*['"]([a-z0-9_]*link[a-z0-9_]*)['"]\s*\)\.innerHTML\s*=\s*([^;]+);/gi; let m;
  while ((m = re.exec(html))) { const v = stEval(m[2]); if (v.includes("get_video?")) c[m[1].toLowerCase()] = v; }
  let link = "";
  for (const k of ["robotlink", "captchalink", "norobotlink", "botlink"]) if (c[k]) { link = c[k]; break; }
  if (!link) link = Object.values(c)[0] || "";
  if (!link) return null;
  link = new URL(link.startsWith("//") ? "https:" + link : link, pageUrl).toString();
  if (!/[?&]stream=1/.test(link)) link += "&stream=1";
  let exp = 0; try { exp = parseInt(new URL(link).searchParams.get("expires") || "0", 10) || 0; } catch (e) {}
  let title = stMeta(html, "og:title").replace(/\s+at Streamtape\.com$/i, "").trim();
  if (!title) { m = html.match(/<title>\s*([^<]*)/i); if (m) title = clean(m[1]).replace(/\s+at Streamtape\.com$/i, ""); }
  m = html.match(/class="subheading"[^>]*>\s*([^<]+)</i);
  return { url: link, title, poster: stMeta(html, "og:image"), size: m ? m[1].trim() : "", expires: exp, sources: stScan(html, pageUrl) };
}
async function stGet(url, referer) {
  const r = await fetch(url, { headers: { "User-Agent": UQ_UA, "Accept": "text/html,application/xhtml+xml,*/*;q=0.8", "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8", Referer: referer }, redirect: "follow" });
  return { status: r.status, url: r.url || url, text: await r.text() };
}
async function stScrape(code, hostHint) {
  const hosts = [...new Set([hostHint, ...ST_DOMAINS].filter(Boolean))], errs = [];
  for (const h of hosts) {
    for (const p of ["/e/" + code, "/v/" + code]) {
      try {
        const r = await stGet("https://" + h + p, "https://" + h + "/");
        if (r.status >= 400 || !r.text) { errs.push(h + " " + r.status); continue; }
        const info = stExtract(r.text, r.url);
        if (info) return { ...info, id: code, host: h, page: "https://" + h + "/v/" + code, embed: "https://" + h + "/e/" + code };
        if (/Video not found|Maybe it got deleted|has been removed/i.test(r.text)) { errs.push(h + ": vídeo removido"); break; }
        errs.push(h + ": link não encontrado");
      } catch (e) { errs.push(h + " " + e.message); }
    }
  }
  throw new Error("não achei o link do vídeo (" + errs.slice(0, 4).join("; ") + ")");
}
async function stViaPhp(target) {
  const t = new URL(ST_API); t.searchParams.set("mode", "json"); t.searchParams.set("nocache", "1"); t.searchParams.set("url", target);
  const r = await callApi(t.toString()); const j = JSON.parse(r.text);
  if (!j.success || !j.data) throw new Error(j.error || "PHP sem resposta");
  return j.data;
}
async function stInfo(target, ctx, nocache) {
  const code = stCode(target); if (!code) throw new Error("não achei o código do vídeo no link");
  const key = new Request("https://kf-cache.local/st?c=" + code);
  if (!nocache) {
    const hit = await caches.default.match(key);
    if (hit) { try { const d = await hit.json(); if (!(d.expires && d.expires - Date.now() / 1000 < 120)) return d; } catch (e) {} }
  }
  const info = await stScrape(code, stHost(target));
  info.fetched_at = Math.floor(Date.now() / 1000);
  const life = info.expires ? Math.min(300, Math.floor(info.expires - Date.now() / 1000 - 120)) : 300;
  if (life > 0) ctx.waitUntil(caches.default.put(key, new Response(JSON.stringify(info), { headers: { "Cache-Control": "max-age=" + life } })));
  return info;
}
const stFetchVideo = (info, range) => {
  const h = { "User-Agent": UQ_UA, Referer: info.embed, Accept: "*/*" }; if (range) h.Range = range;
  return fetch(info.url, { headers: h, redirect: "follow" });
};
const stOk = r => (r.ok || r.status === 206) && !/text\/html/i.test(r.headers.get("Content-Type") || "");
function stReply(r, cors) {
  const ct = r.headers.get("Content-Type") || "";
  const hd = { ...cors, "Content-Type": ct && !/octet-stream/i.test(ct) ? ct : "video/mp4", "Accept-Ranges": "bytes", "Cache-Control": "no-store",
    "Access-Control-Expose-Headers": "Content-Range, Content-Length, Accept-Ranges" };
  for (const k of ["Content-Range", "Content-Length"]) { const v = r.headers.get(k); if (v) hd[k] = v; }
  return new Response(r.body, { status: r.status === 206 ? 206 : 200, headers: hd });
}

// /?action=mp4&url=LINK_STREAMTAPE&proxy=1&x=.m3u8   -> toca direto (MP4 com Range). Outros modos: mode=json | redirect | nocache=1
async function stMp4(request, url, target, cors, json, fail, ctx) {
  const mode = url.searchParams.get("mode") || "stream", nocache = !!url.searchParams.get("nocache");
  let info = null, err = "";
  try { info = await stInfo(target, ctx, nocache); } catch (e) { err = e.message; }
  if (mode === "json") {
    if (!info) { try { info = await stViaPhp(target); } catch (e2) { return fail("Não consegui ler o Streamtape: " + err); } }
    const self = new URL(request.url);
    const play = self.origin + "/?action=mp4&proxy=1&x=.m3u8&url=" + encodeURIComponent(target);
    return json({ success: true, data: { url: play, quality: "Auto", height: 0, title: info.title, poster: info.poster, size: info.size, duration: 0,
      qualities: [{ label: "Auto", height: 0, url: play }], audios: [], subtitles: (info.sources || []).filter(s => s.kind === "subtitle").map(s => ({ language: "und", label: s.type, url: s.url })),
      parts: [], sources: info.sources || [], direct: info.url, page: info.page, embed: info.embed, expires: info.expires,
      expires_in: info.expires ? Math.max(0, info.expires - Math.floor(Date.now() / 1000)) : null, fetched_at: info.fetched_at }, error: null }, 200, { "Cache-Control": "no-store" });
  }
  if (mode === "redirect" && info) {
    const r = await fetch(info.url, { headers: { "User-Agent": UQ_UA, Referer: info.embed, Range: "bytes=0-0" }, redirect: "manual" });
    const loc = r.headers.get("Location");
    return new Response(null, { status: 302, headers: { ...cors, Location: loc ? new URL(loc, info.url).toString() : info.url, "Cache-Control": "no-store" } });
  }
  const rg = request.headers.get("Range");
  if (info) {
    try {
      let r = await stFetchVideo(info, rg);
      if (!stOk(r) && !nocache) { info = await stInfo(target, ctx, true); r = await stFetchVideo(info, rg); }   // link vencido -> pega outro
      if (stOk(r)) return stReply(r, cors);
    } catch (e) { err = err || e.message; }
  }
  try {                                                                                                          // reserva: o PHP busca e repassa
    const t = new URL(ST_API); t.searchParams.set("mode", "stream"); t.searchParams.set("url", target);
    const h = { "User-Agent": UA }; if (rg) h.Range = rg;
    const r = await fetch(t.toString(), { headers: h });
    if (stOk(r)) return stReply(r, cors);
  } catch (e) {}
  return fail("Não consegui abrir o Streamtape" + (err ? ": " + err : " (o servidor do vídeo recusou)"), 502);
}

/* ---------- AES (verificação anti-robô do seu PHP) ---------- */
const hex2 = h => new Uint8Array(h.match(/../g).map(x => parseInt(x, 16)));
const toHex = u => [...u].map(x => x.toString(16).padStart(2, "0")).join("");
async function solveCookie(html) {
  const m = [...html.matchAll(/toNumbers\("([0-9a-fA-F]+)"\)/g)].map(x => x[1]);
  if (m.length < 3) throw new Error("Formato da verificação não reconhecido");
  const key = hex2(m[0]), iv = hex2(m[1]), c = hex2(m[2]);
  const k = await crypto.subtle.importKey("raw", key, { name: "AES-CBC" }, false, ["encrypt", "decrypt"]);
  const pad = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-CBC", iv: c }, k, new Uint8Array(0))).slice(0, 16);
  const both = new Uint8Array(32); both.set(c, 0); both.set(pad, 16);
  const dec = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-CBC", iv: new Uint8Array(16) }, k, both));
  return toHex(dec.map((v, i) => v ^ iv[i]));
}
async function callApi(target, cookie) {
  const headers = { Accept: "application/json", "User-Agent": UA };
  if (cookie) headers.Cookie = "__test=" + cookie;
  const r = await fetch(target, { headers, redirect: "follow" });
  return { status: r.status, text: await r.text() };
}

/* ================= AO VIVO (canais) ================= */
const CHANNELS_URL = "https://kiraflix.qd.je/Canais.json";   // sua lista de canais

function privateHost(h) {
  h = String(h || "").toLowerCase().replace(/^\[|\]$/g, "");
  if (!h || h === "localhost" || h.endsWith(".local") || h.endsWith(".internal") || h === "::1" || h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80")) return true;
  const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (m) { const a = +m[1], b = +m[2]; return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224; }
  return false;
}
const liveOk = u => { try { const x = new URL(u); return /^https?:$/.test(x.protocol) && !privateHost(x.hostname); } catch (e) { return false; } };
const slug = t => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "canal";

/** aceita os formatos comuns de Canais.json (lista, {channels}, {canais}, {categorias:[...]}, objeto) */
function normChannels(data) {
  let list = [];
  if (Array.isArray(data)) list = data;
  else if (data && Array.isArray(data.channels)) list = data.channels;
  else if (data && Array.isArray(data.canais)) list = data.canais;
  else if (data && Array.isArray(data.categorias)) data.categorias.forEach(cat => (cat.canales || cat.channels || cat.canais || []).forEach(c => list.push({ ...c, category: cat.nombre || cat.name || cat.nome || "Geral" })));
  else if (data && typeof data === "object") Object.keys(data).forEach(k => { const it = data[k]; if (it && (it.url || it.source)) list.push({ name: it.name || it.nome || it.title || k, ...it }); });
  const used = {};
  return list.map((c, i) => {
    const name = c.name || c.nome || c.nombre || c.title || ("Canal " + (i + 1));
    let id = slug(name); used[id] = (used[id] || 0) + 1; if (used[id] > 1) id += "-" + used[id];
    return { id, name, url: c.url || c.source || c.link || "", logo: c.logo || c.logoURL || "", category: c.category || c.grupo || c.group || "Geral" };
  }).filter(c => c.url);
}

async function loadChannels(ctx, nocache) {
  const key = new Request("https://kf-cache.local/channels");
  if (!nocache) { const hit = await caches.default.match(key); if (hit) { try { return await hit.json(); } catch (e) {} } }
  const r = await fetch(CHANNELS_URL + (CHANNELS_URL.includes("?") ? "&" : "?") + "t=" + Date.now(), { headers: { "User-Agent": UA }, cf: { cacheTtl: 0 } });
  if (!r.ok) throw new Error("Canais.json respondeu HTTP " + r.status);
  const list = normChannels(await r.json());
  ctx.waitUntil(caches.default.put(key, new Response(JSON.stringify(list), { headers: { "Cache-Control": "max-age=300" } })));
  return list;
}

/** reescreve a playlist: tudo (sub-playlists, segmentos, chaves) volta pelo Worker => sem CORS e sem http misto */
function liveRewrite(text, base, selfLive) {
  const fix = u => { try { return selfLive + encodeURIComponent(new URL(u, base).toString()); } catch (e) { return u; } };
  return text.split(/\r?\n/).map(line => {
    const t = line.trim(); if (!t) return line;
    if (t.startsWith("#")) return line.replace(/URI="([^"]+)"/g, (m, u) => 'URI="' + fix(u) + '"');
    return fix(t);
  }).join("\n");
}

async function liveProxy(request, url, cors, fail, ctx) {
  const o = request.headers.get("Origin");
  if (o && !ALLOWED.includes(o)) return fail("Origem não autorizada.", 403);
  let u = url.searchParams.get("url") || "";
  const cid = url.searchParams.get("c") || url.searchParams.get("id");
  if (!u && cid) {
    try { const ch = (await loadChannels(ctx, false)).find(x => x.id === cid || x.name === cid); if (ch) u = ch.url; } catch (e) { return fail("Não consegui ler a lista de canais: " + e.message); }
  }
  u = String(u).trim();
  if (!u) return fail("Informe url= (link do canal) ou c= (id do canal).", 400);
  if (!liveOk(u)) return fail("Endereço não permitido.", 403);
  const h = { "User-Agent": UA, "Accept": "*/*" };
  const rg = request.headers.get("Range"); if (rg) h.Range = rg;
  let r;
  try { r = await fetch(u, { headers: h, redirect: "follow", signal: AbortSignal.timeout(20000) }); }
  catch (e) { return fail("Não consegui abrir o canal: " + e.message, 502); }
  if (!r.ok && r.status !== 206) return fail("O canal respondeu HTTP " + r.status, r.status >= 500 ? 502 : r.status);
  const ct = r.headers.get("Content-Type") || "";
  const final = r.url || u;
  const looksList = /mpegurl/i.test(ct) || /\.m3u8?(\?|$)/i.test(new URL(final).pathname + new URL(final).search) || /(playlist|chunklist|manifest|index)\b/i.test(new URL(final).pathname);
  if (looksList && r.status === 200) {
    const txt = await r.text();
    if (/^\s*#EXTM3U/.test(txt)) {
      const self = new URL(request.url);
      return new Response(liveRewrite(txt, final, self.origin + "/?action=live&url="), { status: 200, headers: { ...cors, "Content-Type": "application/vnd.apple.mpegurl", "Cache-Control": "no-store" } });
    }
    return new Response(txt, { status: 200, headers: { ...cors, "Content-Type": ct || "text/plain", "Cache-Control": "no-store" } });
  }
  const hd = { ...cors, "Content-Type": ct || (/\.aac|\.mp3/i.test(final) ? "audio/aac" : "video/MP2T"), "Cache-Control": "public, max-age=8", "Access-Control-Expose-Headers": "Content-Length, Content-Range" };
  ["Content-Range", "Accept-Ranges"].forEach(k => { const v = r.headers.get(k); if (v) hd[k] = v; });
  if (!r.headers.get("Content-Encoding")) { const cl = r.headers.get("Content-Length"); if (cl) hd["Content-Length"] = cl; }
  return new Response(r.body, { status: r.status, headers: hd });
}


/* ================= YOUTUBE (repassa ao youtube.php: link direto, HLS video+audio, legendas, renova token) ================= */
const YT_API = "https://kiraflix-api.site.je/youtube.php";
const YT_HOST_RE = /^(?:https?:\/\/)?(?:[\w-]+\.)?(?:youtube\.com|youtube-nocookie\.com|youtu\.be)(?:[\/:?#]|$)/i;
const YT_ID_RE = /^[A-Za-z0-9_-]{11}$/;
function isYtRaw(raw) {
  let v = String(raw || "").trim();
  for (let i = 0; i < 3; i++) { if (/%3A%2F%2F/i.test(v)) { try { v = decodeURIComponent(v); } catch (e) { break; } } }
  return YT_HOST_RE.test(v) || YT_ID_RE.test(v);
}
let ytCookie = "";
async function ytFetch(target, headers) {
  const go = (c) => { const u = new URL(target); if (c) u.searchParams.set("i", "1"); return fetch(u.toString(), { headers: c ? { ...headers, Cookie: "__test=" + c } : headers, redirect: "manual" }); };
  let r = await go(ytCookie);
  const ct = r.headers.get("Content-Type") || "";
  if (/text\/html/i.test(ct)) {                       // verificacao anti-robo da hospedagem
    const t = await r.clone().text();
    if (/aes\.js/.test(t) && /toNumbers/.test(t)) { ytCookie = await solveCookie(t); r = await go(ytCookie); }
  }
  return r;
}
async function ytProxy(request, url, cors, fail) {
  const t = new URL(YT_API);
  url.searchParams.forEach((v, k) => t.searchParams.set(k, v));
  t.searchParams.set("base", new URL(request.url).origin);   // o PHP monta os links (m3u8/segmentos/legendas) apontando pra este worker
  const h = { "User-Agent": UA, Accept: "*/*" };
  const rg = request.headers.get("Range"); if (rg) h.Range = rg;
  try {
    const r = await ytFetch(t.toString(), h);
    const hd = { ...cors, "Cache-Control": "no-store", "Access-Control-Expose-Headers": "Content-Range, Content-Length, Accept-Ranges, X-Expires, X-Quality" };
    for (const k of ["Content-Type", "Content-Range", "Accept-Ranges", "Location", "X-Expires", "X-Quality"]) { const v = r.headers.get(k); if (v) hd[k] = v; }
    if (!r.headers.get("Content-Encoding")) { const cl = r.headers.get("Content-Length"); if (cl) hd["Content-Length"] = cl; }
    return new Response(r.body, { status: r.status, headers: hd });
  } catch (e) { return fail("Worker não conseguiu falar com o youtube.php: " + e.message); }
}

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get("Origin") || "";
    const cors = {
      "Access-Control-Allow-Origin": ALLOWED.includes(origin) ? origin : ALLOWED[0],
      "Vary": "Origin", "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Accept", "Access-Control-Max-Age": "86400",
    };
    const json = (obj, status = 200, extra = {}) => new Response(typeof obj === "string" ? obj : JSON.stringify(obj), { status, headers: { ...cors, "Content-Type": "application/json; charset=utf-8", ...extra } });
    const fail = (msg, status = 502) => json({ success: false, data: null, error: msg }, status);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "GET") return fail("Método não permitido.", 405);

    const url = new URL(request.url);
    const action = url.searchParams.get("action") || "";

    // ---- YOUTUBE: tudo que for link do YouTube (e os segmentos/legendas dele) vai pro youtube.php ----
    const ytRaw = url.searchParams.get("url") || url.searchParams.get("link") || "";
    if (action === "ytseg" || action === "ytsub" || action === "diag" || ((action === "mp4" || action === "tracks" || !action) && ytRaw && isYtRaw(ytRaw))) return ytProxy(request, url, cors, fail);

    if (action === "config") return json({ success: true, data: { name: "KiraFlix Worker", version: "4.3", sites: ["uqload", "streamtape", "youtube", "(filmes/series)"], actions: ["tracks", "mp4", "play", "seg", "sub", "channels", "live", "ytseg", "ytsub", "diag", "config", "(demais: repassa ao PHP)"] }, error: null });

    if (action === "tracks") {
      const target = cleanTarget(url.searchParams.get("url") || url.searchParams.get("link") || "");
      if (!target) return fail("Informe o link da página em url=", 400);
      if (!hostOk(target)) return fail("Domínio não autorizado: " + new URL(target).hostname, 403);
      if (isSt(target)) {
        try { const i = await stInfo(target, ctx, !!url.searchParams.get("nocache"));
          return json({ success: true, data: { title: i.title, poster: i.poster, duration: 0, qualities: [{ label: "Auto", height: 0, url: new URL(request.url).origin + "/?action=mp4&proxy=1&x=.m3u8&url=" + encodeURIComponent(target) }], subtitles: (i.sources || []).filter(x => x.kind === "subtitle").map(x => ({ language: "und", label: x.type, url: x.url })), audio: [], parts: [], sources: i.sources, source_url: target, complete: true, worker: 3, expires: i.expires, fetched_at: i.fetched_at }, error: null }); }
        catch (e) { return fail("Não consegui ler o Streamtape: " + e.message); }
      }
      if (isUq(target)) {
        try { const i = await uqInfo(target, ctx, !!url.searchParams.get("nocache"));
          return json({ success: true, data: { title: i.title, poster: i.poster, duration: i.duration, qualities: i.qualities, subtitles: i.subtitles, audio: [], parts: [], source_url: target, complete: true, worker: 3, expires: i.expires, fetched_at: i.fetched_at }, error: null }); }
        catch (e) { return fail("Não consegui ler o Uqload: " + e.message); }
      }
      try {
        const data = await cachedTracks(target, ctx, !!url.searchParams.get("nocache"));
        return json({ success: true, data, error: null });
      } catch (e) {
        try { const t = new URL(API); t.searchParams.set("action", "tracks"); t.searchParams.set("url", target); const r = await callApi(t.toString()); JSON.parse(r.text); return json(r.text, r.status); }
        catch (e2) { return fail("Não consegui ler as faixas: " + e.message); }
      }
    }

    // /?action=play&url=PAGINA&q=720&audio=pt  -> pagina SEM texto: so o player nativo do Chrome
    if (action === "play") {
      const base = url.origin + "/";
      { const pt = cleanTarget(url.searchParams.get("url") || ""); if (isSt(pt)) {
        const src = base + "?action=mp4&proxy=1&x=.m3u8&url=" + encodeURIComponent(pt);
        return new Response('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>KiraFlix</title><style>html,body{margin:0;height:100%;background:#000;overflow:hidden}video{width:100%;height:100%;background:#000;outline:0}</style></head><body><video controls autoplay playsinline preload="auto" src="' + src.replace(/&/g, "&amp;") + '"></video></body></html>', { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
      } }
      const html = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>KiraFlix</title>'
        + '<script src="https://cdnjs.cloudflare.com/ajax/libs/hls.js/1.5.8/hls.min.js"></script>'
        + '<style>html,body{margin:0;height:100%;background:#000;overflow:hidden}video{width:100%;height:100%;background:#000;outline:0}</style></head><body>'
        + '<video id="v" controls autoplay playsinline preload="auto"></video><script>'
        + '(function(){var B=' + JSON.stringify(base) + ',Q=location.search,P=new URLSearchParams(Q),v=document.getElementById("v"),h=null,tm=null,tries=0,seen={},tk=0;'
        + 'function qs(extra){var p=new URLSearchParams();["url","q","audio"].forEach(function(k){if(P.get(k))p.set(k,P.get(k))});for(var k in extra)p.set(k,extra[k]);return B+"?"+p.toString()}'
        + 'function src(){return P.get("q")?qs({action:"mp4",proxy:"1",x:".m3u8"}):qs({action:"mp4",mode:"master",proxy:"1",x:".m3u8"})}'
        + 'function addTracks(list){(list||[]).forEach(function(s){if(seen[s.url])return;seen[s.url]=1;var t=document.createElement("track");t.kind="subtitles";t.label=s.label||s.language;t.srclang=(s.language||"und").split("-")[0];t.src=B+"?action=sub&vtt=1&url="+encodeURIComponent(s.url);'
        + 'if(!tk&&/^pt/i.test(s.language)){t.default=true;tk=1}v.appendChild(t)})}'
        + 'function arm(exp){clearTimeout(tm);if(!exp)return;tm=setTimeout(function(){reload()},Math.max(5000,exp*1000-Date.now()-75000))}'
        + 'function info(extra,cb){fetch(qs(Object.assign({action:"mp4",mode:"json"},extra))).then(function(r){return r.json()}).then(function(j){cb(j&&j.data)}).catch(function(){})}'
        + 'function load(start){var t=start||0;if(window.Hls&&Hls.isSupported()){if(h){h.destroy()}h=new Hls({startPosition:t>0?t:-1,maxBufferLength:40,backBufferLength:60,startFragPrefetch:true,abrEwmaDefaultEstimate:6e6,capLevelToPlayerSize:true,manifestLoadingMaxRetry:2,levelLoadingMaxRetry:2,fragLoadingMaxRetry:3});'
        + 'h.loadSource(src());h.attachMedia(v);h.on(Hls.Events.MANIFEST_PARSED,function(){var p=v.play();if(p&&p.catch)p.catch(function(){})});'
        + 'h.on(Hls.Events.ERROR,function(e,d){if(d&&d.fatal&&tries<4){tries++;reload()}})}else{v.src=src();if(t)v.currentTime=t}}'
        + 'function reload(){var t=v.currentTime||0,was=!v.paused;info({nocache:"1"},function(d){if(d)arm(d.expires);load(t);if(was)v.play().catch(function(){})})}'
        + 'v.addEventListener("playing",function(){tries=0});'
        + 'load(0);info({},function(d){if(!d)return;arm(d.expires);addTracks(d.subtitles);info({full:"1"},function(f){if(f)addTracks(f.subtitles)})});'
        + '})();</script></body></html>';
      return new Response(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
    }

    // /?action=mp4&url=PAGINA&q=720&audio=pt&mode=master|m3u8|redirect|json&proxy=1&full=1&nocache=1
    // json devolve TUDO junto: link com token, qualidades, idiomas, legendas e partes (full=1 junta as legendas de todos os idiomas)
    if (action === "mp4") {
      const target = cleanTarget(url.searchParams.get("url") || "");
      if (!target || !hostOk(target)) return fail("Link inválido ou domínio não autorizado.", 403);
      if (isSt(target)) return stMp4(request, url, target, cors, json, fail, ctx);
      if (isUq(target)) return uqMp4(request, url, target, cors, json, fail, ctx);
      const mode = url.searchParams.get("mode") || "m3u8";
      const lang = (url.searchParams.get("audio") || "").toLowerCase().split("-")[0];
      const nocache = !!url.searchParams.get("nocache");
      try {
        let info = await liteInfo(target, lang, ctx, nocache);
        const st = pickFrom(info, url.searchParams.get("q"));
        if (!st) return fail("Nenhuma fonte de vídeo encontrada nesta página.", 404);
        const self = new URL(request.url);
        const common = "&url=" + encodeURIComponent(target) + (lang ? "&audio=" + lang : "") + (url.searchParams.get("proxy") ? "&proxy=1" : "");
        if (mode === "json") {
          let subs = info.subtitles, audios = info.audios;
          if (url.searchParams.get("full")) {
            const f = await cachedTracks(target, ctx, nocache);
            subs = f.subtitles; audios = f.audio.map(a => ({ language: a.language, label: a.label, dubbed: a.dubbed, current: a.current, qualities: a.qualities }));
            info = { ...info, parts: f.parts };
          }
          return json({ success: true, data: { ...st, qualities: info.qualities, audios, subtitles: subs, parts: info.parts, fetched_at: info.fetched_at,
            master: self.origin + "/?action=mp4&mode=master" + common + "&x=.m3u8" }, error: null }, 200, { "Cache-Control": "no-store" });
        }
        if (mode === "redirect") return new Response(null, { status: 302, headers: { ...cors, Location: st.url, "Cache-Control": "no-store" } });
        if (mode === "master") {
          const lines = ["#EXTM3U", "#EXT-X-VERSION:3"];
          info.qualities.slice().sort((a, b) => a.height - b.height).forEach(q => {
            lines.push("#EXT-X-STREAM-INF:BANDWIDTH=" + BW(q.height) + ",RESOLUTION=" + Math.round(q.height * 16 / 9 / 2) * 2 + "x" + q.height + ',NAME="' + q.label + '"');
            lines.push(self.origin + "/?action=mp4&mode=m3u8&q=" + q.height + common + "&x=.m3u8");
          });
          return new Response(lines.join("\n") + "\n", { status: 200, headers: { ...cors, "Content-Type": "application/vnd.apple.mpegurl", "Cache-Control": "no-store" } });
        }
        const o2 = new URL(target).origin;
        const r = await fetch(st.url, { headers: { "User-Agent": UA, Referer: o2 + "/", Origin: o2 } });
        if (!r.ok) {
          if (!nocache) { return fail("token vencido, tente de novo", 502); }
          return fail("O servidor do vídeo respondeu HTTP " + r.status, 502);
        }
        const txt = await r.text();
        const tok = (st.url.match(/[?&]hdnts=([^&]+)/) || [])[1] || "";
        const viaSeg = url.searchParams.get("proxy") ? self.origin + "/?action=seg&url=" : "";
        return new Response(absolutize(txt, r.url || st.url, tok, viaSeg), { status: 200, headers: { ...cors, "Content-Type": "application/vnd.apple.mpegurl", "Cache-Control": "no-store", "X-Quality": st.quality, "X-Audio": st.audio || "", "Access-Control-Expose-Headers": "X-Quality, X-Audio" } });
      } catch (e) { return fail("Não consegui montar o vídeo: " + e.message); }
    }

    // playlists/segmentos via Worker (so se o CDN do site bloquear CORS: use &proxy=1)
    if (action === "seg") {
      const u = url.searchParams.get("url") || ""; let host = ""; try { host = new URL(u).hostname; } catch (e) {}
      const uq = UQ_HOST_RE.test(host);
      if (!u || !(SUB_HOST_RE.test(host) || uq)) return fail("Domínio não autorizado.", 403);
      const h = uq ? { "User-Agent": UQ_UA, Referer: uqReferer(), Origin: uqReferer().replace(/\/$/, ""), Accept: "*/*" } : { "User-Agent": UA, Referer: new URL(u).origin + "/" };
      const rg = request.headers.get("Range"); if (rg) h.Range = rg;
      const r = await fetch(u, { headers: h });
      const ct = r.headers.get("Content-Type") || "";
      if (uq && (/mpegurl/i.test(ct) || /\.m3u8(\?|$)/i.test(u))) {
        const self = new URL(request.url);
        return new Response(absUq(await r.text(), r.url || u, self.origin + "/?action=seg&url="), { status: r.status, headers: { ...cors, "Content-Type": "application/vnd.apple.mpegurl", "Cache-Control": "no-store" } });
      }
      if (/mpegurl/i.test(ct) || /\.m3u8(\?|$)/i.test(u)) {
        const tok = (u.match(/[?&]hdnts=([^&]+)/) || [])[1] || "";
        const self = new URL(request.url);
        return new Response(absolutize(await r.text(), r.url || u, tok, self.origin + "/?action=seg&url="), { status: r.status, headers: { ...cors, "Content-Type": "application/vnd.apple.mpegurl", "Cache-Control": "no-store" } });
      }
      const hd = { ...cors, "Content-Type": ct || "video/MP2T", "Cache-Control": "public, max-age=300" };
      ["Content-Range", "Accept-Ranges", "Content-Length"].forEach(k => { const v = r.headers.get(k); if (v) hd[k] = v; });
      return new Response(r.body, { status: r.status, headers: hd });
    }

    if (action === "sub") {
      { const u0 = url.searchParams.get("url") || ""; if (/[?&]action=ytsub(&|$)/.test(u0)) { try { return ytProxy(request, new URL(u0), cors, fail); } catch (e) {} } }
      const u = cleanTarget(url.searchParams.get("url") || "");
      let host = ""; try { host = new URL(u).hostname; } catch (e) {}
      if (!u || !(SUB_HOST_RE.test(host) || UQ_HOST_RE.test(host))) return fail("Legenda de domínio não autorizado.", 403);
      try {
        const r = await fetch(u, { headers: { "User-Agent": UA } });
        if (!r.ok) return fail("HTTP " + r.status, 502);
        const body = await r.text();
        if (url.searchParams.get("vtt")) return new Response(toVtt(body), { status: 200, headers: { ...cors, "Content-Type": "text/vtt; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
        return new Response(body, { status: 200, headers: { ...cors, "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
      } catch (e) { return fail(e.message); }
    }

    // ---- AO VIVO ----
    // /?action=channels[&category=filmes][&q=hbo][&nocache=1]  -> lista de canais (id, nome, categoria, play)
    if (action === "channels") {
      try {
        const all = await loadChannels(ctx, !!url.searchParams.get("nocache"));
        const cat = (url.searchParams.get("category") || "").toLowerCase(), q = (url.searchParams.get("q") || "").toLowerCase();
        const self = new URL(request.url);
        let list = all.filter(c => (!cat || c.category.toLowerCase() === cat) && (!q || c.name.toLowerCase().includes(q)));
        const cats = {}; all.forEach(c => { cats[c.category] = (cats[c.category] || 0) + 1; });
        list = list.map(c => ({ ...c, play: self.origin + "/?action=live&c=" + encodeURIComponent(c.id) + "&x=.m3u8" }));
        return json({ success: true, data: { total: list.length, categories: Object.entries(cats).map(([name, count]) => ({ name, count })), channels: list }, error: null }, 200, { "Cache-Control": "public, max-age=60" });
      } catch (e) { return fail("Não consegui ler Canais.json: " + e.message); }
    }
    // /?action=live&url=<link .m3u8>  ou  /?action=live&c=<id do canal>  -> proxy do canal (playlist + segmentos)
    if (action === "live") return liveProxy(request, url, cors, fail, ctx);
    // compatível com o player ao vivo antigo: /?url=<link do canal>  (qualquer endereço que não seja dos sites de filmes)
    if (!action) {
      const raw = url.searchParams.get("url") || "";
      { const t0 = cleanTarget(raw); if (t0 && isSt(t0)) return stMp4(request, url, t0, cors, json, fail, ctx); }
      if (/^https?:\/\//i.test(raw) && !hostOk(cleanTarget(raw)) && !/\/detail\//i.test(raw)) return liveProxy(request, url, cors, fail, ctx);
    }

    // ---- repasse ao PHP (como antes) ----
    const target = new URL(API);
    url.searchParams.forEach((v, k) => target.searchParams.set(k, v));
    try {
      let r = await callApi(target.toString());
      if (/aes\.js/.test(r.text) && /toNumbers/.test(r.text)) {
        const cookie = await solveCookie(r.text);
        target.searchParams.set("i", "1");
        r = await callApi(target.toString(), cookie);
      }
      try { JSON.parse(r.text); }
      catch (e) { return fail("O servidor da API não devolveu JSON (HTTP " + r.status + "). Trecho: " + r.text.replace(/\s+/g, " ").slice(0, 160)); }
      return json(r.text, r.status);
    } catch (e) { return fail("Worker não conseguiu falar com a API: " + e.message); }
  },
};
