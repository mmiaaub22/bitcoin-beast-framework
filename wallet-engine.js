// wallet-engine.js
// BitcoinWalletEngine:  Unified wallet/mempool/UTXO/status/monitor engine for testnet/mainnet. 
// Attach this to your Express app or use as a backend singleton.

const axios = require('axios');
const bitcoin = require('bitcoinjs-lib');
const EventEmitter = require('events');
const WebSocket = require('ws');

const NETWORKS = {
  testnet: bitcoin.networks.testnet,
  mainnet: bitcoin.networks.bitcoin,
};

class BitcoinWalletEngine extends EventEmitter {
  constructor(network = 'testnet') {
    super();
    this.network = network;
    this.addresses = [];
    this.utxos = {};
    this.transactions = {};
    this.mempool_txs = {};

    this.apis = {
      testnet: {
        mempool: 'https://mempool.space/testnet/api',
        ws: 'wss://mempool.space/testnet/v1/ws',
        blockchair: 'https://api.blockchair.com/bitcoin/testnet',
      },
      mainnet: {
        mempool: 'https://mempool.space/api',
        ws: 'wss://mempool.space/v1/ws',
        blockchair: 'https://api.blockchair.com/bitcoin',
      },
    };

    this.config = {
      min_confirmations_spendable: 1,
      min_confirmations_safe: 6,
      mempool_timeout: 60 * 60 * 1000, // 1 hour
      polling_interval: 30000, // 30 seconds
    };

    this.websockets = {}; // address:  ws
    this.polling_interval = null;
  }

  setNetwork(network) {
    if (network !== this.network && (network === 'mainnet' || network === 'testnet')) {
      this.network = network;
      this.emit('network: changed', network);
    }
  }

  // ========== Add address ==========
  addAddress(address) {
    if (!this.addresses.includes(address)) {
      this.addresses. push(address);
      this.utxos[address] = [];
      this.transactions[address] = [];
      this.mempool_txs[address] = {};
      this.emit('address:added', address);
    }
  }

  // ========== Remove address ==========
  removeAddress(address) {
    this.addresses = this.addresses.filter(a => a !== address);
    delete this.utxos[address];
    delete this.transactions[address];
    delete this.mempool_txs[address];
    if (this.websockets[address]) {
      this.websockets[address].close();
      delete this.websockets[address];
    }
    this.emit('address:removed', address);
  }

  // ========== Fetch UTXOs ==========
  async fetchUtxos(address) {
    try {
      const apiUrl = this.apis[this. network].mempool;
      const response = await axios.get(`${apiUrl}/address/${address}/utxo`, {
        timeout: 10000,
      });

      const utxos = response.data. map((utxo) => ({
        txid: utxo.txid,
        vout: utxo.vout,
        value: utxo.value,
        confirmations: utxo.status. confirmed ? (utxo.status.block_height ?  1 : 0) : 0,
        block_height: utxo.status.block_height || null,
        block_time: utxo.status.block_time || null,
        is_confirmed: utxo.status.confirmed,
        is_pending: ! utxo.status.confirmed,
      }));

      this.utxos[address] = utxos;
      this.emit('utxos:updated', { address, utxos });
      return utxos;
    } catch (error) {
      this.emit('error', { type: 'fetch_utxos', address, error:  error.message });
      return [];
    }
  }

  // ========== Fetch mempool transactions ==========
  async fetchMempoolTxs(address) {
    try {
      const apiUrl = this.apis[this.network]. mempool;
      const response = await axios.get(`${apiUrl}/address/${address}/txs/mempool`, {
        timeout: 10000,
      });

      const now = Date.now();
      const mempool_txs = {};

      response.data.forEach((tx) => {
        // Mempool API provides vout array for all outputs of the TX. 
        let rx_amt = 0;
        if (Array.isArray(tx.vout)) {
          rx_amt = tx.vout
            .filter((out) => out.scriptpubkey_address === address)
            .reduce((sum, out) => sum + out.value, 0);
        }
        mempool_txs[tx.txid] = {
          txid: tx.txid,
          confirmations: 0,
          fee: tx.fee,
          fee_rate: tx.fee / tx.vsize,
          vsize: tx.vsize,
          rbf: typeof tx.rbf !== 'undefined' ? tx.rbf : false,
          timestamp: now,
          status: 'mempool',
          is_incoming: rx_amt > 0,
          amount: rx_amt,
        };
      });

      this.mempool_txs[address] = mempool_txs;
      this.emit('mempool:updated', { address, count: Object.keys(mempool_txs).length });
      return mempool_txs;
    } catch (error) {
      this.emit('error', { type: 'fetch_mempool', address, error: error.message });
      return {};
    }
  }

