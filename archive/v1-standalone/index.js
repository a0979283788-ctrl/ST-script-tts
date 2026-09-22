import { extension_settings, getContext } from "../../../extensions.js";
import { saveSettingsDebounced, eventSource, event_types, getRequestHeaders } from "../../../../script.js";

/* 剧本多角色语音 ST-Script-TTS v1.0.0  作者：哈基米 for 咲川
 * 一条「旁白 + 多角色台词」回复 → 拆成独立语音单元，
 * 旁白一个音色，角色 A/B… 各自音色，逐条独立语音条。
 * 引擎：火山引擎豆包语音（经酒馆 /proxy 中转）。 */

const extensionFolderPath = new URL(".", import.meta.url).pathname.replace(/\/$/, "");
const extensionName = decodeURIComponent(extensionFolderPath.split("/").pop() || "ST-script-tts");
const VOLC_V3_URL = "https://openspeech.bytedance.com/api/v3/tts/unidirectional";
const VOLC_TIMEOUT_MS = 90000;
const SF_EXT_NAME = "ST-sound-forest-TTS";

function scueLog(msg) {
  const t = new Date().toLocaleTimeString();
  try { console.log("[剧本TTS]", "[" + t + "]", msg); } catch (e) {}
}

const defaultSettings = {
  volcAppId: "", volcAccessKey: "",
  enabled: true,
  autoPlay: true,
  readHistory: false,
  stripActions: true,
  narrVoice: "zh_male_jieshuoxiaoming_moon_bigtts",
  narrCustom: "",
  roleDefaultVoice: "zh_female_linjianvhai_moon_bigtts",
  roleDefaultCustom: "",
  roleMap: [],
  customRegex: "",
};

function getS() {
  if (!extension_settings[extensionName]) extension_settings[extensionName] = {};
  const s = extension_settings[extensionName];
  Object.keys(defaultSettings).forEach((k) => { if (s[k] === undefined) s[k] = defaultSettings[k]; });
  return s;
}
function save() { try { saveSettingsDebounced(); } catch (e) {} }

/* 精选音色（面板可选；也可手填 ICL_ / S_ 自定义复刻ID） */
const VOLC_VOICES = [
  { value: "zh_male_jieshuoxiaoming_moon_bigtts", name: "解说小明", scene: "旁白解说" },
  { value: "zh_male_jieshuonansheng_mars_bigtts", name: "磁性解说男声", scene: "旁白解说" },
  { value: "zh_male_changtianyi_mars_bigtts", name: "悬疑解说", scene: "旁白解说" },
  { value: "zh_male_yuanboxiaoshu_moon_bigtts", name: "渊博小叔", scene: "旁白解说" },
  { value: "en_female_anna_mars_bigtts", name: "Anna女解说", scene: "旁白解说" },
  { value: "zh_male_M100_conversation_wvae_bigtts", name: "悠悠君子", scene: "旁白解说" },
  { value: "zh_female_linjianvhai_moon_bigtts", name: "邻家女孩", scene: "少女" },
  { value: "zh_female_tianmeixiaoyuan_moon_bigtts", name: "甜美小源", scene: "少女" },
  { value: "zh_female_qingxinnvsheng_mars_bigtts", name: "清新女声", scene: "少女" },
  { value: "zh_female_qinqienvsheng_moon_bigtts", name: "亲切女声", scene: "少女" },
  { value: "zh_female_qiaopinvsheng_mars_bigtts", name: "俏皮女声", scene: "少女" },
  { value: "zh_female_shuangkuaisisi_moon_bigtts", name: "爽快思思", scene: "少女" },
  { value: "zh_female_vv_uranus_bigtts", name: "Vivi2.0", scene: "少女" },
  { value: "zh_female_wenroushunv_mars_bigtts", name: "温柔淑女", scene: "熟女御姐" },
  { value: "zh_female_gaolengyujie_moon_bigtts", name: "高冷御姐", scene: "熟女御姐" },
  { value: "zh_female_gufengshaoyu_mars_bigtts", name: "古风少御", scene: "熟女御姐" },
  { value: "zh_female_zhixingnvsheng_mars_bigtts", name: "知性女声", scene: "熟女御姐" },
  { value: "zh_female_popo_mars_bigtts", name: "婆婆", scene: "熟女御姐" },
  { value: "zh_female_wuzetian_mars_bigtts", name: "武则天", scene: "熟女御姐" },
  { value: "zh_male_shaonianzixin_moon_bigtts", name: "少年梓辛", scene: "男青年" },
  { value: "zh_male_yangguangqingnian_moon_bigtts", name: "阳光青年", scene: "男青年" },
  { value: "zh_male_wennuanahu_moon_bigtts", name: "温暖阿虎", scene: "男青年" },
  { value: "zh_male_ruyaqingnian_mars_bigtts", name: "儒雅青年", scene: "男青年" },
  { value: "zh_male_baqiqingshu_mars_bigtts", name: "霸气青叔", scene: "男青年" },
  { value: "zh_male_qingcang_mars_bigtts", name: "擎苍", scene: "男青年" },
  { value: "zh_female_meilinvyou_moon_bigtts", name: "魅力女友", scene: "角色趣味" },
  { value: "zh_female_sajiaonvyou_moon_bigtts", name: "柔美女友", scene: "角色趣味" },
  { value: "zh_female_yuanqinvyou_moon_bigtts", name: "撒娇学妹", scene: "角色趣味" },
  { value: "zh_male_aojiaobazong_moon_bigtts", name: "傲娇霸总", scene: "角色趣味" },
  { value: "zh_female_daimengchuanmei_moon_bigtts", name: "呆萌川妹", scene: "角色趣味" },
  { value: "zh_male_beijingxiaoye_moon_bigtts", name: "北京小爷", scene: "角色趣味" },
  { value: "zh_male_tangseng_mars_bigtts", name: "唐僧", scene: "角色趣味" },
];

