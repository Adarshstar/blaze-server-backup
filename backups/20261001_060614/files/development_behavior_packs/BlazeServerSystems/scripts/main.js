import { world, system } from "@minecraft/server";
import { ActionFormData, ModalFormData, MessageFormData } from "@minecraft/server-ui";

const PREFIX = "!";
const MONEY = "money";
const PHONE = "blaze:phone";

// button ids declared at top

const START_MONEY = 500;
const SPAWN = { x: 225, y: 64, z: 1233 };
const CLAIM_COST = 200;
const CLAIM_R = 12;
const MAX_CLAIMS = 5;

let claims = new Map();
let homes = new Map();
let invMap = new Map();
let stats = new Map();
let sessionStart = new Map();
let known = new Set();
let mail = new Map(); // name -> [{from, msg, at}]
let jobs = new Map(); // name -> jobId
let warps = new Map();
const daily = new Map();
const tpaReq = new Map();

const JOBS = [
  { id: "miner", name: "Miner", pay: 15, desc: "Break stone/ores for bonus pay" },
  { id: "farmer", name: "Farmer", pay: 12, desc: "Harvest crops for bonus pay" },
  { id: "hunter", name: "Hunter", pay: 20, desc: "Kill mobs for bonus pay" },
  { id: "builder", name: "Builder", pay: 10, desc: "Place blocks for bonus pay" },
  { id: "trader", name: "Trader", pay: 8, desc: "Extra shop discounts" }
];

function tell(p, m) { try { p.sendMessage("§8[§6Blaze§8] §r" + m); } catch {} }
function bc(m) { try { world.sendMessage("§8[§6Blaze§8] §r" + m); } catch {} }
function isOp(p) { try { return p.isOp === true; } catch { return false; } }
function getP(n) {
  return [...world.getPlayers()].find(p => p.name.toLowerCase() === (n || "").toLowerCase()) || null;
}
function getMoney(p) {
  try {
    const o = world.scoreboard.getObjective(MONEY);
    return o ? (o.getScore(p.scoreboardIdentity) ?? 0) : 0;
  } catch { return 0; }
}
function setMoney(p, v) {
  try {
    let o = world.scoreboard.getObjective(MONEY);
    if (!o) o = world.scoreboard.addObjective(MONEY, "Money");
    o.setScore(p.scoreboardIdentity, Math.max(0, Math.floor(v)));
  } catch {}
}
function addMoney(p, a) { setMoney(p, getMoney(p) + a); }
function ensureMoneyObj() {
  ensureMoneyObj();
}
function $n(n) { return "§a$" + Number(n).toLocaleString(); }
function fmtMs(ms) {
  const s = Math.floor((ms || 0) / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m ${s % 60}s`;
}
function fmtDate(ts) {
  if (!ts) return "never";
  try { return new Date(ts).toISOString().replace("T", " ").slice(0, 19) + " UTC"; } catch { return "-"; }
}

function safeSub(obj, name, handler) {
  try {
    const ev = obj?.[name];
    if (ev && typeof ev.subscribe === "function") {
      ev.subscribe(handler);
      console.warn("[Blaze] OK " + name);
      return true;
    }
    console.warn("[Blaze] SKIP " + name);
  } catch (e) { console.warn("[Blaze] FAIL " + name + " " + e); }
  return false;
}

function dpGet(key, fallback) {
  try {
    const raw = world.getDynamicProperty(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch { return fallback; }
}
function dpSet(key, val) {
  try { world.setDynamicProperty(key, JSON.stringify(val)); } catch {}
}

// ---- inventory ----
function readInv(p) {
  const out = { name: p.name, slots: [], armor: {}, savedAt: Date.now() };
  try {
    const c = p.getComponent("minecraft:inventory")?.container;
    if (c) {
      for (let i = 0; i < c.size; i++) {
        const it = c.getItem(i);
        if (it) out.slots.push({ slot: i, id: it.typeId, amount: it.amount });
      }
    }
  } catch {}
  try {
    const eq = p.getComponent("minecraft:equippable");
    if (eq) {
      for (const slot of ["Head", "Chest", "Legs", "Feet", "Offhand"]) {
        try {
          const it = eq.getEquipment(slot);
          if (it) out.armor[slot] = { id: it.typeId, amount: it.amount };
        } catch {}
      }
    }
  } catch {}
  return out;
}
function saveInv(p, reason) {
  try {
    const snap = readInv(p);
    if (reason) snap.reason = reason;
    invMap.set(p.name, snap);
    const obj = {};
    for (const [k, v] of invMap) obj[k] = v;
    dpSet("blaze_inv", obj);
  } catch {}
}
function loadInv() {
  try {
    const obj = dpGet("blaze_inv", null);
    if (!obj) return;
    invMap = new Map(Object.entries(obj));
  } catch {}
}
function showInvText(to, name) {
  const key = [...invMap.keys()].find(k => k.toLowerCase() === name.toLowerCase());
  const snap = key ? invMap.get(key) : null;
  if (!snap) { tell(to, "§cNo snapshot for " + name); return; }
  tell(to, `§6Inventory §e${snap.name} §7${fmtDate(snap.savedAt)}`);
  for (const [s, it] of Object.entries(snap.armor || {})) {
    tell(to, `§b${s}: §f${(it.id || "").replace("minecraft:", "")} x${it.amount}`);
  }
  let total = 0;
  for (const it of snap.slots || []) total += it.amount || 0;
  tell(to, `§7${(snap.slots || []).length} stacks · ${total} items`);
  for (const it of (snap.slots || []).slice(0, 24)) {
    tell(to, `§8#${it.slot} §f${(it.id || "").replace("minecraft:", "")} §7x${it.amount}`);
  }
}

function hasPhone(p) {
  try {
    const c = p.getComponent("minecraft:inventory")?.container;
    if (!c) return false;
    for (let i = 0; i < c.size; i++) {
      const it = c.getItem(i);
      if (it && (it.typeId === PHONE || (it.typeId || "").includes("recovery_compass"))) return true;
    }
  } catch {}
  return false;
}
function givePhone(p) {
  if (hasPhone(p)) return;
  try { p.runCommand(`give @s ${PHONE} 1`); } catch {
    try { p.runCommand("give @s recovery_compass 1"); } catch {}
  }
}

