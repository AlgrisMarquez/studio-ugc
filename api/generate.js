import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

function getMonthYear() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function getMonthsDiff(dateStr) {
  const start = new Date(dateStr);
  const now = new Date();
  return (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth());
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { imageBase64, imageType, prompt, userId, action } = req.body;

  if (!userId) return res.status(401).json({ error: 'No autenticado' });

  // ── GET USER STATUS ──
  if (action === 'status') {
    const { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();

    if (!profile) return res.status(404).json({ error: 'Usuario no encontrado' });

    const monthYear = getMonthYear();
    const monthsDiff = getMonthsDiff(profile.first_use_at);

    const { count: totalMonth } = await supabase
      .from('brief_usage')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('month_year', monthYear);

    const { count: totalAll } = await supabase
      .from('brief_usage')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);

    // Determinar estado según flujo de conversión
    let status = 'active';
    let limit = 5;
    let message = '';
    let showFeedback = false;
    let showUpgrade = false;
    let blocked = false;

    if (profile.plan === 'pro') {
      status = 'pro';
      limit = 999;
    } else if (monthsDiff >= 5) {
      // Mes 5+: acceso cerrado
      status = 'closed';
      blocked = true;
      message = 'Tu período gratuito ha finalizado. Activá tu plan Pro para seguir generando briefs.';
      showUpgrade = true;
    } else if (monthsDiff >= 3) {
      // Mes 3-4 sin pago: 1 brief por mes
      limit = 1;
      if (totalMonth >= 1) {
        status = 'restricted';
        blocked = true;
        const next = new Date();
        next.setMonth(next.getMonth() + 1);
        next.setDate(1);
        message = `Ya usaste tu brief gratuito de este mes. Próximo disponible el 1 de ${next.toLocaleDateString('es-ES', { month: 'long' })}. O activá Pro ahora.`;
        showUpgrade = true;
      }
    } else if (monthsDiff >= 2) {
      // Mes 3 inicio: exigir pago
      status = 'upgrade_required';
      blocked = true;
      message = 'Ya usaste UGC Studio por 2 meses. Para seguir sin límites, activá tu plan Pro.';
      showUpgrade = true;
    } else {
      // Mes 1-2: libre con límite de 5
      if (totalMonth >= 5) {
        blocked = true;
        message = 'Llegaste al límite de 5 briefs este mes. Volvé el próximo mes o activá Pro.';
        showUpgrade = true;
      }
      // Feedback en el 3er brief del mes 2
      if (monthsDiff >= 1 && totalMonth === 2) {
        showFeedback = true;
      }
    }

    return res.status(200).json({
      status,
      plan: profile.plan,
      monthsDiff,
      totalMonth: totalMonth || 0,
      totalAll: totalAll || 0,
      limit,
      blocked,
      message,
      showFeedback,
      showUpgrade
    });
  }

  // ── SAVE FEEDBACK ──
  if (action === 'feedback') {
    const { rating, comment } = req.body;
    await supabase.from('feedback').insert({ user_id: userId, rating, comment });
    return res.status(200).json({ ok: true });
  }

  // ── GENERATE BRIEF ──
  if (!imageBase64 || !prompt) return res.status(400).json({ error: 'Faltan datos' });
  if (!ANTHROPIC_KEY) return res.status(500).json({ error: 'API key no configurada' });

  // Registrar uso
  const monthYear = getMonthYear();
  await supabase.from('brief_usage').insert({ user_id: userId, month_year: monthYear });

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2000,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: imageType || 'image/jpeg', data: imageBase64 } },
            { type: 'text', text: prompt }
          ]
        }]
      })
    });

    const data = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: data.error?.message || 'Error de API' });
    return res.status(200).json({ result: data.content?.[0]?.text || '' });

  } catch (error) {
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
}
