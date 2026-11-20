/**
 * APS Voice Vault - Cloudflare Worker backend.
 * SECURITY: Do not deploy until Cloudflare Access has been configured and
 * CF_ACCESS_TEAM_DOMAIN / CF_ACCESS_AUD are set as server-only bindings.
 * Never send API credentials to browser. All paid conversion routes disabled.
 */
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer'}});
const decodeBase64Url=s=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(s.length/4)*4,'=')),c=>c.charCodeAt(0));
async function verifyAccess(jwt,env){
 if(!jwt||!env.CF_ACCESS_TEAM_DOMAIN||!env.CF_ACCESS_AUD)return false;
 const parts=jwt.split('.');if(parts.length!==3)return false;
 try{
 const head=JSON.parse(new TextDecoder().decode(decodeBase64Url(parts[0])));
 const claims=JSON.parse(new TextDecoder().decode(decodeBase64Url(parts[1])));
 if(head.alg!=='RS256'||!head.kid||!claims.exp||claims.exp*1000<Date.now())return false;
 if(!(Array.isArray(claims.aud)?claims.aud:[claims.aud]).includes(env.CF_ACCESS_AUD))return false;
 const team=new URL(env.CF_ACCESS_TEAM_DOMAIN);if(team.protocol!=='https:'||!team.hostname.endsWith('.cloudflareaccess.com'))return false;
 if(claims.iss!==team.origin)return false;
 const res=await fetch(team.origin+'/cdn-cgi/access/certs',{cf:{cacheTtl:300,cacheEverything:true}});
 if(!res.ok)return false;
 const jwks=await res.json();const jwk=jwks.keys?.find(k=>k.kid===head.kid&&k.kty==='RSA');if(!jwk)return false;
 const key=await crypto.subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
 return await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,decodeBase64Url(parts[2]),new TextEncoder().encode(parts[0]+'.'+parts[1]));
 }catch{return false;}
}
export default {async fetch(request,env){
 const url=new URL(request.url);
 if(url.pathname==='/health'&&request.method==='GET')return json({service:'aps-voice-vault',status:'locked',configured:{kits:!!env.KITS_API_KEY,replicate:!!env.REPLICATE_API_TOKEN},paidJobsEnabled:false});
 if(!(await verifyAccess(request.headers.get('Cf-Access-Jwt-Assertion'),env)))return json({error:'unauthorized'},403);
 if(url.pathname==='/api/provider-status'&&request.method==='GET')return json({kits:!!env.KITS_API_KEY,replicate:!!env.REPLICATE_API_TOKEN,paidJobsEnabled:false});
 if(url.pathname==='/api/test-replicate'&&request.method==='POST'){
  if(!env.REPLICATE_API_TOKEN)return json({provider:'replicate',connected:false,reason:'missing_secret'},424);
  try{
   const r=await fetch('https://api.replicate.com/v1/account',{headers:{Authorization:'Bearer '+env.REPLICATE_API_TOKEN},signal:AbortSignal.timeout(10000)});
   return json({provider:'replicate',connected:r.ok,httpStatus:r.status},r.ok?200:502);
  }catch{return json({provider:'replicate',connected:false,reason:'network_error'},502);}
 }
 if(url.pathname==='/api/test-kits'&&request.method==='POST')return json({provider:'kits',configured:!!env.KITS_API_KEY,connected:false,reason:'provider_endpoint_not_verified',paidJobsEnabled:false},501);
 return json({error:'not_found_or_not_enabled',paidJobsEnabled:false},404);
}};