function ckey(x, z) { return Math.floor(x / CLAIM_R) + "," + Math.floor(z / CLAIM_R); }
function loadClaims() {
  try {
    const arr = dpGet("blaze_claims", []);
    claims = new Map();
    for (const c of arr) claims.set(c.key, c);
  } catch {}
}
function saveClaims() {
  dpSet("blaze_claims", [...claims.entries()].map(([k, v]) => ({ ...v, key: k })));
}
function canBuild(p, x, z) {
  if (isOp(p)) return true;
  const c = claims.get(ckey(x, z));
  if (!c) return true;
  return c.owner === p.name || (c.trusted || []).includes(p.name);
}

function loadStats() {
  try {
    const obj = dpGet("blaze_stats", null);
    if (obj) stats = new Map(Object.entries(obj));
  } catch {}
}
function saveStats() {
  const o = {};
  for (const [k, v] of stats) o[k] = v;
  dpSet("blaze_stats", o);
}
function ensureStat(n) {
  if (!stats.has(n)) stats.set(n, { joins: 0, totalMs: 0, lastJoin: 0, lastLeave: 0, lastName: n, sessions: [], kills: 0, deaths: 0, blocksBroken: 0, blocksPlaced: 0 });
  return stats.get(n);
}

function loadMail() {
  try {
    const obj = dpGet("blaze_mail", null);
    if (obj) mail = new Map(Object.entries(obj));
  } catch {}
}
function saveMail() {
  const o = {};
  for (const [k, v] of mail) o[k] = v;
  dpSet("blaze_mail", o);
}
function loadJobs() {
  try {
    const obj = dpGet("blaze_jobs", null);
    if (obj) jobs = new Map(Object.entries(obj));
  } catch {}
}
function saveJobs() {
  const o = {};
  for (const [k, v] of jobs) o[k] = v;
  dpSet("blaze_jobs", o);
}
function loadWarps() {
  try {
    const obj = dpGet("blaze_warps", null);
    if (obj) warps = new Map(Object.entries(obj));
  } catch {}
}
function saveWarps() {
  const o = {};
  for (const [k, v] of warps) o[k] = v;
  dpSet("blaze_warps", o);
}

function jobOf(p) { return jobs.get(p.name) || null; }
function jobInfo(id) { return JOBS.find(j => j.id === id) || null; }

// ===================== HEAVY SERVER-SIDE UI =====================
// All decisions, economy, storage = server. Client only renders forms.

function openPhone(p) {
  try {
    const st = ensureStat(p.name);
    const j = jobInfo(jobOf(p));
    const inbox = (mail.get(p.name) || []).length;
    const form = new ActionFormData()
      .title("§6§lBlaze OS")
      .body(
        `§f${p.name}\n` +
        `§7Balance: ${$n(getMoney(p))}\n` +
        `§7Playtime: §f${fmtMs(st.totalMs)}\n` +
        `§7Job: §e${j ? j.name : "None"}\n` +
        `§7Mail: §b${inbox} §7unread\n` +
        `§8All processing runs on the server`
      )
      .button("§a§lWallet")
      .button("§e§lShop")
      .button("§d§lJobs")
      .button("§9§lTravel")
      .button("§3§lClaims")
      .button("§6§lSocial")
      .button("§b§lStats")
      .button("§5§lInventory")
      .button("§2§lMail")
      .button("§c§lLeaderboards")
      .button("§7§lRules & Help")
      .button("§b§lControl Pad")
      .button(isOp(p) ? "§4§lAdmin Panel" : "§8Close");
    form.show(p).then(r => {
      if (r.canceled) return;
      const s = r.selection;
      if (s === 0) openWallet(p);
      else if (s === 1) openShop(p);
      else if (s === 2) openJobs(p);
      else if (s === 3) openTravel(p);
      else if (s === 4) openClaimsMenu(p);
      else if (s === 5) openSocial(p);
      else if (s === 6) openStatsUI(p);
      else if (s === 7) openInvUI(p);
      else if (s === 8) openMail(p);
      else if (s === 9) openLeaderboards(p);
      else if (s === 10) openRules(p);
      else if (s === 11) openControlPad(p);
      else if (s === 12 && isOp(p)) openAdmin(p);
    }).catch(e => {
      tell(p, "§cUI error — use §e!help");
      console.warn("phone " + e);
    });
  } catch (e) {
    tell(p, "§cPhone failed — §e!money §e!help");
    console.warn("phone " + e);
  }
}

function openWallet(p) {
  const form = new ActionFormData()
    .title("§aWallet")
    .body(`§fBalance: ${$n(getMoney(p))}\n§7Server-side economy`)
    .button("§ePay player")
    .button("§aDaily reward")
    .button("§6Sell items")
    .button("§7Back");
  form.show(p).then(r => {
    if (r.canceled || r.selection === 3) return openPhone(p);
    if (r.selection === 0) openPayModal(p);
    else if (r.selection === 1) {
      const now = Date.now();
      if (now - (daily.get(p.name) || 0) < 20 * 3600 * 1000) {
        tell(p, "§cDaily already claimed");
        return openWallet(p);
      }
      daily.set(p.name, now);
      addMoney(p, 100);
      tell(p, "§aDaily +" + $n(100));
      openWallet(p);
    } else if (r.selection === 2) openSellUI(p);
  }).catch(() => {});
}

function openPayModal(p) {
  const online = [...world.getPlayers()].filter(x => x.name !== p.name).map(x => x.name);
  if (!online.length) {
    tell(p, "§cNo other players online");
    return openWallet(p);
  }
  const form = new ModalFormData()
    .title("§ePay Player")
    .dropdown("Player", online, 0)
    .textField("Amount", "100");
  form.show(p).then(r => {
    if (r.canceled) return openWallet(p);
    const target = getP(online[r.formValues[0]]);
    const amt = parseInt(r.formValues[1]);
    if (!target || !amt || amt <= 0) { tell(p, "§cInvalid"); return openWallet(p); }
    if (getMoney(p) < amt) { tell(p, "§cNot enough"); return openWallet(p); }
    addMoney(p, -amt);
    addMoney(target, amt);
    tell(p, "§aPaid " + $n(amt) + " to " + target.name);
    tell(target, "§a+" + $n(amt) + " from " + p.name);
    openWallet(p);
  }).catch(() => openWallet(p));
}

