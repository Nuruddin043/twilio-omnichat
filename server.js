import express from 'express';
import axios from 'axios';
import dotenv from 'dotenv';
import twilio from 'twilio';
import morgan  from 'morgan';

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

async function findOrCreateContact(msisdn) {
    const bearer = await getBearer();

    /* 1 – lookup */
    const look = await axios.get(`${OMNI_BASE}/contact`, {
        params: { apiAccountId: OMNI_API_ACCOUNT_ID, mobileNumber: msisdn },
        headers: { Authorization: `Bearer ${bearer}` }
    });
    if (look.data.items?.length) return look.data.items[0].contactId;

    /* 2 – create Presubscribed contact */
    const create = await axios.post(
        `${OMNI_BASE}/contact`,
        {
            mobileNumber: msisdn,
            name: msisdn,
            status: 'Presubscribed',
            apiAccountId: OMNI_API_ACCOUNT_ID
        },
        { headers: { Authorization: `Bearer ${bearer}` } }
    );
    return create.data.contactId;
}

/* ─── WhatsApp template broadcast ───────────────────────────────────── */
async function sendWhatsApp(contactId) {
    const bearer = await getBearer();
    await axios.post(
        `${OMNI_BASE}/broadcast`,
        {
            apiAccountId: OMNI_API_ACCOUNT_ID,
            contactId,
            templateId: OMNI_TEMPLATE_ID,
            message: ''
        },
        { headers: { Authorization: `Bearer ${bearer}` } }
    );
}
/* ── express app ── */
const app = express();

/* 1️⃣  Honour X-Forwarded-Proto so req.protocol === 'https' */
app.set('trust proxy', true);

/* Custom morgan format */
morgan.token('real-ip', (req) => req.ip || req.headers['x-forwarded-for'] || '-');
app.use(
  morgan(
    ':real-ip │ :method :url │ :status │ :response-time ms │ :res[content-length]b │ ":user-agent"'
  )
);

//  express.raw({ type: 'application/x-www-form-urlencoded' }),
app.post(
    '/twilio/voice',
   
    twilio.webhook(TWILIO_AUTH_TOKEN, { validate: true, protocol: 'https' }),
    async (req, res) => {
        const params = new URLSearchParams(req.body.toString());
        const caller = params.get('From');               // +447…
        console.log('Incoming call from', caller);

        /* A. respond instantly with <Hangup/> */
        const vr = new twiml.VoiceResponse();
        vr.hangup();
        res.type('text/xml').send(vr.toString());

        /* B. fire WhatsApp in background */
        try {
            const contactId = await findOrCreateContact(caller);
            console.log('contactId', contactId);
            await sendWhatsApp(contactId);
            console.log('WhatsApp template sent →', caller);
        } catch (err) {
            console.error('OmniChat error', err.response?.data || err.message);
        }
    }
);

app.use(express.urlencoded({ extended: false })); // Twilio posts url-encoded
app.use(express.json());


app.get('/', (_, res) => res.send('OK'));
app.listen(PORT, () => console.log(`🚀 Listening on :${PORT}`));
