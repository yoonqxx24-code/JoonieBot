require('dotenv').config();
const fs = require('fs');
const path = require('path');
const {
  Client,
  GatewayIntentBits,
  Events,
  EmbedBuilder,
  REST,
  Routes,
  SlashCommandBuilder,
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');
const { createCanvas, loadImage } = require('canvas');
const axios = require('axios');

// === HELPER: createDropCollage ===
async function createDropCollage(cards) {
  const width = 1100;
  const height = 450;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // Hintergrund
  ctx.fillStyle = "#1f1f1f";
  ctx.fillRect(0, 0, width, height);

  const positions = [
    { x: 50, y: 25 },
    { x: 400, y: 25 },
    { x: 750, y: 25 }
  ];

  for (let n = 0; n < cards.length; n++) {
    const card = cards[n];
    try {
      const img = await loadImage(card.image);
      const pos = positions[n];
      ctx.drawImage(img, pos.x, pos.y, 300, 400);
    } catch (err) {
      console.error("Failed loading an image:", err);
    }
  }

  return canvas.toBuffer("image/png");
}
// Discord client
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// Dateien (lokales Backup)
const USERS_FILE = path.join(__dirname, 'users.json');
const USER_CARDS_FILE = path.join(__dirname, 'user_cards.json');
const CARDS_FILE = path.join(__dirname, 'cards.json');

/* ----------------------------------------------------
   Remote + lokal speichern / laden
---------------------------------------------------- */
async function loadJsonOrRemote(file, fallback) {
  const BIN_KEY = process.env.JSONBIN_KEY;
  const BIN_ID = process.env.JSONBIN_ID;

  if (!BIN_KEY || !BIN_ID) {
    if (!fs.existsSync(file)) return fallback;
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch { return fallback; }
  }

  try {
    const res = await axios.get(`https://api.jsonbin.io/v3/b/${BIN_ID}/latest`, {
      headers: { 'X-Master-Key': BIN_KEY }
    });
    const record = res.data.record;
    if (!record) return fallback;

    if (file === USERS_FILE) return record.users ?? fallback;
    if (file === USER_CARDS_FILE) return record.user_cards ?? fallback;
    if (file === CARDS_FILE) return record.cards ?? fallback;
    return record;
  } catch (err) {
    console.error('JSONBin load failed, using local:', err.message);
    if (!fs.existsSync(file)) return fallback;
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch { return fallback; }
  }
}

async function saveJsonOrRemote(file, data) {
  const BIN_KEY = process.env.JSONBIN_KEY;
  const BIN_ID = process.env.JSONBIN_ID;

  // immer lokal speichern
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
  if (!BIN_KEY || !BIN_ID) return;

  try {
    let current = {};
    try {
      const res = await axios.get(`https://api.jsonbin.io/v3/b/${BIN_ID}/latest`, {
        headers: { 'X-Master-Key': BIN_KEY }
      });
      current = res.data.record || {};
    } catch { current = {}; }

    if (file === USERS_FILE) current.users = data;
    else if (file === USER_CARDS_FILE) current.user_cards = data;
    else if (file === CARDS_FILE) current.cards = data;

    await axios.put(`https://api.jsonbin.io/v3/b/${BIN_ID}`, current, {
      headers: { 'Content-Type': 'application/json', 'X-Master-Key': BIN_KEY }
    });
  } catch (err) {
    console.error('JSONBin save failed:', err.message);
  }
}

/* ----------------------------------------------------
   BOOST / DROP – Hilfsdaten
---------------------------------------------------- */
const BASE_RARITY_WEIGHTS = {
  common: 35,
  rare: 22,
  super_rare: 16,
  ultra_rare: 10,
  legendary: 7,
  birthday: 5,
  public: 3,
  limited: 2
};

const BOOST_MULTIPLIERS = {
  small: { common: 0.9, rare: 1.1, super_rare: 1.15, ultra_rare: 1.2, legendary: 1.25, birthday: 1.25, public: 1.2, limited: 1.3 },
  normal:{ common: 0.75, rare: 1.25, super_rare: 1.35, ultra_rare: 1.45, legendary: 1.55, birthday: 1.6, public: 1.5, limited: 1.75 },
  mega:  { common: 0.5, rare: 1.45, super_rare: 1.7, ultra_rare: 1.9, legendary: 2.1, birthday: 2.2, public: 2.0, limited: 1.8 }
};

// Kaufpreise (event/limited nicht kaufbar)
const RARITY_PRICES = { common: 500, rare: 1000, super_rare: 1800, ultra_rare: 2500};

function getActiveBoost(user) {
  if (!user || !user.activeBoost) return null;
  if (!user.activeBoost.expiresAt) return null;
  if (Date.now() > user.activeBoost.expiresAt) { delete user.activeBoost; return null; }
  return user.activeBoost.type;
}

function pickRarityWithBoost(baseWeights, boostName = null) {
  const weights = { ...baseWeights };
  if (boostName && BOOST_MULTIPLIERS[boostName]) {
    const multi = BOOST_MULTIPLIERS[boostName];
    for (const r in weights) if (multi[r]) weights[r] = weights[r] * multi[r];
  }
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  const roll = Math.random() * total;
  let acc = 0;
  for (const [rarity, weight] of Object.entries(weights)) {
    acc += weight;
    if (roll <= acc) return rarity;
  }
  return 'common';
}

/* ----------------------------------------------------
   Helpers
---------------------------------------------------- */
function ruiEmbed(title, desc, fields = []) {
  const e = new EmbedBuilder().setTitle(title).setDescription(desc).setColor(0xFFB6C1);
  if (fields.length) e.addFields(...fields);
  return e;
}
function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

/* ----------------------------------------------------
   ID Template
   {CATEGORY/RARITY}{GG}{II}V{V}{EE}
---------------------------------------------------- */

const ID_REGEX = /^(?:C|R|S|U|L|HB|B|P|LE|CC)[A-Z]{2}[A-Z]{2}V([1-9]\d*)(0[1-9]|[1-9]\d)$/;

const rarityLetterMap = {
  common: 'C',
  rare: 'R',
  super_rare: 'S',
  ultra_rare: 'U',
  legendary: 'L',

  birthday: 'HB',
  public: 'PU',
  booster: 'B',
  patreon: 'P',
  limited: 'LE',
  custom: 'CC'
};

/* ----------------------------------------------------
   Slash Commands registrieren
---------------------------------------------------- */
async function registerCommands() {
  const commands = [
    new SlashCommandBuilder().setName('ping').setDescription('Check if Namjoon is awake'),
    new SlashCommandBuilder().setName('start').setDescription('Create a profile'),
    new SlashCommandBuilder().setName('balance').setDescription('Show your coins, ivy and cards'),
    new SlashCommandBuilder().setName('daily').setDescription('Claim your daily reward'),
    new SlashCommandBuilder().setName('weekly').setDescription('Claim your weekly reward'),
    new SlashCommandBuilder().setName('monthly').setDescription('Claim your monthly reward'),
    new SlashCommandBuilder().setName('drop').setDescription('Drop 3 random cards'),
    new SlashCommandBuilder()
  .setName('binder_add')
  .setDescription('Create a binder with up to 9 owned cards')
  .addStringOption(o =>
    o.setName('name')
      .setDescription('Binder name')
      .setRequired(true)
  )
  .addStringOption(o =>
    o.setName('cards')
      .setDescription('Card IDs separated by commas')
      .setRequired(true)
  ),
    new SlashCommandBuilder().setName('search').setDescription('Search for a card')
  .addStringOption(o =>
  o.setName('card_id')
    .setDescription('Search for a card')
    .setRequired(false)
) 
.addStringOption(o =>
  o.setName('idol')
    .setDescription('Search by idol')
    .setRequired(false)
),
    new SlashCommandBuilder()
  .setName('progress')
  .setDescription('Show your collection progress')
  .addStringOption(o =>
    o.setName('group').setDescription('Filter by group').setRequired(false)
  )
  .addStringOption(o =>
    o.setName('idol').setDescription('Filter by idol/member').setRequired(false)
  )
  .addStringOption(o =>
    o.setName('era').setDescription('Filter by era/theme').setRequired(false)
  )
  .addIntegerOption(o =>
    o.setName('page').setDescription('Page number').setRequired(false)
  ),
    new SlashCommandBuilder().setName('work').setDescription('Help out bangtan to earn rewards'),
    new SlashCommandBuilder().setName('inventory').setDescription('Show your collected cards')
    .addStringOption(o =>
       o.setName('group')
   .setDescription('Filter by group')
   .setRequired(false)
)

    .addStringOption(o =>
       o.setName('idol')
   .setDescription('Filter by idol')
   .setRequired(false)
)
    .addStringOption(o =>
  o.setName('era')
   .setDescription('Filter by era/theme')
   .setRequired(false)
),
    new SlashCommandBuilder().setName('claim').setDescription('Claim a random card every 30 seconds'),
    new SlashCommandBuilder().setName('overview').setDescription('Show all commands'),

    new SlashCommandBuilder()
      .setName('buy')
      .setDescription('Buy a card')
      .addStringOption(o =>
        o.setName('card_id').setDescription('Card code').setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName('gift')
      .setDescription('Send coins, ivy or a card to another player')
      .addUserOption(o => o.setName('target').setDescription('Who should receive it?').setRequired(true))
      .addStringOption(o =>
        o.setName('what').setDescription('What do you want to gift?').setRequired(true).addChoices(
          { name: 'Coins', value: 'coins' },
          { name: 'Ivy', value: 'ivy' },
          { name: 'Card', value: 'card' }
        )
      )
      .addIntegerOption(o => o.setName('amount').setDescription('Amount').setRequired(false))
      .addStringOption(o => o.setName('card_id').setDescription('Card ID').setRequired(false)),

    new SlashCommandBuilder()
  .setName('addcard')
  .setDescription('create a new card')
  .addStringOption(o =>
    o.setName('card_id')
      .setDescription('Card ID')
      .setRequired(true)
  )
  .addStringOption(o => o.setName('group').setDescription('Group name').setRequired(true))
  .addStringOption(o => o.setName('idol').setDescription('Idol name').setRequired(true))
  .addStringOption(o =>
    o.setName('category').setDescription('Card category').setRequired(true).addChoices(
      { name: 'Regular', value: 'regular' },
      { name: 'Happy Birthday', value: 'birthday' },
      { name: 'Public', value: 'public' },
      { name: 'Booster', value: 'booster' },
      { name: 'Patreon', value: 'patreon' },
      { name: 'Limited', value: 'limited' },
      { name: 'Custom', value: 'custom' }

    )
  )
  .addStringOption(o => o.setName('era').setDescription('Era name').setRequired(true))
  .addStringOption(o => o.setName('version').setDescription('Version number').setRequired(true))
  .addAttachmentOption(o =>
    o.setName('image').setDescription('Upload card image').setRequired(true)
  )
  .addBooleanOption(o =>
    o.setName('droppable').setDescription('Should drop in /drop').setRequired(true)
  )
  .addStringOption(o =>
    o.setName('rarity').setDescription('Only needed for Regular cards').setRequired(false).addChoices(
      { name: 'common', value: 'common' },
      { name: 'rare', value: 'rare' },
      { name: 'super_rare', value: 'super_rare' },
      { name: 'ultra_rare', value: 'ultra_rare' },
      { name: 'legendary', value: 'legendary' }
    )
  ),
    // neue Staff-Commands
    new SlashCommandBuilder()
      .setName('editcard_dropon')
      .setDescription('make a card droppable')
      .addStringOption(o =>
        o.setName('card_id').setDescription('Card ID').setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName('editcard_dropoff')
      .setDescription('make a card NOT droppable')
      .addStringOption(o =>
        o.setName('card_id').setDescription('Card ID').setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName('deletecard')
      .setDescription('delete a card completely')
      .addStringOption(o =>
        o.setName('card_id').setDescription('Card ID').setRequired(true)
      )
  ].map(c => c.toJSON());

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

  // global (optional zusätzlich guild-scope falls gewünscht)
  await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });

  // optional: in 1 Guild schneller sichtbar
  if (process.env.GUILD_ID) {
    await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
      { body: commands }
    );
  }

  console.log('Slash commands registered');
}

/* ----------------------------------------------------
   Events
---------------------------------------------------- */
const WORK_MESSAGES = [
  "You found extra rewards bedind a stack of Indigo albums!",
  "Someone whispered 'strong power thank you' into your ear before disappearing into the storage room",
  "Work done! Don’t tell Noa but you might actually be more productive than him today.",
  "Jimin paid you for sneaking one of Jks bananamilk packs from the fridge",
  "You helped Yoongi organizing studio equipment and earned",
  "You helped Seokjin prepare snacks for the gallery staff and received",
  "You worked overtime reorganizing album shelves after someone sorted them by color instead of era. You received",
  "Here, I saved a few ivy for you.",
  "You helped Namjoon water the gallery plants today and earned",
  "You organized old concert photos losing at least 10 minutes staring at 2015 Bangtan",
  "You earned these fair and square. Keep it safe.",
  "You spent the afternoon breaking up another argument about dumplings and earned",
  "You stayed late after 'one last rehearsal' became twelve more.",
  "unfortunately you didn't finish your work in time cause Jungkook connected their phone to the gallery speakers and started a full concert. AT LEAST YOU TRIED",
  "Jin claimed he was supervising today's shift but mostly just stood there looking expensive. You received",
  "Namjoon confidently said 'nothing will break this time' yet you immediately qualified for hazard pay and earned",
  "You and Tae spend an hour choosing between two decorations that looked exactly the same to everyone else. You received"
];

client.once(Events.ClientReady, async (c) => {
  console.log("Logged in as " + c.user.tag);
  try { await registerCommands(); } catch (err) { console.error('Failed to register commands:', err); }
});

/* ----------------------------------------------------
   Interaction handler
---------------------------------------------------- */
client.on(Events.InteractionCreate, async (i) => {
  // ---------- BUTTONS ----------
  if (i.isButton()) {
    if (i.customId.startsWith('drop_pick_')) {
      const users = await loadJsonOrRemote(USERS_FILE, {});
      const id = i.user.id;
      const u = users[id];
      const DROP_CLAIM_COOLDOWN = 20 * 1000;

if (!u.lastDropClaim) u.lastDropClaim = 0;

const claimLeft = DROP_CLAIM_COOLDOWN - (Date.now() - u.lastDropClaim);

if (claimLeft > 0) {
  const seconds = Math.ceil(claimLeft / 1000);
  return i.reply({
    content: `You can claim another drop card in **${seconds}s**.`,
    ephemeral: true
  });
}

      if (!u || !u.pendingDrop) return i.reply({ content: 'You have no active drop.', ephemeral: true });

      const now = Date.now();
      if (u.pendingDrop.expiresAt && now > u.pendingDrop.expiresAt) {
        delete u.pendingDrop;
        await saveJsonOrRemote(USERS_FILE, users);
        return i.reply({ content: 'Your drop expired. Use /drop again.', ephemeral: true });
      }

      const idx = parseInt(i.customId.split('_').pop(), 10);
      const cards = u.pendingDrop.cards || [];
      if (!cards[idx]) return i.reply({ content: 'This card is not available anymore.', ephemeral: true });

      const chosen = cards[idx];
      const allUserCards = await loadJsonOrRemote(USER_CARDS_FILE, {});
      if (!Array.isArray(allUserCards[id])) allUserCards[id] = [];
      allUserCards[id].push(chosen);
      await saveJsonOrRemote(USER_CARDS_FILE, allUserCards);
u.lastDropClaim = Date.now();
      u.pendingDrop = null;
      u.lastDrop = new Date().toISOString();
      await saveJsonOrRemote(USERS_FILE, users);

      const embed = new EmbedBuilder()
        .setTitle('Card claimed')
        .setDescription(`You claimed **${chosen.id}** (${chosen.group} — ${chosen.member}) • **${chosen.rarity}**`)
        .setColor(0xFFB6C1);
      if (chosen.image) embed.setImage(chosen.image);

      return i.reply({ embeds: [embed], ephemeral: true });
    }
    return;
  }

  // ---------- SLASH COMMANDS ----------
  if (!i.isChatInputCommand()) return;

  try {
    const users = await loadJsonOrRemote(USERS_FILE, {});
    const id = i.user.id;
    const name = i.user.username;

    if (!users[id]) {
      users[id] = {
        id, name, coins: 0, ivy: 0, created: new Date().toISOString(),
        lastDaily: null, lastWeekly: null, lastMonthly: null, lastWork: null,
        lastDrop: null, pendingDrop: null, lastClaim: null
      };
      await saveJsonOrRemote(USERS_FILE, users);
    }
    const u = users[id];

    /* /ping */
    if (i.commandName === 'ping') {
      return i.reply({ embeds: [ruiEmbed('Pong', 'Joonie is awake.')] });
    }

    /* /overview */
    if (i.commandName === 'overview') {
      return i.reply({
        embeds: [ruiEmbed('Joonie Command Overview',
          'Here’s a quick summary of all available commands:',
          [
            { name: '/start', value: 'Create your profile' },
            { name: '/balance', value: 'Show your coins, ivy and cards' },
            { name: '/daily /weekly /monthly', value: 'Claim your rewards' },
            { name: '/work', value: 'Earn coins and ivy' },
            { name: '/drop', value: 'Drop 3 random cards' },
            { name: '/claim', value: 'Claim a random card' },
            { name: '/buy', value: 'Buy a specific card by ID' },
            { name: '/gift', value: 'Send coins, ivy or cards to other players' },
            { name: '/inventory', value: 'View your collected cards' }
          ]
        )],
        ephemeral: true
      });
    }

    /* /start — NEVER overwrite */
    if (i.commandName === 'start') {
      const all = await loadJsonOrRemote(USERS_FILE, {});
      if (all[id]) {
        return i.reply({ embeds: [ruiEmbed('Already started', `Oh! Seems like you already created a profile, ${name}. Have fun playing.`)] });
      }
      all[id] = {
        id, name, coins: 0, ivy: 0, created: new Date().toISOString(),
        lastDaily: null, lastWeekly: null, lastMonthly: null, lastWork: null,
        lastDrop: null, pendingDrop: null, lastClaim: null
      };
      await saveJsonOrRemote(USERS_FILE, all);
      return i.reply({ embeds: [ruiEmbed('Profile created', `Hi ${name}. Your collector profile has been created.`)] });
    }

    /* /balance */
    if (i.commandName === 'balance') {
      const allUserCards = await loadJsonOrRemote(USER_CARDS_FILE, {});
      const allCards = await loadJsonOrRemote(CARDS_FILE, []);
      let myCards = Array.isArray(allUserCards[id]) ? allUserCards[id] : [];

if (allCards.length) {
  const validIds = new Set(allCards.map(c => c.id));

  const filtered = myCards.filter(c => {
    const cardId = typeof c === 'string' ? c : c.id;
    return validIds.has(cardId);
  });

  if (filtered.length !== myCards.length) {
    allUserCards[id] = filtered;
    await saveJsonOrRemote(USER_CARDS_FILE, allUserCards);
  }

  myCards = filtered;
}
if (u.ivy == null || Number.isNaN(u.ivy)) u.ivy = 0;
if (u.coins == null || Number.isNaN(u.coins)) u.coins = 0;
      
      return i.reply({
        embeds: [ruiEmbed(`${name}'s Balance`, `Here’s your current collector data.`, [
          { name: 'Coins', value: String(u.coins), inline: true },
          { name: 'Ivy', value: String(u.ivy), inline: true },
          { name: 'Cards', value: String(myCards.length), inline: true }
        ])]
      });
    }

    /* /daily */
    if (i.commandName === 'daily') {
      const DAY = 24 * 60 * 60 * 1000;
      const now = Date.now();
      const last = u.lastDaily ? new Date(u.lastDaily).getTime() : 0;

      if (u.lastDaily && (now - last) < DAY) {
        const leftH = Math.ceil((DAY - (now - last)) / (60 * 60 * 1000));
        return i.reply({ embeds: [ruiEmbed('Daily already claimed', `You already picked up today’s rewards, ${name}. Come back in about ${leftH} hour(s).`)] });
      }

      const coins = rand(200, 750);
      const ivy = rand(3, 7);
      u.coins += coins; u.ivy += leaves; u.lastDaily = new Date().toISOString();
      await saveJsonOrRemote(USERS_FILE, users);

      return i.reply({ embeds: [ruiEmbed('Daily collected', `${name}, here is your daily.`, [
        { name: 'Coins', value: `+${coins}`, inline: true },
        { name: 'Ivy', value: `+${ivy}`, inline: true },
        { name: 'Cards', value: 'No cards available yet', inline: false },
        { name: 'New total', value: `${u.coins} 🪙 / ${u.ivy} 🌿`, inline: false }
      ])] });
    }
/* /progress */
if (i.commandName === 'progress') {
  const allCards = await loadJsonOrRemote(CARDS_FILE, []);
  const allUserCards = await loadJsonOrRemote(USER_CARDS_FILE, {});

  const groupFilter = i.options.getString('group');
  const idolFilter = i.options.getString('idol');
  const eraFilter = i.options.getString('era');
  const page = i.options.getInteger('page') || 1;

  let cards = allCards;

  if (groupFilter) {
    cards = cards.filter(c => c.group?.toLowerCase() === groupFilter.toLowerCase());
  }

  if (eraFilter) {
    cards = cards.filter(c => c.era?.toLowerCase() === eraFilter.toLowerCase());
  }
const rarityOrder = {
  common: 1,
  rare: 2,
  super_rare: 3,
  ultra_rare: 4,
  legendary: 5
};

cards.sort((a, b) => {
  const groupCompare = (a.group || "").localeCompare(b.group || "");
  if (groupCompare !== 0) return groupCompare;

  const memberCompare =
    (memberOrder[a.member] || 999) - (memberOrder[b.member] || 999);
  if (memberCompare !== 0) return memberCompare;

  const specialTypes = [
    'birthday',
    'public',
    'booster',
    'patreon',
    'limited',
    'custom'
  ];

  const aSpecial = specialTypes.includes(a.rarity);
  const bSpecial = specialTypes.includes(b.rarity);

  // regular rarity sorting
  if (!aSpecial && !bSpecial) {
    const rarityCompare =
      (rarityOrder[a.rarity] || 999) -
      (rarityOrder[b.rarity] || 999);

    if (rarityCompare !== 0) return rarityCompare;
  }

  // special sorting by last numbers in ID
  const aNum = parseInt(a.id.slice(-2)) || 0;
  const bNum = parseInt(b.id.slice(-2)) || 0;

  return aNum - bNum;
});
  const userCards = Array.isArray(allUserCards[id]) ? allUserCards[id] : [];
  const ownedIds = new Set(userCards.map(c => typeof c === 'string' ? c : c.id));

  const totalOwned = cards.filter(c => ownedIds.has(c.id)).length;
  const totalCards = cards.length;

  const perPage = 12;
  const maxPage = Math.ceil(cards.length / perPage);
  const safePage = Math.min(Math.max(page, 1), maxPage);
  const pageCards = cards.slice((safePage - 1) * perPage, safePage * perPage);

  const canvas = createCanvas(1000, 1250);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#1f1f23';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 46px Sans';
  ctx.fillText('Collection Progress', 60, 80);

  ctx.font = '30px Sans';
  ctx.fillText(`${totalOwned}/${totalCards} Cards`, 60, 130);
  ctx.fillText(`Page ${safePage}/${maxPage}`, 60, 170);

  const cardW = 180;
  const cardH = 250;
  const gapX = 45;
  const gapY = 70;
  const startX = 60;
  const startY = 230;

  for (let index = 0; index < pageCards.length; index++) {
    const card = pageCards[index];
    const col = index % 4;
    const row = Math.floor(index / 4);

    const x = startX + col * (cardW + gapX);
    const y = startY + row * (cardH + gapY);

    const owned = ownedIds.has(card.id);

    try {
      const img = await loadImage(card.image);

      ctx.save();

      if (!owned) {
        ctx.filter = 'grayscale(100%) brightness(45%)';
      }

      ctx.drawImage(img, x, y, cardW, cardH);
      ctx.restore();
      ctx.filter = 'none';

      ctx.fillStyle = owned ? '#ffffff' : '#999999';
      ctx.font = 'bold 20px Sans';
      ctx.textAlign = 'center';
      ctx.fillText(card.id, x + cardW / 2, y + cardH + 28);

    } catch (err) {
      ctx.fillStyle = '#333333';
      ctx.fillRect(x, y, cardW, cardH);

      ctx.fillStyle = '#ffffff';
      ctx.font = '18px Sans';
      ctx.textAlign = 'center';
      ctx.fillText('Image error', x + cardW / 2, y + cardH / 2);
      ctx.fillText(card.id, x + cardW / 2, y + cardH + 28);
    }
  }

  const attachment = new AttachmentBuilder(canvas.toBuffer(), {
    name: 'progress.png'
  });

  return i.reply({
    content: `Progress: **${totalOwned}/${totalCards}** cards`,
    files: [attachment]
  });
}
  if (i.commandName === 'binder_add') {
  const id = i.user.id;
  const name = i.options.getString('name').trim();
  const cardsInput = i.options.getString('cards');

  const users = await loadJsonOrRemote(USERS_FILE, {});
  const allCards = await loadJsonOrRemote(CARDS_FILE, []);
  const allUserCards = await loadJsonOrRemote(USER_CARDS_FILE, {});

  if (!users[id]) users[id] = { coins: 0, ivy: 0 };

  if (!users[id].binders) users[id].binders = {};

  const requestedIds = cardsInput
    .split(',')
    .map(x => x.trim().toUpperCase())
    .filter(Boolean);

  if (requestedIds.length > 9) {
    return i.reply({
      content: 'A binder can only hold up to **9 cards**.',
      ephemeral: true
    });
  }

  const existingCards = new Set(allCards.map(c => c.id?.toUpperCase()));
  const invalidIds = requestedIds.filter(cardId => !existingCards.has(cardId));

  if (invalidIds.length) {
    return i.reply({
      content: `These card IDs do not exist: **${invalidIds.join(', ')}**`,
      ephemeral: true
    });
  }

  const userCards = Array.isArray(allUserCards[id]) ? allUserCards[id] : [];
  const ownedIds = new Set(userCards.map(c =>
    typeof c === 'string' ? c.toUpperCase() : c.id?.toUpperCase()
  ));

  const notOwned = requestedIds.filter(cardId => !ownedIds.has(cardId));

  if (notOwned.length) {
    return i.reply({
      content: `You can only add cards you own. Missing: **${notOwned.join(', ')}**`,
      ephemeral: true
    });
  }

  users[id].binders[name] = requestedIds;

  await saveJsonOrRemote(USERS_FILE, users);

  return i.reply({
    content: `Binder **${name}** created with **${requestedIds.length}/9** cards.`
  });
  }
    
    /* /weekly */
    if (i.commandName === 'weekly') {
      const WEEK = 7 * 24 * 60 * 60 * 1000;
      const now = Date.now();
      const last = u.lastWeekly ? new Date(u.lastWeekly).getTime() : 0;

      if (u.lastWeekly && (now - last) < WEEK) {
        const leftD = Math.ceil((WEEK - (now - last)) / (24 * 60 * 60 * 1000));
        return i.reply({ embeds: [ruiEmbed('Weekly already claimed', `That one is only once per week, ${name}. Come back in about ${leftD} day(s).`)] });
      }

      const coins = rand(900, 1800);
      const ivy = rand(10, 15);
      u.coins += coins; u.ivy += leaves; u.lastWeekly = new Date().toISOString();
      await saveJsonOrRemote(USERS_FILE, users);

      return i.reply({ embeds: [ruiEmbed('Weekly collected', `Weekly rewards for ${name}.`, [
        { name: 'Coins', value: `+${coins}`, inline: true },
        { name: 'Ivy', value: `+${ivy}`, inline: true },
        { name: 'Cards', value: 'No cards available yet', inline: false },
        { name: 'New total', value: `${u.coins} 🪙 / ${u.ivy} 🌿`, inline: false }
      ])] });
    }

    /* /monthly */
    if (i.commandName === 'monthly') {
      const MONTH = 30 * 24 * 60 * 60 * 1000;
      const now = Date.now();
      const last = u.lastMonthly ? new Date(u.lastMonthly).getTime() : 0;

      if (u.lastMonthly && (now - last) < MONTH) {
        const leftD = Math.ceil((MONTH - (now - last)) / (24 * 60 * 60 * 1000));
        return i.reply({ embeds: [ruiEmbed('Monthly already claimed', `You already took your monthly pack, ${name}. Come back in about ${leftD} day(s).`)] });
      }

      const coins = rand(2500, 5000);
      const ivy = rand(25, 50);
      u.coins += coins; u.ivy += ivy; u.lastMonthly = new Date().toISOString();
      await saveJsonOrRemote(USERS_FILE, users);

      return i.reply({ embeds: [ruiEmbed('Monthly collected', ` for ${name}.`, [
        { name: 'Coins', value: `+${coins}`, inline: true },
        { name: 'Ivy', value: `+${ivy}`, inline: true },
        { name: 'Cards', value: 'No cards available yet', inline: false },
        { name: 'New total', value:`${u.coins} 🪙 / ${u.ivy} 🌿`, inline: false }
      ])] });
    }
/* /search */
if (i.commandName === 'search') {
  const cardIdInput = i.options.getString('card_id');
  const groupFilter = i.options.getString('group');
  const idolFilter = i.options.getString('idol');
  const eraFilter = i.options.getString('era');

  const allCards = await loadJsonOrRemote(CARDS_FILE, []);
  const allUserCards = await loadJsonOrRemote(USER_CARDS_FILE, {});

  let results = allCards;

  if (cardIdInput) {
    results = results.filter(c => c.id?.toUpperCase() === cardIdInput.toUpperCase());
  }

  if (idolFilter) {
    results = results.filter(c => c.member?.toLowerCase() === idolFilter.toLowerCase());
  }

  if (!results.length) {
    return i.reply({
      embeds: [ruiEmbed('Card not found', 'No cards match that search.')],
      ephemeral: true
    });
  }

  const userCards = Array.isArray(allUserCards[id]) ? allUserCards[id] : [];
  const ownedIds = new Set(userCards.map(c => typeof c === 'string' ? c : c.id));

  const page = 0;
  const card = results[page];
  const ownsCard = ownedIds.has(card.id);

  const embed = new EmbedBuilder()
    .setTitle(card.id)
    .setDescription(
      `**Group:** ${card.group || 'Unknown'}\n` +
      `**Idol:** ${card.member || 'Unknown'}\n` +
      `**Era:** ${card.era || 'Unknown'}\n` +
      `**Rarity:** ${card.rarity || 'Unknown'}\n\n` +
      `**Owned:** ${ownsCard ? 'Yes' : 'No'}\n` +
      `**Result:** ${page + 1}/${results.length}`
    )
    .setColor(0xFFB6C1);

  if (card.image) embed.setImage(card.image);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`search_prev_${id}_${page}`)
      .setLabel('Previous')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true),
    new ButtonBuilder()
      .setCustomId(`search_next_${id}_${page}`)
      .setLabel('Next')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(results.length <= 1)
  );

  users[id].searchResults = results.map(c => c.id);
  await saveJsonOrRemote(USERS_FILE, users);

  return i.reply({
    embeds: [embed],
    components: [row]
  });
}
    /* /work */
    if (i.commandName === 'work') {
      const now = Date.now();
      const COOLDOWN = 15 * 60 * 1000;

      if (u.lastWork && now - new Date(u.lastWork).getTime() < COOLDOWN) {
        const leftMs = COOLDOWN - (now - new Date(u.lastWork).getTime());
        const leftMins = Math.ceil(leftMs / (60 * 1000));
        return i.reply({ embeds: [ruiEmbed('Not yet', `You already helped out recently. Come back in ${leftMins} minute(s).`)] });
      }

      const coins = rand(200, 750);
      const ivy = rand(3, 10);
      const msg = WORK_MESSAGES[Math.floor(Math.random() * WORK_MESSAGES.length)];

      u.coins += coins; u.ivy += ivy; u.lastWork = new Date().toISOString();
      await saveJsonOrRemote(USERS_FILE, users);

      return i.reply({ embeds: [ruiEmbed('Work complete', `${msg}\nYou earned 🪙 ${coins} and 🌿 ${ivy}.\nNew total: 🪙 ${u.coins} / 🌿 ${u.ivy}.`)] });
    }

    /* /inventory */
if (i.commandName === 'inventory') {
  const allCards = await loadJsonOrRemote(CARDS_FILE, []);
  const allUserCards = await loadJsonOrRemote(USER_CARDS_FILE, {});

  let myCards = Array.isArray(allUserCards[id]) ? allUserCards[id] : [];
  const groupFilter = i.options.getString('group');
const idolFilter = i.options.getString('idol');

  // 🔍 Entferne Kopien von Karten, die nicht mehr in "cards" existieren
  if (allCards.length) {
    const validIds = new Set(allCards.map(c => c.id));
    const filtered = myCards.filter(c => validIds.has(c.id));
    const eraFilter = i.options.getString('era');

    // Wenn sich etwas geändert hat → aufräumen & speichern
    if (filtered.length !== myCards.length) {
      allUserCards[id] = filtered;
      await saveJsonOrRemote(USER_CARDS_FILE, allUserCards);
    }

    myCards = filtered;
  }
if (groupFilter) {
  myCards = myCards.filter(
    c => c.group?.toLowerCase() === groupFilter.toLowerCase()
  );
}

if (idolFilter) {
  myCards = myCards.filter(
    c => c.member?.toLowerCase() === idolFilter.toLowerCase()
  );
}
if (eraFilter) {
  myCards = myCards.filter(
    c => c.era?.toLowerCase() === eraFilter.toLowerCase()
  );
}

  if (!myCards.length) {
    return i.reply({
      embeds: [ruiEmbed(
        `${name}'s Inventory`,
        "You don't have any cards yet. Try `/drop` or /claim."
      )]
    });
  }

  const firstTen = myCards.slice(0, 10);
  return i.reply({
    embeds: [ruiEmbed(
      `${name}'s Inventory`,
      `You currently own **${myCards.length}** card(s). Showing first ${firstTen.length}:`,
      firstTen.map((c, idx) => ({
        name: `#${idx + 1} • ${c.group} — ${c.member}`,
        value: `ID: ${c.id} • Rarity: **${c.rarity || 'unknown'}**`,
        inline: false
      }))
    )]
  });
}

    /* /buy */
    if (i.commandName === 'buy') {
      const cardIdInput = i.options.getString('card_id');
      const cardId = (cardIdInput || '').toUpperCase();

      const allCards = await loadJsonOrRemote(CARDS_FILE, []);
      const wanted = allCards.find(c => c.id === cardId);

      if (!wanted) {
        return i.reply({ embeds: [ruiEmbed('Not found', `There is no card with ID **${cardId}**.`)], ephemeral: true });
      }

      const category = wanted.category || 'regular';
const rarity = wanted.rarity || 'common';

const BUYABLE_RARITIES = ['common', 'rare', 'super_rare', 'ultra_rare'];

if (category !== 'regular') {
  return i.reply({
    embeds: [ruiEmbed('Not buyable', `Only regular cards can be bought. This card is **${category}**.`)],
    ephemeral: true
  });
}

if (!BUYABLE_RARITIES.includes(rarity)) {
  return i.reply({
    embeds: [ruiEmbed('Not buyable', `Cards with rarity **${rarity}** cannot be bought.`)],
    ephemeral: true
  });
}

const price = RARITY_PRICES[rarity];

      if (u.coins < price) {
        return i.reply({ embeds: [ruiEmbed('Not enough coins', `This card costs **${price}** 🪙 but you only have **${u.coins}**.`)], ephemeral: true });
      }

      u.coins -= price;
      const allUserCards = await loadJsonOrRemote(USER_CARDS_FILE, {});
      if (!Array.isArray(allUserCards[id])) allUserCards[id] = [];
      allUserCards[id].push(wanted);

      await saveJsonOrRemote(USERS_FILE, users);
      await saveJsonOrRemote(USER_CARDS_FILE, allUserCards);

      return i.reply({ embeds: [ruiEmbed('Card bought', `You bought **${wanted.id}** (${wanted.group} — ${wanted.member}) • **${rarity}** for **${price}**`)] });
    }

    /* /gift */
    if (i.commandName === 'gift') {
      const targetUser = i.options.getUser('target');
      const what = i.options.getString('what');
      const amount = i.options.getInteger('amount');
      const cardIdInput = i.options.getString('card_id');
      const cardId = cardIdInput ? cardIdInput.toUpperCase() : null;

      if (!targetUser) return i.reply({ embeds: [ruiEmbed('No target', 'You have to pick someone to gift to.')] });
      if (targetUser.id === id) return i.reply({ embeds: [ruiEmbed('…No.', 'You can’t gift to yourself')] });

      if (!users[targetUser.id]) {
        users[targetUser.id] = {
          id: targetUser.id, name: targetUser.username, coins: 0, ivy: 0, created: new Date().toISOString(),
          lastDaily: null, lastWeekly: null, lastMonthly: null, lastWork: null, lastDrop: null, pendingDrop: null, lastClaim: null
        };
      }

      const receiver = users[targetUser.id];

      if (what === 'coins' || what === 'ivy') {
        if (!amount || amount <= 0) return i.reply({ embeds: [ruiEmbed('Missing amount', 'Tell me how many you want to send.')] });
        if (what === 'coins') {
          if (u.coins < amount) return i.reply({ embeds: [ruiEmbed('Not enough', `You only have ${u.coins} coins.`)], ephemeral: true });
          u.coins -= amount; receiver.coins += amount;
        } else {
          if (u.ivy < amount) return i.reply({ embeds: [ruiEmbed('Not enough', `You only have ${u.ivy} ivy.`)], ephemeral: true });
          u.ivy -= amount; receiver.ivy += amount;
        }
        await saveJsonOrRemote(USERS_FILE, users);
        return i.reply({ embeds: [ruiEmbed('Gift sent', `${name} sent **${amount}** ${what === 'coins' ? 'coins' : 'ivy'} to ${targetUser.username}.`)] });
      }

      if (what === 'card') {
        const allUserCards = await loadJsonOrRemote(USER_CARDS_FILE, {});
        const senderCards = Array.isArray(allUserCards[id]) ? allUserCards[id] : [];
        const receiverCards = Array.isArray(allUserCards[targetUser.id]) ? allUserCards[targetUser.id] : [];

        if (!cardId) return i.reply({ embeds: [ruiEmbed('Missing card', 'Tell me which card ID you want to send (ALL CAPS).')], ephemeral: true });

        const idx = senderCards.findIndex(c => c.id === cardId);
        if (idx === -1) return i.reply({ embeds: [ruiEmbed('Not found', `You don’t own a card with ID **${cardId}**.`)], ephemeral: true });

        const cardToSend = senderCards.splice(idx, 1)[0];
        receiverCards.push(cardToSend);

        allUserCards[id] = senderCards;
        allUserCards[targetUser.id] = receiverCards;
        await saveJsonOrRemote(USER_CARDS_FILE, allUserCards);

        return i.reply({ embeds: [ruiEmbed('Card sent', `${name} sent **${cardToSend.id}** (${cardToSend.group} — ${cardToSend.member}) to ${targetUser.username}.`)] });
      }

      return i.reply({ embeds: [ruiEmbed('Unknown thing', 'You can gift `coins` `ivy` or `card`.')] });
    }

    /* /addcard (STAFF + Template-Check, ALL CAPS + ES/EL, Bild-Datei Pflicht) */
    if (i.commandName === 'addcard') {
      const staffEnv = process.env.STAFF_IDS || '';
      const staffList = staffEnv.split(',').map(s => s.trim()).filter(Boolean);
      if (!staffList.includes(i.user.id)) {
        return i.reply({ embeds: [ruiEmbed('Not allowed', 'This command is for Joonie staff only.')], ephemeral: true });
      }

      const cardIdRaw = i.options.getString('card_id') || '';
      const cardId = cardIdRaw.toUpperCase();

      let rarity = i.options.getString('rarity');
const category = i.options.getString('category');
const group = i.options.getString('group');
const idol = i.options.getString('idol');
const era = i.options.getString('era') || null;
const version = i.options.getString('version') || null;
let droppable = i.options.getBoolean('droppable');

if (category === 'booster' || category === 'custom' || category === 'patreon') {
  droppable = false;
}

if (category === 'regular' && !rarity) {
  return i.reply({
    embeds: [ruiEmbed('Missing rarity', 'Regular cards need a rarity.')],
    ephemeral: true
  });
}

if (category !== 'regular') {
  rarity = category;
}

      // Bild-Upload (erforderlich)
      const imgAtt = i.options.getAttachment('image');
      if (!imgAtt) {
        return i.reply({ embeds: [ruiEmbed('Missing image', 'Please attach an image file.')], ephemeral: true });
      }
      const isImage = (imgAtt.contentType || '').startsWith('image/');
      const maxBytes = 10 * 1024 * 1024; // 10 MB
      if (!isImage || (imgAtt.size && imgAtt.size > maxBytes)) {
        return i.reply({ embeds: [ruiEmbed('Invalid image', 'Only image files up to ~10 MB are allowed.')], ephemeral: true });
      }
      const image = imgAtt.url; // Discord CDN URL

      if (!ID_REGEX.test(cardId)) {
  return i.reply({
    embeds: [ruiEmbed(
      'Invalid card_id',
      'Use valid prefixes:\nC/R/S/U/L = Regular rarities\nHB = Birthday\nB = Public\nPU = Booster\nP = Patreon\nLE = Limited'
    )],
    ephemeral: true
  });
}

// Prefix check
const expected = rarityLetterMap[rarity] || 'C';

const prefix =
  cardId.startsWith('HB') ? 'HB' :
  cardId.startsWith('PU') ? 'PU' :
  cardId.startsWith('LE') ? 'LE' :
  cardId.startsWith('B') ? 'B' :
  cardId.startsWith('P') ? 'P' :
  cardId.startsWith('CC') ? 'CC' :

  cardId.charAt(0);

if (prefix !== expected) {
  return i.reply({
    embeds: [ruiEmbed(
      'Rarity mismatch',
      `ID starts with **${prefix}**, but expected **${expected}** for category/rarity **${rarity}**.`
    )],
    ephemeral: true
  });
}}
      const cards = await loadJsonOrRemote(CARDS_FILE, []);
      if (cards.find(c => c.id === cardId)) {
        return i.reply({ embeds: [ruiEmbed('Already exists', `There is already a card with ID **${cardId}**.`)], ephemeral: true });
      }

      const newCard = {
  id: cardId,
  group,
  member: idol,
  era,
  version,
  image,
  rarity,
  category,
  droppable
};
      cards.push(newCard);
      await saveJsonOrRemote(CARDS_FILE, cards);

      return i.reply({ embeds: [ruiEmbed('Card created',
        `New card was added.\nID: **${cardId}**\nGroup: **${group}**\nIdol: **${idol}**\nRarity: **${rarity}**\nType: **${ctype}**\nDroppable: **${droppable ? 'yes' : 'no'}**\nEra: **${era || '—'}**\nVersion: **${version || '—'}**`
      )] });
    

    /* /editcard_dropon (STAFF) */
    if (i.commandName === 'editcard_dropon') {
      const staffEnv = process.env.STAFF_IDS || '';
      const staffList = staffEnv.split(',').map(s => s.trim()).filter(Boolean);

      if (!staffList.includes(i.user.id)) {
        return i.reply({
          embeds: [ruiEmbed('Not allowed', 'This command is for Joonie staff only.')],
          ephemeral: true
        });
      }

      const cardId = (i.options.getString('card_id') || '').toUpperCase();
      const cards = await loadJsonOrRemote(CARDS_FILE, []);

      const card = cards.find(c => c.id === cardId);
      if (!card) {
        return i.reply({
          embeds: [ruiEmbed('Not found', `There is no card with ID **${cardId}**.`)],
          ephemeral: true
        });
      }

      card.droppable = true;
      await saveJsonOrRemote(CARDS_FILE, cards);

      return i.reply({
        embeds: [ruiEmbed('Updated', `Card **${cardId}** is now **droppable**.`)]
      });
    }

    /* /editcard_dropoff (STAFF) */
    if (i.commandName === 'editcard_dropoff') {
      const staffEnv = process.env.STAFF_IDS || '';
      const staffList = staffEnv.split(',').map(s => s.trim()).filter(Boolean);

      if (!staffList.includes(i.user.id)) {
        return i.reply({
          embeds: [ruiEmbed('Not allowed', 'This command is for Joonie staff only.')],
          ephemeral: true
        });
      }

      const cardId = (i.options.getString('card_id') || '').toUpperCase();
      const cards = await loadJsonOrRemote(CARDS_FILE, []);

      const card = cards.find(c => c.id === cardId);
      if (!card) {
        return i.reply({
          embeds: [ruiEmbed('Not found', `There is no card with ID **${cardId}**.`)],
          ephemeral: true
        });
      }

      card.droppable = false;
      await saveJsonOrRemote(CARDS_FILE, cards);

      return i.reply({
        embeds: [ruiEmbed('Updated', `Card **${cardId}** is now **NOT droppable**.`)]
      });
    }

    /* /deletecard (STAFF) */
    if (i.commandName === 'deletecard') {
      const staffEnv = process.env.STAFF_IDS || '';
      const staffList = staffEnv.split(',').map(s => s.trim()).filter(Boolean);

      if (!staffList.includes(i.user.id)) {
        return i.reply({
          embeds: [ruiEmbed('Not allowed', 'This command is for Joonie staff only.')],
          ephemeral: true
        });
      }

      const cardId = (i.options.getString('card_id') || '').toUpperCase();
      let cards = await loadJsonOrRemote(CARDS_FILE, []);

      const before = cards.length;
      cards = cards.filter(c => c.id !== cardId);

      if (cards.length === before) {
        return i.reply({
          embeds: [ruiEmbed('Not found', `There is no card with ID **${cardId}**.`)],
          ephemeral: true
        });
      }

      await saveJsonOrRemote(CARDS_FILE, cards);

      return i.reply({
        embeds: [ruiEmbed('Card deleted', `Card **${cardId}** was removed from the system.\n(Existing copies in inventories stay.)`)]
      });
    }

    /* /claim */
    if (i.commandName === 'claim') {
      const now = Date.now();
      const COOLDOWN = 30 * 1000;
      const cards = await loadJsonOrRemote(CARDS_FILE, []);
      if (!cards.length) return i.reply({ embeds: [ruiEmbed('No cards available', 'There are no cards to claim yet.')] });

      if (u.lastClaim && now - new Date(u.lastClaim).getTime() < COOLDOWN) {
        const left = Math.ceil((COOLDOWN - (now - new Date(u.lastClaim).getTime())) / 1000);
        return i.reply({ embeds: [ruiEmbed('Cooldown', `Please wait **${left} seconds** before claiming again.`)], ephemeral: true });
      }

      const pool = cards.filter(isDroppable);

if (!pool.length) {
  return i.reply({
    embeds: [ruiEmbed('No droppable cards', 'There are no droppable cards available right now.')],
    ephemeral: true
  });
}

const chosen = pool[Math.floor(Math.random() * pool.length)];

      const allUserCards = await loadJsonOrRemote(USER_CARDS_FILE, {});
      if (!Array.isArray(allUserCards[id])) allUserCards[id] = [];
      allUserCards[id].push(chosen);
      await saveJsonOrRemote(USER_CARDS_FILE, allUserCards);

      u.lastClaim = new Date().toISOString();
      await saveJsonOrRemote(USERS_FILE, users);

      const embed = new EmbedBuilder()
        .setTitle('Card claimed')
        .setDescription(`You got **${chosen.id}** (${chosen.group} — ${chosen.member}) • **${chosen.rarity?.toUpperCase() || 'UNKNOWN'}**!`)
        .setColor(0xFFB6C1);
      if (chosen.image) embed.setImage(chosen.image);

      return i.reply({ embeds: [embed] });
    }

/* /drop */
  function isDroppable(card) {
  if (!card) return false;

  const category = card.category || 'regular';

  if (category === 'booster' || category === 'custom' || category === 'patreon') {
    return false;
  }

  return card.droppable !== false;
  }
if (i.commandName === 'drop') {
      const cards = await loadJsonOrRemote(CARDS_FILE, []);
      if (!cards.length) {
        return i.reply({
          embeds: [ruiEmbed('No cards available', 'Add some cards first.')],
          ephemeral: true
        });
      }

      const now = Date.now();

      if (u.lastDrop) {
        const diff = now - new Date(u.lastDrop).getTime();
        const COOLDOWN = 2 * 60 * 1000;
        if (diff < COOLDOWN) {
          const left = Math.ceil((COOLDOWN - diff) / 1000);
          return i.reply({
  embeds: [ruiEmbed('Cooldown', `You can drop again in **${left}** seconds.`)],
  ephemeral: true
});
      }
        }
      const boostType = getActiveBoost(u);
      const pulled = [];
      for (let n = 0; n < 3; n++) {
        const rarity = pickRarityWithBoost(BASE_RARITY_WEIGHTS, boostType);
        const pool = cards.filter(c => c.rarity === rarity && isDroppable(c));
const finalPool = pool.length
  ? pool
  : cards.filter(c => c.rarity === 'common' && isDroppable(c));
      
        const chosen = finalPool[Math.floor(Math.random() * finalPool.length)];
        pulled.push(chosen);
      }

      // pendingDrop merken (für Buttons)
      u.pendingDrop = { cards: pulled, expiresAt: now + 60 * 1000 };
      await saveJsonOrRemote(USERS_FILE, users);

      // Collage aus den 3 Karten bauen
      const imageBuffer = await createDropCollage(pulled);

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('drop_pick_0').setLabel('1').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('drop_pick_1').setLabel('2').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('drop_pick_2').setLabel('3').setStyle(ButtonStyle.Primary)
      );

      return i.reply({
        content: `**${i.user.username} dropped 3 cards!**`,
        files: [{ attachment: imageBuffer, name: 'drop.png' }],
        components: [row]
      });
        }
    } catch (err) {
  console.error(err);
  if (i.replied || i.deferred) return;
  return i.reply({
    embeds: [ruiEmbed('Error', 'Something went wrong')]
  });
  }
  });
/* ----------------------------------------------------
   Render keep-alive
---------------------------------------------------- */
const express = require("express");
const app = express();
app.get("/", (req, res) => res.send("Joonie is alive"));
app.listen(process.env.PORT || 3000);

// start bot
client.login(process.env.DISCORD_TOKEN);
