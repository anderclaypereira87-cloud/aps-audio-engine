/* APS — Planos (gratuito x pago). ÚNICO lugar para marcar quais recursos serão do plano pago no futuro.
 * Hoje NADA é bloqueado: enforce=false. Para ativar depois, mude enforce para true e implemente o login/pagamento.
 * Valores: 'free' (todos) ou 'pro' (assinantes). */
/* 🎁 PERÍODO LIVRE: ÚNICO lugar para mudar. Até esta data/hora (Recife, UTC-3) tudo fica liberado para todos, sem cobrança. */
window.APS_FREE_UNTIL=Date.parse('2026-10-31T23:59:59-03:00');
window.APS_FREE_NOW=function(){return Date.now()<window.APS_FREE_UNTIL;};
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
  'compartilhar':'free','exportar.mp3':'free',
  'master.nota':'free','cifra.auto':'free','loops.biblioteca':'free','loops.premium':'free','tutorial':'free','daw.pro':'free','instrumento.trocar':'free','instrumento.polifonico':'free','reconhecimento':'free','biblioteca.contribuir':'free'
 }
};
window.APSPlan={
 allowed(f){const P=window.APS_PLANS;if(!P.enforce)return true;const need=P.features[f]||'free';return need==='free'||P.currentPlan==='pro';},
 tier(f){return window.APS_PLANS.features[f]||'free';}
};

(function(){if(!APS_FREE_NOW())return;var P=APS_PLANS;P.freePeriod=true;P.currentPlan='pro';P.planName=P.planName||'estudio';
 function banner(){if(document.getElementById('aps-free-banner'))return;var d=document.createElement('div');d.id='aps-free-banner';d.setAttribute('role','status');
  d.style.cssText='background:linear-gradient(90deg,#b8913f,#e5be74);color:#151922;font:700 14px/1.4 system-ui,sans-serif;text-align:center;padding:10px 12px;position:relative;z-index:99999';
  d.textContent='🎁 Acesso total liberado sem cobrança até 31/10';document.body.insertBefore(d,document.body.firstChild);
  var st=document.createElement('style');st.textContent='[data-aps-upsell]{display:none!important}';document.head.appendChild(st);}
 if(document.body)banner();else document.addEventListener('DOMContentLoaded',banner);})();