function openShop(p) {
  const items = [
    { id: "cooked_beef", n: "Cooked Beef x8", price: 12, amt: 8 },
    { id: "bread", n: "Bread x10", price: 8, amt: 10 },
    { id: "torch", n: "Torch x32", price: 8, amt: 32 },
    { id: "oak_log", n: "Oak Logs x16", price: 20, amt: 16 },
    { id: "cobblestone", n: "Cobble x64", price: 10, amt: 64 },
    { id: "iron_ingot", n: "Iron x4", price: 35, amt: 4 },
    { id: "gold_ingot", n: "Gold x4", price: 45, amt: 4 },
    { id: "diamond", n: "Diamond x1", price: 180, amt: 1 },
    { id: "arrow", n: "Arrows x32", price: 25, amt: 32 },
    { id: "golden_apple", n: "Golden Apple", price: 250, amt: 1 }
  ];
  const discount = jobOf(p) === "trader" ? 0.9 : 1;
  const f = new ActionFormData()
    .title("§eServer Shop")
    .body(`§7Balance: ${$n(getMoney(p))}\n§7${discount < 1 ? "§aTrader 10% off" : "Prices set by server"}`);
  for (const it of items) {
    const price = Math.floor(it.price * discount);
    f.button(`§f${it.n}\n§a$${price}`);
  }
  f.button("§7Back");
  f.show(p).then(r => {
    if (r.canceled || r.selection === items.length) return openPhone(p);
    const it = items[r.selection];
    const price = Math.floor(it.price * discount);
    if (getMoney(p) < price) { tell(p, "§cNot enough money"); return openShop(p); }
    addMoney(p, -price);
    try {
      p.runCommand(`give @s ${it.id} ${it.amt}`);
      tell(p, "§aBought " + it.n + " for " + $n(price));
    } catch {
      addMoney(p, price);
      tell(p, "§cPurchase failed");
    }
    openShop(p);
  }).catch(() => {});
}

function openSellUI(p) {
  const prices = [
    { id: "diamond", n: "Diamond", price: 50 },
    { id: "iron_ingot", n: "Iron Ingot", price: 8 },
    { id: "gold_ingot", n: "Gold Ingot", price: 12 },
    { id: "coal", n: "Coal", price: 2 },
    { id: "oak_log", n: "Oak Log", price: 3 },
    { id: "cobblestone", n: "Cobblestone", price: 1 }
  ];
  const f = new ActionFormData().title("§6Sell to Server").body("§7Server buys these items");
  for (const it of prices) f.button(`§f${it.n}\n§a$${it.price} each`);
  f.button("§7Back");
  f.show(p).then(r => {
    if (r.canceled || r.selection === prices.length) return openWallet(p);
    const it = prices[r.selection];
    const modal = new ModalFormData().title("Sell " + it.n).slider("Amount", 1, 64, 1, 1);
    modal.show(p).then(m => {
      if (m.canceled) return openSellUI(p);
      const amt = m.formValues[0];
      try {
        p.runCommand(`clear @s ${it.id} 0 ${amt}`);
        addMoney(p, it.price * amt);
        tell(p, "§aSold " + amt + "x " + it.n + " for " + $n(it.price * amt));
      } catch { tell(p, "§cNot enough items"); }
      openSellUI(p);
    }).catch(() => openSellUI(p));
  }).catch(() => {});
}

function openJobs(p) {
  const cur = jobInfo(jobOf(p));
  const f = new ActionFormData()
    .title("§dJobs Center")
    .body(`§7Current: §e${cur ? cur.name : "None"}\n§7Job pay is processed on the server when you work.`);
  for (const j of JOBS) f.button(`§f${j.name}\n§7${j.desc}`);
  f.button("§cQuit job");
  f.button("§7Back");
  f.show(p).then(r => {
    if (r.canceled || r.selection === JOBS.length + 1) return openPhone(p);
    if (r.selection === JOBS.length) {
      jobs.delete(p.name);
      saveJobs();
      tell(p, "§7You left your job");
      return openJobs(p);
    }
    const j = JOBS[r.selection];
    jobs.set(p.name, j.id);
    saveJobs();
    tell(p, "§aJoined job: §e" + j.name);
    openJobs(p);
  }).catch(() => {});
}

function openTravel(p) {
  const f = new ActionFormData()
    .title("§9Travel")
    .body("§7Homes & warps stored on server")
    .button("§aSet home here")
    .button("§eGo home")
    .button("§bSpawn")
    .button("§6Warps list")
    .button(isOp(p) ? "§cSet warp (admin)" : "§7Back");
  if (!isOp(p)) { /* last is back */ }
  f.show(p).then(r => {
    if (r.canceled) return;
    if (r.selection === 0) {
      homes.set(p.name, { x: p.location.x, y: p.location.y, z: p.location.z });
      const o = {}; for (const [k, v] of homes) o[k] = v;
      dpSet("blaze_homes", o);
      tell(p, "§aHome set");
      openTravel(p);
    } else if (r.selection === 1) {
      const h = homes.get(p.name);
      if (!h) tell(p, "§cNo home");
      else try { p.teleport(h); } catch {}
    } else if (r.selection === 2) {
      try { p.teleport(SPAWN); } catch {}
    } else if (r.selection === 3) openWarps(p);
    else if (r.selection === 4 && isOp(p)) openSetWarp(p);
    else openPhone(p);
  }).catch(() => {});
}

function openWarps(p) {
  const names = [...warps.keys()];
  const f = new ActionFormData().title("§6Warps").body(names.length ? "§7Select destination" : "§cNo warps set");
  for (const n of names) f.button("§e" + n);
  f.button("§7Back");
  f.show(p).then(r => {
    if (r.canceled || r.selection === names.length) return openTravel(p);
    const w = warps.get(names[r.selection]);
    if (w) try { p.teleport(w); tell(p, "§aWarped to " + names[r.selection]); } catch {}
  }).catch(() => {});
}

function openSetWarp(p) {
  new ModalFormData().title("Set Warp").textField("Warp name", "shop").show(p).then(r => {
    if (r.canceled) return openTravel(p);
    const name = (r.formValues[0] || "").toLowerCase().trim();
    if (!name) return openTravel(p);
    warps.set(name, { x: p.location.x, y: p.location.y, z: p.location.z });
    saveWarps();
    tell(p, "§aWarp set: " + name);
    openTravel(p);
  }).catch(() => openTravel(p));
}

