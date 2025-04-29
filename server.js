import express from 'express';
import axios from 'axios';
import dotenv from 'dotenv';
import twilio from 'twilio';
const { twiml } = twilio;
dotenv.config();


const {
    PORT = 3000,
    TWILIO_AUTH_TOKEN,

    OMNI_USERNAME,
    OMNI_PASSWORD,
    OMNI_APP_NAME,
    OMNI_API_ACCOUNT_ID,
    OMNI_TEMPLATE_ID
} = process.env;

const OMNI_BASE = 'https://api.omnichat.co.uk';


let token = '';
let tokenExpiry = 0;

async function getBearer() {
    if (token && Date.now() < tokenExpiry - 60_000) return token; // still valid

    const { data } = await axios.post(
        `${OMNI_BASE}/oauth/token`,
        { username: OMNI_USERNAME, password: OMNI_PASSWORD },
        { headers: { 'X-Calling-Application': OMNI_APP_NAME } }
    ); // returns { access_token, expires_at } :contentReference[oaicite:0]{index=0}

    token = data.access_token;
    tokenExpiry = new Date(data.expires_at).getTime();
    return token;
}

/* ── contact helpers ── */
async function findContactByMobile(mobile) {
    const bearer = await getBearer();

    const { data } = await axios.get(
        `${OMNI_BASE}/contact`,
        {
            params: {
                apiAccountId: OMNI_API_ACCOUNT_ID,
                mobileNumber: mobile                  // filter by UK E.164 number :contentReference[oaicite:1]{index=1}
            },
            headers: { Authorization: `Bearer ${bearer}` }
        }
    );
    return data.items?.[0];                    // undefined if not found
}

async function createContact(mobile) {
    const bearer = await getBearer();

    const { data } = await axios.post(
        `${OMNI_BASE}/contact`,
        {
            mobileNumber: mobile,
            name: mobile,
            status: 'Presubscribed',
            apiAccountId: OMNI_API_ACCOUNT_ID
        },
        { headers: { Authorization: `Bearer ${bearer}` } }
    );                                         // :contentReference[oaicite:2]{index=2}
    return data;
}

/* ── broadcast helper ── */
async function sendWhatsApp(contactId, message = '') {
    const bearer = await getBearer();

    await axios.post(
        `${OMNI_BASE}/broadcast`,
        {
            apiAccountId: OMNI_API_ACCOUNT_ID,
            contactId,
            templateId: OMNI_TEMPLATE_ID,
            message: message                   // placeholders already substituted if any
        },
        { headers: { Authorization: `Bearer ${bearer}` } }
    );                                         // :contentReference[oaicite:3]{index=3}
}

/* ── express app ── */
const app = express();

/* validate Twilio signature */
const validate = twilio.webhook({ validate: true, authToken: TWILIO_AUTH_TOKEN });

app.post('/twilio/voice', validate, async (req, res) => {
    const caller = req.body.From;              // E.164 (+447…)
    console.log(`Incoming call from ${caller}`);

    /* 1️⃣ Hang up immediately */
    const vr = new twiml.VoiceResponse();
    vr.hangup();
    res.type('text/xml').send(vr.toString());

    /* 2️⃣ Background OmniChat flow */
    try {
        let contact = await findContactByMobile(caller);
        if (!contact) contact = await createContact(caller);

        await sendWhatsApp(contact.contactId, '');
        console.log(`WhatsApp broadcast sent → ${caller}`);
    } catch (err) {
        console.error('OmniChat error', err.response?.data || err.message);
    }
});


app.use(express.urlencoded({ extended: false })); // Twilio posts url-encoded
app.use(express.json());


app.get('/', (_, res) => res.send('OK'));
app.listen(PORT, () => console.log(`🚀 Listening on :${PORT}`));
