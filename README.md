# Jana Cosmeticos - Pagamentos

Base backend em Node.js para testar pagamento Pix com a MisticPay.

## Configuracao

1. Abra o arquivo `.env`.
2. Substitua os placeholders pelas credenciais reais da MisticPay.
3. Nunca versione o `.env`; ele ja esta listado no `.gitignore`.

Variaveis usadas:

```ini
MISTIC_PAY_CLIENT_ID="YOUR_MISTIC_PAY_CLIENT_ID"
MISTIC_PAY_CLIENT_SECRET="YOUR_MISTIC_PAY_CLIENT_SECRET"
MISTIC_PAY_WEBHOOK_URL=""
MISTIC_PAY_DEFAULT_DOCUMENT="00000000000"
PIX_DISCOUNT_RATE="0.15"
ADMIN_USER="YOUR_ADMIN_EMAIL"
ADMIN_PASSWORD="YOUR_STRONG_ADMIN_PASSWORD"
ADMIN_SESSION_SECRET="CHANGE_THIS_TO_A_RANDOM_SECRET"
ADMIN_SESSION_TTL_SECONDS="1800"
CMS_DATA_PATH=""
NODE_ENV="development"
```

## Funcoes

Funcoes disponiveis em `src/payments.js`:

- `createMisticPayPixTransaction`: cria uma transacao Pix via `/transactions/create`.
- `checkMisticPayTransaction`: consulta uma transacao via `/transactions/check`.
- `getMisticPayBalance`: consulta saldo via `/users/balance`.

## Rodar servidor local

```bash
npm start
```

No PowerShell, se `npm` estiver bloqueado pela politica de execucao, use:

```powershell
npm.cmd start
```

Depois acesse:

```text
http://localhost:3000
```

## Deploy na Vercel

O projeto esta pronto para Vercel com API em `api/[...path].js`.

1. Conecte o repositorio na Vercel.
2. Configure as variaveis de ambiente:
   - `MISTIC_PAY_CLIENT_ID`
   - `MISTIC_PAY_CLIENT_SECRET`
   - `MISTIC_PAY_WEBHOOK_URL` (opcional)
   - `MISTIC_PAY_DEFAULT_DOCUMENT` (opcional)
   - `ADMIN_USER`
   - `ADMIN_PASSWORD`
   - `ADMIN_SESSION_SECRET` (obrigatoria em producao)
   - `ADMIN_SESSION_TTL_SECONDS` (opcional, padrao `1800`, equivalente a 30 minutos)
3. Deploy.

Observacao sobre dados CMS:

- Em Vercel, gravacao em arquivo do projeto nao e persistente.
- Se `CMS_DATA_PATH` nao for informado, o app usa `/tmp/jana-cms.json` em runtime para permitir CRUD temporario.
- Para persistencia real de produtos/categorias, use banco/KV externo e ajuste `readCms`/`writeCms`.

## Endpoints

- `GET /api/health`
- `POST /api/checkout/pix`
- `POST /api/misticpay/pix`
- `POST /api/misticpay/check`
- `GET /api/misticpay/balance`

## Teste Pix

Com o servidor rodando, envie:

```powershell
$body = @{
  amount = 89.90
  payerName = "Cliente Teste"
  payerDocument = "12345678909"
  transactionId = "pedido-perfume-001"
  description = "Teste Pix Jana Cosmeticos"
} | ConvertTo-Json

Invoke-RestMethod -Uri "http://localhost:3000/api/misticpay/pix" -Method Post -ContentType "application/json" -Body $body
```

Para consultar:

```powershell
$body = @{
  transactionId = "pedido-perfume-001"
} | ConvertTo-Json

Invoke-RestMethod -Uri "http://localhost:3000/api/misticpay/check" -Method Post -ContentType "application/json" -Body $body
```

## Checkout Pix do site

A landing page usa este endpoint para gerar Pix ao clicar em `Comprar`:

```powershell
$body = @{
  productId = "prod-perfume-rose"
  buyerName = "Cliente Teste"
  cep = "00000-000"
  street = "Rua Teste"
} | ConvertTo-Json

Invoke-RestMethod -Uri "http://localhost:3000/api/checkout/pix" -Method Post -ContentType "application/json" -Body $body
```
