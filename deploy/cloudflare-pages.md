# Deploy do frontend no Cloudflare Pages

O frontend é 100% estático (Vite → `frontend/dist`), sem nenhuma função server-side.

## 1. Conectar o repositório

1. Acesse <https://dash.cloudflare.com> → **Workers & Pages** → **Create** → aba **Pages** → **Connect to Git**.
2. Autorize o GitHub e escolha o repositório do InfinityStream.
3. Configure o build:

| Campo | Valor |
|---|---|
| Production branch | `main` |
| Framework preset | `None` |
| Build command | `cd frontend && npm install && npm run build` |
| Build output directory | `frontend/dist` |
| Root directory | *(vazio, raiz do repo)* |

4. Em **Environment variables** (Production e Preview):

| Variável | Valor | Observação |
|---|---|---|
| `NODE_VERSION` | `24` | garante Node atual no build |
| `VITE_TMDB_API_KEY` | sua chave v3 do TMDB | fica pública no bundle (normal para TMDB) |
| `VITE_ORACLE_BRIDGE_URL` | `https://bridge.seudominio.com` | sem barra no final |
| `VITE_BRIDGE_TOKEN` | *(recomendado: deixar vazio)* | veja "Segurança do token" |

5. **Save and Deploy**. O site fica em `https://<projeto>.pages.dev`.

## 2. Atualização do catálogo

Cada push na `main` gera um novo deploy, inclusive os commits do GitHub Actions que atualizam o
`catalog.json`. Por isso as mensagens desses commits **não** levam `[skip ci]`: o Pages também
pularia o deploy. O workflow não entra em loop, porque o gatilho de push dele observa apenas
`catalog-sources/**`. São no máximo cerca de 6 builds/dia (de ~1 min cada), dentro dos
500 builds/mês gratuitos.

## 3. Domínio próprio (opcional)

**Custom domains** → **Set up a custom domain** → `stream.seudominio.com`. Depois, adicione esse
domínio a `keys/allowed_origins.txt` na VM e rode `deploy/oracle-setup.sh` de novo.
Os domínios `*.pages.dev` já são aceitos pelo CORS da bridge.

## 4. Segurança do token

Toda variável `VITE_*` é embutida no JavaScript e pode ser lida por quem abrir o site.

- **Recomendado:** deixe `VITE_BRIDGE_TOKEN` vazio e informe o token em **⚙ Configurações** no site.
  Ele fica salvo só no `localStorage` do seu navegador.
- **Para manter o site privado:** ative o **Cloudflare Access** (Zero Trust, gratuito até 50 usuários):
  Zero Trust → Access → Applications → *Self-hosted* → domínio do projeto → política
  "Emails = seu e-mail".

## 5. Teste local

```bash
cp frontend/.env.example frontend/.env.local   # preencha
npm install
npm run dev     # http://localhost:5173
npm test        # testes do parser, anti-CAM e ranking
```
