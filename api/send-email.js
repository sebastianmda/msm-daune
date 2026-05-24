// Serverless function — trimite email prin Gmail SMTP cu atașamente
// Variabile necesare în Vercel:
//   GMAIL_USER          → adresa ta Gmail
//   GMAIL_APP_PASSWORD  → parola de aplicație (16 caractere)

import nodemailer from 'nodemailer';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '4mb',
    },
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
    return res.status(500).json({
      error: 'Configurare Gmail lipsește. Adaugă GMAIL_USER și GMAIL_APP_PASSWORD în Vercel Environment Variables.'
    });
  }

  try {
    const { to, subject, body, fromName, attachments } = req.body || {};

    if (!to || !subject || !body) {
      return res.status(400).json({ error: 'Câmpuri lipsă (to, subject, body)' });
    }

    // Fetch attachments from Supabase Storage URLs (in parallel)
    let mailAttachments = [];
    if (Array.isArray(attachments) && attachments.length > 0) {
      const results = await Promise.all(
        attachments.map(async (att) => {
          if (!att?.url) return null;
          try {
            const r = await fetch(att.url);
            if (!r.ok) {
              console.error('Skip attachment, status:', r.status, att.name);
              return null;
            }
            const arrayBuffer = await r.arrayBuffer();
            return {
              filename: att.name || 'attachment',
              content: Buffer.from(arrayBuffer),
              contentType: att.type || undefined,
            };
          } catch (e) {
            console.error('Skip attachment error:', att.name, e.message);
            return null;
          }
        })
      );
      mailAttachments = results.filter(Boolean);
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
      attachments: mailAttachments,
    });

    return res.status(200).json({
      success: true,
      messageId: info.messageId,
      attachmentsCount: mailAttachments.length,
      attachmentsRequested: (attachments || []).length,
    });
  } catch (err) {
    console.error('Email error:', err);
    return res.status(500).json({ error: err.message || 'Eroare la trimitere email' });
  }
}