function openClaimsMenu(p) {
  let mine = 0;
  for (const c of claims.values()) if (c.owner === p.name) mine++;
  const here = claims.get(ckey(p.location.x, p.location.z));
  const f = new ActionFormData()
    .title("§3Land Claims")
    .body(
      `§7Your claims: §f${mine}/${MAX_CLAIMS}\n` +
      `§7Cost: ${$n(CLAIM_COST)}\n` +
      `§7Here: ${here ? "§e" + here.owner : "§awilderness"}`
    )
    .button("§aClaim here")
    .button("§cUnclaim here")
    .button("§eTrust player")
    .button("§7Back");
  f.show(p).then(r => {
    if (r.canceled || r.selection === 3) return openPhone(p);
    if (r.selection === 0) {
      const k = ckey(p.location.x, p.location.z);
      if (claims.has(k)) { tell(p, "§cAlready claimed"); return openClaimsMenu(p); }
      if (mine >= MAX_CLAIMS) { tell(p, "§cMax claims"); return openClaimsMenu(p); }
      if (getMoney(p) < CLAIM_COST) { tell(p, "§cNeed " + $n(CLAIM_COST)); return openClaimsMenu(p); }
      addMoney(p, -CLAIM_COST);
      claims.set(k, { owner: p.name, x: Math.floor(p.location.x), z: Math.floor(p.location.z), trusted: [] });
      saveClaims();
      tell(p, "§aClaimed");
      openClaimsMenu(p);
    } else if (r.selection === 1) {
      const k = ckey(p.location.x, p.location.z);
      const cl = claims.get(k);
      if (!cl || (cl.owner !== p.name && !isOp(p))) { tell(p, "§cCannot unclaim"); return openClaimsMenu(p); }
      claims.delete(k); saveClaims(); tell(p, "§aUnclaimed");
      openClaimsMenu(p);
    } else if (r.selection === 2) {
      const online = [...world.getPlayers()].map(x => x.name);
      new ModalFormData().title("Trust").dropdown("Player", online, 0).show(p).then(m => {
        if (m.canceled) return openClaimsMenu(p);
        const k = ckey(p.location.x, p.location.z);
        const cl = claims.get(k);
        if (!cl || cl.owner !== p.name) { tell(p, "§cStand in your claim"); return openClaimsMenu(p); }
        const name = online[m.formValues[0]];
        cl.trusted = cl.trusted || [];
        if (!cl.trusted.includes(name)) cl.trusted.push(name);
        saveClaims();
        tell(p, "§aTrusted " + name);
        openClaimsMenu(p);
      }).catch(() => openClaimsMenu(p));
    }
  }).catch(() => {});
}

function openSocial(p) {
  const online = [...world.getPlayers()].filter(x => x.name !== p.name);
  const f = new ActionFormData()
    .title("§6Social")
    .body(`§7Online others: §f${online.length}\n§8TPA removed`)
    .button("§eOnline list")
    .button("§7Back");
  f.show(p).then(r => {
    if (r.canceled || r.selection === 1) return openPhone(p);
    for (const o of world.getPlayers()) {
      const st = ensureStat(o.name);
      tell(p, `§a● §f${o.name} §7${fmtMs(st.totalMs)}`);
    }
    openSocial(p);
  }).catch(() => {});
}

function openStatsUI(p) {
  const st = ensureStat(p.name);
  const f = new ActionFormData()
    .title("§bYour Stats")
    .body(
      `§f${p.name}\n` +
      `§7Joins: §f${st.joins || 0}\n` +
      `§7Playtime: §f${fmtMs(st.totalMs)}\n` +
      `§7Kills: §f${st.kills || 0} §7Deaths: §f${st.deaths || 0}\n` +
      `§7Blocks broken: §f${st.blocksBroken || 0}\n` +
      `§7Blocks placed: §f${st.blocksPlaced || 0}\n` +
      `§7Last join: §f${fmtDate(st.lastJoin)}\n` +
      `§8Tracked on server`
    )
    .button("§7Back");
  f.show(p).then(() => openPhone(p)).catch(() => {});
}

function openInvUI(p) {
  saveInv(p, "ui");
  const snap = invMap.get(p.name);
  let body = "§cNo snapshot";
  if (snap) {
    let total = 0;
    for (const it of snap.slots || []) total += it.amount || 0;
    const top = (snap.slots || []).slice(0, 12).map(it =>
      `§8${(it.id || "").replace("minecraft:", "")} §7x${it.amount}`
    ).join("\n");
    body = `§7${(snap.slots || []).length} stacks · ${total} items\n${top}`;
  }
  new ActionFormData().title("§5Inventory").body(body)
    .button("§eRefresh")
    .button("§7Chat full list")
    .button("§7Back")
    .show(p).then(r => {
      if (r.canceled || r.selection === 2) return openPhone(p);
      if (r.selection === 0) return openInvUI(p);
      showInvText(p, p.name);
      openInvUI(p);
    }).catch(() => {});
}

function openMail(p) {
  const box = mail.get(p.name) || [];
  const f = new ActionFormData()
    .title("§2Mail")
    .body(box.length ? `§7${box.length} messages (server storage)` : "§7Inbox empty");
  f.button("§aCompose");
  for (const m of box.slice(-8).reverse()) {
    f.button(`§e${m.from}\n§7${(m.msg || "").slice(0, 32)}`);
  }
  f.button("§7Back");
  f.show(p).then(r => {
    if (r.canceled || r.selection === box.slice(-8).length + 1) return openPhone(p);
    if (r.selection === 0) return openCompose(p);
    const msg = box.slice(-8).reverse()[r.selection - 1];
    if (msg) {
      new MessageFormData()
        .title("§eFrom " + msg.from)
        .body(`§f${msg.msg}\n\n§7${fmtDate(msg.at)}`)
        .button1("§7OK")
        .button2("§cClose")
        .show(p).then(() => openMail(p)).catch(() => openMail(p));
    }
  }).catch(() => {});
}

