// api/lead.js - Unified lead submission endpoint v2
// More robust: never returns 500 to user if request body is valid.
// Logs every step so we can debug from Vercel runtime logs.

const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbznV0sKDwQL7tb65JDNZzhquH14p6gF0m-sasxKVtumm0gV80UcOivmoGz2L3dl_fsCnQ/exec';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Capture request body — even if everything else fails, we have the lead in Vercel logs
  const lead = req.body || {};
  console.log('=== NEW LEAD ===');
  console.log('Source:', lead.source);
  console.log('Language:', lead.language);
  console.log('Name:', lead.name);
  console.log('Phone:', lead.phone);
  console.log('Address:', lead.address);
  console.log('Service:', lead.service);
  console.log('Message:', lead.message);

  let englishName = lead.name || '';
  let englishAddress = lead.address || '';
  let englishMessage = lead.message || '';
  const originalMessage = lead.messageOriginal || lead.message || '';

  // STEP 1: Translate to English if needed (non-blocking — fallback to originals)
  if (lead.language && lead.language !== 'en') {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (apiKey) {
      try {
        const langName = lead.language === 'ru' ? 'Russian' : lead.language === 'hy' ? 'Armenian' : lead.language;
        const translatePrompt = `Translate this ${langName} HVAC customer data to English.
Rules:
- name: transliterate to Latin (Сурен->Suren, Հայկ->Hayk)
- address: translate/transliterate to English
- message: translate to natural English, brief

Input:
Name: ${englishName || '(empty)'}
Address: ${englishAddress || '(empty)'}
Message: ${englishMessage || '(empty)'}

Return ONLY this JSON, no other text:
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
            if (translated.name) englishName = translated.name;
            if (translated.address) englishAddress = translated.address;
            if (translated.message) englishMessage = translated.message;
            console.log('Translation OK. Name:', englishName, 'Message:', englishMessage.substring(0, 80));
          } else {
            console.error('Translation: no JSON in response:', tText.substring(0, 200));
          }
        } else {
          console.error('Translation API failed, status:', translateRes.status);
        }
      } catch (tErr) {
        console.error('Translation exception:', tErr.message);
        // Continue with originals
      }
    } else {
      console.error('ANTHROPIC_API_KEY not set, skipping translation');
    }
  }

  // STEP 2: Build payload
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

  console.log('Payload prepared:', JSON.stringify(payload).substring(0, 300));

  // STEP 3: Send to Apps Script — try, never throw upward
  let appsScriptOk = false;
  let appsScriptError = '';

  try {
    // Use form-urlencoded — most reliable with Apps Script (avoids redirect issues)
    const formBody = 'payload=' + encodeURIComponent(JSON.stringify(payload));
    console.log('Sending to Apps Script (form-urlencoded)...');

    const scriptRes = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formBody,
      redirect: 'follow'
    });

    const scriptText = await scriptRes.text();
    console.log('Apps Script status:', scriptRes.status);
    console.log('Apps Script body:', scriptText.substring(0, 400));

    if (scriptRes.ok && scriptText.includes('success')) {
      appsScriptOk = true;
    } else {
      appsScriptError = `Status ${scriptRes.status}: ${scriptText.substring(0, 200)}`;
    }
  } catch (e) {
    console.error('Apps Script fetch error:', e.message);
    appsScriptError = e.message;
  }

  // Always return success to user — lead is in Vercel logs as backup
  // even if Apps Script delivery had issues
  return res.status(200).json({
    success: true,
    delivered: appsScriptOk,
    note: appsScriptOk ? 'Lead saved to sheet' : 'Lead logged (sheet delivery issue: ' + appsScriptError + ')'
  });
};
