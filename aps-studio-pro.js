
(()=>{
 const ready=()=>{
  const $=id=>document.getElementById(id);
  const toolbar=document.createElement('section'); toolbar.className='aps-pro-toolbar';
  toolbar.innerHTML='<div><strong>APS AUDIO ENGINE | STUDIO PRO</strong></div><div class="aps-pro-tools"><a href="./partitura-pro.html">♬ Editor de partitura</a><a href="./bateria.html">🥁 Bateria</a><a href="./midia.html">▣ Arquivos</a><a href="./painel.html">⌂ Painel</a></div>';
  const h=$('apsScreenTitle'); if(h)h.before(toolbar);
  const edit=$('tracks');if(edit){let banner=document.createElement('div'); banner.className='aps-pro-head';banner.innerHTML='<strong>ARRANJO • PISTAS</strong><span>Selecione uma faixa para efeitos · R = preparar pista · M = silenciar · S = solo</span>';edit.closest('.timeline')?.before(banner);}
  // One-time keyboard transport when user is not editing a field
  window.addEventListener('keydown',ev=>{
   if(ev.defaultPrevented||ev.ctrlKey||ev.altKey||ev.metaKey||ev.code!=='Space'||/^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(document.activeElement?.tagName||''))return;
   const play=$('play'); if(play){ev.preventDefault();play.click();}
  });
  const footer=document.createElement('footer'); footer.className='aps-pro-company';
  footer.innerHTML='APS Audio Engine · CNPJ 60.412.110/0001-92 · Suporte: <a href="mailto:diretoria@clinicadmoura.company">diretoria@clinicadmoura.company</a> · Modo de demonstração (sem autenticação ativada).';
  document.querySelector('.wrap')?.append(footer);
  // Professional audio interface input diagnostics
  const mic=$('micDevice'); if(mic){
   const panel=mic.closest('.padded');
   const controls=document.createElement('div'); controls.className='aps-device-status';
   controls.innerHTML='<strong>Interface de áudio USB</strong><div id="apsDeviceInfo">Selecione uma entrada e clique em Diagnosticar. Use fones; no navegador, drivers ASIO e latência ultrabaixa não são garantidos.</div><button type="button" id="apsDeviceTest" class="mini" style="margin-top:8px">🔌 Diagnosticar interface</button>';
   mic.nextElementSibling?.after(controls);
   $('apsDeviceTest').addEventListener('click',async()=>{
    let info=$('apsDeviceInfo'); try{
      if(!navigator.mediaDevices?.getUserMedia)throw Error('É necessário HTTPS e permissão de microfone.');
      const devices=await navigator.mediaDevices.enumerateDevices();
      const ins=devices.filter(d=>d.kind==='audioinput');
      const stream=await navigator.mediaDevices.getUserMedia({audio:{deviceId:mic.value?{ideal:mic.value}:undefined,echoCancellation:false,noiseSuppression:false,autoGainControl:false},video:false});
      const track=stream.getAudioTracks()[0]; const settings=track.getSettings();
      const AC=window.AudioContext||window.webkitAudioContext;const ctx=AC?new AC({latencyHint:'interactive'}):null;
      info.textContent='Entrada: '+(track.label||'microfone')+' · '+(settings.sampleRate||ctx?.sampleRate||'taxa desconhecida')+' Hz · '+(settings.channelCount||1)+' canal(is) · '+ins.length+' entrada(s) detectada(s)'+(ctx?.baseLatency?' · latência base estimada: '+Math.round(ctx.baseLatency*1000)+' ms':'')+'. Verificação não substitui teste de round-trip.';
      stream.getTracks().forEach(t=>t.stop());await ctx?.close();
    }catch(e){info.textContent='Não consegui ativar a interface: '+e.message;}
   });
  }
  // Useful print-score launch remains separate from automated approximate pitch analyzer
  const score=$('score');if(score){
   const link=document.createElement('a');link.className='block';link.href='./partitura-pro.html';link.style.fontWeight='700';link.textContent='↗ Abrir editor completo de partitura (claves, figuras, compassos e páginas)';
   score.closest('.padded')?.insertBefore(link,score);
  }
  const help=$('engineHelp'); if(help){help.textContent+=' Afinador de voz com preservação de formantes e identificação exata de várias notas simultâneas requerem motor profissional, ainda não ativado.';}
 };
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',ready,{once:true}); else ready();
})();
