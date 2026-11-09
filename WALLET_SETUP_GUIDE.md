# STEWARD — Non-Custodial Treasury Wallet Setup Guide

**STEWARD** supports two real, non-custodial corporate treasury wallet connections:

1. **NEAR Wallet** via [`@hot-labs/near-connect`](https://github.com/hot-dao/near-selector) (`NearConnector`)
2. **MetaMask** via EIP-1193 (`window.ethereum`) across **Base**, **Arbitrum One**, and **Ethereum Mainnet**

> **Core Security Invariant**: STEWARD never requests, accepts, stores, or transmits private keys or seed phrases. Wallet connection, payment authorization, and wallet signing are three strictly separated operations.

---

## 1. Connecting a NEAR Treasury Wallet (`@hot-labs/near-connect`)

### Supported NEAR Wallets
Through HOT Labs' dynamically loaded manifest (`NearConnector`), STEWARD discovers and connects to:
- **HOT Wallet** (Browser Extension, Mobile & Telegram)
- **MyNearWallet** (`app.mynearwallet.com`)
- **Meteor Wallet** (`wallet.meteorwallet.app`)
- **Intear Wallet**
- **Nightly Wallet**
- **NEAR Mobile Wallet**
- **Unity Wallet**
- **OKX Wallet**

### Step-by-Step Connection Flow
1. Open STEWARD (`http://localhost:3001`) and navigate to the **Treasury** tab in the left sidebar.
2. In the **NEAR Wallet (`@hot-labs/near-connect`)** card:
   - Leave the selector on **"Open NEAR Connect Wallet Selector Modal"** to choose your wallet visually, or pick a specific wallet from the dropdown.
   - Click **Connect NEAR Wallet**.
3. Approve the connection prompt in your NEAR wallet.
4. Once connected, STEWARD automatically:
   - Reads your NEAR account ID (e.g. `company-treasury.near`) and public key.
   - Queries **NEAR Mainnet RPC** (`https://rpc.mainnet.near.org`) for your native **NEAR** balance (including storage-locked vs. available balance) and NEP-141 balances (**USDC**, **USDT**, **wNEAR**).
   - Queries **NEAR Intents 1Click** (`GET https://1click.chaindefuser.com/v0/tokens`) for live USD prices and timestamps.
5. Subscribes to `wallet:signIn` and `wallet:signOut` events so account switches or disconnects update the Treasury dashboard immediately.

### NEAR Capability Detection
Not all NEAR wallets implement identical methods. [`NearConnectWalletAdapter`](file:///home/suxess/Desktop/STEWARD/src/client/wallets/nearWalletAdapter.ts) inspects connected wallet features and surfaces clear guidance if a wallet does not support `signAndSendTransaction` or `signMessage`.

---

## 2. Connecting MetaMask (`EIP-1193`)

### Supported EVM Networks
| Network | Chain ID (Dec) | Chain ID (Hex) | Native Asset | Supported ERC-20 Assets |
|---|---|---|---|---|
| **Base Mainnet** | `8453` | `0x2105` | `ETH` | `USDC` (`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`), `USDT` (`0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2`) |
| **Arbitrum One** | `42161` | `0xa4b1` | `ETH` | `USDC` (`0xaf88d065e77c8cC2239327C5EDb3A432268e5831`), `USDT` (`0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9`) |
| **Ethereum Mainnet** | `1` | `0x1` | `ETH` | `USDC` (`0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48`), `USDT` (`0xdAC17F958D2ee523a2206206994597C13D831ec7`) |

### Step-by-Step Connection Flow
1. Ensure the MetaMask browser extension is installed and unlocked.
2. Navigate to the **Treasury** tab in STEWARD.
3. In the **MetaMask (`EIP-1193 Provider`)** card:
   - Select your preferred EVM treasury chain (**Base**, **Arbitrum One**, or **Ethereum Mainnet**).
   - Click **Connect MetaMask**.
4. Approve `eth_requestAccounts` in the MetaMask popup.
5. If MetaMask is on a different network than your selected treasury chain, click the chain switcher button (`wallet_switchEthereumChain`, with automatic fallback to `wallet_addEthereumChain` for Base/Arbitrum).
6. STEWARD listens to `accountsChanged`, `chainChanged`, and `disconnect` events on the EIP-1193 provider in real time.

---

## 3. Inspecting Public On-Chain Balances Without Connecting an Extension

If you are reviewing STEWARD in an environment without a browser wallet extension installed, use the **Public On-Chain Balance & Price Inspector** on the **Treasury** page:
- Inspect any **NEAR Mainnet** account (e.g., `wrap.near` or `intents.near`) to view live native NEAR and NEP-141 token balances.
- Inspect any **EVM address** (e.g., `0x742d35Cc6634C0532925a3b844Bc454e4438f44e`) across **Arbitrum**, **Base**, or **Ethereum** to view live native ETH and ERC-20 USDC/USDT balances.
