const express = require('express');
const BitcoinWalletEngine = require('./wallet-engine');

// Create engine instance per process
const walletEngine = new BitcoinWalletEngine('testnet');
walletEngine.startPolling(); // Always-on polling

const router = express.Router();

// ========== Add Address to Monitor ==========
router.post('/wallet/add-address', (req, res) => {
  try {
    const { address, network = 'testnet' } = req.body;

    if (!address) {
      return res.status(400).json({ error: 'address required' });
    }

    // Switch network if needed
    if (network !== walletEngine.network) {
      walletEngine.setNetwork(network);
    }

    walletEngine.addAddress(address);
    // Optional: start WebSocket monitoring for real-time updates
    walletEngine.startWebSocketMonitor(address);

    res.json({
      success: true,
      address,
      network,
      message: 'Address added and monitoring started',
      monitoring_type: 'polling + websocket',
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ========== Remove Address from Monitoring ==========
router.post('/wallet/remove-address', (req, res) => {
  try {
    const { address } = req.body;

    if (!address) {
      return res.status(400).json({ error: 'address required' });
    }

    walletEngine. removeAddress(address);

    res.json({
      success: true,
      address,
      message: 'Address removed from monitoring',
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ========== Get Wallet Balance ==========
router.get('/wallet/balance', async (req, res) => {
  try {
    const { address, network } = req.query;

    if (!address) {
      return res.status(400).json({ error: 'address required' });
    }

    // Switch network if different
    if (network && network !== walletEngine.network) {
      walletEngine.setNetwork(network);
    }

    // Fetch fresh data
    await walletEngine.fetchUtxos(address);
    await walletEngine.fetchMempoolTxs(address);

    const balance = walletEngine.calculateBalances(address);

    res.json(balance);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ========== Get UTXOs ==========
router.get('/wallet/utxos', async (req, res) => {
  try {
    const { address, network } = req.query;

    if (!address) {
      return res.status(400).json({ error: 'address required' });
    }

    if (network && network !== walletEngine. network) {
      walletEngine.setNetwork(network);
    }

    const utxos = await walletEngine.fetchUtxos(address);

    res.json({
      address,
      network:  walletEngine.network,
      utxo_count: utxos.length,
      confirmed_count: utxos.filter(u => u.is_confirmed).length,
      pending_count: utxos.filter(u => u.is_pending).length,
      total_value: utxos.reduce((sum, u) => sum + u.value, 0),
      utxos,
      fetched_at: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ========== Get Mempool Transactions ==========
router. get('/wallet/mempool', async (req, res) => {
  try {
    const { address, network } = req.query;

    if (!address) {
      return res.status(400).json({ error: 'address required' });
    }

    if (network && network !== walletEngine.network) {
      walletEngine.setNetwork(network);
    }

    const mempool = await walletEngine.fetchMempoolTxs(address);

    res.json({
      address,
      network: walletEngine.network,
      pending_count: Object.keys(mempool).length,
      pending_transactions: mempool,
      total_pending_value: Object.values(mempool).reduce((sum, tx) => sum + (tx.amount || 0), 0),
      fetched_at: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ========== Get Full Wallet Status ==========
router.get('/wallet/status', (req, res) => {
  try {
    const status = walletEngine.getFullStatus();
    const addressCount = Object.keys(status).length;

    res.json({
      network: walletEngine.network,
      addresses_monitored: addressCount,
      addresses:  status,
      total_balance: Object.values(status).reduce((sum, addr) => sum + (addr.total_balance || 0), 0),
      total_spendable: Object.values(status).reduce((sum, addr) => sum + (addr.spendable_balance || 0), 0),
      total_pending: Object.values(status).reduce((sum, addr) => sum + (addr.pending_balance || 0), 0),
      fetched_at: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ========== Start Real-Time Monitoring ==========
router.post('/wallet/start-monitoring', async (req, res) => {
  try {
    const { address, network } = req.body;

    if (!address) {
      return res.status(400).json({ error: 'address required' });
    }

    if (network && network !== walletEngine.network) {
      walletEngine.setNetwork(network);
    }

    walletEngine.addAddress(address);
    walletEngine.startWebSocketMonitor(address);

    res.json({
      success: true,
      address,
      network:  walletEngine.network,
      monitoring:  true,
      message: 'Real-time monitoring started via WebSocket',
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ========== Stop Real-Time Monitoring ==========
router.post('/wallet/stop-monitoring', (req, res) => {
  try {
    const { address } = req.body;

    if (!address) {
      return res.status(400).json({ error: 'address required' });
    }

    walletEngine. stopWebSocketMonitor(address);

    res.json({
      success: true,
      address,
      monitoring: false,
      message: 'Real-time monitoring stopped',
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ========== Get Transaction Details ==========
router.get('/wallet/tx/:txid', async (req, res) => {
  try {
    const { txid } = req.params;
    const { network = 'testnet' } = req.query;

    if (network !== walletEngine.network) {
      walletEngine.setNetwork(network);
    }

    const tx = await walletEngine.getTransactionDetails(txid);

    if (!tx) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    res.json(tx);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ========== List All Monitored Addresses ==========
router. get('/wallet/addresses', (req, res) => {
  try {
    const addresses = walletEngine.addresses;
    const status = walletEngine.getFullStatus();

    res.json({
      network: walletEngine.network,
      count: addresses.length,
      addresses:  addresses. map(addr => ({
        address: addr,
        ... status[addr],
      })),
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

module.exports = router;