function uuid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}
function escapeHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&" + "quot;").replace(/'/g, "&#39;");
}
function inferResourceId(speaker) {
  const v = String(speaker || "").trim();
  const l = v.toLowerCase();
  if (l.startsWith("icl_") || l.startsWith("s_")) return "seed-icl-2.0";
  if (v.includes("_uranus_") || v.includes("_saturn_") || v.includes("_moon_")) return "seed-tts-2.0";
  return "seed-tts-1.0";
}
function normalizeWs(s) {
  return String(s || "").replace(/[ \t\u00A0]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}
/* ===== 一、清洗 ===== */
function decodeMesHtml(raw) {
  return String(raw || "")
    .replace(/\r\n?/g, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>|<\/div>|<\/li>/gi, "\n");
}
function compileUserRegex(text) {
  const out = [];
  String(text || "").split("\n").map((l) => l.trim()).filter(Boolean).forEach((line) => {
    const m = line.match(/^\/(.+)\/([a-z]*)$/i);
    try {
      if (m) out.push(new RegExp(m[1], m[2] || "g"));
      else out.push(new RegExp(line.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"));
    } catch (e) { scueLog("忽略无效正则：" + line); }
  });
  return out;
}
function cleanScript(raw, s) {
  let t = decodeMesHtml(raw);
  t = t.replace(/```[\s\S]*?```/g, " ").replace(/`[^`\n]*`/g, " ");
  t = t.replace(/<状态栏>[\s\S]*?<\/状态栏>/g, " ").replace(/<status>[\s\S]*?<\/status>/gi, " ");
  t = t.replace(/!\[[^\]]*\]\([^)]*\)/g, " ").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  t = t.replace(/<[^>]+>/g, "");
  compileUserRegex(s.customRegex).forEach((re) => { t = t.replace(re, " "); });
  return normalizeWs(t);
}

/* ===== 二、拆段 ===== */
const NAME_RE = /^[一-龥A-Za-z0-9·.]{1,12}$/;
function pushNarr(out, buf, s) {
  let text = buf;
  if (s.stripActions) text = text.replace(/（[^）]*）/g, " ").replace(/\([^)]*\)/g, " ");
  text = normalizeWs(text);
  if (text) out.push({ kind: "narr", speaker: "", text });
}
function parseCues(raw, s) {
  const text = cleanScript(raw, s);
  const out = [];
  let outside = "", inside = "", inQ = false;
  const flushDialogue = (forceNoSpeaker = false) => {
    const lines = outside.replace(/\s+$/, "").split("\n");
    const last = (lines[lines.length - 1] || "").trim();
    let speaker = ""; let narrPart = outside;
    if (!forceNoSpeaker && last && NAME_RE.test(last)) {
      speaker = last; narrPart = lines.slice(0, -1).join("\n");
    }
    pushNarr(out, narrPart, s);
    const say = normalizeWs(inside);
    if (say) out.push({ kind: "role", speaker, text: say });
    outside = ""; inside = "";
  };
  for (const ch of text) {
    if (!inQ) {
      if (ch === "「") inQ = true; else outside += ch;
    } else if (ch === "」") { inQ = false; flushDialogue(); }
    else inside += ch;
  }
  if (inQ) flushDialogue(); else pushNarr(out, outside, s);
  return out;
}

/* ===== 三、音色选择 ===== */
function getVoice(cue, s) {
  if (cue.kind === "narr") {
    const c = String(s.narrCustom || "").trim();
    if (c) return c;
    return s.narrVoice || defaultSettings.narrVoice;
  }
  if (cue.speaker) {
    const hit = s.roleMap.find((r) => r.name === cue.speaker);
    if (hit) {
      const c = String(hit.custom || "").trim();
      if (c) return c;
      if (hit.voice) return hit.voice;
    }
  }
  const dc = String(s.roleDefaultCustom || "").trim();
  if (dc) return dc;
  return s.roleDefaultVoice || defaultSettings.roleDefaultVoice;
}
/* ===== 四、火山合成（经 /proxy），返回 mp3 Blob ===== */
function getKeys() {
  const s = getS();
  let appId = String(s.volcAppId || "").trim();
  let accessKey = String(s.volcAccessKey || "").trim();
  if ((!appId || !accessKey) && extension_settings[SF_EXT_NAME]) {
    const o = extension_settings[SF_EXT_NAME];
    appId = appId || String(o.volcAppId || "").trim();
    accessKey = accessKey || String(o.volcAccessKey || "").trim();
  }
  return { appId, accessKey };
}
async function synthesizeVolcano(text, speaker) {
  const { appId, accessKey } = getKeys();
  if (!appId || !accessKey) throw new Error("未配置火山 AppID / Access Key");
  if (!text || !speaker) throw new Error("缺少 text/speaker");
  const resourceId = inferResourceId(speaker);
  const requestId = uuid();
  const body = {
    user: { uid: "st_script_user" },
    req_params: {
      text, speaker,
      audio_params: { format: "mp3", sample_rate: 24000, speech_rate: 0, loudness_rate: 0 },
    },
  };
  if (resourceId === "seed-tts-1.0") body.req_params.model = "seed-tts-1.1";

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), VOLC_TIMEOUT_MS);
  let resp;
  try {
    resp = await fetch("/proxy/" + encodeURIComponent(VOLC_V3_URL), {
      method: "POST",
      headers: {
        ...(typeof getRequestHeaders === "function" ? getRequestHeaders() : {}),
        "Content-Type": "application/json",
        "X-Api-App-Id": appId,
        "X-Api-Access-Key": accessKey,
        "X-Api-Resource-Id": resourceId,
        "X-Api-Request-Id": requestId,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (e) {
    if (e.name === "AbortError") throw new Error("火山请求超时（90秒）");
    throw new Error("火山请求失败：" + e.message + "（需酒馆支持 /proxy）");
  } finally { clearTimeout(timeoutId); }

  const logid = resp.headers.get("X-Tt-Logid") || requestId;
  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    throw new Error("火山 HTTP " + resp.status + ": " + String(t).slice(0, 160));
  }
  const chunks = [];
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const consume = (line) => {
    let t = String(line || "").trim();
    if (!t) return;
    if (t.startsWith("data:")) t = t.slice(5).trim();
    if (!t || t === "[DONE]") return;
    let j; try { j = JSON.parse(t); } catch (e) { return; }
    if (j.data) {
      const bin = atob(j.data);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      chunks.push(bytes);
    }
    const code = j.code === undefined || j.code === null ? null : Number(j.code);
    if (code !== null && code !== 0 && code !== 20000000) {
      throw new Error("火山错误 " + j.code + ": " + (j.message || "合成失败") + " (" + logid + ")");
    }
  };
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n"); buffer = lines.pop() || "";
    lines.forEach(consume);
  }
  buffer += decoder.decode(); consume(buffer);
  if (!chunks.length) throw new Error("火山未返回音频 (" + logid + ")");
  return new Blob(chunks, { type: "audio/mpeg" });
}
/* ===== 五、消息处理：注入独立语音条 ===== */
const blobCache = new Map();      // key(speaker|text) -> blobURL
let autoSession = 0;             // 自动连读会话号，点击即作废

function cueKey(cue) { return (cue.speaker || "§narr") + "|" + cue.text; }
function tagLabel(cue) { return cue.kind === "narr" ? "旁白" : (cue.speaker || "角色"); }

async function ensureCueAudio(cue) {
  const key = cueKey(cue);
  if (blobCache.has(key)) return blobCache.get(key);
  const s = getS();
  const voice = getVoice(cue, s);
  scueLog("合成：" + tagLabel(cue) + " / " + voice + " / " + cue.text.slice(0, 12));
  const blob = await synthesizeVolcano(cue.text, voice);
  const url = URL.createObjectURL(blob);
  blobCache.set(key, url);
  return url;
}

function setCueState(cardEl, state) {
  cardEl.setAttribute("data-state", state);
  const btn = cardEl.querySelector(".scue-btn");
  if (btn) btn.textContent = state === "loading" ? "…" : state === "playing" ? "⏸" : "▶";
}

function buildCueCard(cue) {
  const card = document.createElement("div");
  card.className = "scue-cue";
  card.setAttribute("data-state", "idle");
  const head = document.createElement("div");
  head.className = "scue-head";
  const tag = document.createElement("span");
  tag.className = "scue-tag " + (cue.kind === "narr" ? "is-narr" : "is-role");
  tag.textContent = tagLabel(cue);
  const btn = document.createElement("span");
  btn.className = "scue-btn";
  btn.title = "朗读 / 停止";
  btn.setAttribute("role", "button");
  btn.textContent = "▶";
  head.appendChild(tag); head.appendChild(btn);
  const audio = document.createElement("audio");
  audio.className = "scue-audio";
  audio.preload = "none";
  card.appendChild(head); card.appendChild(audio);
  card._cue = cue;
  return card;
}

function processMessage(mesEl, autoplay) {
  const s = getS();
  if (!s.enabled) return;
  const mesId = Number.parseInt(mesEl.getAttribute("mesid"), 10);
  if (!Number.isFinite(mesId)) return;
  const context = getContext();
  const raw = context?.chat?.[mesId]?.mes;
  if (!raw) return;
  if (mesEl.querySelector(".scue-wrap")) return;
  let cues;
  try { cues = parseCues(raw, s); } catch (e) { scueLog("解析失败：" + e.message); return; }
  if (!cues.length) return;
  const wrap = document.createElement("div");
  wrap.className = "scue-wrap";
  const cards = cues.map(buildCueCard);
  cards.forEach((c) => wrap.appendChild(c));
  const mesText = mesEl.querySelector(".mes_text");
  (mesText || mesEl).appendChild(wrap);
  if (autoplay && s.autoPlay) playSequence(cards);
  return cards;
}

/* 顺序连读：一条播完接下一条；用户操作即中断 */
function playSequence(cards) {
  const session = ++autoSession;
  scueLog("开始连读，共 " + cards.length + " 条");
  let i = 0;
  const next = async () => {
    if (session !== autoSession) { scueLog("连读已中断"); return; }
    if (i >= cards.length) { scueLog("连读结束"); return; }
    const card = cards[i];
    const audio = card.querySelector(".scue-audio");
    try {
      setCueState(card, "loading");
      const url = await ensureCueAudio(card._cue);
      if (session !== autoSession) { setCueState(card, "idle"); return; }
      audio.src = url;
      setCueState(card, "playing");
      await audio.play();
    } catch (e) {
      scueLog("连读失败：" + e.message);
      setCueState(card, "idle");
      i += 1; next();
    }
  };
  audio_listen:
  {
    const advance = () => { i += 1; next(); };
    cards.forEach((c) => c.querySelector(".scue-audio").addEventListener("ended", advance, { once: true }));
  }
  next();
}

/* 单条点击：中断连读，独立播放/停止 */
function bindCueClicks() {
  document.addEventListener("click", async (e) => {
    const btn = e.target.closest?.(".scue-btn");
    if (!btn) return;
    e.preventDefault(); e.stopPropagation();
    const card = btn.closest(".scue-cue");
    const audio = card.querySelector(".scue-audio");
    autoSession += 1; // 中断自动连读
    if (card.getAttribute("data-state") === "playing") {
      audio.pause(); setCueState(card, "idle"); return;
    }
    try {
      setCueState(card, "loading");
      const url = await ensureCueAudio(card._cue);
      audio.src = url;
      audio.addEventListener("ended", () => setCueState(card, "idle"), { once: true });
      setCueState(card, "playing");
      await audio.play();
    } catch (err) {
      scueLog("播放失败：" + err.message);
      setCueState(card, "idle");
      toastr?.error?.(err.message, "剧本TTS");
    }
  }, true);
}

function processAllVisible(autoplay = false) {
  document.querySelectorAll(".mes").forEach((el) => {
    const isUser = el.getAttribute("is_user") === "true" || el.classList.contains("mes_user");
    if (isUser) return;
    processMessage(el, autoplay);
  });
}
/* ===== 六、设置面板 ===== */
function voiceOptions(selected) {
  let lastScene = "";
  const html = ['<option value="">— 默认 —</option>'];
  VOLC_VOICES.forEach((v) => {
    if (v.scene !== lastScene) { html.push('<optgroup label="' + escapeHtml(v.scene) + '">'); lastScene = v.scene; }
    html.push('<option value="' + v.value + '"' + (v.value === selected ? " selected" : "") + ">" + escapeHtml(v.name) + "</option>");
  });
  return html.join("");
}
function renderRoleRows() {
  const s = getS();
  const box = document.getElementById("scue_role_rows");
  if (!box) return;
  box.innerHTML = "";
  s.roleMap.forEach((r, idx) => {
    const row = document.createElement("div");
    row.className = "scue-role-row";
    row.innerHTML =
      '<input class="scue-r-name" placeholder="角色名(如 南华)" value="' + escapeHtml(r.name) + '">' +
      '<select class="scue-r-voice">' + voiceOptions(r.voice) + "</select>" +
      '<input class="scue-r-custom" placeholder="自定义ID(ICL_/S_)，可空" value="' + escapeHtml(r.custom || "") + '">' +
      '<span class="scue-r-del" title="删除">✕</span>';
    row.querySelector(".scue-r-name").addEventListener("input", (e) => { s.roleMap[idx].name = e.target.value; save(); });
    row.querySelector(".scue-r-voice").addEventListener("change", (e) => { s.roleMap[idx].voice = e.target.value; save(); });
    row.querySelector(".scue-r-custom").addEventListener("input", (e) => { s.roleMap[idx].custom = e.target.value; save(); });
    row.querySelector(".scue-r-del").addEventListener("click", () => { s.roleMap.splice(idx, 1); save(); renderRoleRows(); });
    box.appendChild(row);
  });
}

function buildPanel() {
  const panel = document.createElement("div");
  panel.id = "scue_settings";
  panel.className = "scue-panel";
  panel.innerHTML =
    '<div class="inline-drawer-toggle inline-drawer-header"><b>剧本多角色语音</b><small>旁白 / 多角色分音色 · 火山引擎</small></div>' +
    '<div class="inline-drawer-content">' +
      '<label class="checkbox_label"><input type="checkbox" id="scue_enabled"> 启用插件</label>' +
      '<label class="checkbox_label"><input type="checkbox" id="scue_autoplay"> 新回复自动连读</label>' +
      '<label class="checkbox_label"><input type="checkbox" id="scue_history"> 切换聊天时给历史消息补语音条</label>' +
      '<label class="checkbox_label"><input type="checkbox" id="scue_actions"> 剥离旁白中的（动作描写）</label>' +
      '<hr><div class="scue-title">火山引擎凭证（不填则借用「声林」扩展的凭证）</div>' +
      '<div class="scue-kv"><label>AppID</label><input id="scue_appid" class="text_pole"></div>' +
      '<div class="scue-kv"><label>Access Key</label><input id="scue_key" class="text_pole"></div>' +
      '<div class="scue-btns"><input id="scue_test" class="menu_button" type="button" value="测试连接"><span id="scue_test_res"></span></div>' +
      '<hr><div class="scue-title">旁白音色</div>' +
      '<div class="scue-kv"><select id="scue_narr_voice">' + voiceOptions("") + "</select></div>" +
      '<div class="scue-kv"><label>自定义ID</label><input id="scue_narr_custom" class="text_pole" placeholder="可空，优先于下拉"></div>' +
      '<hr><div class="scue-title">默认角色音色（未匹配到名字的台词用）</div>' +
      '<div class="scue-kv"><select id="scue_def_voice">' + voiceOptions("") + "</select></div>" +
      '<div class="scue-kv"><label>自定义ID</label><input id="scue_def_custom" class="text_pole"></div>' +
      '<hr><div class="scue-title">角色 → 音色绑定</div>' +
      '<div id="scue_role_rows"></div>' +
      '<input id="scue_add_role" class="menu_button" type="button" value="+ 添加角色">' +
      '<hr><div class="scue-title">排除正则（每行一个；/正则/flags 或纯文本）</div>' +
      '<textarea id="scue_regex" class="text_pole" rows="3" placeholder="/OOC[^\\n]*/g"></textarea>' +
      '<hr><input id="scue_rescan" class="menu_button" type="button" value="重新扫描当前聊天（补语音条，不自动播）">' +
    "</div>";
  return panel;
}

function loadPanelValues() {
  const s = getS();
  document.getElementById("scue_enabled").checked = !!s.enabled;
  document.getElementById("scue_autoplay").checked = !!s.autoPlay;
  document.getElementById("scue_history").checked = !!s.readHistory;
  document.getElementById("scue_actions").checked = !!s.stripActions;
  document.getElementById("scue_appid").value = s.volcAppId || "";
  document.getElementById("scue_key").value = s.volcAccessKey || "";
  document.getElementById("scue_narr_voice").value = s.narrVoice || "";
  document.getElementById("scue_narr_custom").value = s.narrCustom || "";
  document.getElementById("scue_def_voice").value = s.roleDefaultVoice || "";
  document.getElementById("scue_def_custom").value = s.roleDefaultCustom || "";
  document.getElementById("scue_regex").value = s.customRegex || "";
  renderRoleRows();
}

function bindPanel() {
  const bind = (id, key, ev = "change", attr = "checked") => {
    document.getElementById(id).addEventListener(ev, (e) => { getS()[key] = e.target[attr]; save(); });
  };
  bind("scue_enabled", "enabled"); bind("scue_autoplay", "autoPlay");
  bind("scue_history", "readHistory"); bind("scue_actions", "stripActions");
  const inp = (id, key) => document.getElementById(id).addEventListener("input", (e) => { getS()[key] = e.target.value; save(); });
  inp("scue_appid", "volcAppId"); inp("scue_key", "volcAccessKey");
  inp("scue_narr_custom", "narrCustom"); inp("scue_def_custom", "roleDefaultCustom");
  inp("scue_regex", "customRegex");
  document.getElementById("scue_narr_voice").addEventListener("change", (e) => { getS().narrVoice = e.target.value; save(); });
  document.getElementById("scue_def_voice").addEventListener("change", (e) => { getS().roleDefaultVoice = e.target.value; save(); });
  document.getElementById("scue_add_role").addEventListener("click", () => {
    getS().roleMap.push({ name: "", voice: "", custom: "" }); save(); renderRoleRows();
  });
  document.getElementById("scue_rescan").addEventListener("click", () => processAllVisible(false));
  document.getElementById("scue_test").addEventListener("click", async () => {
    const res = document.getElementById("scue_test_res");
    res.textContent = "测试中…";
    try {
      await synthesizeVolcano("你好，这是一条连接测试。", "zh_female_linjianvhai_moon_bigtts");
      res.textContent = "✅ 成功"; res.style.color = "#00ffae";
    }
    catch (e) { res.textContent = "❌ " + e.message; res.style.color = "#ff6b6b"; }
  });
}

/* ===== 七、初始化 ===== */
jQuery(async () => {
  getS();
  const panel = buildPanel();
  $("#extensions_settings").append(panel);
  loadPanelValues();
  bindPanel();
  bindCueClicks();

  // 新角色回复渲染完成 → 处理（自动连读由设置决定）
  if (event_types.CHARACTER_MESSAGE_RENDERED) {
    eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, () => {
      setTimeout(() => {
        const last = document.querySelector(".mes:last-child");
        if (last) processMessage(last, true);
      }, 200);
    });
  }
  // 切换聊天 → 按需补历史
  if (event_types.CHAT_CHANGED) {
    eventSource.makeLast && eventSource.on(event_types.CHAT_CHANGED, () => {
      setTimeout(() => { if (getS().readHistory) processAllVisible(false); }, 600);
    });
  }
  // 兜底：给当前可见消息补条
  setTimeout(() => { if (getS().readHistory) processAllVisible(false); }, 1000);
  scueLog("剧本多角色语音已加载 v1.0.0");
});
