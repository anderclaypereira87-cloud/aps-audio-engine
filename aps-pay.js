/* APS Pagamentos (front). Só a URL pública do Worker aqui — nenhuma chave. */
window.APS_PAY_URL = window.APS_PAY_URL || 'https://aps-pagamentos.aps-audio.workers.dev';
window.APSPay = {
  sbToken: null,
  token(){ return this.sbToken || localStorage.getItem('aps_pay_token'); },
  async sb(){ // Login social (Supabase): só ativo quando auth-config.js estiver preenchido.
    const c=window.APS_AUTH; if(!c||!c.supabaseUrl||!c.publishableKey) return null;
    if(!this._sb){ const {createClient}=await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
      this._sb=createClient(c.supabaseUrl,c.publishableKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}}); }
    return this._sb; },
  async session(){ try{ const sb=await this.sb(); if(!sb) return null; const {data}=await sb.auth.getSession(); this.sbToken=data.session?data.session.access_token:null; return data.session; }catch(e){ return null; } },
  async api(p, m='GET', body, auth){ if(!auth) await this.session(); const h={'Content-Type':'application/json'}; const t=auth||this.token(); if(t) h.Authorization='Bearer '+t;
    const r=await fetch(APS_PAY_URL+p,{method:m,headers:h,body:body&&JSON.stringify(body)}); const d=await r.json().catch(()=>({})); if(!r.ok) throw Object.assign(new Error(d.error||'Erro'),{data:d}); return d; },
  async signup(d){ const r=await this.api('/customer','POST',d); if(r.token) localStorage.setItem('aps_pay_token',r.token); this.apply(r.status); return r; },
  async refresh(){ await this.session(); if(!this.token()) return null; try{ const s=await this.api('/status'); this.apply(s); return s; }catch(e){ return null; } },
  async logout(){ const sb=await this.sb(); if(sb) await sb.auth.signOut(); this.sbToken=null; localStorage.removeItem('aps_pay_status'); },
  apply(s){ if(!s||!window.APS_PLANS) return; localStorage.setItem('aps_pay_status',JSON.stringify(s));
    APS_PLANS.currentPlan = (s.plan==='dono'||s.plan==='estudio'||s.plan==='pro') ? 'pro' : 'free';
    if(window.APS_FREE_NOW&&APS_FREE_NOW()&&APS_PLANS.currentPlan==='free'){APS_PLANS.currentPlan='pro';}
    APS_PLANS.planName = (window.APS_FREE_NOW&&APS_FREE_NOW()&&s.plan!=='dono')?'estudio':s.plan; APS_PLANS.credits = s.credits||{}; APS_PLANS.owner = !!s.owner; }
};
try{ APSPay.apply(JSON.parse(localStorage.getItem('aps_pay_status'))); }catch(e){}
APSPay.refresh();
