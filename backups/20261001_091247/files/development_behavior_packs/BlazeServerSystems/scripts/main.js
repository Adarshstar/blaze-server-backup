import { world, system } from "@minecraft/server";
import { ActionFormData, ModalFormData, MessageFormData } from "@minecraft/server-ui";

const PREFIX = "!";
const MONEY = "money";
const PHONE = "blaze:phone";
const START_MONEY = 500;
const CLAIM_COST = 200;
const CLAIM_R = 12;
const MAX_CLAIMS = 5;
const VERSION = "v24-iron-kit";
const STARTER_SLOTS = 2; // next N unique joiners get full starter kit
const STARTER_KEY = "blaze_starter_given"; // list of player names who already got kit

let claims = new Map();
let homes = new Map();
let stats = new Map();
let sessionStart = new Map();
let known = new Set();
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
  } catch (_) { return fallback; }
}
function dpSet(key, val) {
  try { world.setDynamicProperty(key, JSON.stringify(val)); } catch (_) {}
}

function ckey(x, z) {
  return Math.floor(Number(x) / CLAIM_R) + ":" + Math.floor(Number(z) / CLAIM_R);
}
function canBuild(p, x, z) {
  try {
    if (isOp(p)) return true;
    const c = claims.get(ckey(x, z));
    if (!c) return true;
    if (c.owner === p.name) return true;
    if (Array.isArray(c.trusted) && c.trusted.includes(p.name)) return true;
    return false;
  } catch (_) { return true; }
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

/** Same starter package battlegaming375-style join gets */
function giveStarterKit(p) {
  try {
    ensureMoneyObj();
    setMoney(p, START_MONEY);
    givePhone(p);
    // Full iron armor + tools + shield + food + basics
    const cmds = [
      "give @s iron_helmet 1",
      "give @s iron_chestplate 1",
      "give @s iron_leggings 1",
      "give @s iron_boots 1",
      "give @s iron_sword 1",
      "give @s iron_pickaxe 1",
      "give @s iron_axe 1",
      "give @s iron_shovel 1",
      "give @s shield 1",
      "give @s bow 1",
      "give @s arrow 32",
      "give @s cooked_beef 16",
      "give @s bread 16",
      "give @s golden_apple 2",
      "give @s torch 64",
      "give @s oak_log 32",
      "give @s cobblestone 64",
      "give @s water_bucket 1",
      "give @s crafting_table 1",
      "give @s furnace 1",
      "give @s bed 1"
    ];
    for (const c of cmds) {
      try { p.runCommand(c); } catch (_) {}
    }
    tell(p, "§aFull iron starter kit! " + $n(START_MONEY) + " · armor · tools · shield · food");
  } catch (e) {
    console.warn("[Blaze] kit " + e);
  }
}

function tryGrantStarterSlot(p) {
  try {
    let given = dpGet(STARTER_KEY, []);
    if (!Array.isArray(given)) given = [];
    const name = p.name;
    // battlegaming375 already counted as first recipient conceptually
    const lower = given.map(x => String(x).toLowerCase());
    if (lower.includes(name.toLowerCase())) return false;
    if (name.toLowerCase() === "battlegaming375") {
      // record them as already received without re-giving dump if they rejoin
      if (!lower.includes("battlegaming375")) {
        given.push(name);
        dpSet(STARTER_KEY, given);
      }
      // still ensure phone + money baseline
      if (getMoney(p) <= 0) setMoney(p, START_MONEY);
      givePhone(p);
      return false;
    }
    if (given.length >= STARTER_SLOTS + 1) {
      // +1 for battlegaming375 slot; only STARTER_SLOTS more
      // Actually: user wants NEXT first 2 joining players after battlegaming375
      const others = given.filter(n => String(n).toLowerCase() !== "battlegaming375");
      if (others.length >= STARTER_SLOTS) return false;
    }
    const others = given.filter(n => String(n).toLowerCase() !== "battlegaming375");
    if (others.length >= STARTER_SLOTS) return false;
    giveStarterKit(p);
    given.push(name);
    dpSet(STARTER_KEY, given);
    bc("§e" + name + " §7got a starter kit (" + (others.length + 1) + "/" + STARTER_SLOTS + ")");
    return true;
  } catch (e) {
    console.warn("[Blaze] starter " + e);
    return false;
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
function isTorchStack(it) {
  if (!it) return false;
  const id = String(it.typeId || "").toLowerCase();
  return id === "minecraft:torch" || id.endsWith(":torch") || id.includes("torch");
}
function holdingTorch(p) {
  try {
    return isTorchStack(getMainHand(p)) || isTorchStack(getOffhand(p));
  } catch (_) { return false; }
}
function applyTorchLight(p) {
  try {
    if (!holdingTorch(p)) return;
    p.addEffect("night_vision", 60, { amplifier: 0, showParticles: false });
  } catch (_) {
    try { p.runCommand("effect @s night_vision 3 0 true"); } catch (_) {}
  }
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
  } catch (_) {
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

function openPhone(p) {
  try {
    const form = new ActionFormData()
      .title("§6Blaze Phone")
      .body("§f" + p.name + "\n§7" + $n(getMoney(p)) + "\n§8" + VERSION)
      .button("§aBalance")
      .button("§eShop")
      .button("§9Go Home")
      .button("§dClaim here")
      .button("§bSwap hands")
      .button("§6Help")
      .button("§8Close");
    form.show(p).then((r) => {
      if (r.canceled || r.selection === 6) return;
      if (r.selection === 0) tell(p, "Balance: " + $n(getMoney(p)));
      else if (r.selection === 1) openShop(p);
      else if (r.selection === 2) {
        const h = homes.get(p.name);
        if (h) { try { p.teleport(h); tell(p, "§aHome"); } catch (_) {} }
        else tell(p, "§cNo home — §e!sethome");
      } else if (r.selection === 3) {
        const k = ckey(p.location.x, p.location.z);
        if (claims.has(k)) tell(p, "§cOwned by " + claims.get(k).owner);
        else if (getMoney(p) < CLAIM_COST) tell(p, "§cNeed " + $n(CLAIM_COST));
        else {
          let n = 0;
          for (const cl of claims.values()) if (cl.owner === p.name) n++;
          if (n >= MAX_CLAIMS) { tell(p, "§cMax claims"); return; }
          addMoney(p, -CLAIM_COST);
          claims.set(k, { owner: p.name, x: Math.floor(p.location.x), z: Math.floor(p.location.z), trusted: [] });
          dpSet("blaze_claims", [...claims.entries()].map(([key, v]) => ({ ...v, key })));
          tell(p, "§aClaimed");
        }
      } else if (r.selection === 4) swapHands(p);
      else if (r.selection === 5) {
        tell(p, "§6!phone !money !pay !daily !claim !sethome !home !swap !drop");
        tell(p, "§7Chat works normally. Commands start with !");
      }
    }).catch(() => tell(p, "§cUI failed — try §e!money"));
  } catch (_) {
    tell(p, "§cPhone error");
  }
}

function openShop(p) {
  const items = [
    { id: "cooked_beef", n: "Beef x8", price: 12, amt: 8 },
    { id: "bread", n: "Bread x10", price: 8, amt: 10 },
    { id: "torch", n: "Torch x32", price: 8, amt: 32 },
    { id: "oak_log", n: "Oak Logs x16", price: 20, amt: 16 },
    { id: "iron_ingot", n: "Iron x4", price: 35, amt: 4 },
    { id: "diamond", n: "Diamond", price: 180, amt: 1 },
    { id: "ender_pearl", n: "Pearl x2", price: 55, amt: 2 },
    { id: "golden_apple", n: "GApple", price: 75, amt: 1 }
  ];
  const f = new ActionFormData().title("§eShop").body("Balance " + $n(getMoney(p)));
  for (const it of items) f.button("§f" + it.n + "\n§a$" + it.price);
  f.button("§7Back");
  f.show(p).then((r) => {
    if (r.canceled || r.selection === items.length) return openPhone(p);
    const it = items[r.selection];
    if (!it) return;
    if (getMoney(p) < it.price) { tell(p, "§cNot enough"); return openShop(p); }
    addMoney(p, -it.price);
    try { p.runCommand("give @s " + it.id + " " + it.amt); } catch (_) {}
    tell(p, "§aBought " + it.n);
    openShop(p);
  }).catch(() => {});
}

function isCommandMessage(msg) {
  if (!msg || typeof msg !== "string") return false;
  const t = msg.trim();
  if (!t.startsWith(PREFIX)) return false;
  const cmd = t.slice(PREFIX.length).trim().split(/\s+/)[0]?.toLowerCase() || "";
  const known = new Set([
    "phone","menu","money","bal","balance","pay","daily","claim",
    "sethome","home","spawn","pad","control","swap","drop","version","ver","help"
  ]);
  return known.has(cmd);
}

function cmd(p, msg) {
  try {
    if (!msg || typeof msg !== "string") return false;
    const t = msg.trim();
    if (!t.startsWith(PREFIX)) return false;
    const a = t.slice(PREFIX.length).trim().split(/\s+/);
    const c = (a[0] || "").toLowerCase();
    if (!c) return false;

    if (c === "phone" || c === "menu") { openPhone(p); return true; }
    if (c === "money" || c === "bal" || c === "balance") {
      tell(p, "Balance: " + $n(getMoney(p)));
      return true;
    }
    if (c === "pay") {
      const tplayer = getP(a[1]);
      const amt = parseInt(a[2], 10);
      if (!tplayer || !amt || amt <= 0) { tell(p, "§c!pay <player> <amt>"); return true; }
      if (getMoney(p) < amt) { tell(p, "§cNot enough"); return true; }
      addMoney(p, -amt);
      addMoney(tplayer, amt);
      tell(p, "§aPaid " + $n(amt));
      tell(tplayer, "§a+" + $n(amt) + " from " + p.name);
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
    if (c === "spawn" || c === "pad" || c === "control") {
      tell(p, "§cDisabled");
      return true;
    }
    if (c === "swap") { swapHands(p); return true; }
    if (c === "drop") { dropSelected(p); return true; }
    if (c === "version" || c === "ver") { tell(p, "§6Blaze OS " + VERSION); return true; }
    if (c === "help") {
      tell(p, "§6!phone !money !pay !daily !claim !sethome !home !swap !drop");
      tell(p, "§7Normal chat works — only !commands are special");
      return true;
    }
  } catch (e) {
    console.warn("[Blaze] cmd " + e);
  }
  return false;
}

// ---- events ----
safeSub(world.afterEvents, "playerSpawn", (ev) => {
  system.runTimeout(() => {
    try {
      const p = ev.player;
      if (!p) return;
      if (ev.initialSpawn) {
        ensureMoneyObj();
        // Starter kit for next 2 players (after battlegaming375 baseline)
        const gotKit = tryGrantStarterSlot(p);
        if (!gotKit) {
          if (getMoney(p) <= 0) setMoney(p, START_MONEY);
          givePhone(p);
          tell(p, "§aWelcome! " + $n(getMoney(p)) + " · §e!phone");
        }
        tell(p, "§7Chat is open — type normally. Commands use §e!");
      }
      const st = ensureStat(p.name);
      st.joins = (st.joins || 0) + 1;
      st.lastJoin = Date.now();
      st.lastName = p.name;
      sessionStart.set(p.name, Date.now());
      known.add(p.name);
    } catch (e) {
      console.warn("[Blaze] spawn " + e);
    }
  }, 20);
});

// CHAT: only cancel real !commands — never block normal messages
let chatBound = false;
chatBound = safeSub(world.beforeEvents, "chatSend", (ev) => {
  try {
    const msg = ev.message;
    if (!isCommandMessage(msg)) {
      // allow normal chat through — do not cancel
      return;
    }
    // Run command on next tick (beforeEvents is read-only for many APIs)
    const sender = ev.sender;
    const message = msg;
    try { ev.cancel = true; } catch (_) {}
    system.run(() => {
      try { cmd(sender, message); } catch (_) {}
    });
  } catch (_) {}
});
if (!chatBound) {
  chatBound = safeSub(world.afterEvents, "chatSend", (ev) => {
    try {
      const msg = ev.message;
      if (isCommandMessage(msg)) {
        system.run(() => {
          try { cmd(ev.sender, msg); } catch (_) {}
        });
      }
      // normal chat already delivered by game
    } catch (_) {}
  });
}
if (!chatBound) {
  console.warn("[Blaze] chat API missing — chat still works via vanilla; commands via phone");
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

system.runInterval(() => {
  try {
    for (const p of world.getPlayers()) applyTorchLight(p);
  } catch (_) {}
}, 15);

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
    // seed battlegaming375 as already having received baseline
    let given = dpGet(STARTER_KEY, []);
    if (!Array.isArray(given)) given = [];
    if (!given.map(x => String(x).toLowerCase()).includes("battlegaming375")) {
      given.push("battlegaming375");
      dpSet(STARTER_KEY, given);
    }
    console.warn("[Blaze] " + VERSION + " ready");
  } catch (e) {
    console.warn("[Blaze] boot " + e);
  }
}, 60);