function openCompose(p) {
  const online = [...world.getPlayers()].map(x => x.name);
  if (!online.length) return openMail(p);
  new ModalFormData()
    .title("Compose Mail")
    .dropdown("To", online, 0)
    .textField("Message", "Hello!")
    .show(p).then(r => {
      if (r.canceled) return openMail(p);
      const to = online[r.formValues[0]];
      const msg = (r.formValues[1] || "").slice(0, 200);
      if (!msg) return openMail(p);
      const box = mail.get(to) || [];
      box.push({ from: p.name, msg, at: Date.now() });
      mail.set(to, box.slice(-30));
      saveMail();
      tell(p, "§aMail sent to " + to);
      const tp = getP(to);
      if (tp) tell(tp, "§bNew mail from " + p.name + " — open Phone → Mail");
      openMail(p);
    }).catch(() => openMail(p));
}

function openLeaderboards(p) {
  const byMoney = [...world.getPlayers()].map(pl => ({ n: pl.name, v: getMoney(pl) })).sort((a, b) => b.v - a.v);
  const byTime = [...stats.entries()].map(([n, st]) => ({ n: st.lastName || n, v: st.totalMs || 0 })).sort((a, b) => b.v - a.v).slice(0, 10);
  let body = "§6§lRichest (online)\n";
  byMoney.slice(0, 5).forEach((x, i) => { body += `§e${i + 1}. §f${x.n} §a${$n(x.v)}\n`; });
  body += "\n§6§lMost playtime\n";
  byTime.slice(0, 5).forEach((x, i) => { body += `§e${i + 1}. §f${x.n} §7${fmtMs(x.v)}\n`; });
  new ActionFormData().title("§cLeaderboards").body(body).button("§7Back")
    .show(p).then(() => openPhone(p)).catch(() => {});
}

function openRules(p) {
  new ActionFormData()
    .title("§7Rules & Help")
    .body(
      "§e1. §fBe respectful\n" +
      "§e2. §fNo cheating / xray\n" +
      "§e3. §fNo griefing claims\n" +
      "§e4. §fHave fun\n\n" +
      "§6Commands: §e!phone !money !pay !daily\n" +
      "§e!claim !home !spawn !inv !sell\n" +
      "§8UI is client display only — logic is server-side"
    )
    .button("§7Back")
    .show(p).then(() => openPhone(p)).catch(() => {});
}

function openAdmin(p) {
  if (!isOp(p)) return openPhone(p);
  new ActionFormData()
    .title("§4Admin Panel")
    .body("§cServer-side admin tools")
    .button("§eBroadcast message")
    .button("§aGive money")
    .button("§bSet time day")
    .button("§9Clear weather")
    .button("§6Save all inventories")
    .button("§7Back")
    .show(p).then(r => {
      if (r.canceled || r.selection === 5) return openPhone(p);
      if (r.selection === 0) {
        new ModalFormData().title("Broadcast").textField("Message", "Hello server").show(p).then(m => {
          if (!m.canceled && m.formValues[0]) bc("§c[Admin] §f" + m.formValues[0]);
          openAdmin(p);
        }).catch(() => openAdmin(p));
      } else if (r.selection === 1) {
        const names = [...world.getPlayers()].map(x => x.name);
        new ModalFormData().title("Give Money").dropdown("Player", names, 0).textField("Amount", "100").show(p).then(m => {
          if (m.canceled) return openAdmin(p);
          const t = getP(names[m.formValues[0]]);
          const amt = parseInt(m.formValues[1]) || 0;
          if (t && amt) { addMoney(t, amt); tell(p, "§aGave " + $n(amt)); tell(t, "§aAdmin gave you " + $n(amt)); }
          openAdmin(p);
        }).catch(() => openAdmin(p));
      } else if (r.selection === 2) {
        try { p.runCommand("time set day"); tell(p, "§aDay"); } catch {}
        openAdmin(p);
      } else if (r.selection === 3) {
        try { p.runCommand("weather clear"); tell(p, "§aClear"); } catch {}
        openAdmin(p);
      } else if (r.selection === 4) {
        for (const pl of world.getPlayers()) saveInv(pl, "admin");
        tell(p, "§aInventories saved");
        openAdmin(p);
      }
    }).catch(() => {});
}

