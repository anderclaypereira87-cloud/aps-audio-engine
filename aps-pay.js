/* APS Pagamentos (front). Só a URL pública do Worker aqui — nenhuma chave. */
window.APS_PAY_URL = window.APS_PAY_URL || 'https://aps-pagamentos.aps-audio.workers.dev';
window.APSPay = {
  token(){ return localStorage.getItem('aps_pay_token'); },
  async api(p, m='GET', body, auth){ const h={'Content-Type':'application/json'}; const t=auth||this.token(); if(t) h.Authorization='Bearer '+t;
    const r=await fetch(APS_PAY_URL+p,{method:m,headers:h,body:body&&JSON.stringify(body)}); const d=await r.json().catch(()=>({})); if(!r.ok) throw new Error(d.error||'Erro'); return d; },
  async signup(d){ const r=await this.api('/customer','POST',d); localStorage.setItem('aps_pay_token',r.token); this.apply(r.status); return r; },
  async refresh(){ if(!this.token()) return null; try{ const s=await this.api('/status'); this.apply(s); return s; }catch(e){ return null; } },
  apply(s){ if(!s||!window.APS_PLANS) return; localStorage.setItem('aps_pay_status',JSON.stringify(s));
    APS_PLANS.currentPlan = (s.plan==='dono'||s.plan==='estudio'||s.plan==='pro') ? 'pro' : 'free';
    APS_PLANS.planName = s.plan; APS_PLANS.credits = s.credits||{}; APS_PLANS.owner = !!s.owner; }
};
try{ APSPay.apply(JSON.parse(localStorage.getItem('aps_pay_status'))); }catch(e){}
APSPay.refresh();
