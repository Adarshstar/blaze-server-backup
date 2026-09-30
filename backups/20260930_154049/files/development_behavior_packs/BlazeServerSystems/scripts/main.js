import { world, system } from "@minecraft/server";
import { ActionFormData, ModalFormData } from "@minecraft/server-ui";

const PREFIX = "!";
const MONEY = "money";
const PHONE = "blaze:phone";
const START_MONEY = 500;
const SPAWN = { x: 225, y: 64, z: 1233 };
const CLAIM_COST = 200;
const CLAIM_R = 12;
const MAX_CLAIMS = 5;

// One-time kit: ONLY AdarshKumar1783, flag v3 (force deliver once more after losses)
const KIT_NAME = "adarshkumar1783";
const KIT_FLAG = "blaze_kit_v3";

let claims = new Map();
let homes = new Map();
let invMap = new Map();
let stats = new Map();
let sessionStart = new Map();
let known = new Set();
const daily = new Map();

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
function $n(n) { return "§a$" + Number(n).toLocaleString(); }
function fmtMs(ms) {
  const s = Math.floor((ms || 0) / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}
function fmtDate(ts) {
  if (!ts) return "never";
  try { return new Date(ts).toISOString().replace("T", " ").slice(0, 19) + " UTC"; } catch { return "-"; }
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
    world.setDynamicProperty("blaze_inv", JSON.stringify(obj));
  } catch (e) { console.warn("saveInv " + e); }
}
function loadInv() {
  try {
    const raw = world.getDynamicProperty("blaze_inv");
    if (!raw) return;
    invMap = new Map(Object.entries(JSON.parse(raw)));
    console.warn("[Blaze] inv snapshots: " + invMap.size);
  } catch {}
}
function showInv(to, name) {
  const key = [...invMap.keys()].find(k => k.toLowerCase() === name.toLowerCase());
  const snap = key ? invMap.get(key) : null;
  if (!snap) { tell(to, "§cNo inventory snapshot for " + name); return; }
  tell(to, `§6Inventory §e${snap.name} §7${fmtDate(snap.savedAt)} ${snap.reason || ""}`);
  for (const [s, it] of Object.entries(snap.armor || {})) {
    tell(to, `§b${s}: §f${(it.id || "").replace("minecraft:", "")} x${it.amount}`);
  }
  let total = 0;
  for (const it of snap.slots || []) total += it.amount || 0;
  tell(to, `§7${(snap.slots || []).length} stacks, ${total} items`);
  for (const it of (snap.slots || []).slice(0, 30)) {
    tell(to, `§8#${it.slot} §f${(it.id || "").replace("minecraft:", "")} §7x${it.amount}`);
  }
}

