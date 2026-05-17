// api/lead.js - Unified lead submission endpoint
// Receives lead data from website form/chat → translates if needed → forwards to Apps Script
// All done server-side to avoid browser CORS issues with Google Apps Script

const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbznV0sKDwQL7tb65JDNZzhquH14p6gF0m-sasxKVtumm0gV80UcOivmoGz2L3dl_fsCnQ/exec';

module.exports = async function handler(req, res) {
  // CORS for browser fetch
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const lead = req.body || {};
    console.log('Lead received:', { source: lead.source, language: lead.language, name: lead.name });

    let englishName = lead.name || '';
    let englishAddress = lead.address || '';
    let englishMessage = lead.message || '';
    const originalMessage = lead.messageOriginal || lead.message || '';

    // Translate to English if not already English
    if (lead.language && lead.language !== 'en') {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (apiKey) {
        try {
          const langName = lead.language === 'ru' ? 'Russian' : lead.language === 'hy' ? 'Armenian' : lead.language;
          const translatePrompt = `Translate this ${langName} HVAC customer data to English for our dispatcher.
Rules:
- "name": transliterate to Latin (Сурен→Suren, Հայկ→Hayk)
- "address": translate/transliterate to English
- "message": translate to natural English, brief and professional

Input:
Name: ${englishName || '(empty)'}
Address: ${englishAddress || '(empty)'}
Message: ${englishMessage || '(empty)'}

Return ONLY valid JSON, no other text:
{"name":"...","address":"...","message":"..."}`;

          const translateRes = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': apiKey,
              'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
              model: 'claude-haiku-4-5-20251001',
              max_tokens: 500,
              messages: [{ role: 'user', content: translatePrompt }]
            })
          });

          if (translateRes.ok) {
            const tData = await translateRes.json();
            const tText = tData.content?.[0]?.text || '';
            const jsonMatch = tText.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              const translated = JSON.parse(jsonMatch[0]);
              englishName = translated.name || englishName;
              englishAddress = translated.address || englishAddress;
              englishMessage = translated.message || englishMessage;
              console.log('Translation successful');
            }
          } else {
            console.error('Translation API failed:', translateRes.status);
          }
        } catch (tErr) {
          console.error('Translation error:', tErr);
          // Continue with originals
        }
      }
    }

    // Build payload for Apps Script
    const payload = {
      source: lead.source || 'Website',
      name: englishName,
      phone: lead.phone || '',
      email: lead.email || '',
      address: englishAddress,
      service: lead.service || '',
      language: lead.language || 'en',
      message: englishMessage,
      messageOriginal: originalMessage
    };

    // Send to Apps Script (server-side, no CORS limits)
    console.log('Sending to Apps Script...');
    const scriptRes = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      redirect: 'follow',
      body: JSON.stringify(payload)
    });

    const scriptStatus = scriptRes.status;
    const scriptText = await scriptRes.text();
    console.log('Apps Script response:', scriptStatus, scriptText.substring(0, 200));

    if (!scriptRes.ok) {
      return res.status(500).json({
        error: 'Failed to save lead',
        status: scriptStatus,
        details: scriptText.substring(0, 200)
      });
    }

    return res.status(200).json({ success: true });

  } catch (error) {
    console.error('Lead handler error:', error);
    return res.status(500).json({ error: 'Internal server error', details: error.message });
  }
};
