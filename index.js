const { Client, GatewayIntentBits, PermissionFlagsBits, SlashCommandBuilder, EmbedBuilder } = require('discord.js');
require('dotenv').config();

class MassUnbanBot {
    constructor() {
        this.client = new Client({
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildMembers,
                GatewayIntentBits.GuildBans,
                GatewayIntentBits.GuildMessages
            ]
        });

        this.isUnbanningInProgress = false;
        this.unbanCount = 0;
        this.failedUnbans = [];
        this.startTime = null;

        this.setupEventListeners();
        this.setupCommands();
    }

    setupEventListeners() {
        this.client.once('ready', () => {
            console.log(`✅ Bot hazır! ${this.client.user.tag} olarak giriş yapıldı.`);
            console.log(`🎯 Sunucu sayısı: ${this.client.guilds.cache.size}`);
        });

        this.client.on('error', console.error);
        this.client.on('warn', console.warn);
    }

    async setupCommands() {
        this.client.on('ready', async () => {
            const commands = [
                new SlashCommandBuilder()
                    .setName('massunban')
                    .setDescription('⚠️ Sunucudaki TÜM banlı kullanıcıları kaldırır (GERİ ALINAMAZ!)')
                    .addStringOption(option =>
                        option.setName('confirm')
                            .setDescription('Güvenlik onayı - İşlemi onaylamak için "CONFIRM" yazın')
                            .setRequired(true)
                    ),
                
                new SlashCommandBuilder()
                    .setName('banstatus')
                    .setDescription('📊 Sunucudaki ban durumunu ve bot işlemlerini kontrol eder'),
                
                new SlashCommandBuilder()
                    .setName('stopunban')
                    .setDescription('⏹️ Devam eden unban işlemini güvenli şekilde durdurur')
            ];

            try {
                console.log('🔄 Slash komutları yükleniyor...');
                
                const guild = this.client.guilds.cache.get(process.env.GUILD_ID);
                if (!guild) {
                    console.error('❌ Belirtilen sunucu bulunamadı!');
                    return;
                }

                await guild.commands.set(commands);
                console.log('✅ Slash komutları başarıyla yüklendi!');
            } catch (error) {
                console.error('❌ Komutlar yüklenirken hata:', error);
            }
        });

        this.client.on('interactionCreate', async (interaction) => {
            if (!interaction.isCommand()) return;

            try {
                await this.handleCommand(interaction);
            } catch (error) {
                console.error('Komut işlenirken hata:', error);
                
                const errorEmbed = new EmbedBuilder()
                    .setColor('#ff0000')
                    .setTitle('❌ Hata')
                    .setDescription('Komut işlenirken bir hata oluştu!')
                    .setTimestamp();

                if (interaction.replied || interaction.deferred) {
                    await interaction.editReply({ embeds: [errorEmbed] });
                } else {
                    await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
                }
            }
        });
    }

    async handleCommand(interaction) {
        // Yetki kontrolü
        if (!interaction.member.permissions.has(PermissionFlagsBits.BanMembers)) {
            const noPermEmbed = new EmbedBuilder()
                .setColor('#ff0000')
                .setTitle('❌ Yetki Hatası')
                .setDescription('Bu komutu kullanmak için **Ban Members** yetkisine sahip olmalısınız!')
                .setTimestamp();

            return await interaction.reply({ embeds: [noPermEmbed], ephemeral: true });
        }

        const { commandName } = interaction;

        switch (commandName) {
            case 'massunban':
                await this.handleMassUnban(interaction);
                break;
            case 'banstatus':
                await this.handleBanStatus(interaction);
                break;
            case 'stopunban':
                await this.handleStopUnban(interaction);
                break;
        }
    }

    async handleMassUnban(interaction) {
        const confirm = interaction.options.getString('confirm');
        
        if (confirm !== 'CONFIRM') {
            const confirmEmbed = new EmbedBuilder()
                .setColor('#ffaa00')
                .setTitle('⚠️ Güvenlik Onayı Gerekli')
                .setDescription('🔒 **Bu işlem geri alınamaz!**\n\nTüm banlı kullanıcıları kaldırmak için `confirm` parametresine **CONFIRM** yazmalısınız.')
                .addFields(
                    { name: '✅ Doğru Kullanım', value: '`/massunban confirm:CONFIRM`', inline: false },
                    { name: '⚠️ Uyarı', value: 'Bu işlem sunucudaki TÜM banları kaldıracaktır!', inline: false }
                )
                .setFooter({ text: 'Güvenlik için CONFIRM yazmanız gerekiyor' })
                .setTimestamp();

            return await interaction.reply({ embeds: [confirmEmbed], ephemeral: true });
        }

        if (this.isUnbanningInProgress) {
            const currentProgress = this.unbanCount > 0 ? 
                `${this.unbanCount} kişi kaldırıldı` : 
                'İşlem başlatılıyor...';
                
            const inProgressEmbed = new EmbedBuilder()
                .setColor('#ffaa00')
                .setTitle('⚠️ Unban İşlemi Devam Ediyor')
                .setDescription('🚫 **Şu anda bir unban işlemi aktif!**\n\nYeni işlem başlatmak için mevcut işlemin bitmesini bekleyin veya `/stopunban` komutu ile durdurun.')
                .addFields(
                    { name: '📊 Mevcut İlerleme', value: currentProgress, inline: true },
                    { name: '❌ Başarısız', value: this.failedUnbans.length.toString(), inline: true },
                    { name: '⏱️ Başlangıç Zamanı', value: `<t:${Math.floor(this.startTime / 1000)}:R>`, inline: true }
                )
                .addFields(
                    { name: '⏱️ Geçen Süre', value: this.getElapsedTime(), inline: true },
                    { name: '🛑 Durdurmak İçin', value: '`/stopunban` komutunu kullanın', inline: true },
                    { name: '📊 Durum Kontrolü', value: '`/banstatus` komutunu kullanın', inline: true }
                )
                .setFooter({ text: 'Lütfen mevcut işlemin tamamlanmasını bekleyin!' })
                .setTimestamp();

            return await interaction.reply({ embeds: [inProgressEmbed], ephemeral: true });
        }

        await interaction.deferReply();

        try {
            const guild = interaction.guild;
            const bans = await guild.bans.fetch();
            
            if (bans.size === 0) {
                const noBansEmbed = new EmbedBuilder()
                    .setColor('#00ff00')
                    .setTitle('🎉 Ban Listesi Temiz!')
                    .setDescription('✅ **Bu sunucuda hiç banlı kullanıcı bulunmuyor!**\n\nTebrikler, sunucunuzda kaldırılacak ban yok.')
                    .addFields({
                        name: '💡 Bilgi',
                        value: 'Eğer yeni banlar eklenirse bu komutu tekrar kullanabilirsiniz.',
                        inline: false
                    })
                    .setFooter({ text: 'Temiz sunucu = Mutlu topluluk! 🎉' })
                    .setTimestamp();

                return await interaction.editReply({ embeds: [noBansEmbed] });
            }

            const startEmbed = new EmbedBuilder()
                .setColor('#0099ff')
                .setTitle('🚀 Toplu Unban İşlemi Başlatıldı')
                .setDescription(`🎯 **${bans.size}** banlı kullanıcı tespit edildi!\n\n🔄 **Unban işlemi başlatılıyor...**`)
                .addFields(
                    { name: '⏱️ Tahmini Tamamlanma Süresi', value: this.calculateEstimatedTime(bans.size), inline: true },
                    { name: '🔄 API Rate Limit Koruması', value: `${process.env.UNBAN_DELAY || 1000}ms gecikme`, inline: true },
                    { name: '📊 İşlenecek Toplam', value: `${bans.size} kişi`, inline: true }
                )
                .addFields({
                    name: '⚠️ Önemli Bilgiler',
                    value: '• İşlem devam ederken yeni unban başlatılamaz\n• `/stopunban` ile güvenli şekilde durdurabilirsiniz\n• `/banstatus` ile ilerlemeyi takip edebilirsiniz\n• 15 dakikadan uzun süren işlemlerde sonuç kanal mesajı olarak gelir',
                    inline: false
                })
                .setFooter({ text: '🚫 İşlem devam ederken başka unban komutu çalıştırmayın!' })
                .setTimestamp();

            await interaction.editReply({ embeds: [startEmbed] });

            await this.startMassUnban(guild, interaction);

        } catch (error) {
            console.error('Mass unban başlatılırken hata:', error);
            
            const errorEmbed = new EmbedBuilder()
                .setColor('#ff0000')
                .setTitle('❌ Hata')
                .setDescription(`Unban işlemi başlatılırken hata oluştu:\n\`\`\`${error.message}\`\`\``)
                .setTimestamp();

            await interaction.editReply({ embeds: [errorEmbed] });
        }
    }

    async handleBanStatus(interaction) {
        await interaction.deferReply();

        try {
            const guild = interaction.guild;
            const bans = await guild.bans.fetch();

            const statusEmbed = new EmbedBuilder()
                .setTitle('📊 Sunucu Ban Durumu')
                .addFields(
                    { name: '🚫 Toplam Banlı Kullanıcı', value: bans.size.toString(), inline: true },
                    { name: '🤖 Bot Durumu', value: this.isUnbanningInProgress ? '🔄 **Aktif İşlem Var**' : '⏸️ **Beklemede**', inline: true },
                    { name: '🔄 İşlem Durumu', value: this.isUnbanningInProgress ? '✅ Unban işlemi devam ediyor' : '❌ Herhangi bir işlem yok', inline: false }
                );

            if (this.isUnbanningInProgress) {
                const progress = bans.size > 0 ? ((this.unbanCount / bans.size) * 100).toFixed(1) : '0';
                const progressBar = this.createProgressBar(this.unbanCount, bans.size, 15);
                
                statusEmbed
                    .setColor('#ff9900')
                    .setDescription(`🔄 **Aktif Unban İşlemi Devam Ediyor**\n\n${progressBar}\n**İlerleme: %${progress}**`)
                    .addFields(
                        { name: '✅ Başarıyla Kaldırılan', value: this.unbanCount.toString(), inline: true },
                        { name: '❌ Başarısız Olan', value: this.failedUnbans.length.toString(), inline: true },
                        { name: '📊 Kalan', value: (bans.size - this.unbanCount).toString(), inline: true }
                    )
                    .addFields(
                        { name: '⏱️ Başlangıç Zamanı', value: `<t:${Math.floor(this.startTime / 1000)}:R>`, inline: true },
                        { name: '🕐 Geçen Süre', value: this.getElapsedTime(), inline: true },
                        { name: '🕒 Tahmini Kalan Süre', value: this.calculateRemainingTime(bans.size), inline: true }
                    )
                    .setFooter({ text: '⚠️ İşlem devam ederken yeni unban başlatılamaz!' });
            } else {
                statusEmbed
                    .setColor('#00ff00')
                    .setDescription('✅ **Bot hazır ve beklemede**\n\nYeni unban işlemi başlatmak için `/massunban` komutunu kullanabilirsiniz.');
                    
                if (bans.size > 0) {
                    statusEmbed.addFields({
                        name: '💡 Önerilen İşlem',
                        value: `\`/massunban confirm:CONFIRM\` komutu ile ${bans.size} banlı kullanıcıyı kaldırabilirsiniz.`,
                        inline: false
                    });
                } else {
                    statusEmbed.addFields({
                        name: '🎉 Durum',
                        value: 'Bu sunucuda hiç banlı kullanıcı bulunmuyor!',
                        inline: false
                    });
                }
            }

            statusEmbed.setTimestamp();
            await interaction.editReply({ embeds: [statusEmbed] });

        } catch (error) {
            console.error('Ban status kontrol edilirken hata:', error);
            
            const errorEmbed = new EmbedBuilder()
                .setColor('#ff0000')
                .setTitle('❌ Hata')
                .setDescription(`Ban durumu kontrol edilirken hata oluştu:\n\`\`\`${error.message}\`\`\``)
                .setTimestamp();

            await interaction.editReply({ embeds: [errorEmbed] });
        }
    }

    async handleStopUnban(interaction) {
        if (!this.isUnbanningInProgress) {
            const notRunningEmbed = new EmbedBuilder()
                .setColor('#ffaa00')
                .setTitle('⚠️ Aktif İşlem Bulunamadı')
                .setDescription('🔍 **Şu anda devam eden bir unban işlemi bulunmuyor!**\n\nEğer yeni bir işlem başlatmak istiyorsanız `/massunban` komutunu kullanabilirsiniz.')
                .addFields(
                    { name: '💡 Önerilen Komutlar', value: '• `/banstatus` - Ban durumunu kontrol et\n• `/massunban` - Yeni unban işlemi başlat', inline: false }
                )
                .setTimestamp();

            return await interaction.reply({ embeds: [notRunningEmbed], ephemeral: true });
        }

        // İşlemi durdur
        this.isUnbanningInProgress = false;

        const stoppedEmbed = new EmbedBuilder()
            .setColor('#ff6600')
            .setTitle('⏹️ Unban İşlemi Durduruldu')
            .setDescription('🛑 **İşlem kullanıcı tarafından güvenli şekilde durduruldu.**\n\nİşlem özeti aşağıda belirtilmiştir.')
            .addFields(
                { name: '✅ Başarıyla Kaldırılan', value: `${this.unbanCount} kişi`, inline: true },
                { name: '❌ Başarısız Olan', value: `${this.failedUnbans.length} kişi`, inline: true },
                { name: '📊 Toplam İşlenen', value: `${this.unbanCount + this.failedUnbans.length} kişi`, inline: true }
            )
            .addFields(
                { name: '⏱️ Toplam Çalışma Süresi', value: this.getElapsedTime(), inline: true },
                { name: '⚡ Ortalama Hız', value: this.unbanCount > 0 ? `${(this.unbanCount / ((Date.now() - this.startTime) / 1000)).toFixed(2)} kişi/saniye` : 'N/A', inline: true },
                { name: '🔄 Yeni İşlem', value: 'Artık yeni unban işlemi başlatabilirsiniz', inline: true }
            )
            .setFooter({ text: 'İşlem güvenli şekilde sonlandırıldı' })
            .setTimestamp();

        await interaction.reply({ embeds: [stoppedEmbed] });
    }

    async startMassUnban(guild, interaction) {
        this.isUnbanningInProgress = true;
        this.unbanCount = 0;
        this.failedUnbans = [];
        this.startTime = Date.now();

        try {
            const bans = await guild.bans.fetch();
            const totalBans = bans.size;
            const delay = parseInt(process.env.UNBAN_DELAY) || 1000;

            console.log(`🚀 ${totalBans} kişinin banını kaldırma işlemi başlatıldı...`);

            let progressUpdateCount = 0;
            const updateInterval = Math.max(Math.floor(totalBans / 20), 10); // Her %5'te bir güncelle
            let canUpdateProgress = true; // Webhook token kontrolü için

            for (const [userId, banInfo] of bans) {
                if (!this.isUnbanningInProgress) {
                    console.log('⏹️ İşlem kullanıcı tarafından durduruldu.');
                    break;
                }

                try {
                    await guild.members.unban(userId, 'Toplu unban işlemi');
                    this.unbanCount++;
                    
                    if (process.env.ENABLE_LOGGING === 'true') {
                        console.log(`✅ ${banInfo.user?.tag || userId} banı kaldırıldı (${this.unbanCount}/${totalBans})`);
                    }

                    // İlerleme güncellemesi (webhook token geçerliyse)
                    progressUpdateCount++;
                    if (progressUpdateCount >= updateInterval && canUpdateProgress) {
                        canUpdateProgress = await this.updateProgress(interaction, totalBans);
                        progressUpdateCount = 0;
                    }

                } catch (error) {
                    this.failedUnbans.push({
                        userId,
                        username: banInfo.user?.tag || 'Unknown',
                        error: error.message
                    });
                    
                    console.error(`❌ ${banInfo.user?.tag || userId} banı kaldırılamadı:`, error.message);
                }

                // Rate limit koruması
                await this.sleep(delay);
            }

            await this.finishUnbanProcess(interaction, totalBans);

        } catch (error) {
            console.error('Mass unban işlemi sırasında hata:', error);
            this.isUnbanningInProgress = false;
            
            const errorEmbed = new EmbedBuilder()
                .setColor('#ff0000')
                .setTitle('❌ Fatal Hata')
                .setDescription(`Unban işlemi sırasında fatal hata oluştu:\n\`\`\`${error.message}\`\`\``)
                .setTimestamp();

            try {
                await interaction.editReply({ embeds: [errorEmbed] });
            } catch (e) {
                console.error('Hata mesajı gönderilemedi:', e);
            }
        }
    }

    async updateProgress(interaction, totalBans) {
        try {
            const progress = ((this.unbanCount / totalBans) * 100).toFixed(1);
            const progressBar = this.createProgressBar(this.unbanCount, totalBans);
            
            const progressEmbed = new EmbedBuilder()
                .setColor('#0099ff')
                .setTitle('🔄 Unban İşlemi Devam Ediyor')
                .setDescription(`**İlerleme:** ${progress}%\n${progressBar}`)
                .addFields(
                    { name: '✅ Kaldırılan', value: this.unbanCount.toString(), inline: true },
                    { name: '❌ Başarısız', value: this.failedUnbans.length.toString(), inline: true },
                    { name: '📊 Toplam', value: totalBans.toString(), inline: true }
                )
                .addFields(
                    { name: '⏱️ Geçen Süre', value: this.getElapsedTime(), inline: true },
                    { name: '🕐 Tahmini Kalan', value: this.calculateRemainingTime(totalBans), inline: true }
                )
                .setTimestamp();

            await interaction.editReply({ embeds: [progressEmbed] });
        } catch (error) {
            console.error('İlerleme güncellenirken hata:', error);
            // Webhook token süresi dolduysa ilerleme güncellemesini durdur
            if (error.code === 50027) {
                console.log('⚠️ Webhook token süresi doldu, ilerleme güncellemeleri durduruluyor.');
                return false; // İlerleme güncellemelerini durdur
            }
        }
        return true; // İlerleme güncellemeleri devam edebilir
    }

    async finishUnbanProcess(interaction, totalBans) {
        this.isUnbanningInProgress = false;
        const endTime = Date.now();
        const totalTime = endTime - this.startTime;

        console.log(`🏁 Unban işlemi tamamlandı!`);
        console.log(`✅ Başarılı: ${this.unbanCount}`);
        console.log(`❌ Başarısız: ${this.failedUnbans.length}`);
        console.log(`⏱️ Toplam Süre: ${this.formatTime(totalTime)}`);

        const completedEmbed = new EmbedBuilder()
            .setColor('#00ff00')
            .setTitle('🎉 Unban İşlemi Tamamlandı!')
            .addFields(
                { name: '✅ Başarıyla Kaldırılan', value: this.unbanCount.toString(), inline: true },
                { name: '❌ Başarısız', value: this.failedUnbans.length.toString(), inline: true },
                { name: '📊 Toplam İşlenen', value: totalBans.toString(), inline: true }
            )
            .addFields(
                { name: '⏱️ Toplam Süre', value: this.formatTime(totalTime), inline: true },
                { name: '⚡ Ortalama Hız', value: `${(this.unbanCount / (totalTime / 1000)).toFixed(2)} kişi/saniye`, inline: true }
            )
            .setTimestamp();

        if (this.failedUnbans.length > 0) {
            const failedList = this.failedUnbans.slice(0, 10).map(fail => 
                `• ${fail.username} - ${fail.error}`
            ).join('\n');
            
            completedEmbed.addFields({
                name: '❌ Başarısız Olanlar (İlk 10)',
                value: `\`\`\`${failedList}\`\`\``,
                inline: false
            });

            if (this.failedUnbans.length > 10) {
                completedEmbed.setFooter({ 
                    text: `Ve ${this.failedUnbans.length - 10} tane daha...` 
                });
            }
        }

        try {
            await interaction.editReply({ embeds: [completedEmbed] });
        } catch (error) {
            console.error('Son mesaj gönderilemedi:', error);
            
            // Webhook token süresi dolduysa, kanal üzerinden mesaj gönder
            if (error.code === 50027) { // Invalid Webhook Token
                try {
                    const channel = interaction.channel;
                    if (channel) {
                        await channel.send({ 
                            content: `<@${interaction.user.id}> Unban işleminiz tamamlandı!`,
                            embeds: [completedEmbed] 
                        });
                        console.log('✅ Sonuç mesajı kanal üzerinden gönderildi.');
                    }
                } catch (channelError) {
                    console.error('Kanal üzerinden mesaj gönderilemedi:', channelError);
                }
            }
        }
    }

    createProgressBar(current, total, length = 20) {
        const percentage = current / total;
        const filledLength = Math.round(length * percentage);
        const emptyLength = length - filledLength;
        
        const filledBar = '█'.repeat(filledLength);
        const emptyBar = '░'.repeat(emptyLength);
        
        return `[${filledBar}${emptyBar}] ${current}/${total}`;
    }

    calculateEstimatedTime(totalBans) {
        const delay = parseInt(process.env.UNBAN_DELAY) || 1000;
        const totalSeconds = (totalBans * delay) / 1000;
        return this.formatTime(totalSeconds * 1000);
    }

    calculateRemainingTime(totalBans) {
        if (this.unbanCount === 0) return 'Hesaplanıyor...';
        
        const elapsed = Date.now() - this.startTime;
        const averageTime = elapsed / this.unbanCount;
        const remaining = (totalBans - this.unbanCount) * averageTime;
        
        return this.formatTime(remaining);
    }

    getElapsedTime() {
        if (!this.startTime) return '0 saniye';
        return this.formatTime(Date.now() - this.startTime);
    }

    formatTime(milliseconds) {
        const seconds = Math.floor(milliseconds / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);

        if (hours > 0) {
            return `${hours}s ${minutes % 60}d ${seconds % 60}sn`;
        } else if (minutes > 0) {
            return `${minutes}d ${seconds % 60}sn`;
        } else {
            return `${seconds}sn`;
        }
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async start() {
        try {
            await this.client.login(process.env.DISCORD_TOKEN);
        } catch (error) {
            console.error('❌ Bot başlatılamadı:', error);
            process.exit(1);
        }
    }
}

// Bot'u başlat
const bot = new MassUnbanBot();
bot.start();

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Bot kapatılıyor...');
    bot.client.destroy();
    process.exit(0);
});

process.on('unhandledRejection', (error) => {
    console.error('Unhandled promise rejection:', error);
});

module.exports = MassUnbanBot;
