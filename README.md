# Tien Len Wager (Instant In-Game, Low-Cost Cashout)

This project is a hybrid model designed for:

- Instant and free transfers during gameplay (off-chain internal ledger)
- Low-cost cashouts to blockchain wallets (batched L2 relayer flow)
- 4-player realtime Tien Len rooms over WebSocket

## What is implemented

- Expo app with real cards and animations
- Realtime multiplayer rooms (4 players)
- Server-authoritative game rules and turn validation
- Rule: winner can only receive up to 2x winner stake
- If pot is smaller than 2x winner stake, winner gets full pot
- Internal wallet balance ledger for instant in-game settlement
- Cashout quote/request APIs with low-fee L2 model
- Solidity escrow contract stub for production ledger + withdrawal flow

## Architecture

1. Deposit once on-chain (USDC on low-fee chain like Base)
2. Move value instantly in-game via internal ledger (free, no gas)
3. Cashout only when needed, batched by relayer to reduce fees

This avoids gas costs during every hand while still allowing real wallet withdrawals.

## Run locally

Open two terminals in the project root.

Terminal 1:

```bash
npm run server
```

Terminal 2:

```bash
npm run start
```

Or run both:

```bash
npm run dev:all
```

## Connect from phone (Expo Go)

If using a physical phone, set `Server URL` in the app to your PC LAN IP:

- Example: `http://192.168.1.105:8088`

`localhost` only works when app and server run on the same host context.

## Wallet auth modes

- Quick Demo Connect: signs with a demo signature format for local testing
- Real signature mode: supports nonce challenge + signature verify flow

For production WalletConnect UX, connect your wallet SDK to sign this exact challenge message:

`Sign in to Tien Len: <nonce>`

Then submit the signature to `/auth/verify`.

## Main endpoints

- `POST /auth/challenge`
- `POST /auth/verify`
- `GET /wallet/me`
- `POST /wallet/deposit/mock`
- `POST /wallet/cashout/quote`
- `POST /wallet/cashout/request`
- `WS /ws?token=<jwt>`

## Smart contract

Contract file:

- `contracts/TienLenEscrow.sol`

The contract supports:

- `deposit(amount)`
- `settleHand(...)` by operator
- `withdraw(amount)`
- `requestCashout(amount)` intent event

Use a low-fee L2 stablecoin deployment for production.

## Production checklist

- Replace in-memory server state with Redis/Postgres
- Add anti-collusion checks and hand replay logs
- Add deterministic shuffling proof or commit-reveal
- Add WalletConnect mobile signing UI in-app
- Add relayer worker that calls escrow contract for withdrawals
- Add rate limiting and auth hardening
