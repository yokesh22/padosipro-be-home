import config from '../config/index.js';

const BREVO_SEND_URL = 'https://api.brevo.com/v3/smtp/email';

interface SendEmailInput {
    to: string;
    subject: string;
    text: string;
    html: string;
}

// Sends one transactional email through Brevo's REST API.
const sendEmail = async ({ to, subject, text, html }: SendEmailInput): Promise<void> => {
    const response = await fetch(BREVO_SEND_URL, {
        method: 'POST',
        headers: {
            'api-key': config.brevo.apiKey,
            'content-type': 'application/json',
            accept: 'application/json',
        },
        body: JSON.stringify({
            sender: { email: config.mail.fromEmail, name: config.mail.fromName },
            to: [{ email: to }],
            subject,
            textContent: text,
            htmlContent: html,
        }),
    });

    if (!response.ok) {
        throw new Error(`Brevo send failed (${response.status}): ${await response.text()}`);
    }
};

const sendVerificationEmail = async (to: string, otp: string): Promise<void> => {
    await sendEmail({
        to,
        subject: 'Verify your PadosiPro account',
        text: `Your verification code is ${otp}. It expires in 10 minutes.`,
        html: `<p>Your verification code is <strong>${otp}</strong>. It expires in 10 minutes.</p>`,
    });
};

export default {
    sendEmail,
    sendVerificationEmail,
};
