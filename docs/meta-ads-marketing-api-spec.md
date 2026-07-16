# Especificação Técnica — Automação de Ações no Meta Ads via Marketing API

**Status**: pronto para implementação
**Autor**: Backend Architect (Claude Code)
**Data**: 2026-07-16
**Repositório alvo**: `ponto-de-virada-bio` (Next.js/Vercel — mesmo padrão de `api/webhooks/hotmart.js` e `api/webhooks/cakto.js`)
**Motivação**: substituir a dependência de um MCP tool de Meta Ads que desconecta intermitentemente, por chamadas diretas à Meta Marketing API (Graph API) a partir de um endpoint que já controlamos.

**Conta de anúncios alvo**: `act_1453692412636648` (⚠️ note o prefixo `act_` obrigatório em quase todas as chamadas de nível de conta — é um erro comum esquecer isso; em chamadas por ID de objeto específico, como ad set ou ad, o prefixo não é necessário).

---

## Índice

1. [Autenticação — System User Token](#1-autenticação--system-user-token)
2. [Ação 1 — Restringir Placements de um Ad Set](#2-ação-1--restringir-placements-de-um-ad-set)
3. [Ação 2 — Pausar um Anúncio por ID](#3-ação-2--pausar-um-anúncio-por-id)
4. [Arquitetura Recomendada](#4-arquitetura-recomendada-endpoint-http-vs-scripts-cli)
5. [Segurança](#5-segurança)
6. [Plano de Expansão Futura](#6-plano-de-expansão-futura)

---

## 1. Autenticação — System User Token

### 1.1 Token de usuário normal vs. token de System User

| | Token de usuário normal (`/me`, login OAuth) | Token de System User (Business Manager) |
|---|---|---|
| Vínculo | Preso à conta pessoal do Facebook de quem gerou | Preso a uma identidade "robô" dentro do Business Manager, sem conta pessoal associada |
| Expiração | Token de curta duração expira em ~1-2h; o de longa duração ("long-lived") expira em ~60 dias e precisa ser trocado periodicamente | **Não expira** por tempo — só é revogado manualmente, se a senha do Business Manager mudar de dono, ou se o System User for removido |
| Risco operacional | Se a pessoa sair da empresa, trocar senha ou perder acesso ao 2FA, o token quebra | Independe de qualquer pessoa física — ideal para automação server-to-server |
| Uso recomendado | Testes manuais no Graph API Explorer | **Produção** — é o que vamos usar aqui |

Conclusão: para automação recorrente (mesmo que disparada manualmente), o token de **System User de longa duração** é a escolha correta. Ele já está sendo criado por Patrick com a permissão `ads_management`.

### 1.2 Checklist de criação do System User (Business Manager)

1. Business Settings → Users → System Users → criar um System User do tipo **Admin** ou **Employee** (recomendado: **Employee**, princípio do menor privilégio — só precisa gerenciar anúncios, não o Business Manager inteiro).
2. Atribuir o System User à conta de anúncios `1453692412636648` especificamente (Assign Assets → Ad Accounts), em vez de conceder acesso a todas as contas do Business Manager.
3. Gerar um token (Generate New Token) selecionando o app conectado e marcando o escopo `ads_management` (e `ads_read` se formos puxar insights no futuro — ver seção 6).
4. Copiar o token **uma única vez** (a Meta não permite recuperá-lo depois de fechar a tela — se perder, precisa gerar um novo e invalidar o anterior).
5. Confirmar que o token não expira: `GET /debug_token?input_token={token}&access_token={token}` deve retornar `"expires_at": 0` (0 = nunca expira).

### 1.3 Armazenamento seguro (Vercel)

- Salvar como variável de ambiente no projeto Vercel: `META_SYSTEM_USER_TOKEN`.
- Escopo: **Production** e **Preview** separadamente — se possível, usar um token diferente (ou pelo menos marcar claramente) para não misturar testes com produção, já que qualquer chamada de pausar/restringir é real e afeta a conta ao vivo.
- Nunca commitar em `.env` versionado — confirmar que `.env*` está no `.gitignore` do repo (o `.gitignore` atual do `ponto-de-virada-bio` tem 9 bytes, quase certamente só `.env` — vale conferir antes de prosseguir).
- Adicionar também `META_AD_ACCOUNT_ID=1453692412636648` e `META_ADMIN_API_SECRET` (segredo separado, só para autenticar chamadas ao nosso próprio endpoint — ver seção 5) como env vars.
- Rotação: como o token de System User não expira por tempo, definir uma rotina manual de rotação a cada 6-12 meses por boa prática de segurança (registrar isso no Obsidian, `Padrões e Soluções.md`, para não esquecer).

### 1.4 Formato das chamadas

Duas formas de passar o token — usar a segunda (header) por ser mais segura, já que query strings acabam em logs de acesso:

```
# Evitar (token aparece em logs de URL):
https://graph.facebook.com/v21.0/{ad-set-id}?access_token={TOKEN}

# Preferir (header Authorization):
Authorization: Bearer {TOKEN}
```

Versão da API: usar **v21.0** (mesma versão já usada em `api/webhooks/cakto.js` e `api/webhooks/hotmart.js` para a Conversions API — manter consistência de versão em todo o projeto). Meta costuma dar ~2 anos de suporte por versão; registrar no Obsidian a data-limite de v21.0 para lembrar de migrar depois.

---

## 2. Ação 1 — Restringir Placements de um Ad Set

### 2.1 Contexto técnico importante (ler antes de implementar)

O campo `targeting` de um Ad Set é um **objeto único e complexo** (geolocalização, idade, interesses, posicionamentos, etc. tudo dentro dele). A Marketing API **não faz merge parcial dentro de `targeting`** — se você enviar um POST só com `targeting.publisher_platforms` e `targeting.facebook_positions`, o restante do objeto `targeting` (segmentação geográfica, idade, público customizado, etc.) pode ser **sobrescrito ou zerado**, dependendo do que a API interpretar como omitido.

**Por isso o fluxo correto é sempre GET → modificar apenas os campos de placement → POST o objeto `targeting` inteiro de volta.** Nunca fazer PATCH cego só com os campos de posicionamento.

### 2.2 Passo 1 — Buscar o Ad Set atual

```
GET https://graph.facebook.com/v21.0/{ad-set-id}?fields=targeting,name,status
```

### 2.3 Passo 2 — Payload de atualização (placements manuais)

Placements "Advantage+" (automáticos) são o **estado padrão quando os campos de posicionamento não são enviados explicitamente**. Para forçar posicionamento manual, é necessário **incluir explicitamente** `publisher_platforms`, `facebook_positions` e `instagram_positions`, e **omitir** `audience_network_positions` (e `messenger_positions`, se não for usar Messenger).

Mapeamento de nomes técnicos da API:

| Nome na interface do Ads Manager | Valor no campo da API |
|---|---|
| Facebook Feed | `"feed"` em `facebook_positions` |
| Instagram Feed | `"stream"` em `instagram_positions` |
| Instagram Stories | `"story"` em `instagram_positions` |
| Audience Network | `audience_network_positions` — **omitir o campo inteiro** |

```json
{
  "targeting": {
    "...": "-- manter todos os campos já existentes vindos do GET (geo_locations, age_min, age_max, custom_audiences, etc.) --",
    "publisher_platforms": ["facebook", "instagram"],
    "facebook_positions": ["feed"],
    "instagram_positions": ["stream", "story"]
  }
}
```

Endpoint e método:

```
POST https://graph.facebook.com/v21.0/{ad-set-id}
```

### 2.4 Exemplo de código (Node.js / fetch)

Padrão consistente com o estilo já usado em `api/webhooks/cakto.js` (CommonJS, `module.exports`, sem dependências externas).

```js
// scripts/restrict-placements.js (ou lógica reaproveitada dentro do endpoint admin)

const GRAPH_API_VERSION = 'v21.0';
const TOKEN = process.env.META_SYSTEM_USER_TOKEN;

async function getAdSetTargeting(adSetId) {
  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${adSetId}?fields=targeting,name,status`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  const result = await response.json();
  if (result.error) {
    throw new Error(`Erro ao buscar ad set ${adSetId}: ${JSON.stringify(result.error)}`);
  }
  return result;
}

async function restrictPlacementsToManual(adSetId) {
  const current = await getAdSetTargeting(adSetId);

  const updatedTargeting = {
    ...current.targeting,
    publisher_platforms: ['facebook', 'instagram'],
    facebook_positions: ['feed'],
    instagram_positions: ['stream', 'story'],
  };
  // Remover explicitamente qualquer resquício de Audience Network / Messenger
  delete updatedTargeting.audience_network_positions;
  delete updatedTargeting.messenger_positions;

  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${adSetId}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ targeting: updatedTargeting }),
  });

  const result = await response.json();
  if (result.error) {
    throw new Error(`Erro ao atualizar ad set ${adSetId}: ${JSON.stringify(result.error)}`);
  }
  return result; // Meta retorna { success: true } em updates bem-sucedidos
}

module.exports = { getAdSetTargeting, restrictPlacementsToManual };
```

### 2.5 Validação pós-execução

Depois do POST, fazer um novo GET nos mesmos campos e conferir:
- `publisher_platforms` contém só `facebook` e `instagram`;
- `facebook_positions` = `["feed"]`;
- `instagram_positions` = `["stream", "story"]`;
- `audience_network_positions` não existe mais no objeto retornado.

Isso vira o "reconciliation check" mencionado na seção 5 — nunca confiar apenas no código HTTP 200 da resposta, sempre reler o objeto para confirmar o estado real.

---

## 3. Ação 2 — Pausar um Anúncio por ID

### 3.1 Endpoint e payload

Ao contrário do `targeting`, o campo `status` **não é aninhado** — é um update simples e seguro, sem risco de sobrescrever outros campos.

```
POST https://graph.facebook.com/v21.0/{ad-id}
```

```json
{ "status": "PAUSED" }
```

Valores válidos de `status` para um anúncio: `ACTIVE`, `PAUSED`, `DELETED`, `ARCHIVED`. **Usar `PAUSED`, nunca `DELETED`** — pausar é reversível, deletar não é (e cai na categoria de ação destrutiva irreversível que exige cuidado redobrado, ver seção 5).

### 3.2 Exemplo de código (Node.js / fetch)

```js
// scripts/pause-ad.js (ou lógica reaproveitada dentro do endpoint admin)

const GRAPH_API_VERSION = 'v21.0';
const TOKEN = process.env.META_SYSTEM_USER_TOKEN;

async function pauseAd(adId) {
  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${adId}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ status: 'PAUSED' }),
  });

  const result = await response.json();
  if (result.error) {
    throw new Error(`Erro ao pausar anúncio ${adId}: ${JSON.stringify(result.error)}`);
  }
  return result;
}

