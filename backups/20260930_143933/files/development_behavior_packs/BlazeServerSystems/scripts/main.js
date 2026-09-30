import { world, system, ItemStack, EquipmentSlot } from "@minecraft/server";
import { ActionFormData, ModalFormData } from "@minecraft/server-ui";

const PREFIX = "!";
const STARTING_MONEY = 500;
const MONEY_OBJ = "money";
const CLAIM_COST = 200;
const CLAIM_RADIUS = 12;
const MAX_CLAIMS = 5;
const DAILY_REWARD = 100;
const REWARDS = { spleef: 150, sumo: 120, parkour: 100, bedwars: 250, tntrun: 130 };
const SPAWN = { x: 225, y: 64, z: 1233 };
const PHONE_ID = "blaze:phone";
const RANKS = {
  member: { tag: "rank_member", color: "§7", display: "Member" },
  vip: { tag: "rank_vip", color: "§a", display: "VIP" },
  mvp: { tag: "rank_mvp", color: "§b", display: "MVP" },
  admin: { tag: "rank_admin", color: "§c", display: "Admin" }
};
const SHOP = [
  { id: "cooked_beef", name: "Cooked Beef", price: 12, amount: 8 },
  { id: "bread", name: "Bread", price: 8, amount: 10 },
  { id: "golden_apple", name: "Golden Apple", price: 75, amount: 1 },
  { id: "torch", name: "Torches", price: 8, amount: 32 },
  { id: "oak_log", name: "Oak Logs", price: 20, amount: 16 },
  { id: "iron_ingot", name: "Iron Ingot", price: 35, amount: 4 },
  { id: "diamond", name: "Diamond", price: 180, amount: 1 },
  { id: "ender_pearl", name: "Ender Pearl", price: 55, amount: 2 },
  { id: "arrow", name: "Arrows", price: 18, amount: 16 },
  { id: "tnt", name: "TNT", price: 40, amount: 2 }
];

// Pending kits (given on next join if offline when requested)
const PENDING_KIT_NAMES = new Set(["adarshkumar1783"]); // exact name only, lowercase
const KIT_FLAG = "blaze_kit_adarsh_v2"; // one-time v2 after item loss

let claims = new Map();
const homes = new Map();
const lastDaily = new Map();
let playerStats = new Map();
let invSnapshots = new Map(); // name -> {slots:[], armor:{}, offhand, savedAt}
const sessionStart = new Map();
const knownOnline = new Set();
const spleefQ = new Set(), sumoQ = new Set(), parkourQ = new Set(), bedwarsQ = new Set(), tntrunQ = new Set();
let spleefOn = false, sumoOn = false, parkourOn = false, bedwarsOn = false, tntrunOn = false;
const bwTeams = { red: new Set(), blue: new Set() };
const bwBeds = { red: true, blue: true };
const bwAlive = new Set();
const SPLEEF = { x: 225, y: 78, z: 1233 };
const SUMO = { x: 240, y: 70, z: 1233 };
const PARKOUR = { x: 210, y: 70, z: 1233 };
const PARKOUR_END_Y = 85;
const BW_RED = { x: 200, y: 70, z: 1200 };
const BW_BLUE = { x: 250, y: 70, z: 1260 };
const BW_RED_BED = { x: 198, y: 70, z: 1200 };
const BW_BLUE_BED = { x: 252, y: 70, z: 1260 };
const TNTRUN = { x: 225, y: 90, z: 1233 };

