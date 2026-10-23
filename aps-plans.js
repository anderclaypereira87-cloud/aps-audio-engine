/* APS — Planos (gratuito x pago). ÚNICO lugar para marcar quais recursos serão do plano pago no futuro.
 * Hoje NADA é bloqueado: enforce=false. Para ativar depois, mude enforce para true e implemente o login/pagamento.
 * Valores: 'free' (todos) ou 'pro' (assinantes). */
window.APS_PLANS={
 enforce:false,
 currentPlan:'free',
 features:{
  'projetos.local':'free','projetos.drive':'free','projetos.exportar':'free',
  'mix.ia':'free','mix.referencia':'free','master':'free',
  'separador.leve':'free','separador.completo':'free',
  'bateria.kits':'free','bateria.camadas':'free',
  'voz.afinacao':'free','voz.limpeza':'free',
  'gravacao.punch':'free','gravacao.metronomo':'free','gravacao.afinador':'free',
  'compartilhar':'free','exportar.mp3':'free'
 }
};
window.APSPlan={
 allowed(f){const P=window.APS_PLANS;if(!P.enforce)return true;const need=P.features[f]||'free';return need==='free'||P.currentPlan==='pro';},
 tier(f){return window.APS_PLANS.features[f]||'free';}
};