// ===================== COMMANDS =====================
function cmd(p, msg) {
  if (!msg || !msg.startsWith(PREFIX)) return false;
  const a = msg.slice(1).trim().split(/\s+/);
  const c = (a[0] || "").toLowerCase();

  if (c === "phone" || c === "menu" || c === "os") { openPhone(p); return true; }
  if (c === "money" || c === "bal" || c === "balance") { tell(p, "Balance: " + $n(getMoney(p))); return true; }
  if (c === "pay") {
    const t = getP(a[1]); const amt = parseInt(a[2]);
    if (!t || !amt || amt <= 0) { tell(p, "§c!pay <player> <amt>"); return true; }
    if (getMoney(p) < amt) { tell(p, "§cNot enough"); return true; }
    addMoney(p, -amt); addMoney(t, amt);
    tell(p, "§aPaid " + $n(amt)); tell(t, "§a+" + $n(amt) + " from " + p.name);
    return true;
  }
  if (c === "daily") {
    const now = Date.now();
    if (now - (daily.get(p.name) || 0) < 20 * 3600 * 1000) { tell(p, "§cAlready claimed"); return true; }
    daily.set(p.name, now); addMoney(p, 100); tell(p, "§aDaily +" + $n(100));
    return true;
  }
  if (c === "claim") {
    const k = ckey(p.location.x, p.location.z);
    if (claims.has(k)) { tell(p, "§cOwned by " + claims.get(k).owner); return true; }
    let n = 0; for (const cl of claims.values()) if (cl.owner === p.name) n++;
    if (n >= MAX_CLAIMS) { tell(p, "§cMax claims"); return true; }
    if (getMoney(p) < CLAIM_COST) { tell(p, "§cNeed " + $n(CLAIM_COST)); return true; }
    addMoney(p, -CLAIM_COST);
    claims.set(k, { owner: p.name, x: Math.floor(p.location.x), z: Math.floor(p.location.z), trusted: [] });
    saveClaims(); tell(p, "§aLand claimed"); return true;
  }
  if (c === "unclaim") {
    const k = ckey(p.location.x, p.location.z);
    const cl = claims.get(k);
    if (!cl) { tell(p, "§cNo claim"); return true; }
    if (cl.owner !== p.name && !isOp(p)) { tell(p, "§cNot yours"); return true; }
    claims.delete(k); saveClaims(); tell(p, "§aUnclaimed"); return true;
  }
  if (c === "sethome") {
    homes.set(p.name, { x: p.location.x, y: p.location.y, z: p.location.z });
    const o = {}; for (const [k, v] of homes) o[k] = v;
    dpSet("blaze_homes", o); tell(p, "§aHome set"); return true;
  }
  if (c === "home") {
    const h = homes.get(p.name);
    if (!h) { tell(p, "§cNo home"); return true; }
    try { p.teleport(h); } catch {}
    return true;
  }
  if (c === "spawn") { try { p.teleport(SPAWN); } catch {} return true; }
  if (c === "inv" || c === "inventory") {
    const t = a[1] || p.name;
    if (a[1] && a[1].toLowerCase() !== p.name.toLowerCase() && !isOp(p)) {
      tell(p, "§cOps only"); return true;
    }
    const online = getP(t);
    if (online) saveInv(online, "view");
    showInvText(p, online ? online.name : t);
    return true;
  }
  if (c === "players" || c === "plist") {
    for (const [n, st] of [...stats.entries()].slice(0, 15)) {
      const on = sessionStart.has(n) ? "§a●" : "§8○";
      tell(p, `${on} §f${st.lastName || n} §7${fmtMs(st.totalMs)}`);
    }
    return true;
  }
  if (c === "playtime" || c === "stats") {
    const st = ensureStat(a[1] || p.name);
    tell(p, `§e${st.lastName || a[1] || p.name} §7j:${st.joins} ${fmtMs(st.totalMs)}`);
    return true;
  }
  if (c === "sell") {
    const prices = { diamond: 50, iron_ingot: 8, gold_ingot: 12, coal: 2, oak_log: 3, cobblestone: 1 };
    const item = (a[1] || "").toLowerCase();
    const amt = Math.max(1, parseInt(a[2] || "1") || 1);
    if (!prices[item]) { tell(p, "§c!sell <item> <amt>"); return true; }
    try {
      p.runCommand(`clear @s ${item} 0 ${amt}`);
      addMoney(p, prices[item] * amt);
      tell(p, "§aSold for " + $n(prices[item] * amt));
    } catch { tell(p, "§cNot enough items"); }
    return true;
  }


  if (c === "job") {
    openJobs(p); return true;
  }
  if (c === "pad" || c === "controls") {
    openControlPad(p);
    return true;
  }
  if (c === "drop") {
    dropSelected(p);
    return true;
  }
  if (c === "swap") {
    swapHands(p);
    return true;
  }
  if (c === "offhand" || c === "oh") {
    tell(p, "§6Control Pad: §e!pad");
    tell(p, "§bSWAP §7main ↔ offhand");
    tell(p, "§aUSE §7offhand (right-click style)");
    tell(p, "§cHIT §7offhand attack");
    tell(p, "§eDROP §7main-hand item");
    tell(p, "§7Torch in main/offhand = moving light (no night vision)");
    openControlPad(p);
    return true;
  }
  if (c === "version" || c === "ver") {
    tell(p, "§6Blaze OS §ev20 §7· server-side systems");
    return true;
  }
  if (c === "help") {
    tell(p, "§6!phone §7opens full Blaze OS UI (server-side)");
    tell(p, "§6!pad §7= control buttons · §6!drop !swap !offhand");
    tell(p, "§6!money !pay !daily !claim !home !spawn !inv !sell !job");
    tell(p, "§7Hold torch in main or off-hand for light");
    return true;
  }
  return false;
}

// ---- events ----
safeSub(world.afterEvents, "playerSpawn", (ev) => {
  system.runTimeout(() => {
    try {
      const p = ev.player;
      ensureMoneyObj();
      if (ev.initialSpawn) {
        if (!p.hasTag("blaze_joined")) {
          setMoney(p, START_MONEY);
          p.addTag("blaze_joined");
          tell(p, "§aWelcome! " + $n(START_MONEY) + " · §e!phone");
        }
        const st = ensureStat(p.name);
        st.joins = (st.joins || 0) + 1;
        st.lastJoin = Date.now();
        st.lastName = p.name;
        sessionStart.set(p.name, Date.now());
        saveStats();
        bc("§a+ §e" + p.name);
      }
      givePhone(p);
      system.runTimeout(() => { givePhone(p); saveInv(p, "spawn"); }, 50);
    } catch (e) { console.warn("spawn " + e); }
  }, 20);
});

system.runInterval(() => {
  try {
    const now = new Set([...world.getPlayers()].map(p => p.name));
    for (const n of known) {
      if (!now.has(n)) {
        const st = ensureStat(n);
        const start = sessionStart.get(n) || st.lastJoin || Date.now();
        st.totalMs = (st.totalMs || 0) + Math.max(0, Date.now() - start);
        st.lastLeave = Date.now();
        sessionStart.delete(n);
        clearPlayerLight(n);
        saveStats();
        bc("§c- §e" + n);
      }
    }
    for (const n of now) known.add(n);
    for (const n of [...known]) if (!now.has(n)) known.delete(n);
  } catch {}
}, 40);

system.runInterval(() => {
  try {
    for (const p of world.getPlayers()) {
      givePhone(p);
      saveInv(p, "auto");
    }
  } catch {}
}, 200);