function getScore(p, o) {
  try { const obj = world.scoreboard.getObjective(o); return obj ? (obj.getScore(p.scoreboardIdentity) ?? 0) : 0; } catch { return 0; }
}
function setScore(p, o, v) {
  try {
    let obj = world.scoreboard.getObjective(o);
    if (!obj) obj = world.scoreboard.addObjective(o, "Money");
    obj.setScore(p.scoreboardIdentity, Math.max(0, Math.floor(v)));
  } catch {}
}
function addScore(p, o, a) { setScore(p, o, getScore(p, o) + a); }
function money(n) { return "§a$" + Number(n).toLocaleString(); }
function tell(p, m) { try { p.sendMessage("§8[§6Blaze§8] §r" + m); } catch {} }
function broadcast(m) { try { world.sendMessage("§8[§6Blaze§8] §r" + m); } catch {} }
function isOp(p) { try { return p.isOp === true; } catch { return false; } }
function getP(n) { return [...world.getPlayers()].find(p => p.name.toLowerCase() === (n || "").toLowerCase()) || null; }
function getRank(p) {
  if (p.hasTag(RANKS.admin.tag) || isOp(p)) return RANKS.admin;
  if (p.hasTag(RANKS.mvp.tag)) return RANKS.mvp;
  if (p.hasTag(RANKS.vip.tag)) return RANKS.vip;
  return RANKS.member;
}
function setRank(p, k) {
  for (const r of Object.values(RANKS)) p.removeTag(r.tag);
  if (RANKS[k]) p.addTag(RANKS[k].tag);
}
function fmtTime(ms) {
  if (!ms || ms < 0) return "0m";
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
function fmtDate(ts) {
  if (!ts) return "never";
  try { return new Date(ts).toISOString().replace("T", " ").slice(0, 19) + " UTC"; } catch { return String(ts); }
}

// ====================== INVENTORY SYSTEM ======================
function readInventory(player) {
  const out = { slots: [], armor: {}, offhand: null, savedAt: Date.now(), name: player.name };
  try {
    const inv = player.getComponent("minecraft:inventory")?.container;
    if (inv) {
      for (let i = 0; i < inv.size; i++) {
        const it = inv.getItem(i);
        if (it) out.slots.push({ slot: i, id: it.typeId, amount: it.amount });
      }
    }
  } catch {}
  try {
    const eq = player.getComponent("minecraft:equippable");
    if (eq) {
      for (const slot of [EquipmentSlot.Head, EquipmentSlot.Chest, EquipmentSlot.Legs, EquipmentSlot.Feet, EquipmentSlot.Offhand]) {
        try {
          const it = eq.getEquipment(slot);
          if (it) {
            if (slot === EquipmentSlot.Offhand) out.offhand = { id: it.typeId, amount: it.amount };
            else out.armor[slot] = { id: it.typeId, amount: it.amount };
          }
        } catch {}
      }
    }
  } catch {}
  return out;
}

function saveInventorySnapshot(player) {
  try {
    const snap = readInventory(player);
    invSnapshots.set(player.name, snap);
    // persist lightly (cap size)
    const all = {};
    for (const [k, v] of invSnapshots) {
      all[k] = v;
    }
    // only keep last 30 players worth
    const keys = Object.keys(all);
    if (keys.length > 30) {
      for (const k of keys.slice(0, keys.length - 30)) delete all[k];
    }
    world.setDynamicProperty("blaze_inventories", JSON.stringify(all));
  } catch (e) {
    console.warn("inv save " + e);
  }
}

function loadInventories() {
  try {
    const raw = world.getDynamicProperty("blaze_inventories");
    if (!raw) return;
    const obj = JSON.parse(raw);
    invSnapshots = new Map();
    for (const [k, v] of Object.entries(obj)) invSnapshots.set(k, v);
    console.warn(`[Blaze] Loaded ${invSnapshots.size} inventory snapshots`);
  } catch {}
}

function showInventory(toPlayer, targetName) {
  const snap = invSnapshots.get(targetName) || invSnapshots.get(
    [...invSnapshots.keys()].find(k => k.toLowerCase() === targetName.toLowerCase())
  );
  if (!snap) {
    tell(toPlayer, `§cNo inventory snapshot for §e${targetName}`);
    tell(toPlayer, "§7Snapshots save while players are online.");
    return;
  }
  tell(toPlayer, `§6=== Inventory: §e${snap.name || targetName} §6===`);
  tell(toPlayer, `§7Saved: §f${fmtDate(snap.savedAt)}`);
  if (snap.armor && Object.keys(snap.armor).length) {
    tell(toPlayer, "§bArmor:");
    for (const [slot, it] of Object.entries(snap.armor)) {
      tell(toPlayer, `§8- §f${slot}: ${it.id} x${it.amount}`);
    }
  }
  if (snap.offhand) tell(toPlayer, `§bOffhand: §f${snap.offhand.id} x${snap.offhand.amount}`);
  const slots = snap.slots || [];
  tell(toPlayer, `§bHotbar/Inv (${slots.length} stacks):`);
  for (const it of slots.slice(0, 40)) {
    tell(toPlayer, `§8#${it.slot} §f${it.id} §7x${it.amount}`);
  }
  if (slots.length > 40) tell(toPlayer, `§7... +${slots.length - 40} more`);
}

// ====================== PERMANENT PHONE ======================
function hasPhone(player) {
  try {
    const inv = player.getComponent("minecraft:inventory")?.container;
    if (!inv) return false;
    for (let i = 0; i < inv.size; i++) {
      const it = inv.getItem(i);
      if (it && (it.typeId === PHONE_ID || it.typeId === "minecraft:recovery_compass")) return true;
    }
  } catch {}
  return false;
}

function ensurePhone(player) {
  if (hasPhone(player)) return;
  try {
    player.runCommand(`give @s ${PHONE_ID} 1`);
  } catch {
    try { player.runCommand("give @s recovery_compass 1"); } catch {}
  }
  tell(player, "§6Blaze Phone restored §7(permanent — kept after death)");
}

function playPhoneAnim(player) {
  // quick use + cutoff style feedback via camera shake / particles / sound-ish titles
  try {
    player.runCommand("camerashake add @s 0.05 0.15 rotational");
  } catch {}
  try {
    player.runCommand("particle minecraft:end_chest_particle ~~1~");
  } catch {}
  try {
    player.onScreenDisplay?.setActionBar("§6§lBlaze Phone §8• §7opening...");
  } catch {}
  system.runTimeout(() => {
    try { player.onScreenDisplay?.setActionBar("§8"); } catch {}
  }, 15);
}

// ====================== STATS ======================
function loadStats() {
  try {
    const raw = world.getDynamicProperty("blaze_player_stats");
    if (!raw) return;
    const obj = JSON.parse(raw);
    playerStats = new Map();
    for (const [k, v] of Object.entries(obj)) playerStats.set(k, v);
  } catch {}
}
function saveStats() {
  try {
    const obj = {};
    for (const [k, v] of playerStats) {
      obj[k] = { joins: v.joins || 0, totalMs: v.totalMs || 0, lastJoin: v.lastJoin || 0, lastLeave: v.lastLeave || 0, lastName: v.lastName || k, sessions: (v.sessions || []).slice(-20) };
    }
    world.setDynamicProperty("blaze_player_stats", JSON.stringify(obj));
  } catch {}
}
function ensureStat(name) {
  if (!playerStats.has(name)) playerStats.set(name, { joins: 0, totalMs: 0, lastJoin: 0, lastLeave: 0, lastName: name, sessions: [] });
  return playerStats.get(name);
}
function onJoinTrack(player) {
  const st = ensureStat(player.name);
  const now = Date.now();
  st.joins = (st.joins || 0) + 1;
  st.lastJoin = now;
  st.lastName = player.name;
  sessionStart.set(player.name, now);
  st.sessions = st.sessions || [];
  st.sessions.push({ join: now, leave: 0 });
  if (st.sessions.length > 20) st.sessions = st.sessions.slice(-20);
  saveStats();
  broadcast(`§a+ §e${player.name} §7joined §8(#${st.joins})`);
}
function onLeaveTrack(name) {
  const st = ensureStat(name);
  const now = Date.now();
  const start = sessionStart.get(name) || st.lastJoin || now;
  st.totalMs = (st.totalMs || 0) + Math.max(0, now - start);
  st.lastLeave = now;
  sessionStart.delete(name);
  if (st.sessions?.length) {
    const last = st.sessions[st.sessions.length - 1];
    if (last && !last.leave) last.leave = now;
  }
  saveStats();
  broadcast(`§c- §e${name} §7left §8(${fmtTime(now - start)})`);
}

function loadClaims() {
  try {
    const raw = world.getDynamicProperty("blaze_claims");
    if (!raw) return;
    claims = new Map();
    for (const c of JSON.parse(raw)) claims.set(c.key, { owner: c.owner, x: c.x, z: c.z, trusted: c.trusted || [] });
  } catch {}
}
function saveClaims() {
  try {
    const a = [];
    for (const [k, c] of claims) a.push({ key: k, owner: c.owner, x: c.x, z: c.z, trusted: c.trusted || [] });
    world.setDynamicProperty("blaze_claims", JSON.stringify(a));
  } catch {}
}
function loadHomes() {
  try {
    const raw = world.getDynamicProperty("blaze_homes");
    if (!raw) return;
    homes.clear();
    const o = JSON.parse(raw);
    for (const n of Object.keys(o)) homes.set(n, o[n]);
  } catch {}
}
function saveHomes() {
  try {
    const o = {}; for (const [n, h] of homes) o[n] = h;
    world.setDynamicProperty("blaze_homes", JSON.stringify(o));
  } catch {}
}
function cKey(x, z) { return `${Math.floor(x / CLAIM_RADIUS)},${Math.floor(z / CLAIM_RADIUS)}`; }
function getClaim(x, z) { return claims.get(cKey(x, z)) || null; }
function countClaims(n) { let c = 0; for (const x of claims.values()) if (x.owner === n) c++; return c; }
function canBuild(p, x, z) {
  if (isOp(p) || getRank(p) === RANKS.admin) return true;
  if (bedwarsOn && bwAlive.has(p.name)) return true;
  if (spleefOn && spleefQ.has(p.name)) return true;
  if (tntrunOn && tntrunQ.has(p.name)) return true;
  const c = getClaim(x, z);
  if (!c) return true;
  return c.owner === p.name || (c.trusted || []).includes(p.name);
}

// ====================== STARTER / PENDING KIT ======================
function giveFullKit(player) {
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
    try { player.runCommand(`give @s ${it}`); } catch {}
  }
  ensurePhone(player);
  // 1 real hour effects: regen10, strength20, haste50, speed3
  try { player.runCommand("effect @s regeneration 3600 9 true"); } catch {}
  try { player.runCommand("effect @s strength 3600 19 true"); } catch {}
  try { player.runCommand("effect @s haste 3600 49 true"); } catch {}
  try { player.runCommand("effect @s speed 3600 2 true"); } catch {}
  tell(player, "§a§lFull kit + 1h buffs! §7(iron, leaves x5 stacks, milk, water x2, diamonds, spawner)");
  saveInventorySnapshot(player);
}

