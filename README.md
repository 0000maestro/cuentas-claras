# Cuentas Claras

Panel financiero multi-cliente: una persona con sus empresas, todas sus cuentas, cada peso que entra y sale, los costos recurrentes y las deudas.

- **Frontend:** Vite + React + TypeScript + Tailwind, desplegado en Cloudflare Pages.
- **Datos y acceso:** Supabase (Postgres + Auth por enlace mágico). Aislamiento por organización con RLS.
- **Carga de datos:** cartolas Excel/CSV con mapeo de columnas guardado por cuenta; dedupe automático. API bancaria (Fintoc) como siguiente fase.

## Desarrollo

```bash
cp .env.example .env   # VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY
npm install
npm run dev
```

## Despliegue en Cloudflare Pages

1. Cloudflare → Workers & Pages → Create → Pages → Connect to Git → este repositorio.
2. Build command: `npm run build` · Output directory: `dist` · Framework: Vite.
3. Variables de entorno (Production y Preview): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (valores en `.env.example`).
4. Para que el enlace de acceso vuelva al sitio, en Supabase → Authentication → URL Configuration agregar la URL de Pages (y el dominio propio cuando exista) a *Redirect URLs*.
5. Dominio propio: Pages → Custom domains → agregar. Nada más cambia.

## Base de datos

Migraciones en `supabase/migrations/` (ya aplicadas al proyecto `Conciliation`). Tablas principales: `organizations`, `memberships`, `org_invites`, `entities`, `accounts`, `categories`, `transactions`, `rules`, `recurring_charges`, `debts`, `debt_payments`, `imports`. Vistas: `v_monthly_summary`, `v_recurring`, `v_debts`, `v_savings`, `v_savings_summary`. Funciones: `detect_recurring(org)`, `reapply_rules(org)`, `accept_invites()`, `register_saving(...)`, `register_process_saving(...)`, `verify_savings(org)`, `accept_agreement(id)`.

## Ahorro compartido

Módulo para cobrar una comisión por ahorro logrado (migraciones 004 y 005). Cada organización tiene un acuerdo en `agreements` (porcentaje, pago único, texto), que el cliente acepta una vez y queda congelado. Los ahorros viven en `savings_events`:

- **Cargo**: un costo recurrente cancelado o rebajado. Se confirma cuando la cartola de la cuenta donde se cobraba cubre la ventana del próximo cobro y el cargo no aparece (o aparece más bajo).
- **Proceso**: una forma más barata de pagar algo (ej.: USDT por P2P). Se registran operaciones de antes y después en `process_operations`; cada una se cruza con su transferencia en la cartola (monto ±1, fecha ±3 días). Ahorro = unidades del mes × (costo unitario antes − después).

`verify_savings` corre después de cada importación. Un ahorro verificado es inmutable; la comisión pasa a "por pagar" y se marca pagada enlazando la transferencia real.

## Subir archivos (lector universal)

`src/lib/readers/` lee cualquier archivo en el navegador, sin enviar nada a terceros:

- `santanderTx1.ts`: cartola Santander de ancho fijo (.tx1/.txt), con cuadratura contra los saldos del banco.
- `santanderCard.ts`: estado de cuenta de tarjeta Santander en PDF (nacional e internacional).
- `pdf.ts` + `generic.ts`: cualquier PDF o texto con fecha, descripción y monto.
- `ocr.ts`: capturas y fotos (tesseract.js en español). Los archivos del OCR se copian a `public/ocr` con `scripts/copy-ocr.mjs` antes de `dev` y `build`, para servirlos desde el mismo dominio.
- Excel y CSV: detección automática de columnas (`importer.ts`).

Sin duplicados: cada movimiento lleva la huella `v2:fecha:monto:n` (n = ocurrencia de esa fecha y monto en la cuenta) con índice único `(account_id, fingerprint)`. Subir dos veces el mismo archivo, o una captura que se cruza con una cartola, no crea filas nuevas. Todo archivo queda guardado en el bucket privado `documentos` y en la tabla `documents`.

## Configuración inicial

`/bienvenida` (`src/pages/Welcome.tsx`): cinco pasos (tú, tus negocios, tus cuentas, tus deudas con el informe CMF, tus movimientos). El avance se guarda en `organizations.onboarding`. Las instituciones y sus productos están en `src/lib/institutions.ts`; las que alguien pide y no están quedan en `source_requests`.
