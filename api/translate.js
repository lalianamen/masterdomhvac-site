// api/translate.js - Vercel Serverless Function for translating form submissions
// Receives Russian/Armenian text, returns English translation + transliterated names
 
module.exports = async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
 
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
 
  try {
    const { name, address, message, language } = req.body;
 
    // If already English, no translation needed
    if (!language || language === 'en') {
      return res.status(200).json({
        name: name || '',
        address: address || '',
        message: message || ''
      });
    }
 
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      console.error('ANTHROPIC_API_KEY not configured');
      // Return original data as fallback
      return res.status(200).json({
        name: name || '',
        address: address || '',
        message: message || ''
      });
    }
 
    const langName = language === 'ru' ? 'Russian' : language === 'hy' ? 'Armenian' : language;
 
    const prompt = `You are a translator for an HVAC business. Translate the following ${langName} customer data to English for our dispatcher.
 
Rules:
- "name": transliterate to Latin letters (e.g., Сурен → Suren, Հայկ → Hayk, Анна → Anna)
- "address": translate/transliterate to English (Glendale area addresses)
- "message": translate to natural English, brief and professional
 
Input data:
Name: ${name || '(empty)'}
Address: ${address || '(empty)'}
Message: ${message || '(empty)'}
 
Return ONLY valid JSON in this exact format, no other text:
{"name":"...","address":"...","message":"..."}`;
 
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 500,
        messages: [{ role: 'user', content: prompt }]
      })
    });
 
    if (!response.ok) {
      console.error('Translation API error:', response.status);
      // Fallback: return originals
      return res.status(200).json({
        name: name || '',
        address: address || '',
        message: message || ''
      });
    }
 
    const data = await response.json();
    const responseText = data.content?.[0]?.text || '';
 
    // Extract JSON from response (Claude sometimes wraps in markdown)
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return res.status(200).json({
        name: name || '',
        address: address || '',
        message: message || ''
      });
    }
 
    const translated = JSON.parse(jsonMatch[0]);
 
    return res.status(200).json({
      name: translated.name || name || '',
      address: translated.address || address || '',
      message: translated.message || message || ''
    });
 
  } catch (error) {
    console.error('Translation error:', error);
    // Fallback: return originals
    return res.status(200).json({
      name: req.body?.name || '',
      address: req.body?.address || '',
      message: req.body?.message || ''
    });
  }
};