function hasReceivedAdarshKit(player) {
  if (player.hasTag(KIT_FLAG)) return true;
  try {
    const raw = world.getDynamicProperty("blaze_kit_given");
    if (!raw) return false;
    const obj = JSON.parse(raw);
    return !!obj[player.name.toLowerCase()];
  } catch { return false; }
}
function markAdarshKitGiven(player) {
  player.addTag(KIT_FLAG);
  try {
    let obj = {};
    const raw = world.getDynamicProperty("blaze_kit_given");
    if (raw) obj = JSON.parse(raw);
    obj[player.name.toLowerCase()] = Date.now();
    world.setDynamicProperty("blaze_kit_given", JSON.stringify(obj));
  } catch {}
}
function maybePendingKit(player) {
  // ONLY exact player AdarshKumar1783 (case-insensitive), ONE TIME ever
  if (!PENDING_KIT_NAMES.has(player.name.toLowerCase())) return;
  if (hasReceivedAdarshKit(player)) return;
  markAdarshKitGiven(player);
  system.runTimeout(() => {
    giveFullKit(player);
    tell(player, "§aOne-time starter kit delivered (only once).");
  }, 40);
}

// ====================== UI ======================
function openPhone(player) {
  playPhoneAnim(player);
  const rank = getRank(player);
  const st = ensureStat(player.name);
  new ActionFormData()
    .title("§6§lBlaze Phone")
    .body(`§7${rank.color}${rank.display} §f${player.name}\n§7Money: ${money(getScore(player, MONEY_OBJ))}\n§7Playtime: ${fmtTime(st.totalMs)}\n§7Joins: ${st.joins}`)
    .button("§aWallet").button("§eShop").button("§bMessage")
    .button("§dClaims").button("§6Games").button("§9Homes")
    .button("§3Stats").button("§5Inventory").button("§8Close")
    .show(player).then(r => {
      if (r.canceled || r.selection === 8) return;
      if (r.selection === 0) openWallet(player);
      else if (r.selection === 1) openShop(player);
      else if (r.selection === 2) openMsg(player);
      else if (r.selection === 3) openClaims(player);
      else if (r.selection === 4) openGames(player);
      else if (r.selection === 5) openHomes(player);
      else if (r.selection === 6) showStats(player, player.name);
      else if (r.selection === 7) {
        saveInventorySnapshot(player);
        showInventory(player, player.name);
      }
    });
}
function openWallet(p) {
  new ActionFormData().title("§aWallet").button("§ePay").button("§bDaily").button("§6Top").button("§7Back")
    .show(p).then(r => {
      if (r.canceled || r.selection === 3) return openPhone(p);
      if (r.selection === 0) {
        new ModalFormData().title("Pay").textField("Player", "").textField("Amount", "100").show(p).then(res => {
          if (res.canceled) return;
          const t = getP(res.formValues[0]); const a = parseInt(res.formValues[1]);
          if (!t || isNaN(a) || a <= 0) return tell(p, "§cInvalid");
          if (getScore(p, MONEY_OBJ) < a) return tell(p, "§cNot enough");
          addScore(p, MONEY_OBJ, -a); addScore(t, MONEY_OBJ, a);
          tell(p, `§aPaid ${money(a)} → ${t.name}`); tell(t, `§a+${money(a)} from ${p.name}`);
        });
      } else if (r.selection === 1) doDaily(p);
      else if (r.selection === 2) {
        const top = [...world.getPlayers()].map(x => ({ n: x.name, m: getScore(x, MONEY_OBJ) })).sort((a, b) => b.m - a.m).slice(0, 5);
        tell(p, "§6=== Top ==="); top.forEach((e, i) => tell(p, `§e${i + 1}. ${e.n} ${money(e.m)}`));
      }
    });
}
function openShop(p) {
  const f = new ActionFormData().title("§eShop");
  for (const it of SHOP) f.button(`§f${it.name} x${it.amount}\n§a$${it.price}`);
  f.button("§7Back");
  f.show(p).then(r => {
    if (r.canceled || r.selection === SHOP.length) return openPhone(p);
    const it = SHOP[r.selection];
    if (getScore(p, MONEY_OBJ) < it.price) return tell(p, "§cNot enough");
    addScore(p, MONEY_OBJ, -it.price);
    try { p.runCommand(`give @s ${it.id} ${it.amount}`); tell(p, `§aBought ${it.name}`); }
    catch { addScore(p, MONEY_OBJ, it.price); }
  });
}
function openMsg(p) {
  new ModalFormData().title("§bMessage").textField("Player", "").textField("Message", "").show(p).then(r => {
    if (r.canceled) return;
    const t = getP(r.formValues[0]);
    if (!t) return tell(p, "§cOffline");
    tell(t, `§d✉ ${p.name}: §f${r.formValues[1]}`);
    tell(p, "§aSent");
  });
}
function openClaims(p) {
  new ActionFormData().title("§dClaims").button("§aClaim").button("§cUnclaim").button("§eList").button("§bTrust").button("§7Back")
    .show(p).then(r => {
      if (r.canceled || r.selection === 4) return openPhone(p);
      if (r.selection === 0) doClaim(p);
      else if (r.selection === 1) doUnclaim(p);
      else if (r.selection === 2) {
        let n = 0; for (const c of claims.values()) if (c.owner === p.name) { n++; tell(p, `§7• ${c.x},${c.z}`); }
        if (!n) tell(p, "§7No claims");
      } else if (r.selection === 3) {
        new ModalFormData().title("Trust").textField("Player", "").show(p).then(res => { if (!res.canceled) doTrust(p, res.formValues[0]); });
      }
    });
}
function openGames(p) {
  new ActionFormData().title("§6Games")
    .button("§eSpleef").button("§cSumo").button("§bParkour").button("§4BedWars").button("§6TNT Run")
    .button("§aStart Spleef").button("§aStart Sumo").button("§aStart Parkour").button("§aStart BW").button("§aStart TNT")
    .button("§7Back")
    .show(p).then(r => {
      if (r.canceled || r.selection === 10) return openPhone(p);
      if (r.selection === 0) toggleQ(spleefQ, p, "Spleef");
      else if (r.selection === 1) toggleQ(sumoQ, p, "Sumo");
      else if (r.selection === 2) toggleQ(parkourQ, p, "Parkour");
      else if (r.selection === 3) toggleQ(bedwarsQ, p, "BedWars");
      else if (r.selection === 4) toggleQ(tntrunQ, p, "TNT Run");
      else if (r.selection === 5 && isOp(p)) startSpleef();
      else if (r.selection === 6 && isOp(p)) startSumo();
      else if (r.selection === 7 && isOp(p)) startParkour();
      else if (r.selection === 8 && isOp(p)) startBedWars();
      else if (r.selection === 9 && isOp(p)) startTntRun();
    });
}
function openHomes(p) {
  new ActionFormData().title("§9Homes").button("§aSet Home").button("§eHome").button("§cSpawn").button("§7Back")
    .show(p).then(r => {
      if (r.canceled || r.selection === 3) return openPhone(p);
      if (r.selection === 0) { homes.set(p.name, { x: p.location.x, y: p.location.y, z: p.location.z }); saveHomes(); tell(p, "§aHome set"); }
      else if (r.selection === 1) { const h = homes.get(p.name); if (!h) return tell(p, "§cNo home"); try { p.teleport(h); } catch {} }
      else if (r.selection === 2) { try { p.teleport(SPAWN); } catch {} }
    });
}
function showStats(p, targetName) {
  const st = ensureStat(targetName);
  const key = [...playerStats.keys()].find(k => k.toLowerCase() === targetName.toLowerCase()) || targetName;
  const s = playerStats.get(key) || st;
  tell(p, `§6=== Stats: §e${s.lastName || targetName} §6===`);
  tell(p, `§7Joins: §f${s.joins} §7Playtime: §f${fmtTime(s.totalMs)}`);
  tell(p, `§7Last join: §f${fmtDate(s.lastJoin)}`);
  tell(p, `§7Last leave: §f${fmtDate(s.lastLeave)}`);
}
function showAllPlayers(p) {
  tell(p, `§6=== Players (${playerStats.size}) ===`);
  const arr = [...playerStats.entries()].sort((a, b) => (b[1].totalMs || 0) - (a[1].totalMs || 0));
  arr.slice(0, 15).forEach(([name, st], i) => {
    const on = sessionStart.has(name) ? "§a●" : "§8○";
    tell(p, `${on} §e${i + 1}. §f${st.lastName || name} §7j:${st.joins} ${fmtTime(st.totalMs)}`);
  });
}

