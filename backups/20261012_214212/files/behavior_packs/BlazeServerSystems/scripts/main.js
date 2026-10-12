import { world, system } from "@minecraft/server";
import { ActionFormData, ModalFormData, MessageFormData } from "@minecraft/server-ui";

const PREFIX = "!";
const MONEY = "money";
const PHONE = "blaze:phone";
const START_MONEY = 500;
const SPAWN = { x: 225, y: 64, z: 1233 };
const CLAIM_COST = 200;
const CLAIM_R = 12;
const MAX_CLAIMS = 5;
const VERSION = "v21-safe";

let claims = new Map();
let homes = new Map();
let invMap = new Map();
let stats = new Map();
let sessionStart = new Map();
let known = new Set();
let mail = new Map();
let jobs = new Map();
let warps = new Map();
const daily = new Map();
let booted = false;

function tell(p, m) {
  try { p.sendMessage("§8[§6Blaze§8] §r" + m); } catch (_) {}
}
function bc(m) {
  try { world.sendMessage("§8[§6Blaze§8] §r" + m); } catch (_) {}
}
function isOp(p) {
  try { return p.isOp === true; } catch (_) { return false; }
}
function getP(n) {
  try {
    return [...world.getPlayers()].find(p => p.name.toLowerCase() === String(n || "").toLowerCase()) || null;
  } catch (_) { return null; }
}
function ensureMoneyObj() {
  try {
    if (!world.scoreboard.getObjective(MONEY)) {
      world.scoreboard.addObjective(MONEY, "Money");
    }
  } catch (_) {}
}
function getMoney(p) {
  try {
    ensureMoneyObj();
    const o = world.scoreboard.getObjective(MONEY);
    if (!o || !p.scoreboardIdentity) return 0;
    return o.getScore(p.scoreboardIdentity) ?? 0;
  } catch (_) { return 0; }
}
function setMoney(p, v) {
  try {
    ensureMoneyObj();
    const o = world.scoreboard.getObjective(MONEY);
    if (!o || !p.scoreboardIdentity) return;
    o.setScore(p.scoreboardIdentity, Math.max(0, Math.floor(Number(v) || 0)));
  } catch (_) {}
}
function addMoney(p, a) {
  setMoney(p, getMoney(p) + (Number(a) || 0));
}
function $n(n) { return "§a$" + Number(n || 0).toLocaleString(); }
function fmtMs(ms) {
  const s = Math.floor((ms || 0) / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}

function safeSub(obj, name, handler) {
  try {
    const ev = obj && obj[name];
    if (ev && typeof ev.subscribe === "function") {
      ev.subscribe(handler);
      console.warn("[Blaze] OK " + name);
      return true;
    }
    console.warn("[Blaze] SKIP " + name);
  } catch (e) {
    console.warn("[Blaze] FAIL " + name + " " + e);
  }
  return false;
}

function dpGet(key, fallback) {
  try {
    const raw = world.getDynamicProperty(key);
    if (raw === undefined || raw === null || raw === "") return fallback;
    return JSON.parse(String(raw));
  } catch (_) {
    return fallback;
  }
}
function dpSet(key, val) {
  try {
    const str = JSON.stringify(val);
    if (str.length > 9000) {
      console.warn("[Blaze] skip large dp " + key + " " + str.length);
      return;
    }
    world.setDynamicProperty(key, str);
  } catch (e) {
    console.warn("[Blaze] dpSet " + key + " " + e);
  }
}

function ckey(x, z) {
  return Math.floor(x / CLAIM_R) + "," + Math.floor(z / CLAIM_R);
}
function canBuild(p, x, z) {
  if (isOp(p)) return true;
  const c = claims.get(ckey(x, z));
  if (!c) return true;
  return c.owner === p.name || (c.trusted || []).includes(p.name);
}

function ensureStat(n) {
  if (!stats.has(n)) {
    stats.set(n, { joins: 0, totalMs: 0, lastJoin: 0, lastLeave: 0, lastName: n });
  }
  return stats.get(n);
}

function hasPhone(p) {
  try {
    const c = p.getComponent("minecraft:inventory")?.container;
    if (!c) return false;
    for (let i = 0; i < c.size; i++) {
      const it = c.getItem(i);
      if (it && (it.typeId === PHONE || String(it.typeId).includes("recovery_compass"))) return true;
    }
  } catch (_) {}
  return false;
}
function givePhone(p) {
  if (hasPhone(p)) return;
  try { p.runCommand("give @s " + PHONE + " 1"); } catch (_) {
    try { p.runCommand("give @s recovery_compass 1"); } catch (_) {}
  }
}

function getMainHand(p) {
  try {
    const inv = p.getComponent("minecraft:inventory")?.container;
    if (!inv) return null;
    const slot = typeof p.selectedSlotIndex === "number" ? p.selectedSlotIndex : 0;
    return inv.getItem(slot) || null;
  } catch (_) { return null; }
}
function getOffhand(p) {
  try {
    return p.getComponent("minecraft:equippable")?.getEquipment("Offhand") || null;
  } catch (_) { return null; }
}

function swapHands(p) {
  try {
    const inv = p.getComponent("minecraft:inventory")?.container;
    const eq = p.getComponent("minecraft:equippable");
    if (!inv || !eq) { tell(p, "§cCannot swap"); return; }
    const slot = typeof p.selectedSlotIndex === "number" ? p.selectedSlotIndex : 0;
    const main = inv.getItem(slot);
    const off = eq.getEquipment("Offhand");
    eq.setEquipment("Offhand", main || undefined);
    inv.setItem(slot, off || undefined);
    tell(p, "§bSwapped hands");
  } catch (e) {
    tell(p, "§cSwap failed");
  }
}

function dropSelected(p) {
  try {
    const inv = p.getComponent("minecraft:inventory")?.container;
    if (!inv) return;
    const slot = typeof p.selectedSlotIndex === "number" ? p.selectedSlotIndex : 0;
    const it = inv.getItem(slot);
    if (!it) { tell(p, "§cNothing to drop"); return; }
    if (String(it.typeId).includes("blaze:phone")) { tell(p, "§cCan't drop phone"); return; }
    const loc = p.location;
    let view = { x: 0, y: 0, z: 1 };
    try { view = p.getViewDirection(); } catch (_) {}
    inv.setItem(slot, undefined);
    try {
      p.dimension.spawnItem(it, {
        x: loc.x + view.x * 1.5,
        y: loc.y + 1,
        z: loc.z + view.z * 1.5
      });
      tell(p, "§eDropped");
    } catch (_) {
      try { inv.setItem(slot, it); } catch (_) {}
      tell(p, "§cDrop failed");
    }
  } catch (_) {
    tell(p, "§cDrop error");
  }
}

function openControlPad(p) {
  try {
    const form = new ActionFormData()
      .title("§6Control Pad")
      .body("§7SWAP · USE · HIT · DROP")
      .button("§bSWAP")
      .button("§aOFFHAND USE")
      .button("§cOFFHAND HIT")
      .button("§eDROP")
      .button("§7Close");
    form.show(p).then((r) => {
      if (r.canceled || r.selection === 4) return;
      if (r.selection === 0) swapHands(p);
      else if (r.selection === 1) tell(p, "§7Offhand use: hold item in offhand");
      else if (r.selection === 2) {
        try { p.runCommand("damage @e[type=!player,r=3,c=1] 3 entity_attack entity @s"); } catch (_) {}
        tell(p, "§cOffhand hit");
      } else if (r.selection === 3) dropSelected(p);
    }).catch(() => {});
  } catch (_) {
    tell(p, "§cPad failed");
  }
}

function openPhone(p) {
  try {
    const form = new ActionFormData()
      .title("§6Blaze Phone")
      .body("§f" + p.name + "\n§7" + $n(getMoney(p)) + "\n§8" + VERSION)
      .button("§aBalance")
      .button("§eShop")
      .button("§bControl Pad")
      .button("§9Home / Spawn")
      .button("§dClaim here")
      .button("§6Help")
      .button("§8Close");
    form.show(p).then((r) => {
      if (r.canceled || r.selection === 6) return;
      if (r.selection === 0) tell(p, "Balance: " + $n(getMoney(p)));
      else if (r.selection === 1) openShop(p);
      else if (r.selection === 2) openControlPad(p);
      else if (r.selection === 3) {
        const h = homes.get(p.name);
        if (h) try { p.teleport(h); } catch (_) {}
        else try { p.teleport(SPAWN); } catch (_) {}
      } else if (r.selection === 4) {
        const k = ckey(p.location.x, p.location.z);
        if (claims.has(k)) tell(p, "§cOwned by " + claims.get(k).owner);
        else if (getMoney(p) < CLAIM_COST) tell(p, "§cNeed " + $n(CLAIM_COST));
        else {
          addMoney(p, -CLAIM_COST);
          claims.set(k, { owner: p.name, x: Math.floor(p.location.x), z: Math.floor(p.location.z), trusted: [] });
          dpSet("blaze_claims", [...claims.entries()].map(([key, v]) => ({ ...v, key })));
          tell(p, "§aClaimed");
        }
      } else if (r.selection === 5) {
        tell(p, "§6!phone !pad !money !pay !daily !claim !home !spawn !help");
      }
    }).catch(() => {
      tell(p, "§cUI failed — try §e!money");
    });
  } catch (_) {
    tell(p, "§cPhone error");
  }
}

function openShop(p) {
  const items = [
    { id: "cooked_beef", n: "Beef x8", price: 12, amt: 8 },
    { id: "bread", n: "Bread x10", price: 8, amt: 10 },
    { id: "torch", n: "Torch x32", price: 8, amt: 32 },
    { id: "oak_log", n: "Logs x16", price: 20, amt: 16 },
    { id: "iron_ingot", n: "Iron x4", price: 35, amt: 4 }
  ];
  const f = new ActionFormData().title("§eShop").body("Balance " + $n(getMoney(p)));
  for (const it of items) f.button("§f" + it.n + "\n§a$" + it.price);
  f.button("§7Back");
  f.show(p).then((r) => {
    if (r.canceled || r.selection === items.length) return openPhone(p);
    const it = items[r.selection];
    if (getMoney(p) < it.price) { tell(p, "§cNot enough"); return openShop(p); }
    addMoney(p, -it.price);
    try {
      p.runCommand("give @s " + it.id + " " + it.amt);
      tell(p, "§aBought " + it.n);
    } catch (_) {
      addMoney(p, it.price);
      tell(p, "§cBuy failed");
    }
    openShop(p);
  }).catch(() => {});
}

function cmd(p, msg) {
  if (!msg || msg.charAt(0) !== PREFIX) return false;
  const a = msg.slice(1).trim().split(/\s+/);
  const c = (a[0] || "").toLowerCase();
  try {
    if (c === "phone" || c === "menu") { openPhone(p); return true; }
    if (c === "pad" || c === "controls") { openControlPad(p); return true; }
    if (c === "money" || c === "bal" || c === "balance") { tell(p, "Balance: " + $n(getMoney(p))); return true; }
    if (c === "pay") {
      const t = getP(a[1]);
      const amt = parseInt(a[2], 10);
      if (!t || !amt || amt <= 0) { tell(p, "§c!pay <player> <amt>"); return true; }
      if (getMoney(p) < amt) { tell(p, "§cNot enough"); return true; }
      addMoney(p, -amt);
      addMoney(t, amt);
      tell(p, "§aPaid " + $n(amt));
      tell(t, "§a+" + $n(amt) + " from " + p.name);
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
      let n = 0;
      for (const cl of claims.values()) if (cl.owner === p.name) n++;
      if (n >= MAX_CLAIMS) { tell(p, "§cMax claims"); return true; }
      if (getMoney(p) < CLAIM_COST) { tell(p, "§cNeed " + $n(CLAIM_COST)); return true; }
      addMoney(p, -CLAIM_COST);
      claims.set(k, { owner: p.name, x: Math.floor(p.location.x), z: Math.floor(p.location.z), trusted: [] });
      dpSet("blaze_claims", [...claims.entries()].map(([key, v]) => ({ ...v, key })));
      tell(p, "§aClaimed");
      return true;
    }
    if (c === "sethome") {
      homes.set(p.name, { x: p.location.x, y: p.location.y, z: p.location.z });
      const o = {};
      for (const [k, v] of homes) o[k] = v;
      dpSet("blaze_homes", o);
      tell(p, "§aHome set");
      return true;
    }
    if (c === "home") {
      const h = homes.get(p.name);
      if (!h) { tell(p, "§cNo home — !sethome"); return true; }
      try { p.teleport(h); } catch (_) {}
      return true;
    }
    if (c === "spawn") { try { p.teleport(SPAWN); } catch (_) {} return true; }
    if (c === "swap") { swapHands(p); return true; }
    if (c === "drop") { dropSelected(p); return true; }
    if (c === "version" || c === "ver") { tell(p, "§6Blaze OS " + VERSION); return true; }
    if (c === "help") {
      tell(p, "§6!phone !pad !money !pay !daily !claim !sethome !home !spawn !swap !drop");
      return true;
    }
  } catch (e) {
    console.warn("[Blaze] cmd " + e);
  }
  return false;
}

// ---- events (once each) ----
safeSub(world.afterEvents, "playerSpawn", (ev) => {
  system.runTimeout(() => {
    try {
      const p = ev.player;
      if (!p) return;
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
        try {
          const o = {};
          for (const [k, v] of stats) o[k] = v;
          dpSet("blaze_stats", o);
        } catch (_) {}
        bc("§a+ §e" + p.name);
      }
      givePhone(p);
    } catch (e) {
      console.warn("[Blaze] spawn " + e);
    }
  }, 20);
});

