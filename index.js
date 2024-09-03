const TelegramBot = require('node-telegram-bot-api');
const mysql = require('mysql');
const token = '7228644495:AAEm6iVfJU11tSH1WozVLH9IacJQdezAJ3Q';
const bot = new TelegramBot(token, {
    polling: true,
    request: {
        agentOptions: {
            keepAlive: true,
            family: 4
        }
    }
});

const adminChatId = 7477779576; // Admin kullanıcısının chat ID'si

const pool = mysql.createPool({
    connectionLimit: 10,
    host: 'localhost',

    user: 'root',
    password: '',
    database: 'mydata'
});

const userStates = {};

bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id, "Botunuz başarıyla başlatıldı!");
});

bot.onText(/\/kayıt (.+) (.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    const username = match[1];
    const password = match[2];

    const sql = `INSERT INTO users (telegram_username, telegram_password, balance, active) VALUES (?, ?, 0, 0)`;
    pool.query(sql, [username, password], (err, result) => {
        if (err) {
            console.error('Kayıt hatası:', err);
            bot.sendMessage(chatId, "Kayıt sırasında bir hata oluştu: " + err.message);
        } else {
            bot.sendMessage(chatId, "Başarıyla kayıt oldunuz! Lütfen giriş yapabilmek için admin onayı bekleyin.");
            bot.sendMessage(adminChatId, `@${username} kullanıcısı kayıt oldu. Onaylamak için /onay @${username} yazın.`)
                .catch((error) => {
                    console.error('Admin chat_id hata:', error);
                });
        }
    });
});

bot.onText(/\/giriş (.+) (.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    const username = match[1];
    const password = match[2];

    const sql = `SELECT * FROM users WHERE telegram_username = ? AND telegram_password = ? AND active = 1`;
    pool.query(sql, [username, password], (err, results) => {
        if (err) {
            console.error('Giriş hatası:', err);
            bot.sendMessage(chatId, "Veritabanı hatası: " + err.message);
            return;
        }

        if (results.length === 0) {
            bot.sendMessage(chatId, "Kullanıcı adı veya şifre yanlış ya da hesabınız henüz onaylanmadı.");
            return;
        }

        const user = results[0];
        userStates[chatId] = {
            userId: user.id,
            username: user.telegram_username
        };
        bot.sendMessage(chatId, `Hoş geldiniz ${user.telegram_username}! Oturumunuz açıldı.`);
    });
});

bot.onText(/\/onay @(\w+)/, (msg, match) => {
    const chatId = msg.chat.id;
    const username = match[1];

    if (msg.from.id !== adminChatId) {
        bot.sendMessage(chatId, "Bu komutu kullanma yetkiniz yok.");
        return;
    }

    const sqlUpdateActive = `UPDATE users SET active = 1 WHERE telegram_username = ?`;
    pool.query(sqlUpdateActive, [username], (err, result) => {
        if (err) {
            console.error('Onay hatası:', err);
            bot.sendMessage(chatId, "Veritabanı hatası: " + err.message);
            return;
        }

        if (result.affectedRows === 0) {
            bot.sendMessage(chatId, "Kullanıcı bulunamadı.");
            return;
        }

        bot.sendMessage(chatId, `@${username} kullanıcısı başarıyla onaylandı.`);
    });
});

bot.onText(/\/buy/, (msg) => {
    const chatId = msg.chat.id;
    if (!userStates[chatId]) {
        bot.sendMessage(chatId, "Lütfen önce giriş yapın: /giriş [kullanıcı adı] [şifre]");
        return;
    }

    const opts = {
        reply_markup: {
            inline_keyboard: [
                [{ text: 'e-Devlet Satın Al', callback_data: 'edevlet' }],
                [{ text: 'Sahibinden Satın Al', callback_data: 'sahibinden' }],
                [{ text: 'Bakiye Yükle', callback_data: 'bakiye_yukle' }],
                [{ text: 'Fiyatları Göster', callback_data: 'fiyatlar' }],
                [{ text: 'Bakiyem Ne Kadar?', callback_data: 'bakiyem' }]
            ]
        }
    };
    bot.sendMessage(chatId, 'Aşağıdaki seçeneklerden birini seçin:', opts);
});