function doClaim(p) {
  const key = cKey(p.location.x, p.location.z);
  if (claims.has(key)) return tell(p, `§cOwned by ${claims.get(key).owner}`);
  if (countClaims(p.name) >= MAX_CLAIMS) return tell(p, `§cMax ${MAX_CLAIMS}`);
  if (getScore(p, MONEY_OBJ) < CLAIM_COST) return tell(p, `§cNeed ${money(CLAIM_COST)}`);
  addScore(p, MONEY_OBJ, -CLAIM_COST);
  claims.set(key, { owner: p.name, x: Math.floor(p.location.x), z: Math.floor(p.location.z), trusted: [] });
  saveClaims(); tell(p, "§aClaimed");
}
function doUnclaim(p) {
  const key = cKey(p.location.x, p.location.z);
  const c = claims.get(key);
  if (!c) return tell(p, "§cNo claim");
  if (c.owner !== p.name && !isOp(p)) return tell(p, "§cNot yours");
  claims.delete(key); saveClaims(); tell(p, "§aUnclaimed");
}
function doTrust(p, name) {
  const c = getClaim(p.location.x, p.location.z);
  if (!c || c.owner !== p.name) return tell(p, "§cStand in claim");
  if (!c.trusted.includes(name)) c.trusted.push(name);
  saveClaims(); tell(p, `§aTrusted ${name}`);
}
function doDaily(p) {
  const now = Date.now();
  if (now - (lastDaily.get(p.name) || 0) < 20 * 3600 * 1000) return tell(p, "§cAlready claimed");
  lastDaily.set(p.name, now);
  addScore(p, MONEY_OBJ, DAILY_REWARD);
  tell(p, `§aDaily +${money(DAILY_REWARD)}`);
}
function toggleQ(set, p, name) {
  if (set.has(p.name)) { set.delete(p.name); tell(p, `§7Left ${name}`); }
  else { set.add(p.name); tell(p, `§aJoined ${name} (${set.size})`); }
}
function countdown(name, sec, fn) {
  broadcast(`§6${name} in ${sec}...`);
  let t = sec;
  const id = system.runInterval(() => {
    t--;
    if (t > 0) broadcast(`§e${t}...`);
    else { system.clearRun(id); broadcast("§aGO!"); fn(); }
  }, 20);
}
function startSpleef() {
  if (spleefOn || spleefQ.size < 1) return broadcast("§cNeed players");
  spleefOn = true;
  countdown("Spleef", 5, () => {
    for (const n of spleefQ) { const p = getP(n); if (p) try { p.teleport({ x: SPLEEF.x + Math.random() * 4 - 2, y: SPLEEF.y, z: SPLEEF.z + Math.random() * 4 - 2 }); } catch {} }
  });
}
function startSumo() {
  if (sumoOn || sumoQ.size < 1) return broadcast("§cNeed players");
  sumoOn = true;
  countdown("Sumo", 5, () => {
    for (const n of sumoQ) { const p = getP(n); if (p) try { p.teleport({ x: SUMO.x + Math.random() * 2 - 1, y: SUMO.y, z: SUMO.z + Math.random() * 2 - 1 }); } catch {} }
  });
}
function startParkour() {
  if (parkourOn || parkourQ.size < 1) return broadcast("§cNeed players");
  parkourOn = true;
  for (const n of parkourQ) { const p = getP(n); if (p) try { p.teleport(PARKOUR); } catch {} }
}
function startBedWars() {
  if (bedwarsOn || bedwarsQ.size < 2) return broadcast("§cNeed 2+");
  bedwarsOn = true; bwTeams.red.clear(); bwTeams.blue.clear(); bwAlive.clear(); bwBeds.red = true; bwBeds.blue = true;
  [...bedwarsQ].forEach((n, i) => { (i % 2 === 0 ? bwTeams.red : bwTeams.blue).add(n); bwAlive.add(n); });
  countdown("BedWars", 5, () => {
    for (const n of bwTeams.red) { const p = getP(n); if (p) try { p.teleport(BW_RED); p.runCommand("give @s wooden_sword 1"); } catch {} }
    for (const n of bwTeams.blue) { const p = getP(n); if (p) try { p.teleport(BW_BLUE); p.runCommand("give @s wooden_sword 1"); } catch {} }
  });
}
function startTntRun() {
  if (tntrunOn || tntrunQ.size < 1) return broadcast("§cNeed players");
  tntrunOn = true;
  countdown("TNT Run", 5, () => {
    for (const n of tntrunQ) { const p = getP(n); if (p) try { p.teleport({ x: TNTRUN.x + Math.random() * 6 - 3, y: TNTRUN.y, z: TNTRUN.z + Math.random() * 6 - 3 }); } catch {} }
  });
}
function endBW(team) {
  bedwarsOn = false;
  const winners = team === "red" ? bwTeams.red : bwTeams.blue;
  for (const n of winners) { const p = getP(n); if (p) { addScore(p, MONEY_OBJ, REWARDS.bedwars); try { p.teleport(SPAWN); } catch {} } }
  for (const n of bwAlive) { const p = getP(n); if (p && !winners.has(n)) try { p.teleport(SPAWN); } catch {} }
  broadcast(`§6${team.toUpperCase()} won BedWars!`);
  bwTeams.red.clear(); bwTeams.blue.clear(); bwAlive.clear(); bedwarsQ.clear();
}

