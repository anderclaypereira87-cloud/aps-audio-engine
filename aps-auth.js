/* APS Auth: use the same Supabase browser client as APSPay. Public credentials only. */
window.APSAccount = {
  async client() {
    if (!window.APSPay || typeof APSPay.sb !== 'function') throw new Error('Módulo de autenticação indisponível.');
    const sb = await APSPay.sb();
    if (!sb) throw new Error('Autenticação ainda não configurada. Defina a URL e a chave pública do Supabase exclusivo do APS em auth-config.js.');
    return sb;
  },
  url(page) { return new URL(page, location.href).href; },
  next(value) {
    const allowed = ['conta.html', 'painel.html', 'planos.html', 'daw.html', 'midia.html', 'projetos.html'];
    const name = String(value || '').replace(/^\.\//, '');
    return allowed.includes(name) ? './' + name : './conta.html';
  },
  async current() {
    const sb = await this.client();
    const { data, error } = await sb.auth.getUser();
    if (error || !data.user) return { sb, user: null };
    return { sb, user: data.user };
  },
  async profile(sb, user) {
    const { data, error } = await sb.from('profiles')
      .select('id,full_name,email,role,plan_tier,created_at').eq('id', user.id).maybeSingle();
    if (error) throw error;
    if (!data) throw new Error('Perfil ainda não disponível. Confirme que o SQL do APS foi aplicado no projeto correto.');
    return data;
  }
};
