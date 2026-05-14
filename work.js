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

    const messages = [
      ``
    ];

    const randomMsg = messages[Math.floor(Math.random() * messages.length)];

    const embed = new EmbedBuilder()
      .setColor(0xFFC0CB)
      .setTitle('Work Completed!')
      .setDescription(randomMsg)
      .setFooter({ text: 'Work hard, dream big' });

    await interaction.reply({ embeds: [embed] });
  },
};