function handleCmd(p, msg) {
  if (!msg.startsWith(PREFIX)) return false;
  const a = msg.slice(PREFIX.length).trim().split(/\s+/);
  const c = (a[0] || "").toLowerCase();
  if (["phone", "menu"].includes(c)) { openPhone(p); return true; }
  if (["money", "bal"].includes(c)) { tell(p, "Balance: " + money(getScore(p, MONEY_OBJ))); return true; }
  if (c === "pay") {
    const t = getP(a[1]); const amt = parseInt(a[2]);
    if (!t || isNaN(amt) || amt <= 0) { tell(p, "§c!pay <player> <amt>"); return true; }
    if (getScore(p, MONEY_OBJ) < amt) { tell(p, "§cNot enough"); return true; }
    addScore(p, MONEY_OBJ, -amt); addScore(t, MONEY_OBJ, amt);
    tell(p, `§aPaid ${money(amt)}`); tell(t, `§a+${money(amt)} from ${p.name}`); return true;
  }
  if (c === "daily") { doDaily(p); return true; }
  if (c === "claim") { doClaim(p); return true; }
  if (c === "unclaim") { doUnclaim(p); return true; }
  if (c === "trust") { if (a[1]) doTrust(p, a[1]); return true; }
  if (c === "spawn") { try { p.teleport(SPAWN); } catch {} return true; }
  if (c === "sethome") { homes.set(p.name, { x: p.location.x, y: p.location.y, z: p.location.z }); saveHomes(); tell(p, "§aHome set"); return true; }
  if (c === "home") { const h = homes.get(p.name); if (!h) { tell(p, "§cNo home"); return true; } try { p.teleport(h); } catch {} return true; }
  if (c === "players" || c === "plist") { showAllPlayers(p); return true; }
  if (c === "playtime" || c === "seen" || c === "stats") { showStats(p, a[1] || p.name); return true; }
  if (c === "inv" || c === "inventory") {
    const target = a[1] || p.name;
    if (a[1] && a[1].toLowerCase() !== p.name.toLowerCase() && !isOp(p)) {
      tell(p, "§cOnly ops can view others' inventory");
      return true;
    }
    const online = getP(target);
    if (online) saveInventorySnapshot(online);
    showInventory(p, online ? online.name : target);
    return true;
  }
  if (c === "saveinv" && isOp(p)) {
    for (const pl of world.getPlayers()) saveInventorySnapshot(pl);
    tell(p, "§aAll online inventories saved");
    return true;
  }
  if (c === "spleef") { if (a[1] === "start" && isOp(p)) startSpleef(); else toggleQ(spleefQ, p, "Spleef"); return true; }
  if (c === "sumo") { if (a[1] === "start" && isOp(p)) startSumo(); else toggleQ(sumoQ, p, "Sumo"); return true; }
  if (c === "parkour") { if (a[1] === "start" && isOp(p)) startParkour(); else toggleQ(parkourQ, p, "Parkour"); return true; }
  if (c === "bedwars" || c === "bw") { if (a[1] === "start" && isOp(p)) startBedWars(); else toggleQ(bedwarsQ, p, "BedWars"); return true; }
  if (c === "tntrun" || c === "tnt") { if (a[1] === "start" && isOp(p)) startTntRun(); else toggleQ(tntrunQ, p, "TNT Run"); return true; }
  if (c === "setrank" && isOp(p)) {
    const t = getP(a[1]); const r = (a[2] || "").toLowerCase();
    if (!t || !RANKS[r]) { tell(p, "§c!setrank <p> member|vip|mvp|admin"); return true; }
    setRank(t, r); tell(p, "§aOK"); return true;
  }
  if (c === "setmoney" && isOp(p)) {
    const t = getP(a[1]); const amt = parseInt(a[2]);
    if (!t || isNaN(amt)) return true;
    setScore(t, MONEY_OBJ, amt); tell(p, "§aOK"); return true;
  }
  if (c === "kit" && isOp(p)) {
    const t = getP(a[1] || p.name);
    if (!t) { tell(p, "§cPlayer offline"); return true; }
    giveFullKit(t); tell(p, "§aKit given"); return true;
  }
  
  if (c === "tpa") {
    const t = getP(a[1]);
    if (!t) { tell(p, "§c!tpa <player>"); return true; }
    t.addTag("tpa_from_" + p.name.replace(/[^a-zA-Z0-9]/g, "_"));
    tell(t, `§e${p.name} §7requests teleport. Type §a!tpaccept ${p.name}`);
    tell(p, `§aTPA sent to ${t.name}`);
    return true;
  }
  if (c === "tpaccept" || c === "tpyes") {
    const from = a[1];
    if (!from) { tell(p, "§c!tpaccept <player>"); return true; }
    const tag = "tpa_from_" + from.replace(/[^a-zA-Z0-9]/g, "_");
    if (!p.hasTag(tag)) { tell(p, "§cNo TPA from that player"); return true; }
    p.removeTag(tag);
    const t = getP(from);
    if (!t) { tell(p, "§cPlayer offline"); return true; }
    try { t.teleport(p.location); tell(t, "§aTeleported!"); tell(p, "§aAccepted TPA"); } catch { tell(p, "§cTP failed"); }
    return true;
  }
  if (c === "back") {
    const h = homes.get(p.name);
    if (h) try { p.teleport(h); tell(p, "§aBack to home"); } catch {}
    else tell(p, "§cNo home set — use !sethome");
    return true;
  }
  if (c === "msg" || c === "m" || c === "whisper") {
    const t = getP(a[1]);
    const text = a.slice(2).join(" ");
    if (!t || !text) { tell(p, "§c!msg <player> <text>"); return true; }
    tell(t, `§d✉ ${p.name}: §f${text}`);
    tell(p, `§a→ ${t.name}: §f${text}`);
    return true;
  }
  if (c === "online") {
    const list = [...world.getPlayers()].map(x => x.name);
    tell(p, `§aOnline (${list.length}): §f${list.join(", ") || "none"}`);
    return true;
  }

  if (c === "help") {
    tell(p, "§6!phone !money !pay !daily !claim !home !spawn");
    tell(p, "§6!players !playtime !inv [name] !seen");
    tell(p, "§6!spleef !sumo !parkour !bedwars !tntrun");
    tell(p, "§6!tpa !tpaccept !msg !online !back");
    return true;
  }
  return false;
}

