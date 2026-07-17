# Painel Hengst — pacote corrigido para Vercel

Este pacote já está estruturado para publicação como site estático.

## Conteúdo obrigatório na raiz

- `index.html` — página principal do painel
- `404.html` — fallback estático
- `vercel.json` — redireciona todas as rotas para o `index.html`

## Publicação pelo painel da Vercel

1. Exclua o deployment com erro ou crie um novo projeto.
2. Envie o conteúdo deste ZIP mantendo os arquivos na raiz.
3. Em **Framework Preset**, escolha **Other**.
4. Não defina Build Command.
5. Não defina Output Directory.
6. Confirme que **Root Directory** está vazio ou aponta para a pasta que contém `index.html`.
7. Faça o deploy.

## Atualização de um projeto já existente

Substitua os arquivos do repositório pelos arquivos deste pacote e gere um novo deployment. No painel da Vercel, confira em **Settings > Build and Deployment** se o diretório raiz não está apontando para uma subpasta inexistente.
