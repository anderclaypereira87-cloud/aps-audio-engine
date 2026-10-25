# Autenticação APS Audio Engine — configuração

Escopo: branch feat/aps-auth-google-email no repositório original.
O APS é um site estático (GitHub Pages): não há Next.js, React, .env.local ou servidor Node no deploy atual. Não copie a service_role nem o Google Client Secret para o repositório.

## Pré-requisito obrigatório: identificar o Supabase do APS

Antes de aplicar SQL, confirme o **Project ID/ref exclusivamente do APS**. Não use nenhum projeto da Clínica D'Moura, Sarah ou DMAP. O código está preparado para configuração, mas deliberadamente não aplica alterações a bancos não identificados.

No Supabase exclusivo do APS:

1. Abra SQL Editor e revise/aplique o arquivo supabase/aps-auth-setup.sql. A tabela public.profiles tem RLS; usuários leem só seu perfil, administradores confirmados leem/alteram demais perfis. Um cadastro é sempre musician + free_trial; nunca se aceita role da metadata fornecida pelo navegador.
2. Em Authentication > Providers > Google, habilite Google, inserindo Client ID e Client Secret **apenas no painel seguro do Supabase**.
3. Em Authentication > URL Configuration, configure Site URL como https://apsaudio.com.br e Redirect URLs para:
   - https://apsaudio.com.br/auth-callback.html
   - https://apsaudio.com.br/redefinir-senha.html
   - URLs equivalentes de ambiente de teste (somente origens sob seu controle).
4. Copie a Project URL e a **publishable key** do projeto APS para auth-config.js. Exemplo de configuração:

        window.APS_AUTH = {
          supabaseUrl: 'https://SEU_PROJECT_REF.supabase.co',
          publishableKey: 'sb_publishable_...',
          owners: []
        };

   auth-config.js é público no GitHub Pages. A publishable key pode ser pública, mas jamais use uma secret key, service_role ou Google Client Secret nesse arquivo.
5. No Google Cloud Console > Google Auth Platform > Clients, crie cliente Web application:
   - Origens autorizadas: https://apsaudio.com.br (e http://localhost:3000 para teste local, se necessário).
   - **URI de redirecionamento no Google:** https://SEU_PROJECT_REF.supabase.co/auth/v1/callback (copie o endereço exato exibido no Supabase > Google provider).
   - **Não** configure https://apsaudio.com.br/auth-callback.html como a URI de redirecionamento do Google: essa é a URL para onde o Supabase devolve o navegador depois do OAuth.
   - Scopes: openid, email, profile.
6. Cadastre anderclay.pereira87@gmail.com e confirme o e-mail. Então execute supabase/aps-promote-owner.sql **manualmente no projeto APS**, para promover o proprietário verificado. O e-mail informado pelo usuário no cadastro jamais concede privilégios por si só.
7. Verifique em desktop e Android: cadastro, confirmação por e-mail, senha, Google, recuperação de senha, logout, usuário comum sem acesso à gestão e administrador com gestão de perfis.

## Arquivos

- login.html: entrada Google/e-mail e cadastro gratuito.
- auth-callback.html: conclusão da sessão OAuth ou confirmação de e-mail.
- redefinir-senha.html: redefine a senha após link de recuperação.
- conta.html: perfil individual do músico.
- usuarios.html: lista/administração de perfis com checagem RLS.
- aps-auth.js: reutiliza o mesmo cliente Supabase de aps-pay.js.
- supabase/aps-auth-setup.sql: tabela, policies e triggers.
- supabase/aps-promote-owner.sql: promoção administrativa verificada.

## Pontos de atenção

- admin.html pré-existente gerencia pagamentos pelo Worker e uma chave de administrador separada. usuarios.html gerencia **somente perfis no Supabase**. A alteração de plan_tier ainda não altera o plano efetivo no Worker do Asaas; isso exige uma integração de backend específica.
- Os módulos de música existentes continuam acessíveis conforme o período de teste. As páginas de autenticação **não ativam bloqueio de recursos ou cobrança**.
- Notificações para anderclay.pereira87@gmail.com exigem função de backend com provedor de e-mail. O endereço não é usado como Client Secret nem disparado do navegador.
- Em caso de erro profiles does not exist ou permission denied, confira o projeto, a configuração e as permissões/RLS. Não desabilite RLS para contornar o problema.
- Teste em branch/preview antes de fazer merge na main; não publicar na produção sem autorização.
