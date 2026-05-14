const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const fs = require('fs');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('work')
    .setDescription('Work to earn coins and ivy!'),

  async execute(interaction) {
    const userId = interaction.user.id;
    const users = JSON.parse(fs.readFileSync('users.json', 'utf8'));

    const cooldownTime = 1000 * 60 * 30; // 30 minutes
    const now = Date.now();

    if (users[userId]?.lastWork && now - users[userId].lastWork < cooldownTime) {
      const remaining = Math.ceil((cooldownTime - (now - users[userId].lastWork)) / 60000);
      return interaction.reply({ content: `You need to rest! Come back in **${remaining} minutes**`, ephemeral: true });
    }

    const earnings = Math.floor(Math.random() * 20) + 10; 

    if (!users[userId]) users[userId] = { coins: 0, cards: 0 };
    users[userId].coins += earnings;
    users[userId].lastWork = now;

    fs.writeFileSync('users.json', JSON.stringify(users, null, 2));

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
];

const randomMsg = WORK_MESSAGES[Math.floor(Math.random() * WORK_MESSAGES.length)];

    const embed = new EmbedBuilder()
      .setColor(0xFFC0CB)
      .setTitle('Work Completed!')
      .setDescription(randomMsg)
      .setFooter({ text: 'Work hard, dream big' });

    await interaction.reply({ embeds: [embed] });
  },
};
