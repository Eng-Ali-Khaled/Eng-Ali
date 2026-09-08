const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const pino = require('pino');
const fs = require('fs');

const DATA_FILE = './data_ali.json';
const BLOCK_DURATION_HOURS = 5; // مدة الحظر المؤقت بعد إرسال الرسالة (5 ساعات)

const AUTO_REPLY_MESSAGE = `🌷 أهلًا وسهلًا بحضرتكم
💻 معكم فريق (AK Tech) للحلول البرمجية الذكية، برئاسة :

✦ (المهندس التقني: علي خالد) ✦
━━━━━━━━━━━━━━━
🕐 أوقات الدوام :

📅 جميع أيام الأسبوع: ⏰ من الساعة (9:00) صباحاً إلى (7:00) مساءً .
━━━━━━━━━━━━━━━
⚠️ نعتذر منكم عن عدم إمكانية الرد على الرسائل بعد انتهاء أوقات الدوام .

📋 لطلب الخدمة أو الاستفسار:
يرجى كتابة رسالتكم  وسوف يتم الرد عليكم في أسرع وقت ممكن خلال أوقات الدوام .

━━━━━━━━━━━━━━━
🌹 نتمنى لكم تجربة مميزة 
مع ( AK Tech ) .`;

function loadData() {
    if (!fs.existsSync(DATA_FILE)) return { userBlockedUntilMap: {} };
    try {
        const fileContent = fs.readFileSync(DATA_FILE, 'utf8');
        if (!fileContent.trim()) return { userBlockedUntilMap: {} };
        const data = JSON.parse(fileContent);
        if (data.userBlockedUntilMap === undefined) data.userBlockedUntilMap = {};
        return data;
    } catch (e) {
        return { userBlockedUntilMap: {} };
    }
}

function saveData(data) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function getSenderNumber(msg) {
    if (!msg || !msg.key) return '';
    
    const possibleSources = [
        msg.key.remoteJidAlt,
        msg.key.participant,
        msg.key.remoteJid
    ];

    for (let source of possibleSources) {
        if (source && source.includes('@s.whatsapp.net')) {
            return source.replace('@s.whatsapp.net', '').replace(/[^0-9]/g, '');
        }
    }

    const jid = msg.key.remoteJid || '';
    return jid.replace('@s.whatsapp.net', '').replace('@c.us', '').replace(/[^0-9]/g, '');
}

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_auto');
    const sock = makeWASocket({
        logger: pino({ level: 'silent' }),
        auth: state,
        printQRInTerminal: true
    });

    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        const qr = update.qr;
        if (qr) qrcode.generate(qr, { small: true });
        
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) {
                setTimeout(() => {
                    connectToWhatsApp();
                }, 7000);
            } else {
                console.log('Connection closed. You are logged out.');
            }
        }
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const from = msg.key.remoteJid;
        const senderNumber = getSenderNumber(msg);
        if (!senderNumber) return;

        const now = new Date().getTime();
        let data = loadData();

        // تنظيف أوتوماتيكي للمحظورين منتهي الصلاحية مع كل رسالة جديدة
        if (data.userBlockedUntilMap) {
            let needsSave = false;
            for (let num in data.userBlockedUntilMap) {
                if (now >= data.userBlockedUntilMap[num]) {
                    delete data.userBlockedUntilMap[num];
                    needsSave = true;
                }
            }
            if (needsSave) {
                saveData(data);
            }
        }

        // فحص الحظر المؤقت (5 ساعات)
        if (data.userBlockedUntilMap && data.userBlockedUntilMap[senderNumber]) {
            if (now < data.userBlockedUntilMap[senderNumber]) {
                return; 
            } else {
                delete data.userBlockedUntilMap[senderNumber];
                saveData(data);
            }
        }

        // إرسال الرسالة الموحدة
        await sock.sendMessage(from, { text: AUTO_REPLY_MESSAGE });

        // إضافة الرقم إلى قائمة الحظر المؤقت لمدة 5 ساعات
        if (!data.userBlockedUntilMap) data.userBlockedUntilMap = {};
        data.userBlockedUntilMap[senderNumber] = now + (BLOCK_DURATION_HOURS * 3600 * 1000);
        saveData(data);
    });
}

connectToWhatsApp();