import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action, email, password } = req.body;

  if (action === 'register') {
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true
    });
    if (error) return res.status(400).json({ error: error.message });
    return res.status(200).json({ user: data.user });
  }

  if (action === 'login') {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return res.status(400).json({ error: error.message });
    return res.status(200).json({ user: data.user, session: data.session });
  }

  return res.status(400).json({ error: 'Acción no válida' });
}