  // ========== Calculate balances ==========
  calculateBalances(address) {
    const utxos = this.utxos[address] || [];
    const mempool_txs = this.mempool_txs[address] || {};

    let confirmed_balance = 0;
    let pending_balance = 0;
    let unspendable_balance = 0;

    utxos.forEach((utxo) => {
      if (utxo.is_confirmed && utxo.confirmations >= this.config.min_confirmations_spendable) {
        confirmed_balance += utxo.value;
      } else if (utxo.is_pending) {
        pending_balance += utxo.value;
      }
    });

    Object.values(mempool_txs).forEach((tx) => {
      if (tx.is_incoming) {
        pending_balance += tx.amount;
      }
    });

    utxos.forEach((utxo) => {
      if (utxo.is_confirmed && utxo.confirmations < this.config.min_confirmations_spendable) {
        unspendable_balance += utxo.value;
      }
    });

    return {
      address,
      total_balance: confirmed_balance + pending_balance,
      spendable_balance: confirmed_balance,
      pending_balance,
      unspendable_balance,
      utxo_count: utxos.length,
      mempool_tx_count: Object.keys(mempool_txs).length,
      last_updated: new Date().toISOString(),
    };
  }

  // ========== WebSocket address monitor ==========
  startWebSocketMonitor(address) {
    if (this.websockets[address]) {
      return; // Already monitoring
    }
    const wsUrl = this.apis[this. network].ws;
    const ws = new WebSocket(wsUrl);

    ws.on('open', () => {
      // v1 API:  subscribe address
      ws.send(JSON. stringify({ track: address }));
      this.emit('ws:connected', address);
    });

    ws.on('message', async (data) => {
      // Mempool WS v1: address-tx, new-block, etc
      try {
        const msg = JSON.parse(data);
        if (msg['address-transactions']) {
          for (const tx of msg['address-transactions']) {
            this.emit('tx:detected', {
              address,
              txid: tx.txid,
              type: 'address-transactions',
              timestamp: Date.now(),
            });
          }
          await this.fetchMempoolTxs(address);
        }
      } catch {}
    });

    ws.on('error', (error) => {
      this.emit('error', { type: 'ws_error', address, error: error. message });
    });

    ws.on('close', () => {
      this.emit('ws:disconnected', address);
      setTimeout(() => this.startWebSocketMonitor(address), 5000); // Retry
    });

    this.websockets[address] = ws;
    return ws;
  }

  stopWebSocketMonitor(address) {
    if (this.websockets[address]) {
      this.websockets[address].close();
      delete this. websockets[address];
    }
  }

  // ========== Continuous polling ==========
  startPolling() {
    if (this.polling_interval) return;
    this.polling_interval = setInterval(async () => {
      for (const address of this.addresses) {
        try {
          await this.fetchUtxos(address);
          await this.fetchMempoolTxs(address);
        } catch (error) {
          this.emit('error', { type: 'polling', address, error: error.message });
        }
      }
    }, this.config.polling_interval);

    this.emit('polling:started');
  }

  stopPolling() {
    if (this.polling_interval) {
      clearInterval(this.polling_interval);
      this.polling_interval = null;
      this.emit('polling:stopped');
    }
  }

  // ========== Get full wallet status ==========
  getFullStatus() {
    const status = {};
    this.addresses.forEach((address) => {
      status[address] = {
        ... this.calculateBalances(address),
        utxos: this.utxos[address] || [],
        mempool_txs: this.mempool_txs[address] || {},
      };
    });
    return status;
  }

  // ========== Get transaction details ==========
  async getTransactionDetails(txid) {
    try {
      const apiUrl = this.apis[this.network].mempool;
      const response = await axios.get(`${apiUrl}/tx/${txid}`, {
        timeout: 10000,
      });

      return {
        txid:  response.data.txid,
        inputs: response.data. vin,
        outputs: response.data. vout,
        fee: response.data.fee,
        vsize: response.data.vsize,
        confirmations: response.data.status.confirmed ? 1 : 0,
        block_height: response.data.status.block_height || null,
        block_time:  response.data.status.block_time || null,
        timestamp: response.data.status.block_time || Math.floor(Date.now() / 1000),
        is_rbf: response.data.rbf,
        status: response.data.status.confirmed ? 'confirmed' : 'pending',
      };
    } catch (error) {
      this.emit('error', { type: 'fetch_tx_details', txid, error: error.message });
      return null;
    }
  }
}

module.exports = BitcoinWalletEngine;