// ====================== EVENTS ======================
world.afterEvents.playerSpawn.subscribe(ev => {
  system.runTimeout(() => {
    const p = ev.player;
    if (!world.scoreboard.getObjective(MONEY_OBJ)) world.scoreboard.addObjective(MONEY_OBJ, "Money");
    if (ev.initialSpawn) {
      if (!p.hasTag("blaze_joined")) {
        setScore(p, MONEY_OBJ, STARTING_MONEY);
        p.addTag("blaze_joined");
        setRank(p, "member");
        tell(p, `§aWelcome! ${money(STARTING_MONEY)} · §e!phone`);
      }
      onJoinTrack(p);
      maybePendingKit(p);
    }
    // Always restore phone after spawn/death
    ensurePhone(p);
    system.runTimeout(() => {
      ensurePhone(p);
      saveInventorySnapshot(p);
    }, 60);
  }, 25);
});

system.runInterval(() => {
  const now = new Set([...world.getPlayers()].map(p => p.name));
  for (const n of knownOnline) {
    if (!now.has(n)) {
      // try save inv was already done periodically
      onLeaveTrack(n);
    }
  }
  for (const n of now) knownOnline.add(n);
  for (const n of [...knownOnline]) if (!now.has(n)) knownOnline.delete(n);
}, 40);