module.exports = { pauseAd };
```

### 3.3 Exemplo de uso concreto (o anúncio da auditoria)

```js
await pauseAd('120248740807360776'); // CPC R$6,14 — pior anúncio da conta, achado da auditoria de 14/07
```

Depois de pausar, confirmar com `GET /{ad-id}?fields=status,effective_status` — `effective_status` pode continuar mostrando `PENDING_REVIEW` ou similar por alguns segundos antes de refletir `PAUSED`/`ADSET_PAUSED`, então não tratar uma leitura imediata como falha.

---

## 4. Arquitetura Recomendada: Endpoint HTTP vs. Scripts CLI

### 4.1 Comparação

| Critério | Endpoint HTTP (`/api/admin/meta-ads-actions`) | Scripts CLI standalone (`scripts/*.js`) |
|---|---|---|
| Onde o token vive | Env var na Vercel (nunca toca disco local) | Precisa estar em `.env` local na máquina de quem roda o script |
| Como é disparado | `curl`/Postman de qualquer lugar (inclusive por mim, Claude Code, via chamada HTTP) | Precisa Node instalado localmente + repo clonado + rodar `node script.js` |
| Consistência com o repo | Seguimos o mesmo padrão dos webhooks já existentes (`api/webhooks/*.js`) | Introduz um padrão novo e paralelo (scripts fora do fluxo de deploy) |
| Auditoria/logs | Logs centralizados no painel da Vercel (Functions → Logs), com timestamp e IP de origem | Logs só no terminal local, se perdem ao fechar o terminal |
| Superfície de ataque | Exposto publicamente na internet (mitigável — ver seção 5) | Não exposto — só roda localmente |
| Confirmação em 2 passos | Fácil de implementar (endpoint de "dry-run" + endpoint de "confirmar") | Também possível, mas menos natural (precisaria de prompt interativo no terminal) |
| Latência para agir | Imediata, de qualquer dispositivo | Depende de estar na máquina certa com o repo atualizado |

### 4.2 Recomendação: Endpoint HTTP protegido

Para o caso de uso descrito — **ações administrativas pontuais, não um fluxo automático recorrente** — a recomendação é o **endpoint HTTP** (`/api/admin/meta-ads-actions`), pelos seguintes motivos:

1. **Você (Patrick) e eu (Claude Code) precisamos disparar essas ações sem depender de ambiente local configurado.** O motivador original deste documento é justamente a instabilidade de um MCP tool — trocar por "preciso estar na sua máquina com Node instalado" reintroduz um tipo parecido de fricção operacional.
2. **Já existe o padrão exato no repo** (`api/webhooks/hotmart.js`, `api/webhooks/cakto.js`) — zero curva de aprendizado nova, mesmo estilo de deploy (`git push` → Vercel já publica), mesmo lugar para consultar em caso de dúvida.
3. **Auditoria nativa**: cada chamada fica logada no painel da Vercel com timestamp — importante para ações que mexem em dinheiro de anúncio.
4. **A superfície de ataque extra é pequena e controlável** (ver seção 5) — não expomos nada que não possa ser protegido com um segredo compartilhado + confirmação em 2 passos.

Estrutura de arquivo sugerida:

```
api/admin/meta-ads-actions.js   -- endpoint único, roteia por "action" no body
lib/meta-marketing-api.js       -- funções puras: getAdSetTargeting, restrictPlacementsToManual, pauseAd
```

Formato de chamada (exemplo via curl):

```bash
curl -X POST https://ponto-de-virada-bio.vercel.app/api/admin/meta-ads-actions \
  -H "Content-Type: application/json" \
  -H "X-Admin-Secret: $META_ADMIN_API_SECRET" \
  -d '{
    "action": "pause_ad",
    "confirm": true,
    "params": { "adId": "120248740807360776" }
  }'
```

Se `confirm` não vier como `true`, o endpoint responde com um preview do que **seria** feito (dry-run) em vez de executar — ver detalhe na seção 5.2.

---

## 5. Segurança

### 5.1 Autenticação do endpoint (quem pode chamar)

- Header customizado `X-Admin-Secret`, comparado contra `process.env.META_ADMIN_API_SECRET` (segredo **diferente** do token do Meta — nunca reaproveitar o mesmo valor para duas finalidades).
- Comparação deve ser feita com `crypto.timingSafeEqual` (não `===` simples), para evitar timing attacks — mesmo sendo baixo risco aqui, é boa prática de graça:

```js
const crypto = require('crypto');

function isValidSecret(provided, expected) {
  const a = Buffer.from(provided || '', 'utf8');
  const b = Buffer.from(expected || '', 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
```

- Rejeitar qualquer requisição sem o header, com `401`, antes de tocar em qualquer lógica de negócio.
- Opcional (reforço): restringir por IP de origem se as chamadas partirem sempre do mesmo lugar — mas como o objetivo é poder chamar de qualquer lugar (inclusive por mim), não tratar isso como obrigatório.

### 5.2 Confirmação em 2 passos para ações destrutivas/impactantes

Toda ação que muda o estado de uma campanha ao vivo (pausar, restringir placement, e no futuro pausar campanha inteira) deve exigir um campo explícito `"confirm": true` no body. Sem isso, o endpoint retorna **apenas um preview** (o que seria alterado, sem executar):

```json
// Requisição sem confirm:true
{ "action": "pause_ad", "params": { "adId": "120248740807360776" } }

// Resposta (dry-run, nada foi executado):
{
  "dry_run": true,
  "would_execute": "POST /120248740807360776 { status: PAUSED }",
  "current_status": "ACTIVE",
  "message": "Envie novamente com \"confirm\": true para executar de fato."
}
```

Isso evita o cenário de "colei o curl errado e pausei o anúncio errado sem querer" — o preview obriga uma segunda leitura consciente antes da ação real.

### 5.3 Token do System User

- **Nunca em código versionado.** Nem em comentário, nem em arquivo de exemplo, nem em commit de teste "temporário". Sempre `process.env.META_SYSTEM_USER_TOKEN`.
- Nunca logar o token inteiro em `console.log` (nem em caso de erro) — se precisar debugar, logar só os primeiros 8 caracteres (`token.slice(0, 8) + '...'`).
- Vercel: variável marcada como "sensitive" (Vercel tem essa opção desde 2023 — esconde o valor até no dashboard do próprio Vercel para quem tem acesso ao projeto mas não precisa ver segredos).
- Nunca colar o token em chat, ticket, ou qualquer lugar que não seja o campo de env var da Vercel.

### 5.4 Escopo mínimo do System User

Confirmar (seção 1.2) que o System User tem acesso só à conta de anúncios `1453692412636648`, não ao Business Manager inteiro nem a outras contas — mesmo que hoje só exista essa conta, evita que uma futura conta nova fique exposta ao mesmo token sem decisão consciente.

### 5.5 Rate limiting e erros da própria Meta

A Marketing API tem rate limiting por app e por conta de anúncio (sistema de "pontos"). Tratar especificamente:
- Erro `code: 4` / `code: 17` (limite de chamadas por usuário/app) → back-off exponencial, não retry imediato em loop.
- Erro `code: 613` (limite específico de ad account) → mesmo tratamento.
- Qualquer erro deve ser retornado no corpo da resposta do nosso endpoint com o `error.message` original da Meta, para facilitar debug (nunca engolir o erro silenciosamente).

---

## 6. Plano de Expansão Futura

O padrão criado aqui (`lib/meta-marketing-api.js` com funções puras + `api/admin/meta-ads-actions.js` como roteador único por `action`) escala naturalmente para novas ações, sem precisar de nova arquitetura:

1. **Puxar insights de performance** (`action: "get_insights"`): `GET /{ad-account-id}/insights` com `fields=spend,cpc,ctr,impressions,actions` e `time_range`. Como é uma ação **read-only**, não precisa do fluxo de confirmação em 2 passos — pode responder direto. Esse é o primeiro candidato natural a virar uma rotina agendada (ex: relatório diário automático), diferente das ações 1 e 2 que são pontuais/manuais.
2. **Pausar/ativar campanha inteira** (`action: "toggle_campaign"`): mesmo padrão do `pause_ad`, endpoint `POST /{campaign-id}` com `status`. Reaproveita a mesma lógica de confirmação em 2 passos.
3. **Criar novos ad sets** (`action: "create_ad_set"`): mais complexo — exige payload completo (`campaign_id`, `targeting`, `optimization_goal`, `billing_event`, `bid_amount`, `daily_budget`), então quando chegarmos nisso vale definir um **template padrão de ad set** (json de exemplo salvo no repo) para não montar o payload do zero toda vez.
4. **Camada de auditoria mais robusta**: se o volume de ações crescer, considerar logar cada chamada (quem, quando, o quê, resultado) em uma tabela simples (Supabase, já usado em outros projetos do ecossistema XBR) em vez de depender só dos logs da Vercel — dá histórico consultável e permite montar um mini-dashboard de "últimas ações no Meta Ads".
5. **Dashboard leve**: uma vez que existam 4-5 ações diferentes, talvez valha uma página HTML simples dentro do próprio `ponto-de-virada-bio` (protegida pelo mesmo `X-Admin-Secret`, via prompt/local storage) para disparar essas ações clicando em botões em vez de montar `curl` manualmente — mas isso só se justifica quando o número de ações e a frequência de uso crescerem; para o volume atual (2 ações, uso esporádico), curl/Postman direto é suficiente e mais simples de manter.

**Princípio geral para toda expansão**: cada nova ação é uma função nova em `lib/meta-marketing-api.js` + uma nova opção no `switch(action)` do endpoint — nunca um novo endpoint por ação, para manter a autenticação, o dry-run e a auditoria centralizados em um único ponto de entrada.
