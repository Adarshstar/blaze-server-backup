import { world, system } from "@minecraft/server";
import { ActionFormData, ModalFormData, MessageFormData } from "@minecraft/server-ui";

const PREFIX = "!";
const MONEY = "money";
const PHONE = "blaze:phone";
const START_MONEY = 500;
const CLAIM_COST = 200;
const CLAIM_R = 12;
const MAX_CLAIMS = 5;
const VERSION = "v26-fast-cmd";
const STARTER_SLOTS = 2;
const STARTER_KEY = "blaze_starter_given";
const ADARSH = "adarshkumar1783";
const ADARSH_KEY = "blaze_adarsh_horses";

let claims = new Map();
let homes = new Map();
let stats = new Map();
let sessionStart = new Map();
let known = new Set();
const daily = new Map();
let booted = false;
const torchLightPos = new Map();
const playEarnTick = new Map();

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
    if (!world.scoreboard.getObjective(MONEY)) world.scoreboard.addObjective(MONEY, "Money");
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
function addMoney(p, a) { setMoney(p, getMoney(p) + (Number(a) || 0)); }
function $n(n) { return "§a$" + Number(n || 0).toLocaleString(); }

function safeSub(obj, name, handler) {
  try {
    const ev = obj && obj[name];
    if (ev && typeof ev.subscribe === "function") {
      ev.subscribe(handler);
      console.warn("[Blaze] OK " + name);
      return true;
    }
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
  if (!stats.has(n)) stats.set(n, { joins: 0, totalMs: 0, lastJoin: 0, lastLeave: 0, lastName: n });
  return stats.get(n);
}

function hasPhone(p) {
  try {
    const c = p.getComponent("minecraft:inventory")?.container;
    if (!c) return false;
    for (let i = 0; i < c.size; i++) {
      const it = c.getItem(i);
      if (it && (it.typeId === PHONE || String(it.typeId).includes("recovery_compass") || String(it.typeId).includes("phone"))) return true;
    }
  } catch (_) {}
  return false;
}

function givePhone(p) {
  try {
    if (hasPhone(p)) return;
    try { p.runCommand("give @s " + PHONE + " 1"); } catch (_) {
      try { p.runCommand("give @s recovery_compass 1"); } catch (_) {}
    }
    tell(p, "§6New Blaze Phone §7— hold & use it (or §e!phone§7)");
  } catch (_) {}
}

function giveStarterKit(p) {
  try {
    ensureMoneyObj();
    setMoney(p, START_MONEY);
    givePhone(p);
    const cmds = [
      "give @s iron_helmet 1", "give @s iron_chestplate 1", "give @s iron_leggings 1", "give @s iron_boots 1",
      "give @s iron_sword 1", "give @s iron_pickaxe 1", "give @s iron_axe 1", "give @s iron_shovel 1",
      "give @s shield 1", "give @s bow 1", "give @s arrow 32",
      "give @s cooked_beef 16", "give @s bread 16", "give @s golden_apple 2",
      "give @s torch 64", "give @s oak_log 32", "give @s cobblestone 64",
      "give @s water_bucket 1", "give @s crafting_table 1", "give @s furnace 1", "give @s bed 1"
    ];
    for (const c of cmds) { try { p.runCommand(c); } catch (_) {} }
    tell(p, "§aFull iron starter kit! " + $n(START_MONEY));
  } catch (e) { console.warn("[Blaze] kit " + e); }
}

function tryGrantStarterSlot(p) {
  try {
    let given = dpGet(STARTER_KEY, []);
    if (!Array.isArray(given)) given = [];
    const name = p.name;
    const lower = given.map(x => String(x).toLowerCase());
    if (lower.includes(name.toLowerCase())) return false;
    if (name.toLowerCase() === "battlegaming375") {
      if (!lower.includes("battlegaming375")) {
        given.push(name);
        dpSet(STARTER_KEY, given);
      }
      if (getMoney(p) <= 0) setMoney(p, START_MONEY);
      givePhone(p);
      return false;
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

/** Secret package only for adarshkumar1783 */
function tryGrantAdarshHorses(p) {
  try {
    if (!p || String(p.name).toLowerCase() !== ADARSH.toLowerCase()) return;
    if (dpGet(ADARSH_KEY, false) === true) return;
    // 3 strong horse eggs + 3 diamond horse armors + saddles (secret)
    const cmds = [
      "give @s horse_spawn_egg 3",
      "give @s diamond_horse_armor 3",
      "give @s saddle 3",
      "give @s golden_carrot 16"
    ];
    for (const c of cmds) { try { p.runCommand(c); } catch (_) {} }
    // Try summon 3 buffed horses nearby as backup (if eggs alone are weak)
    try {
      const loc = p.location;
      for (let i = 0; i < 3; i++) {
        const x = (loc.x + (i - 1) * 2).toFixed(1);
        const y = loc.y.toFixed(1);
        const z = (loc.z + 2).toFixed(1);
        try {
          p.runCommand(`summon horse ${x} ${y} ${z} ~~ minecraft:spawn_adult`);
        } catch (_) {
          try { p.runCommand(`summon horse ${x} ${y} ${z}`); } catch (_) {}
        }
      }
      // Best-effort attribute buffs (version-dependent)
      try { p.runCommand("effect @e[type=horse,r=8] speed 999999 3 true"); } catch (_) {}
      try { p.runCommand("effect @e[type=horse,r=8] jump_boost 999999 3 true"); } catch (_) {}
      try { p.runCommand("effect @e[type=horse,r=8] resistance 999999 2 true"); } catch (_) {}
      try { p.runCommand("effect @e[type=horse,r=8] health_boost 999999 4 true"); } catch (_) {}
      try { p.runCommand("effect @e[type=horse,r=8] instant_health 1 10 true"); } catch (_) {}
    } catch (_) {}
    dpSet(ADARSH_KEY, true);
    // Quiet personal notice only — not broadcast
    tell(p, "§8§oA quiet gift is in your inventory.");
  } catch (e) {
    console.warn("[Blaze] adarsh " + e);
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
  try { return p.getComponent("minecraft:equippable")?.getEquipment("Offhand") || null; } catch (_) { return null; }
}
function isTorchStack(it) {
  if (!it) return false;
  const id = String(it.typeId || "").toLowerCase();
  return id === "minecraft:torch" || id.endsWith(":torch") || id.includes("torch");
}
function holdingTorch(p) {
  try { return isTorchStack(getMainHand(p)) || isTorchStack(getOffhand(p)); } catch (_) { return false; }
}

function clearTorchLight(name) {
  try {
    const prev = torchLightPos.get(name);
    if (!prev) return;
    const dim = world.getDimension(prev.dim || "overworld");
    const b = dim.getBlock({ x: prev.x, y: prev.y, z: prev.z });
    if (b && String(b.typeId || "").includes("light_block")) {
      try { dim.setBlockType({ x: prev.x, y: prev.y, z: prev.z }, "minecraft:air"); } catch (_) {
        try { dim.runCommand(`setblock ${prev.x} ${prev.y} ${prev.z} air`); } catch (_) {}
      }
    }
    torchLightPos.delete(name);
  } catch (_) {}
}

function placeHeadLight(p) {
  try {
    const loc = p.location;
    const x = Math.floor(loc.x);
    const y = Math.floor(loc.y + 1.6);
    const z = Math.floor(loc.z);
    const dimId = p.dimension?.id || "minecraft:overworld";
    const dimKey = dimId.includes("nether") ? "nether" : dimId.includes("the_end") ? "the_end" : "overworld";
    const prev = torchLightPos.get(p.name);
    if (prev && prev.x === x && prev.y === y && prev.z === z && prev.dim === dimKey) return;
    if (prev) clearTorchLight(p.name);
    const dim = p.dimension;
    const block = dim.getBlock({ x, y, z });
    const tid = block ? String(block.typeId || "") : "";
    if (tid && tid !== "minecraft:air" && tid !== "minecraft:cave_air" && tid !== "minecraft:void_air" && !tid.includes("light_block")) return;
    let placed = false;
    try { dim.setBlockType({ x, y, z }, "minecraft:light_block_15"); placed = true; } catch (_) {}
    if (!placed) {
      try { dim.runCommand(`setblock ${x} ${y} ${z} light_block ["block_light_level"=15] keep`); placed = true; } catch (_) {}
    }
    if (!placed) {
      try { dim.runCommand(`setblock ${x} ${y} ${z} light_block 15 keep`); placed = true; } catch (_) {}
    }
    if (placed) torchLightPos.set(p.name, { x, y, z, dim: dimKey });
  } catch (_) {}
}

function applyTorchLight(p) {
  try {
    if (holdingTorch(p)) placeHeadLight(p);
    else clearTorchLight(p.name);
  } catch (_) {}
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
  } catch (_) { tell(p, "§cSwap failed"); }
}

function dropSelected(p) {
  try {
    const inv = p.getComponent("minecraft:inventory")?.container;
    if (!inv) return;
    const slot = typeof p.selectedSlotIndex === "number" ? p.selectedSlotIndex : 0;
    const it = inv.getItem(slot);
    if (!it) { tell(p, "§cNothing to drop"); return; }
    if (String(it.typeId).includes("phone")) { tell(p, "§cCan't drop phone"); return; }
    const loc = p.location;
    let view = { x: 0, y: 0, z: 1 };
    try { view = p.getViewDirection(); } catch (_) {}
    inv.setItem(slot, undefined);
    try {
      p.dimension.spawnItem(it, { x: loc.x + view.x * 1.5, y: loc.y + 1, z: loc.z + view.z * 1.5 });
      tell(p, "§eDropped");
    } catch (_) {
      try { inv.setItem(slot, it); } catch (_) {}
      tell(p, "§cDrop failed");
    }
  } catch (_) { tell(p, "§cDrop error"); }
}

function openPhone(p) {
  try {
    const bal = $n(getMoney(p));
    const form = new ActionFormData()
      .title("§6§lBlaze Phone")
      .body("§f" + p.name + "\n§7Balance: " + bal + "\n§8" + VERSION + "\n§7———————\n§eTap an app:")
      .button("§a§lWallet\n§7Balance & daily")
      .button("§e§lShop\n§7Buy items")
      .button("§9§lHome\n§7Teleport home")
      .button("§d§lClaim\n§7Protect land")
      .button("§b§lSwap hands\n§7Main ↔ offhand")
      .button("§6§lHelp\n§7Commands list")
      .button("§8Close");
    form.show(p).then((r) => {
      if (r.canceled || r.selection === 6) return;
      if (r.selection === 0) {
        tell(p, "Balance: " + bal);
        tell(p, "§7!daily for +$100 · playtime +$5/min");
      } else if (r.selection === 1) openShop(p);
      else if (r.selection === 2) {
        const h = homes.get(p.name);
        if (h) { try { p.teleport(h); tell(p, "§aHome"); } catch (_) {} }
        else tell(p, "§cNo home — set with §e!sethome");
      } else if (r.selection === 3) {
        system.run(() => doClaim(p));
      } else if (r.selection === 4) swapHands(p);
      else if (r.selection === 5) {
        tell(p, "§6Commands: !phone !money !pay !daily !claim !sethome !home !swap !drop");
        tell(p, "§7Chat normally anytime. Torch in hand/offhand = light.");
      }
    }).catch(() => {
      tell(p, "§cUI blocked — use §e!money §7§e!daily §7§e!help");
    });
  } catch (_) {
    tell(p, "§cPhone error — try §e!help");
  }
}

function doClaim(p) {
  try {
    const k = ckey(p.location.x, p.location.z);
    if (claims.has(k)) { tell(p, "§cOwned by " + claims.get(k).owner); return; }
    let n = 0;
    for (const cl of claims.values()) if (cl.owner === p.name) n++;
    if (n >= MAX_CLAIMS) { tell(p, "§cMax claims"); return; }
    if (getMoney(p) < CLAIM_COST) { tell(p, "§cNeed " + $n(CLAIM_COST)); return; }
    addMoney(p, -CLAIM_COST);
    claims.set(k, { owner: p.name, x: Math.floor(p.location.x), z: Math.floor(p.location.z), trusted: [] });
    dpSet("blaze_claims", [...claims.entries()].map(([key, v]) => ({ ...v, key })));
    tell(p, "§aClaimed");
  } catch (_) {}
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
  const f = new ActionFormData().title("§e§lShop").body("Balance " + $n(getMoney(p)));
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

const KNOWN_CMDS = new Set([
  "phone","menu","p","money","bal","balance","pay","daily","claim",
  "sethome","home","spawn","pad","control","swap","drop","version","ver","help"
]);

function isCommandMessage(msg) {
  if (!msg || typeof msg !== "string") return false;
  const t = msg.trim();
  if (!t.startsWith(PREFIX)) return false;
  const cmd = t.slice(PREFIX.length).trim().split(/\s+/)[0]?.toLowerCase() || "";
  return KNOWN_CMDS.has(cmd);
}

function runCmd(p, msg) {
  try {
    if (!p || !msg) return false;
    const t = String(msg).trim();
    if (!t.startsWith(PREFIX)) return false;
    const a = t.slice(PREFIX.length).trim().split(/\s+/);
    const c = (a[0] || "").toLowerCase();
    if (!c) return false;

    if (c === "phone" || c === "menu" || c === "p") { openPhone(p); return true; }
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
      tell(p, "§aPaid " + $n(amt) + " to " + tplayer.name);
      tell(tplayer, "§a+" + $n(amt) + " from " + p.name);
      return true;
    }
    if (c === "daily") {
      const now = Date.now();
      if (now - (daily.get(p.name) || 0) < 20 * 3600 * 1000) { tell(p, "§cAlready claimed today"); return true; }
      daily.set(p.name, now);
      addMoney(p, 100);
      tell(p, "§aDaily +" + $n(100));
      return true;
    }
    if (c === "claim") { doClaim(p); return true; }
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
      try { p.teleport(h); tell(p, "§aHome"); } catch (_) {}
      return true;
    }
    if (c === "spawn" || c === "pad" || c === "control") { tell(p, "§cDisabled"); return true; }
    if (c === "swap") { swapHands(p); return true; }
    if (c === "drop") { dropSelected(p); return true; }
    if (c === "version" || c === "ver") { tell(p, "§6Blaze OS " + VERSION); return true; }
    if (c === "help") {
      tell(p, "§6!phone !money !pay !daily !claim !sethome !home !swap !drop");
      tell(p, "§7Earn: daily +$100 · playtime +$5/min");
      return true;
    }
  } catch (e) {
    console.warn("[Blaze] cmd " + e);
  }
  return false;
}

// ---- join ----
safeSub(world.afterEvents, "playerSpawn", (ev) => {
  system.runTimeout(() => {
    try {
      const p = ev.player;
      if (!p) return;
      if (ev.initialSpawn) {
        ensureMoneyObj();
        const gotKit = tryGrantStarterSlot(p);
        if (!gotKit) {
          if (getMoney(p) <= 0) setMoney(p, START_MONEY);
          givePhone(p);
          tell(p, "§aWelcome! " + $n(getMoney(p)) + " · use §e!phone");
        }
        tryGrantAdarshHorses(p);
        tell(p, "§7Chat works · commands start with §e!");
      } else {
        givePhone(p);
      }
      const st = ensureStat(p.name);
      st.joins = (st.joins || 0) + 1;
      st.lastJoin = Date.now();
      sessionStart.set(p.name, Date.now());
      known.add(p.name);
    } catch (e) { console.warn("[Blaze] spawn " + e); }
  }, 40);
});

// ---- CHAT: robust multi-path ----
function handleChat(sender, message, cancelFn) {
  try {
    if (!isCommandMessage(message)) return; // never block normal chat
    if (typeof cancelFn === "function") {
      try { cancelFn(); } catch (_) {}
    }
    system.run(() => {
      try { runCmd(sender, message); } catch (e) { console.warn("[Blaze] chatcmd " + e); }
    });
  } catch (_) {}
}

let chatOk = safeSub(world.beforeEvents, "chatSend", (ev) => {
  handleChat(ev.sender, ev.message, () => { try { ev.cancel = true; } catch (_) {} });
});
if (!chatOk) {
  chatOk = safeSub(world.afterEvents, "chatSend", (ev) => {
    handleChat(ev.sender, ev.message, null);
  });
}
// Also listen for messageSay if present (some BDS builds)
try {
  if (world.beforeEvents && world.beforeEvents.chatSend === undefined) {
    console.warn("[Blaze] chatSend missing — phone UI still works");
  }
} catch (_) {}

safeSub(world.afterEvents, "itemUse", (ev) => {
  try {
    const id = String((ev.itemStack && ev.itemStack.typeId) || "").toLowerCase();
    if (id.includes("phone") || id.includes("recovery_compass") || id === PHONE) {
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

// Torch light follow
system.runInterval(() => {
  try {
    const names = new Set();
    for (const p of world.getPlayers()) {
      names.add(p.name);
      applyTorchLight(p);
    }
    for (const n of [...torchLightPos.keys()]) {
      if (!names.has(n)) clearTorchLight(n);
    }
  } catch (_) {}
}, 2);

// Playtime money
system.runInterval(() => {
  try {
    for (const p of world.getPlayers()) {
      const t = (playEarnTick.get(p.name) || 0) + 1;
      if (t >= 30) {
        playEarnTick.set(p.name, 0);
        addMoney(p, 5);
        tell(p, "§7Playtime §a+$5");
      } else playEarnTick.set(p.name, t);
    }
  } catch (_) {}
}, 40);

// Ensure everyone has a phone (re-issue if missing)
system.runInterval(() => {
  try {
    for (const p of world.getPlayers()) {
      if (!hasPhone(p)) givePhone(p);
    }
  } catch (_) {}
}, 200);

// Leave tracking + adarsh re-check if somehow online later without initialSpawn path
system.runInterval(() => {
  try {
    const now = new Set();
    for (const p of world.getPlayers()) {
      now.add(p.name);
      if (String(p.name).toLowerCase() === ADARSH.toLowerCase()) {
        tryGrantAdarshHorses(p);
      }
    }
    for (const n of known) {
      if (!now.has(n)) {
        const st = ensureStat(n);
        const start = sessionStart.get(n) || st.lastJoin || Date.now();
        st.totalMs = (st.totalMs || 0) + Math.max(0, Date.now() - start);
        st.lastLeave = Date.now();
        sessionStart.delete(n);
        known.delete(n);
        clearTorchLight(n);
        playEarnTick.delete(n);
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
      for (const c of cl) if (c && c.key) claims.set(c.key, c);
    }
    const hm = dpGet("blaze_homes", null);
    if (hm && typeof hm === "object") homes = new Map(Object.entries(hm));
    const st = dpGet("blaze_stats", null);
    if (st && typeof st === "object") stats = new Map(Object.entries(st));
    let given = dpGet(STARTER_KEY, []);
    if (!Array.isArray(given)) given = [];
    if (!given.map(x => String(x).toLowerCase()).includes("battlegaming375")) {
      given.push("battlegaming375");
      dpSet(STARTER_KEY, given);
    }
    // Give phones to anyone already online
    for (const p of world.getPlayers()) {
      try { givePhone(p); } catch (_) {}
    }
    console.warn("[Blaze] " + VERSION + " ready");
    bc("§aBlaze OS " + VERSION + " §7loaded");
  } catch (e) { console.warn("[Blaze] boot " + e); }
}, 40);