// periodic inv snapshot + phone check (light)
system.runInterval(() => {
  for (const p of world.getPlayers()) {
    try {
      ensurePhone(p);
      saveInventorySnapshot(p);
    } catch {}
  }
}, 200); // every 10s

world.beforeEvents.chatSend.subscribe(ev => {
  if (handleCmd(ev.sender, ev.message)) ev.cancel = true;
});

world.afterEvents.itemUse.subscribe(ev => {
  try {
    const id = ev.itemStack?.typeId || "";
    if (id === PHONE_ID || id.includes("recovery_compass")) openPhone(ev.source);
  } catch {}
});

world.beforeEvents.playerBreakBlock.subscribe(ev => {
  const p = ev.player, loc = ev.block.location;
  if (bedwarsOn && bwAlive.has(p.name)) {
    const near = (a, b) => Math.abs(a.x - b.x) < 2 && Math.abs(a.z - b.z) < 2 && Math.abs(a.y - b.y) < 2;
    if (near(loc, BW_RED_BED) && bwTeams.blue.has(p.name) && bwBeds.red) {
      bwBeds.red = false; broadcast("§cRED BED destroyed by " + p.name);
    } else if (near(loc, BW_BLUE_BED) && bwTeams.red.has(p.name) && bwBeds.blue) {
      bwBeds.blue = false; broadcast("§9BLUE BED destroyed by " + p.name);
    } else if ((near(loc, BW_RED_BED) && bwTeams.red.has(p.name)) || (near(loc, BW_BLUE_BED) && bwTeams.blue.has(p.name))) {
      ev.cancel = true; return;
    }
  }
  if (!canBuild(p, loc.x, loc.z)) { ev.cancel = true; tell(p, `§cClaim: ${getClaim(loc.x, loc.z)?.owner}`); }
});
world.beforeEvents.playerPlaceBlock.subscribe(ev => {
  if (!canBuild(ev.player, ev.block.location.x, ev.block.location.z)) {
    ev.cancel = true; tell(ev.player, "§cClaimed");
  }
});