safeSub(world.beforeEvents, "chatSend", (ev) => {
  try { if (cmd(ev.sender, ev.message)) ev.cancel = true; } catch (e) { console.warn("chat " + e); }
});
safeSub(world.afterEvents, "itemUse", (ev) => {
  try {
    const id = ((ev.itemStack && ev.itemStack.typeId) || "").toLowerCase();
    const p = ev.source;
    if (id === PHONE || id.includes("phone") || id.includes("recovery_compass")) openPhone(p);
  } catch (e) { console.warn("itemUse " + e); }
});
safeSub(world.afterEvents, "entityDie", (ev) => {
  try {
    if (!ev.deadEntity) return;
    if (ev.deadEntity.typeId === "minecraft:player") {
      const p = getP(ev.deadEntity.nameTag || ev.deadEntity.name);
      if (p) {
        saveInv(p, "death");
        const st = ensureStat(p.name);
        st.deaths = (st.deaths || 0) + 1;
        saveStats();
      }
    }
    // hunter job pay
    try {
      const killer = ev.damageSource?.damagingEntity;
      if (killer && killer.typeId === "minecraft:player") {
        const kp = getP(killer.name);
        if (kp && jobOf(kp) === "hunter") {
          addMoney(kp, 5);
          const st = ensureStat(kp.name);
          st.kills = (st.kills || 0) + 1;
          saveStats();
        }
      }
    } catch {}
  } catch {}
});
safeSub(world.beforeEvents, "playerBreakBlock", (ev) => {
  try {
    if (!canBuild(ev.player, ev.block.location.x, ev.block.location.z)) {
      ev.cancel = true;
      tell(ev.player, "§cClaimed land");
      return;
    }
    const st = ensureStat(ev.player.name);
    st.blocksBroken = (st.blocksBroken || 0) + 1;
    if (jobOf(ev.player) === "miner") {
      const id = ev.block?.typeId || "";
      if (id.includes("ore") || id.includes("stone") || id.includes("deepslate")) {
        if (Math.random() < 0.15) addMoney(ev.player, 2);
      }
    }
  } catch {}
});
safeSub(world.afterEvents, "playerBreakBlock", (ev) => {
  try {
    const st = ensureStat(ev.player.name);
    st.blocksBroken = (st.blocksBroken || 0) + 1;
  } catch {}
});
safeSub(world.beforeEvents, "playerPlaceBlock", (ev) => {
  try {
    if (!canBuild(ev.player, ev.block.location.x, ev.block.location.z)) {
      ev.cancel = true;
      tell(ev.player, "§cClaimed land");
      return;
    }
    if (jobOf(ev.player) === "builder" && Math.random() < 0.1) addMoney(ev.player, 1);
    const st = ensureStat(ev.player.name);
    st.blocksPlaced = (st.blocksPlaced || 0) + 1;
  } catch {}
});



// ---- real-time handheld light (light_block follows player; NO night vision) ----
const LIGHT_ITEMS = new Set([
  "minecraft:torch", "minecraft:soul_torch", "minecraft:redstone_torch",
  "minecraft:lantern", "minecraft:soul_lantern", "minecraft:campfire",
  "minecraft:soul_campfire", "minecraft:lit_pumpkin", "minecraft:shroomlight",
  "minecraft:glowstone", "minecraft:sea_lantern"
]);
const lightPos = new Map(); // playerName -> {x,y,z}

function itemIsLight(typeId) {
  if (!typeId) return false;
  const id = typeId.toLowerCase();
  if (LIGHT_ITEMS.has(id)) return true;
  return id.includes("torch") || id.includes("lantern") || id.endsWith("campfire");
}
function getMainHandItem(p) {
  try {
    const inv = p.getComponent("minecraft:inventory")?.container;
    if (!inv) return null;
    const slot = typeof p.selectedSlotIndex === "number" ? p.selectedSlotIndex : 0;
    return inv.getItem(slot) || null;
  } catch { return null; }
}
function getOffhandItem(p) {
  try {
    const eq = p.getComponent("minecraft:equippable");
    if (!eq) return null;
    return eq.getEquipment("Offhand") || null;
  } catch { return null; }
}
function holdingLight(p) {
  try {
    const main = getMainHandItem(p);
    if (main && itemIsLight(main.typeId)) return true;
    const off = getOffhandItem(p);
    if (off && itemIsLight(off.typeId)) return true;
  } catch {}
  return false;
}
function clearPlayerLight(name) {
  const prev = lightPos.get(name);
  if (!prev) return;
  try {
    // remove only if still our light block
    const dim = world.getDimension("overworld");
    // use command relative to stored coords
  } catch {}
  try {
    // run as server via first player or world
    for (const pl of world.getPlayers()) {
      pl.runCommand(`setblock ${prev.x} ${prev.y} ${prev.z} air [] replace`);
      break;
    }
  } catch {}
  lightPos.delete(name);
}
function updateHeldLight(p) {
  const name = p.name;
  if (!holdingLight(p)) {
    clearPlayerLight(name);
    return;
  }
  const x = Math.floor(p.location.x);
  const y = Math.floor(p.location.y) + 1;
  const z = Math.floor(p.location.z);
  const prev = lightPos.get(name);
  if (prev && prev.x === x && prev.y === y && prev.z === z) return;
  // remove old
  if (prev) {
    try { p.runCommand(`setblock ${prev.x} ${prev.y} ${prev.z} air [] replace`); } catch {}
  }
  // place light_block level 15 at head height if air
  try {
    p.runCommand(`setblock ${x} ${y} ${z} light_block ["block_light_level"=15] keep`);
    lightPos.set(name, { x, y, z });
  } catch {
    try {
      p.runCommand(`setblock ${x} ${y} ${z} light_block 15 keep`);
      lightPos.set(name, { x, y, z });
    } catch {}
  }
}

// ---- offhand control items (3 hotbar buttons) ----
const BTN_SWAP = "blaze:offhand_swap";
const BTN_USE = "blaze:offhand_use";
const BTN_HIT = "blaze:offhand_hit";


function swapHands(p) {
  try {
    const inv = p.getComponent("minecraft:inventory")?.container;
    const eq = p.getComponent("minecraft:equippable");
    if (!inv || !eq) { tell(p, "§cCannot swap"); return; }
    const slot = typeof p.selectedSlotIndex === "number" ? p.selectedSlotIndex : 0;
    const main = inv.getItem(slot);
    const off = eq.getEquipment("Offhand");
    // Prevent swapping the control buttons into offhand messily — still allow
    eq.setEquipment("Offhand", main || undefined);
    inv.setItem(slot, off || undefined);
    tell(p, "§bSwapped main ↔ offhand");
  } catch (e) {
    tell(p, "§cSwap failed");
    console.warn("swap " + e);
  }
}