bot.on('callback_query', (callbackQuery) => {
    const msg = callbackQuery.message;
    const data = callbackQuery.data;
    const chatId = msg.chat.id;

    if (!userStates[chatId]) {
        bot.sendMessage(chatId, "Lütfen önce giriş yapın: /giriş [kullanıcı adı] [şifre]");
        return;
    }

    const user = userStates[chatId];
    const userId = user.userId;

    if (data === 'edevlet') {
        const opts = {
            reply_markup: {
                inline_keyboard: [
                    [{ text: 'Tek Hesap', callback_data: 'edevlet_tek' }],
                    [{ text: 'Çift Hesap', callback_data: 'edevlet_cift' }],
                    [{ text: 'Geri Dön', callback_data: 'geri_don' }]
                ]
            }
        };
        bot.sendMessage(chatId, 'Aşağıdaki seçeneklerden birini seçin:', opts);
    } else if (data === 'edevlet_tek' || data === 'edevlet_cift') {
        const numAccounts = data === 'edevlet_tek' ? 1 : 2;
        const table = 'site_a_accounts';
        const accountPrice = 2 * numAccounts;

        const sqlGetAccounts = `SELECT * FROM ${table} WHERE user_id IS NULL LIMIT ?`;
        pool.query(sqlGetAccounts, [numAccounts], (err, results) => {
            if (err) {
                console.error('Hesap alma hatası:', err);
                bot.sendMessage(chatId, "Veritabanı hatası: " + err.message);
                return;
            }

            if (results.length < numAccounts) {
                bot.sendMessage(chatId, `${numAccounts} adet e-Devlet hesabı bulunamadı.`);
                return;
            }

            let accountInfo = "";
            const accountIds = results.map(account => {
                accountInfo += `ID: ${account.site_id}, Password: ${account.site_password}\n`;
                return account.id;
            });

            const sqlGetUser = `SELECT * FROM users WHERE id = ?`;
            pool.query(sqlGetUser, [userId], (err, userResults) => {
                if (err) {
                    console.error('Kullanıcı alma hatası:', err);
                    bot.sendMessage(chatId, "Veritabanı hatası: " + err.message);
                    return;
                }

                if (userResults.length === 0) {
                    bot.sendMessage(chatId, "Kullanıcı bulunamadı. Öncelikle kayıt olmanız gerekiyor.");
                    return;
                }

                const currentUser = userResults[0];
                if (currentUser.balance < accountPrice) {
                    bot.sendMessage(chatId, "Yetersiz bakiye. Lütfen önce bakiye yükleyin.");
                    return;
                }

                const sqlUpdateAccounts = `UPDATE ${table} SET user_id = ? WHERE id IN (?)`;
                pool.query(sqlUpdateAccounts, [userId, accountIds], (err, result) => {
                    if (err) {
                        console.error('Hesap güncelleme hatası:', err);
                        bot.sendMessage(chatId, "Veritabanı hatası: " + err.message);
                        return;
                    }

                    const newBalance = currentUser.balance - accountPrice;
                    const sqlUpdateBalance = `UPDATE users SET balance = ? WHERE id = ?`;
                    pool.query(sqlUpdateBalance, [newBalance, userId], (err, result) => {
                        if (err) {
                            console.error('Bakiye güncelleme hatası:', err);
                            bot.sendMessage(chatId, "Veritabanı hatası: " + err.message);
                            return;
                        }

                        bot.sendMessage(chatId, `Başarıyla ${numAccounts} adet e-Devlet hesabı satın aldınız! Kalan bakiye: ${newBalance}\n${accountInfo}`);
                    });
                });
            });
        });
    } else if (data === 'sahibinden') {
        const opts = {
            reply_markup: {
                inline_keyboard: [
                    [{ text: 'Tek Hesap', callback_data: 'sahibinden_tek' }],
                    [{ text: 'Çift Hesap', callback_data: 'sahibinden_cift' }],
                    [{ text: 'Geri Dön', callback_data: 'geri_don' }]
                ]
            }
        };
        bot.sendMessage(chatId, 'Aşağıdaki seçeneklerden birini seçin:', opts);
    } else if (data === 'sahibinden_tek' || data === 'sahibinden_cift') {
        const numAccounts = data === 'sahibinden_tek' ? 1 : 2;
        const table = 'site_b_accounts';
        const accountPrice = 7 * numAccounts;

        const sqlGetAccounts = `SELECT * FROM ${table} WHERE user_id IS NULL LIMIT ?`;
        pool.query(sqlGetAccounts, [numAccounts], (err, results) => {
            if (err) {
                console.error('Hesap alma hatası:', err);
                bot.sendMessage(chatId, "Veritabanı hatası: " + err.message);
                return;
            }

            if (results.length < numAccounts) {
                bot.sendMessage(chatId, `${numAccounts} adet Sahibinden hesabı bulunamadı.`);
                return;
            }

            let accountInfo = "";
            const accountIds = results.map(account => {
                accountInfo += `ID: ${account.site_id}, Password: ${account.site_password}\n`;
                return account.id;
            });

            const sqlGetUser = `SELECT * FROM users WHERE id = ?`;
            pool.query(sqlGetUser, [userId], (err, userResults) => {
                if (err) {
                    console.error('Kullanıcı alma hatası:', err);
                    bot.sendMessage(chatId, "Veritabanı hatası: " + err.message);
                    return;
                }

                if (userResults.length === 0) {
                    bot.sendMessage(chatId, "Kullanıcı bulunamadı. Öncelikle kayıt olmanız gerekiyor.");
                    return;
                }

                const currentUser = userResults[0];
                if (currentUser.balance < accountPrice) {
                    bot.sendMessage(chatId, "Yetersiz bakiye. Lütfen önce bakiye yükleyin.");
                    return;
                }

                const sqlUpdateAccounts = `UPDATE ${table} SET user_id = ? WHERE id IN (?)`;
                pool.query(sqlUpdateAccounts, [userId, accountIds], (err, result) => {
                    if (err) {
                        console.error('Hesap güncelleme hatası:', err);
                        bot.sendMessage(chatId, "Veritabanı hatası: " + err.message);
                        return;
                    }

                    const newBalance = currentUser.balance - accountPrice;
                    const sqlUpdateBalance = `UPDATE users SET balance = ? WHERE id = ?`;
                    pool.query(sqlUpdateBalance, [newBalance, userId], (err, result) => {
                        if (err) {
                            console.error('Bakiye güncelleme hatası:', err);
                            bot.sendMessage(chatId, "Veritabanı hatası: " + err.message);
                            return;
                        }

                        bot.sendMessage(chatId, `Başarıyla ${numAccounts} adet Sahibinden hesabı satın aldınız! Kalan bakiye: ${newBalance}\n${accountInfo}`);
                    });
                });
            });
        });
    } else if (data === 'bakiye_yukle') {
        bot.sendMessage(chatId, "Lütfen /bakiye + yüklemek istediğiniz tutarı girin. Örneğin: /bakiye 20");
    } else if (data === 'fiyatlar') {
        const priceInfo = "e-Devlet hesap fiyatı: 2 TL\nSahibinden hesap fiyatı: 7 TL\n";
        bot.sendMessage(chatId, priceInfo);
    } else if (data === 'bakiyem') {
        const sqlGetUser = `SELECT balance FROM users WHERE id = ?`;
        pool.query(sqlGetUser, [userId], (err, results) => {
            if (err) {
                console.error('Bakiyeyi alma hatası:', err);
                bot.sendMessage(chatId, "Veritabanı hatası: " + err.message);
                return;
            }

            if (results.length === 0) {
                bot.sendMessage(chatId, "Kullanıcı bulunamadı. Öncelikle kayıt olmanız gerekiyor.");
                return;
            }

            const currentUser = results[0];
            bot.sendMessage(chatId, `Bakiyeniz: ${currentUser.balance} TL`);
        });
    } else if (data === 'geri_don') {
        bot.sendMessage(chatId, "Ana menüye dönmek için /keyboard yazabilirsiniz.");
    }
});