system.runInterval(() => {
  if (spleefOn) {
    for (const n of [...spleefQ]) {
      const p = getP(n);
      if (!p || p.location.y < SPLEEF.y - 6) {
        spleefQ.delete(n);
        if (p) try { p.teleport(SPAWN); } catch {}
        if (spleefQ.size <= 1) {
          spleefOn = false;
          const w = [...spleefQ][0];
          if (w) { const wp = getP(w); if (wp) addScore(wp, MONEY_OBJ, REWARDS.spleef); broadcast(`§6${w} won Spleef`); }
          spleefQ.clear();
        }
      }
    }
  }
  if (sumoOn) {
    for (const n of [...sumoQ]) {
      const p = getP(n);
      if (!p || p.location.y < SUMO.y - 4) {
        sumoQ.delete(n);
        if (p) try { p.teleport(SPAWN); } catch {}
        if (sumoQ.size <= 1) {
          sumoOn = false;
          const w = [...sumoQ][0];
          if (w) { const wp = getP(w); if (wp) addScore(wp, MONEY_OBJ, REWARDS.sumo); broadcast(`§6${w} won Sumo`); }
          sumoQ.clear();
        }
      }
    }
  }
  if (parkourOn) {
    for (const n of [...parkourQ]) {
      const p = getP(n);
      if (p && p.location.y >= PARKOUR_END_Y) {
        parkourQ.delete(n); addScore(p, MONEY_OBJ, REWARDS.parkour); try { p.teleport(SPAWN); } catch {}
        if (!parkourQ.size) parkourOn = false;
      }
    }
  }
  if (bedwarsOn) {
    for (const n of [...bwAlive]) {
      const p = getP(n);
      if (!p || p.location.y < 50) {
        const team = bwTeams.red.has(n) ? "red" : "blue";
        const bed = team === "red" ? bwBeds.red : bwBeds.blue;
        if (bed && p) try { p.teleport(team === "red" ? BW_RED : BW_BLUE); } catch {}
        else {
          bwAlive.delete(n);
          if (p) try { p.teleport(SPAWN); } catch {}
          if (![...bwAlive].filter(x => bwTeams.red.has(x)).length) endBW("blue");
          else if (![...bwAlive].filter(x => bwTeams.blue.has(x)).length) endBW("red");
        }
      }
    }
  }
  if (tntrunOn) {
    for (const n of [...tntrunQ]) {
      const p = getP(n);
      if (!p || p.location.y < TNTRUN.y - 8) {
        tntrunQ.delete(n);
        if (p) try { p.teleport(SPAWN); } catch {}
        if (tntrunQ.size <= 1) {
          tntrunOn = false;
          const w = [...tntrunQ][0];
          if (w) { const wp = getP(w); if (wp) addScore(wp, MONEY_OBJ, REWARDS.tntrun); broadcast(`§6${w} won TNT Run`); }
          tntrunQ.clear();
        }
      } else {
        try {
          const x = Math.floor(p.location.x), y = Math.floor(p.location.y) - 1, z = Math.floor(p.location.z);
          system.runTimeout(() => { try { p.dimension.runCommand(`setblock ${x} ${y} ${z} air`); } catch {} }, 15);
        } catch {}
      }
    }
  }
}, 20);

system.runTimeout(() => {
  if (!world.scoreboard.getObjective(MONEY_OBJ)) world.scoreboard.addObjective(MONEY_OBJ, "Money");
  loadClaims(); loadHomes(); loadStats(); loadInventories();
  // enable keepInventory for phone survival? we restore phone via script instead
  try { world.getDimension("overworld").runCommand("gamerule keepinventory false"); } catch {}
  console.warn("[Blaze] v9 inventory + permanent phone + RP");
  broadcast("§a§lBlaze v9 §7· inventory tracking · permanent phone · §e!inv §e!phone");
}, 60);