// Chat: try several APIs (chatSend often missing without beta)
let chatBound = safeSub(world.beforeEvents, "chatSend", (ev) => {
  try {
    if (cmd(ev.sender, ev.message)) ev.cancel = true;
  } catch (_) {}
});
if (!chatBound) {
  chatBound = safeSub(world.afterEvents, "chatSend", (ev) => {
    try { cmd(ev.sender, ev.message); } catch (_) {}
  });
}
if (!chatBound) {
  console.warn("[Blaze] no chat event — use phone item / forms only");
}

safeSub(world.afterEvents, "itemUse", (ev) => {
  try {
    const id = String((ev.itemStack && ev.itemStack.typeId) || "").toLowerCase();
    if (id === PHONE || id.includes("phone") || id.includes("recovery_compass")) {
      openPhone(ev.source);
    }
  } catch (_) {}
});

safeSub(world.beforeEvents, "playerBreakBlock", (ev) => {
  try {
    if (!canBuild(ev.player, ev.block.location.x, ev.block.location.z)) {
      ev.cancel = true;
      tell(ev.player, "§cClaimed land");
    }
  } catch (_) {}
});

safeSub(world.beforeEvents, "playerPlaceBlock", (ev) => {
  try {
    if (!canBuild(ev.player, ev.block.location.x, ev.block.location.z)) {
      ev.cancel = true;
      tell(ev.player, "§cClaimed land");
    }
  } catch (_) {}
});

