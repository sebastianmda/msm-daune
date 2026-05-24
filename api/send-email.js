// Serverless function — trimite email prin Gmail SMTP
// Variabile necesare în Vercel:
//   GMAIL_USER          → adresa ta Gmail
//   GMAIL_APP_PASSWORD  → parola de aplicație (16 caractere)

import nodemailer from 'nodemailer';

export default async function handler(req, res) {
  // Doar POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Verifică env vars
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
    return res.status(500).json({
      error: 'Configurare Gmail lipsește. Adaugă GMAIL_USER și GMAIL_APP_PASSWORD în Vercel Environment Variables.'
    });
  }

  try {
    const { to, subject, body, fromName } = req.body || {};

    if (!to || !subject || !body) {
      return res.status(400).json({ error: 'Câmpuri lipsă (to, subject, body)' });
    }

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD,
      },
    });

    const info = await transporter.sendMail({
      from: `"${fromName || 'MSM Service Auto'}" <${process.env.GMAIL_USER}>`,
      to,
      subject,
      text: body,
    });

    return res.status(200).json({ success: true, messageId: info.messageId });
  } catch (err) {
    console.error('Email error:', err);
    return res.status(500).json({ error: err.message || 'Eroare la trimitere email' });
  }
}