// ---- phone permanent ----
function hasPhone(p) {
  try {
    const c = p.getComponent("minecraft:inventory")?.container;
    if (!c) return false;
    for (let i = 0; i < c.size; i++) {
      const it = c.getItem(i);
      if (it && (it.typeId === PHONE || it.typeId.includes("recovery_compass"))) return true;
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

// ---- Adarsh one-time kit ----
function kitGiven(p) {
  if (p.hasTag(KIT_FLAG)) return true;
  try {
    const raw = world.getDynamicProperty("blaze_kit_v3");
    if (!raw) return false;
    return !!JSON.parse(raw)[p.name.toLowerCase()];
  } catch { return false; }
}
function markKit(p) {
  p.addTag(KIT_FLAG);
  try {
    let o = {};
    const raw = world.getDynamicProperty("blaze_kit_v3");
    if (raw) o = JSON.parse(raw);
    o[p.name.toLowerCase()] = Date.now();
    world.setDynamicProperty("blaze_kit_v3", JSON.stringify(o));
  } catch {}
}
function giveAdarshKit(p) {
  const items = [
    "iron_helmet 1", "iron_chestplate 1", "iron_leggings 1", "iron_boots 1",
    "iron_sword 1", "iron_pickaxe 1", "iron_axe 1", "iron_shovel 1", "iron_hoe 1",
    "shield 1", "cooked_beef 32", "bread 16", "torch 64", "oak_log 32",
    "cobblestone 64", "coal 32", "iron_ingot 16", "bow 1", "arrow 32",
    "diamond 4", "mob_spawner 1", "zombie_spawn_egg 4",
    "oak_leaves 64", "oak_leaves 64", "oak_leaves 64", "oak_leaves 64", "oak_leaves 64",
    "milk_bucket 1", "water_bucket 1", "water_bucket 1"
  ];
  for (const it of items) {
    try { p.runCommand("give @s " + it); } catch {}
  }
  givePhone(p);
  try { p.runCommand("effect @s regeneration 3600 9 true"); } catch {}
  try { p.runCommand("effect @s strength 3600 19 true"); } catch {}
  try { p.runCommand("effect @s haste 3600 49 true"); } catch {}
  try { p.runCommand("effect @s speed 3600 2 true"); } catch {}
  saveInv(p, "kit");
  tell(p, "§a§lOne-time kit delivered! §7(gear, leaves, milk, water, diamonds, 1h buffs)");
}

function maybeKit(p) {
  if (p.name.toLowerCase() !== KIT_NAME) return;
  if (kitGiven(p)) return;
  markKit(p);
  system.runTimeout(() => giveAdarshKit(p), 40);
}

// ---- claims ----
function ckey(x, z) { return Math.floor(x / CLAIM_R) + "," + Math.floor(z / CLAIM_R); }
function loadClaims() {
  try {
    const raw = world.getDynamicProperty("blaze_claims");
    if (!raw) return;
    claims = new Map();
    for (const c of JSON.parse(raw)) claims.set(c.key, c);
  } catch {}
}
function saveClaims() {
  try {
    world.setDynamicProperty("blaze_claims", JSON.stringify([...claims.entries()].map(([k, v]) => ({ ...v, key: k }))));
  } catch {}
}
function canBuild(p, x, z) {
  if (isOp(p)) return true;
  const c = claims.get(ckey(x, z));
  if (!c) return true;
  return c.owner === p.name || (c.trusted || []).includes(p.name);
}

// ---- stats ----
function loadStats() {
  try {
    const raw = world.getDynamicProperty("blaze_stats");
    if (!raw) return;
    stats = new Map(Object.entries(JSON.parse(raw)));
  } catch {}
}
function saveStats() {
  try {
    const o = {};
    for (const [k, v] of stats) o[k] = v;
    world.setDynamicProperty("blaze_stats", JSON.stringify(o));
  } catch {}
}
function ensureStat(n) {
  if (!stats.has(n)) stats.set(n, { joins: 0, totalMs: 0, lastJoin: 0, lastLeave: 0, lastName: n, sessions: [] });
  return stats.get(n);
}

// ---- phone UI ----
function openPhone(p) {
  try {
    const st = ensureStat(p.name);
    new ActionFormData()
      .title("§6Blaze Phone")
      .body(`§f${p.name}\n§7Money: ${$n(getMoney(p))}\n§7Play: ${fmtMs(st.totalMs)}`)
      .button("§aBalance").button("§eShop").button("§dClaims")
      .button("§9Home").button("§3Inventory").button("§6Players")
      .button("§bHelp").button("§8Close")
      .show(p).then(r => {
        if (r.canceled || r.selection === 7) return;
        if (r.selection === 0) tell(p, "Balance: " + $n(getMoney(p)));
        else if (r.selection === 1) openShop(p);
        else if (r.selection === 2) {
          tell(p, "§e!claim §7stand in land · §e!unclaim · §e!trust <name>");
        } else if (r.selection === 3) {
          const h = homes.get(p.name);
          if (h) try { p.teleport(h); } catch {}
          else tell(p, "§cNo home — !sethome");
        } else if (r.selection === 4) {
          saveInv(p, "manual");
          showInv(p, p.name);
        } else if (r.selection === 5) {
          for (const [n, st] of [...stats.entries()].slice(0, 12)) {
            tell(p, `§e${st.lastName || n} §7j:${st.joins} ${fmtMs(st.totalMs)}`);
          }
        } else if (r.selection === 6) {
          tell(p, "§6!phone !money !pay !daily !claim !home !inv !players !sell");
        }
      });
  } catch (e) {
    tell(p, "§cPhone UI error — use §e!phone §ccommands: §e!money !inv !claim");
    console.warn("phone " + e);
  }
}

function openShop(p) {
  const items = [
    { id: "cooked_beef", n: "Beef", price: 12, amt: 8 },
    { id: "bread", n: "Bread", price: 8, amt: 10 },
    { id: "torch", n: "Torch", price: 8, amt: 32 },
    { id: "oak_log", n: "Logs", price: 20, amt: 16 },
    { id: "iron_ingot", n: "Iron", price: 35, amt: 4 },
    { id: "diamond", n: "Diamond", price: 180, amt: 1 }
  ];
  const f = new ActionFormData().title("§eShop");
  for (const it of items) f.button(`§f${it.n} x${it.amt}\n§a$${it.price}`);
  f.button("§7Back");
  f.show(p).then(r => {
    if (r.canceled || r.selection === items.length) return openPhone(p);
    const it = items[r.selection];
    if (getMoney(p) < it.price) return tell(p, "§cNot enough money");
    addMoney(p, -it.price);
    try { p.runCommand(`give @s ${it.id} ${it.amt}`); tell(p, "§aBought " + it.n); }
    catch { addMoney(p, it.price); }
  });
}

// ---- commands ----
function cmd(p, msg) {
  if (!msg.startsWith(PREFIX)) return false;
  const a = msg.slice(1).trim().split(/\s+/);
  const c = (a[0] || "").toLowerCase();

  if (c === "phone" || c === "menu") { openPhone(p); return true; }
  if (c === "money" || c === "bal") { tell(p, "Balance: " + $n(getMoney(p))); return true; }
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
    daily.set(p.name, now);
    addMoney(p, 100);
    tell(p, "§aDaily +" + $n(100));
    return true;
  }
  if (c === "claim") {
    const k = ckey(p.location.x, p.location.z);
    if (claims.has(k)) { tell(p, "§cOwned by " + claims.get(k).owner); return true; }
    let n = 0; for (const c of claims.values()) if (c.owner === p.name) n++;
    if (n >= MAX_CLAIMS) { tell(p, "§cMax claims"); return true; }
    if (getMoney(p) < CLAIM_COST) { tell(p, "§cNeed " + $n(CLAIM_COST)); return true; }
    addMoney(p, -CLAIM_COST);
    claims.set(k, { owner: p.name, x: Math.floor(p.location.x), z: Math.floor(p.location.z), trusted: [] });
    saveClaims();
    tell(p, "§aLand claimed");
    return true;
  }
  if (c === "unclaim") {
    const k = ckey(p.location.x, p.location.z);
    const cl = claims.get(k);
    if (!cl) { tell(p, "§cNo claim"); return true; }
    if (cl.owner !== p.name && !isOp(p)) { tell(p, "§cNot yours"); return true; }
    claims.delete(k); saveClaims(); tell(p, "§aUnclaimed");
    return true;
  }
  if (c === "trust") {
    const k = ckey(p.location.x, p.location.z);
    const cl = claims.get(k);
    if (!cl || cl.owner !== p.name) { tell(p, "§cStand in your claim"); return true; }
    if (a[1] && !(cl.trusted || []).includes(a[1])) {
      cl.trusted = cl.trusted || [];
      cl.trusted.push(a[1]);
      saveClaims();
      tell(p, "§aTrusted " + a[1]);
    }
    return true;
  }
  if (c === "sethome") {
    homes.set(p.name, { x: p.location.x, y: p.location.y, z: p.location.z });
    try {
      const o = {}; for (const [k, v] of homes) o[k] = v;
      world.setDynamicProperty("blaze_homes", JSON.stringify(o));
    } catch {}
    tell(p, "§aHome set");
    return true;
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
      tell(p, "§cOps only for others"); return true;
    }
    const online = getP(t);
    if (online) saveInv(online, "view");
    showInv(p, online ? online.name : t);
    return true;
  }
  if (c === "players" || c === "plist") {
    tell(p, "§6Players tracked: " + stats.size);
    for (const [n, st] of [...stats.entries()].slice(0, 15)) {
      const on = sessionStart.has(n) ? "§a●" : "§8○";
      tell(p, `${on} §f${st.lastName || n} §7j:${st.joins} ${fmtMs(st.totalMs)}`);
    }
    return true;
  }
  if (c === "playtime" || c === "stats" || c === "seen") {
    const n = a[1] || p.name;
    const key = [...stats.keys()].find(k => k.toLowerCase() === n.toLowerCase()) || n;
    const st = stats.get(key) || ensureStat(n);
    tell(p, `§e${st.lastName || n} §7joins:${st.joins} play:${fmtMs(st.totalMs)}`);
    tell(p, `§7Last join ${fmtDate(st.lastJoin)} leave ${fmtDate(st.lastLeave)}`);
    return true;
  }
  if (c === "sell") {
    const prices = { diamond: 50, iron_ingot: 8, gold_ingot: 12, coal: 2, oak_log: 3, cobblestone: 1 };
    const item = (a[1] || "").toLowerCase();
    const amt = Math.max(1, parseInt(a[2] || "1") || 1);
    if (!prices[item]) { tell(p, "§c!sell diamond|iron_ingot|gold_ingot|coal|oak_log|cobblestone <amt>"); return true; }
    try {
      p.runCommand(`clear @s ${item} 0 ${amt}`);
      addMoney(p, prices[item] * amt);
      tell(p, "§aSold for " + $n(prices[item] * amt));
    } catch { tell(p, "§cNot enough items"); }
    return true;
  }
  if (c === "tpa") {
    const t = getP(a[1]);
    if (!t) { tell(p, "§c!tpa <player>"); return true; }
    t.addTag("tpa_" + p.name.replace(/[^a-zA-Z0-9]/g, ""));
    tell(t, `§e${p.name} §7TPA — type §a!tpaccept ${p.name}`);
    tell(p, "§aRequest sent");
    return true;
  }
  if (c === "tpaccept") {
    const from = a[1];
    if (!from) { tell(p, "§c!tpaccept <player>"); return true; }
    const tag = "tpa_" + from.replace(/[^a-zA-Z0-9]/g, "");
    if (!p.hasTag(tag)) { tell(p, "§cNo request"); return true; }
    p.removeTag(tag);
    const t = getP(from);
    if (!t) { tell(p, "§cOffline"); return true; }
    try { t.teleport(p.location); } catch {}
    tell(p, "§aAccepted"); tell(t, "§aTeleported");
    return true;
  }
  if (c === "kit" && isOp(p)) {
    const t = getP(a[1] || p.name);
    if (!t) { tell(p, "§cOffline"); return true; }
    // ops can force kit for testing; Adarsh auto still one-time
    giveAdarshKit(t);
    tell(p, "§aKit given");
    return true;
  }
  if (c === "help") {
    tell(p, "§6!phone !money !pay !daily !claim !home !spawn");
    tell(p, "§6!inv !players !playtime !sell !tpa !tpaccept");
    return true;
  }
  return false;
}

// ---- events ----
world.afterEvents.playerSpawn.subscribe(ev => {
  system.runTimeout(() => {
    const p = ev.player;
    if (!world.scoreboard.getObjective(MONEY)) world.scoreboard.addObjective(MONEY, "Money");
    if (ev.initialSpawn) {
      if (!p.hasTag("blaze_joined")) {
        setMoney(p, START_MONEY);
        p.addTag("blaze_joined");
        tell(p, "§aWelcome! " + $n(START_MONEY) + " · type §e!phone");
      }
      const st = ensureStat(p.name);
      st.joins = (st.joins || 0) + 1;
      st.lastJoin = Date.now();
      st.lastName = p.name;
      sessionStart.set(p.name, Date.now());
      st.sessions = (st.sessions || []).slice(-19);
      st.sessions.push({ join: Date.now(), leave: 0 });
      saveStats();
      bc("§a+ §e" + p.name);
      maybeKit(p);
    }
    givePhone(p);
    system.runTimeout(() => { givePhone(p); saveInv(p, "spawn"); }, 50);
  }, 20);
});

system.runInterval(() => {
  const now = new Set([...world.getPlayers()].map(p => p.name));
  for (const n of known) {
    if (!now.has(n)) {
      const st = ensureStat(n);
      const start = sessionStart.get(n) || st.lastJoin || Date.now();
      st.totalMs = (st.totalMs || 0) + Math.max(0, Date.now() - start);
      st.lastLeave = Date.now();
      sessionStart.delete(n);
      saveStats();
      bc("§c- §e" + n);
    }
  }
  for (const n of now) known.add(n);
  for (const n of [...known]) if (!now.has(n)) known.delete(n);
}, 40);

system.runInterval(() => {
  for (const p of world.getPlayers()) {
    givePhone(p);
    saveInv(p, "auto");
  }
}, 200);

world.beforeEvents.chatSend.subscribe(ev => {
  if (cmd(ev.sender, ev.message)) ev.cancel = true;
});

world.afterEvents.itemUse.subscribe(ev => {
  try {
    const id = (ev.itemStack?.typeId || "").toLowerCase();
    if (id === PHONE || id.includes("phone") || id.includes("recovery_compass")) {
      openPhone(ev.source);
    }
  } catch (e) { console.warn("itemUse " + e); }
});

try {
  world.afterEvents.entityDie.subscribe(ev => {
    try {
      if (ev.deadEntity?.typeId !== "minecraft:player") return;
      const p = getP(ev.deadEntity.nameTag || ev.deadEntity.name);
      if (p) saveInv(p, "death");
    } catch {}
  });
} catch {}

world.beforeEvents.playerBreakBlock.subscribe(ev => {
  if (!canBuild(ev.player, ev.block.location.x, ev.block.location.z)) {
    ev.cancel = true;
    tell(ev.player, "§cClaimed land");
  }
});
world.beforeEvents.playerPlaceBlock.subscribe(ev => {
  if (!canBuild(ev.player, ev.block.location.x, ev.block.location.z)) {
    ev.cancel = true;
    tell(ev.player, "§cClaimed land");
  }
});

system.runTimeout(() => {
  if (!world.scoreboard.getObjective(MONEY)) world.scoreboard.addObjective(MONEY, "Money");
  loadClaims(); loadInv(); loadStats();
  try {
    const raw = world.getDynamicProperty("blaze_homes");
    if (raw) homes = new Map(Object.entries(JSON.parse(raw)));
  } catch {}
  console.warn("[Blaze] v14 clean fixed loaded");
  bc("§a§lBlaze v14 §7fixed · §e!phone §7· §e!inv §7· §e!help");
}, 40);
