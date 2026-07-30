// netlify/functions/analyze.js
// Esta función corre en el servidor de Netlify (nunca en el celular del usuario).
// Aquí SÍ es seguro usar la API key, porque el usuario nunca la ve.

exports.handler = async function (event) {
  // Solo aceptamos POST
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Método no permitido" }) };
  }

  const API_KEY = process.env.GEMINI_API_KEY;
  if (!API_KEY) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Falta configurar GEMINI_API_KEY en Netlify" }),
    };
  }

  let link = "";
  try {
    const body = JSON.parse(event.body || "{}");
    link = (body.link || "").trim();
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: "Body inválido" }) };
  }

  if (!link) {
    return { statusCode: 400, body: JSON.stringify({ error: "Falta el link" }) };
  }

  const prompt = `Eres un experto en detectar estafas de phishing en Ecuador (bancos falsos, SRI, IESS, MIES, bonos, sorteos, DeUna, PayPhone, etc).
Analiza este link o texto que alguien recibió por WhatsApp: "${link}"

Responde SOLO con un JSON válido, sin texto adicional, sin backticks, con este formato exacto:
{"isScam": true o false, "target": "nombre corto de la entidad que suplantan o a la que afecta, ej: Banco Pichincha, SRI, tu cuenta y tu plata", "reasons": ["razón 1 corta en español sencillo", "razón 2", "razón 3"]}

Reglas:
- Si el dominio no coincide con el oficial de la entidad que menciona, o pide cédula/clave/tarjeta, o usa acortadores (bit.ly, tinyurl, etc), o tiene urgencia falsa ("verifica ya", "cuenta bloqueada"), es estafa.
- Si parece un sitio legítimo y no pide credenciales de forma sospechosa, no es estafa.
- Las "reasons" deben estar en español de Ecuador, sencillo, sin tecnicismos, máximo 20 palabras cada una.`;

  try {
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest:generateContent?key=${API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.2 },
        }),
      }
    );

    if (!resp.ok) {
      const errText = await resp.text();
      return {
        statusCode: 502,
        body: JSON.stringify({ error: "Error al llamar a Gemini", detail: errText }),
      };
    }

    const data = await resp.json();
    const rawText =
      data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";

    // Limpiar por si Gemini devuelve con ```json ... ```
    const cleaned = rawText.replace(/```json|```/g, "").trim();

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (e) {
      return {
        statusCode: 502,
        body: JSON.stringify({ error: "Respuesta de IA no fue JSON válido", raw: rawText }),
      };
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        isScam: !!parsed.isScam,
        target: parsed.target || "tu cuenta y tu plata",
        reasons: Array.isArray(parsed.reasons) ? parsed.reasons.slice(0, 4) : [],
        source: "ai",
      }),
    };
  } catch (e) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Error inesperado", detail: String(e) }),
    };
  }
};
