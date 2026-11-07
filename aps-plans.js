/* APS — Planos progressivos. enforce=true ativa o bloqueio real. */
window.APS_PLANS = {
  enforce: true,
  currentPlan: 'free',
  features: {
    // Grátis
    'projetos.local': 'free',
    'mix.basico': 'free',
    'separador.local': 'free',
    'bateria.basica': 'free',
    'afinador': 'free',
    'partitura.basica': 'free',
    'exportar.mp3': 'free',

    // Pro
    'separador.nuvem': 'pro',
    'exportar.wav': 'pro',
    'mix.ia': 'pro',
    'master.referencia': 'pro',
    'irs.baixo': 'pro',
    'midia.video': 'pro',
    'partitura.exportar': 'pro',
    'bateria.midi': 'pro',
    'projetos.drive': 'pro',

    // Estúdio
    'separador.nuvem.extra': 'estudio',
    'master.avancado': 'estudio',
    'loops.premium': 'estudio',
    'daw.avancado': 'estudio',
    'prioridade': 'estudio'
  }
};

window.APSPlan = {
  allowed(feature) {
    const P = window.APS_PLANS;
    if (!P.enforce) return true;
    const need = P.features[feature] || 'free';
    const order = { free: 0, pro: 1, estudio: 2 };
    return (order[P.currentPlan] || 0) >= (order[need] || 0);
  },
  setPlan(tier) {
    window.APS_PLANS.currentPlan = tier || 'free';
  }
};
