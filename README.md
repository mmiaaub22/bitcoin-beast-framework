# ⚡ Bitcoin Beast Framework

Advanced Bitcoin wallet monitoring, UTXO management, and payment attack simulation framework.

## 🎯 Features

- 💰 **Wallet Monitoring** - Real-time balance tracking with pending/spendable separation
- 🔐 **Wallet Generation** - Create secure testnet/mainnet wallets
- 📦 **UTXO Management** - Fetch and analyze unspent outputs
- 📝 **OP_RETURN** - Build and decode OP_RETURN transactions
- ⚔️ **Attack Simulation** - Educational demonstrations of payment attacks
- 🌐 **REST API** - Full RESTful API with Swagger documentation
- 🚀 **WebSocket** - Real-time address monitoring via WebSocket
- 📱 **Modern UI** - React-based frontend with real-time updates

## 📋 Tech Stack

- **Backend**: Express.js, Node.js
- **Bitcoin**: bitcoinjs-lib, BIP32, tiny-secp256k1
- **Frontend**: React 18, Tailwind CSS
- **APIs**: Mempool. space, Blockchair
- **Hosting**: Render. com (recommended)

## 🚀 Quick Start

### Local Development

```bash
# Clone repository
git clone https://github.com/yourusername/bitcoin-beast-framework. git
cd bitcoin-beast-framework

# Install dependencies
npm install

# Create .env from example
cp .env.example .env

# Start development server
npm start
```

Server runs on `http://localhost:3000`

### Access Points

- **Frontend**: http://localhost:3000
- **API Docs**: http://localhost:3000/api-docs
- **Health Check**: http://localhost:3000/health

## 📚 API Endpoints

### Wallet Management

```bash
# Generate new wallet
POST /api/generate-wallet
Body: { "network": "testnet" }

# Add address to monitor
POST /api/wallet/add-address
Body: { "address": ".. .", "network": "testnet" }

# Get balance
GET /api/wallet/balance? address=... &network=testnet

# Get UTXOs
GET /api/wallet/utxos?address=... &network=testnet

# Get pending transactions
GET /api/wallet/mempool?address=...&network=testnet

# Start real-time monitoring
POST /api/wallet/start-monitoring
Body: { "address": "...", "network": "testnet" }
```

### UTXO Tools

```bash
# Fetch UTXOs for address
GET /api/utxos?address=...&network=testnet

# Get address balance
GET /api/address-balance?address=...&network=testnet

# Get UTXO details
GET /api/utxo/{txid}/{vout}?network=testnet
```

### Transaction Building

```bash
# Create OP_RETURN transaction
POST /api/create-opreturn-tx
Body: {
  "wif": ".. .",
  "utxo":  { "txid": "...", "vout": 0, "value": 100000 },
  "opreturn_data": "Hello Bitcoin! ",
  "network": "testnet",
  "fee": 2000
}

# Encode OP_RETURN data
POST /api/encode-opreturn
Body: { "data": "Hello Bitcoin!", "encoding": "utf-8" }
```

### Attack Simulation (Educational)

```bash
# Final Sequence Attack
POST /api/final-sequence-attack

# Smart Fee Booster
POST /api/smart-fee-booster

# Merchant Targeted Broadcast
POST /api/merchant-targeted-broadcast

# Delayed Double-Spend
POST /api/delayed-doublespend

# And more...  (see /api-docs)
```

## 📁 Project Structure

```
bitcoin-beast-framework/
├── bitcoin-beast-framework.js      Main Express server
├── wallet-engine.js                Wallet/mempool engine
├── example-express-wallet-routes.js Wallet routes
├── package.json                    Dependencies
├── . env                           Local config (git ignored)
├── .env.example                   Config template
├── render.yaml                    Render deployment
│
├── routes/                        Route handlers
│   ├── wallet-gen.js             Wallet generation
│   ├── utxo-fetch.js             UTXO fetching
│   └── opreturn-tx.js            OP_RETURN builder
│
└── public/                        Frontend
    └── index.html                React app
```

## 🌐 Networks

- **Bitcoin Testnet** (recommended for testing)
- **Bitcoin Mainnet** (⚠️ real money)

API automatically routes to correct network based on `network` parameter.

## 🚀 Deploy to Render

### 1. Push to GitHub

```bash
git add .
git commit -m "Initial commit:  Bitcoin Beast Framework"
git push origin main
```

### 2. Connect to Render

1. Go to [render.com](https://render.com)
2. Create new "Web Service"
3. Connect your GitHub repository
4. Render auto-reads `render.yaml` and deploys

### 3. Set Environment Variables

In Render Dashboard:
- `NODE_ENV` = `production`

### 4. Access Your App

```
https://your-app-name.onrender.com
```

## 🔐 Security Notes

⚠️ **NEVER store real private keys in code**
⚠️ **Use testnet for development/testing**
⚠️ **Keep . env file local (in . gitignore)**
⚠️ **WIFs are sensitive - handle carefully**
⚠️ **For educational/defensive use only**

## 📖 How to Use (Workflow)

### 1. Generate a Testnet Wallet
- Go to "🔑 Generate" tab
- Select "Bitcoin Testnet"
- Click "Generate Wallet"
- **SAVE your WIF securely**

### 2. Get Testnet Bitcoin
- Copy your address
- Go to [Testnet Faucet](https://testnet-faucet.mempool.co/)
- Paste address, get tBTC

### 3. Monitor Balance
- Go to "💳 Monitor Address" tab
- Paste your address
- Click "Add Address"
- Watch balance update in real-time

### 4. View UTXOs
- UTXOs appear below balance
- Shows confirmed/pending
- Use for building transactions

### 5. Test Attack Simulation
- Go to "⚔️ Attack Simulation" tab
- Check available endpoints
- Use Swagger docs to test

## 🛠️ Development

### Install Dependencies

```bash
npm install
```

### Start Dev Server

```bash
npm start
# or with auto-reload
npm run dev
```

### Run Tests

```bash
# Coming soon
npm test
```

## 📝 API Documentation

Full interactive Swagger documentation at `/api-docs`

## 🤝 Contributing

Contributions welcome! For major changes: 

1. Fork the repository
2. Create feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit changes (`git commit -m 'Add AmazingFeature'`)
4. Push to branch (`git push origin feature/AmazingFeature`)
5. Open Pull Request

## ⚠️ Disclaimer

This framework is for **educational and defensive purposes only**. 

- **DO NOT** use to attack unauthorized systems
- **DO NOT** use on mainnet with real funds unless you know what you're doing
- **DO NOT** store real private keys in this application
- Use **testnet only** for learning

Bitcoin payment attacks are illegal if used against third parties without consent. 

## 📄 License

MIT License - See LICENSE file

## 👤 Author

**sweetpie2929** - Bitcoin security researcher

## 🙏 Acknowledgments

- [bitcoinjs-lib](https://github.com/bitcoinjs/bitcoinjs-lib)
- [Mempool.space API](https://mempool.space)
- [Bitcoin Developer Reference](https://developer.bitcoin.org/)

---

**Happy learning! Stay secure!  🔐⚡**