// leave tracking — light interval only
system.runInterval(() => {
  try {
    const now = new Set();
    for (const p of world.getPlayers()) now.add(p.name);
    for (const n of known) {
      if (!now.has(n)) {
        const st = ensureStat(n);
        const start = sessionStart.get(n) || st.lastJoin || Date.now();
        st.totalMs = (st.totalMs || 0) + Math.max(0, Date.now() - start);
        st.lastLeave = Date.now();
        sessionStart.delete(n);
        known.delete(n);
        bc("§c- §e" + n);
      }
    }
    for (const n of now) known.add(n);
  } catch (_) {}
}, 100);

// ONE-TIME light boot — no recursive init
system.runTimeout(() => {
  if (booted) return;
  booted = true;
  try {
    ensureMoneyObj();
    const cl = dpGet("blaze_claims", []);
    if (Array.isArray(cl)) {
      claims = new Map();
      for (const c of cl) {
        if (c && c.key) claims.set(c.key, c);
      }
    }
    const hm = dpGet("blaze_homes", null);
    if (hm && typeof hm === "object") homes = new Map(Object.entries(hm));
    const st = dpGet("blaze_stats", null);
    if (st && typeof st === "object") stats = new Map(Object.entries(st));
    console.warn("[Blaze] " + VERSION + " ready");
  } catch (e) {
    console.warn("[Blaze] boot " + e);
  }
}, 60);