function offhandUse(p) {
  // Simulate "right click" with offhand item: place block if block, eat if food, else tip
  try {
    const off = getOffhandItem(p);
    if (!off) { tell(p, "§cOffhand empty"); return; }
    const id = off.typeId || "";
    const plain = id.replace("minecraft:", "");
    // food-ish
    if (plain.includes("apple") || plain.includes("beef") || plain.includes("pork") || plain.includes("bread") || plain.includes("carrot") || plain.includes("potato") || plain.includes("pie") || plain.includes("stew") || plain.includes("berry") || plain.includes("chorus") || plain.includes("golden")) {
      try {
        p.runCommand(`effect @s saturation 1 1 true`);
        p.runCommand(`effect @s regeneration 2 1 true`);
        // consume 1
        const eq = p.getComponent("minecraft:equippable");
        if (off.amount > 1) {
          off.amount -= 1;
          eq.setEquipment("Offhand", off);
        } else {
          eq.setEquipment("Offhand", undefined);
        }
        tell(p, "§aUsed offhand food");
      } catch { tell(p, "§eAte (effect)"); }
      return;
    }
    // shield
    if (plain === "shield") {
      try { p.runCommand("effect @s resistance 2 0 true"); tell(p, "§aOffhand shield guard"); } catch {}
      return;
    }
    // torch already handled by light system
    if (itemIsLight(id)) {
      tell(p, "§eOffhand light active (moves with you)");
      return;
    }
    // try place block in front
    try {
      const loc = p.location;
      const view = p.getViewDirection();
      const tx = Math.floor(loc.x + view.x * 2);
      const ty = Math.floor(loc.y + view.y * 2);
      const tz = Math.floor(loc.z + view.z * 2);
      p.runCommand(`setblock ${tx} ${ty} ${tz} ${plain} [] keep`);
      const eq = p.getComponent("minecraft:equippable");
      if (off.amount > 1) { off.amount -= 1; eq.setEquipment("Offhand", off); }
      else eq.setEquipment("Offhand", undefined);
      tell(p, "§aPlaced from offhand");
    } catch {
      tell(p, "§7Offhand use: " + plain + " (limited on Bedrock)");
    }
  } catch (e) { console.warn("off use " + e); }
}

function offhandHit(p) {
  try {
    const off = getOffhandItem(p);
    if (!off) { tell(p, "§cOffhand empty"); return; }
    const plain = (off.typeId || "").replace("minecraft:", "");
    // damage nearest mob in front
    try {
      p.runCommand(`damage @e[type=!player,r=3,c=1] 4 entity_attack entity @s`);
      tell(p, "§cOffhand strike (" + plain + ")");
    } catch {
      try {
        p.runCommand(`effect @e[type=!player,r=3,c=1] instant_damage 1 0 true`);
        tell(p, "§cOffhand hit");
      } catch { tell(p, "§7No target in range"); }
    }
  } catch (e) { console.warn("off hit " + e); }
}

function dropSelected(p) {
  try {
    const inv = p.getComponent("minecraft:inventory")?.container;
    if (!inv) { tell(p, "§cNo inventory"); return; }
    const slot = typeof p.selectedSlotIndex === "number" ? p.selectedSlotIndex : 0;
    const it = inv.getItem(slot);
    if (!it) { tell(p, "§cNothing to drop"); return; }
    const tid = it.typeId || "";
    if (tid.includes("blaze:phone") || tid.includes("blaze:offhand")) {
      tell(p, "§cCan't drop that");
      return;
    }
    const loc = p.location;
    let view = { x: 0, y: 0, z: 1 };
    try { view = p.getViewDirection(); } catch {}
    const spawn = {
      x: loc.x + (view.x || 0) * 1.5,
      y: loc.y + 1.0,
      z: loc.z + (view.z || 0) * 1.5
    };
    inv.setItem(slot, undefined);
    try {
      p.dimension.spawnItem(it, spawn);
      tell(p, "§eDropped");
    } catch (e) {
      // restore if spawn failed
      try { inv.setItem(slot, it); } catch {}
      tell(p, "§cDrop failed");
      console.warn("drop " + e);
    }
  } catch (e) {
    tell(p, "§cDrop error");
    console.warn("drop " + e);
  }
}

function openControlPad(p) {
  try {
    const off = getOffhandItem(p);
    const offName = off ? (off.typeId || "").replace("minecraft:", "") : "empty";
    new ActionFormData()
      .title("§6§lControl Pad")
      .body(
        "§7On-screen style controls (server UI)\\n" +
        "§7Offhand: §f" + offName + "\\n" +
        "§8Bedrock cannot attach custom script to vanilla HUD slots;\\n" +
        "§8these 4 buttons work the same on mobile/PC."
      )
      .button("§b§lSWAP\\n§7Main ↔ Offhand")
      .button("§a§lOFFHAND USE\\n§7Right-click offhand")
      .button("§c§lOFFHAND HIT\\n§7Left-click offhand")
      .button("§e§lDROP\\n§7Drop main-hand item")
      .button("§7Close")
      .show(p)
      .then((r) => {
        if (r.canceled || r.selection === 4) return;
        if (r.selection === 0) swapHands(p);
        else if (r.selection === 1) offhandUse(p);
        else if (r.selection === 2) offhandHit(p);
        else if (r.selection === 3) dropSelected(p);
        // re-open pad for rapid presses like on-screen buttons
        system.runTimeout(() => openControlPad(p), 5);
      })
      .catch(() => {});
  } catch (e) {
    tell(p, "§cControl pad failed");
    console.warn("pad " + e);
  }
}



const sneakPad = new Map();
system.runInterval(() => {
  try {
    for (const p of world.getPlayers()) {
      const sneaking = !!(p.isSneaking);
      if (sneaking) {
        const last = sneakPad.get(p.name) || 0;
        const now = Date.now();
        if (last && now - last < 400 && now - last > 50) {
          sneakPad.set(p.name, 0);
          openControlPad(p);
        } else if (!last || now - last > 500) {
          sneakPad.set(p.name, now);
        }
      }
    }
  } catch {}
}, 4);

system.runInterval(() => {
  try {
    for (const p of world.getPlayers()) {
      updateHeldLight(p);
    }
  } catch {}
}, 5);

// clear lights when player leaves handled in leave loop via clearPlayerLight


system.runTimeout(() => {
  try {
    ensureMoneyObj();
    loadClaims(); loadInv(); loadStats(); loadMail(); loadJobs(); loadWarps();
    try {
      const raw = dpGet("blaze_homes", null);
      if (raw) homes = new Map(Object.entries(raw));
    } catch {}
    console.warn("[Blaze] v20 hardened control pad + light");
    bc("§a§lBlaze OS v20 §7· server-side UI · §e!phone");
  } catch (e) { console.warn("[Blaze] init " + e); }
}, 40);