bot.onText(/\/bakiye (\d+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const amount = parseInt(match[1], 10);
    const user = userStates[chatId];

    if (!user) {
        bot.sendMessage(chatId, "Lütfen önce giriş yapın: /giriş [kullanıcı adı] [şifre]");
        return;
    }

    try {
        await bot.sendMessage(adminChatId, `@${user.username} ${amount} TL yüklemek istiyor. Onaylıyorsanız /yukle @${user.username} ${amount} yazın.`);
        bot.sendMessage(chatId, "Lütfen adminden onay bekleyiniz. Yüklenince bakiyenize yansıyacaktır.");
    } catch (error) {
        console.error('Admin chat_id hata:', error);
    }
});

bot.onText(/\/yukle @(\w+) (\d+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const username = match[1];
    const amount = parseInt(match[2], 10);

    if (msg.from.id !== adminChatId) {
        bot.sendMessage(chatId, "Bu komutu kullanma yetkiniz yok.");
        return;
    }

    const sqlGetUser = `SELECT * FROM users WHERE telegram_username = ?`;
    try {
        await pool.query(sqlGetUser, [username], (err, results) => {
            if (err) {
                console.error('Kullanıcı alma hatası:', err);
                bot.sendMessage(chatId, "Veritabanı hatası: " + err.message);
                return;
            }

            if (results.length === 0) {
                bot.sendMessage(chatId, "Kullanıcı bulunamadı.");
                return;
            }

            const user = results[0];
            const newBalance = user.balance + amount;
            const sqlUpdateBalance = `UPDATE users SET balance = ? WHERE id = ?`;
            pool.query(sqlUpdateBalance, [newBalance, user.id], (err, result) => {
                if (err) {
                    console.error('Bakiye güncelleme hatası:', err);
                    bot.sendMessage(chatId, "Veritabanı hatası: " + err.message);
                    return;
                }

                bot.sendMessage(chatId, `Başarıyla @${username} kullanıcısına ${amount} TL yüklendi. Yeni bakiye: ${newBalance} TL`);
            });
        });
    } catch (err) {
        console.error('Bakiye yükleme hatası:', err);
    }
});

bot.on('polling_error', (err) => {
    console.error("Polling error: ", err.code);
    if (err.code === 'EFATAL') {
        console.log("Fatal error occurred. Restarting polling...");
        bot.stopPolling();
        setTimeout(() => bot.startPolling(), 5000);
    }
});

bot.on('message', (msg) => {
    if (!msg.text.startsWith('/')) {
        bot.sendMessage(msg.chat.id, "Bu mesaj bir komut değil. Lütfen geçerli bir komut girin.");
    }
});

console.log('Bot çalışıyor...');
