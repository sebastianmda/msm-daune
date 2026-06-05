// Serverless function — citește nota de constatare (PDF sau poză)
// și extrage datele structurate folosind Claude AI
//
// Variabile necesare în Vercel:
//   ANTHROPIC_API_KEY → cheia API Anthropic (console.anthropic.com)

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({
      error: 'ANTHROPIC_API_KEY lipsește din Vercel Environment Variables. Adaugă cheia API Anthropic în Vercel → Settings → Environment Variables.'
    });
  }

  try {
    const { data, mediaType } = req.body || {};

    if (!data || !mediaType) {
      return res.status(400).json({ error: 'Lipsesc câmpurile data sau mediaType' });
    }

    const isPdf = mediaType === 'application/pdf' || mediaType === 'application/x-pdf';

    // Construim block-ul de conținut în funcție de tip
    const docBlock = isPdf
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } }
      : { type: 'image', source: { type: 'base64', media_type: mediaType, data } };

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: [
            docBlock,
            {
              type: 'text',
              text: `Aceasta este o notă de constatare daune auto din România. Extrage toate datele disponibile și returnează EXCLUSIV un obiect JSON valid, fără text suplimentar, fără markdown, fără explicații, cu această structură exactă:

{"nrDosar":"","dataEveniment":"","dataConstatare":"","asigurator":{"companie":"","inspector":"","contact":""},"proprietar":{"nume":"","telefon":"","email":""},"masina":{"marca":"","model":"","an":"","nrInmatriculare":"","vin":""}}

Reguli:
- Returnează DOAR JSON, nimic altceva
- Datele în format YYYY-MM-DD când sunt disponibile
- nrInmatriculare, marca, model cu MAJUSCULE
- Numărul de dosar poate apărea ca "Nr. dosar", "Dosar nr.", "Nr. daună", "Dosar daună" etc.
- Inspector = persoana care a efectuat constatarea (nu proprietarul)
- contact = telefon inspector sau email asigurator
- Dacă un câmp nu există în document, lasă string gol ""`
            }
          ]
        }]
      })
    });

    const apiData = await r.json();
    if (!r.ok) {
      const errMsg = apiData.error?.message || `Eroare API Anthropic: ${r.status}`;
      throw new Error(errMsg);
    }

    const text = (apiData.content?.[0]?.text || '').replace(/```json|```/g, '').trim();

    let extracted;
    try {
      extracted = JSON.parse(text);
    } catch {
      throw new Error('Răspunsul AI nu e JSON valid. Încearcă din nou.');
    }

    return res.status(200).json({ success: true, data: extracted });
  } catch (err) {
    console.error('Extract error:', err);
    return res.status(500).json({ error: err.message || 'Eroare la citirea documentului' });
  }
}
