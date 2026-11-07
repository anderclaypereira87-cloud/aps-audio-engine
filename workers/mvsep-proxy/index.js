export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === '/create' && request.method === 'POST') {
      const form = await request.formData();
      const token = form.get('api_token') || env.MVSEP_TOKEN;
      if (!token) return new Response(JSON.stringify({ error: 'Token ausente' }), { status: 400 });

      const upstream = new FormData();
      upstream.append('api_token', token);
      upstream.append('sep_type', form.get('sep_type') || '20');
      upstream.append('output_format', form.get('output_format') || '0');
      const file = form.get('audiofile');
      if (file) upstream.append('audiofile', file);

      const res = await fetch('https://mvsep.com/api/separation/create', {
        method: 'POST',
        body: upstream
      });
      const data = await res.json().catch(() => ({}));
      return new Response(JSON.stringify(data), {
        status: res.status,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    if (path === '/status' && request.method === 'GET') {
      const hash = url.searchParams.get('hash');
      if (!hash) return new Response(JSON.stringify({ error: 'hash ausente' }), { status: 400 });
      const res = await fetch('https://mvsep.com/api/separation/get?hash=' + hash);
      const data = await res.json().catch(() => ({}));
      return new Response(JSON.stringify(data), {
        status: res.status,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // Proxy de download dos arquivos resultantes
    if (path === '/download' && request.method === 'GET') {
      const fileUrl = url.searchParams.get('url');
      if (!fileUrl) return new Response(JSON.stringify({ error: 'url ausente' }), { status: 400 });
      const res = await fetch(fileUrl);
      if (!res.ok) return new Response('Falha ao baixar', { status: res.status });
      const headers = new Headers(res.headers);
      headers.set('Access-Control-Allow-Origin', '*');
      headers.set('Content-Disposition', 'attachment');
      return new Response(res.body, { status: res.status, headers });
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type'
        }
      });
    }

    return new Response('Proxy MVSEP funcionando', { headers: { 'Access-Control-Allow-Origin': '*' } });
  }
};
