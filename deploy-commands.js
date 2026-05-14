require('dotenv').config();
const { REST, Routes, SlashCommandBuilder } = require('discord.js');

const commands = [
  new SlashCommandBuilder().setName('ping').setDescription('Check if Namjoon is awake'),
  new SlashCommandBuilder().setName('start').setDescription('Create a profile'),
  new SlashCommandBuilder().setName('balance').setDescription('Show your coins, ivy and cards'),
  new SlashCommandBuilder().setName('daily').setDescription('Claim your daily reward'),
  new SlashCommandBuilder().setName('weekly').setDescription('Claim your weekly reward'),
  new SlashCommandBuilder().setName('monthly').setDescription('Claim your monthly reward'),
  new SlashCommandBuilder().setName('work').setDescription('Help out bangtan to earn rewards'),
  new SlashCommandBuilder().setName('inventory').setDescription('Show your collected cards'),
  new SlashCommandBuilder().setName('claim').setDescription('Claim a random card every 30 seconds'),
  new SlashCommandBuilder().setName('overview').setDescription('Show all commands'),
  new SlashCommandBuilder().setName('packs').setDescription('Show your unopened card packs'),
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
      { name: 'Limited', value: 'limited' }
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
      ),
  new SlashCommandBuilder()
    .setName('openpack')
    .setDescription('Open one of your card packs')
    .addStringOption(o =>
      o.setName('size')
        .setDescription('Which pack?')
        .setRequired(true)
        .addChoices(
          { name: '5-card pack', value: 'pack5' },
          { name: '10-card pack', value: 'pack10' },
          { name: '20-card pack', value: 'pack20' }
        )
    ),
  new SlashCommandBuilder().setName('drop').setDescription('Drop 3 cards')
].map(c => c.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

async function main() {
  await rest.put(
    Routes.applicationGuildCommands(process.env.CLIENT_ID, '1433981066372317194'),
    { body: commands }
  );
  console.log('Guild slash commands registered');
}
main();
