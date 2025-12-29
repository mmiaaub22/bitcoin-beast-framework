const express = require('express');
const bitcoin = require('bitcoinjs-lib');
const ecc = require('tiny-secp256k1');
const { BIP32Factory } = require('bip32');
const router = express.Router();

const NETWORKS = {
  testnet: bitcoin.networks.testnet,
  mainnet: bitcoin.networks.bitcoin,
};

const bip32 = BIP32Factory(ecc);

// ========== Generate Random Wallet ==========
router.post('/generate-wallet', (req, res) => {
  try {
    const { network = 'testnet', address_type = 'p2wpkh' } = req.body;

    // Validate network
    if (! NETWORKS[network]) {
      return res.status(400).json({ 
        error: 'Invalid network. Use "testnet" or "mainnet"' 
      });
    }

    const net = NETWORKS[network];

    // Generate random keypair
    const keyPair = bitcoin.ECPair.makeRandom({ network: net });
    const pubkey = keyPair.publicKey;

    // Generate addresses based on type
    const addresses = {};

    // P2WPKH (Native SegWit - bc1q...)
    const p2wpkh = bitcoin.payments.p2wpkh({ pubkey, network: net });
    addresses.p2wpkh = {
      address: p2wpkh.address,
      type: 'Native SegWit (Recommended)',
      descriptor: `wpkh([... ])`,
    };

    // P2SH-P2WPKH (Wrapped SegWit - 3...)
    const p2sh = bitcoin.payments.p2sh({
      redeem: bitcoin.payments.p2wpkh({ pubkey, network: net }),
      network: net,
    });
    addresses.p2sh = {
      address: p2sh. address,
      type: 'Wrapped SegWit (Compatible)',
      descriptor: `sh(wpkh([...]))`,
    };

    // Legacy P2PKH (1...  or m/n...)
    const p2pkh = bitcoin.payments.p2pkh({ pubkey, network:  net });
    addresses.p2pkh = {
      address:  p2pkh.address,
      type: 'Legacy P2PKH (Old)',
      descriptor: `pkh([...])`,
    };

    const wallet = {
      success: true,
      network,
      wif: keyPair.toWIF(),
      publicKey: pubkey. toString('hex'),
      privateKey: keyPair.privateKey.toString('hex'),
      addresses,
      recommended_address: addresses.p2wpkh. address,
      created_at: new Date().toISOString(),
      security_notes: [
        '🔐 SAVE YOUR WIF IN A SECURE PLACE',
        '🔐 Do NOT share WIF with anyone - it\'s your private key',
        '🔐 Anyone with your WIF can drain all funds',
        `🔐 Network: ${network === 'testnet' ? 'TESTNET (safe for testing)' : 'MAINNET (real money!)'}`,
        '🔐 Use P2WPKH addresses (bc1q.. .) for lower fees',
        '🔐 Keep backups of WIF in multiple secure locations',
      ],
    };

    // Don't expose sensitive data in logs
    console.log(`✓ Wallet generated for ${network}`);
    res.json(wallet);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ========== Generate Wallet from Seed Phrase ==========
router.post('/generate-from-seed', (req, res) => {
  try {
    const { seed_phrase, network = 'testnet', derivation_path = "m/84'/1'/0'/0/0" } = req.body;

    if (!seed_phrase || typeof seed_phrase !== 'string') {
      return res.status(400).json({ error: 'seed_phrase required (BIP39 mnemonic)' });
    }

    if (! NETWORKS[network]) {
      return res.status(400).json({ error: 'Invalid network' });
    }

    const net = NETWORKS[network];

    try {
      // Parse seed phrase into root key
      // Note: This is simplified - real implementation needs BIP39 library
      const seed_buffer = Buffer.from(seed_phrase, 'utf-8');
      const root = bip32.fromSeed(seed_buffer, net);

      // Derive child key from path
      const child = root.derivePath(derivation_path);
      const keyPair = bitcoin. ECPair.fromPrivateKey(child.privateKey, { network: net });

      const p2wpkh = bitcoin.payments.p2wpkh({ pubkey: keyPair.publicKey, network: net });

      res.json({
        success: true,
        network,
        derivation_path,
        wif: keyPair.toWIF(),
        address: p2wpkh.address,
        publicKey: keyPair.publicKey.toString('hex'),
        warning: 'Seed phrase handling should use BIP39 library in production',
      });
    } catch (seedErr) {
      return res.status(400).json({ 
        error: 'Failed to derive from seed - check seed phrase format' 
      });
    }
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ========== Validate Address ==========
router.post('/validate-address', (req, res) => {
  try {
    const { address, network = 'testnet' } = req. body;

    if (!address || typeof address !== 'string') {
      return res.status(400).json({ error: 'address required' });
    }

    if (!NETWORKS[network]) {
      return res.status(400).json({ error: 'Invalid network' });
    }

    const net = NETWORKS[network];

    try {
      bitcoin.address.toOutputScript(address, net);
      
      // Determine address type
      let addressType = 'unknown';
      if (address.startsWith('bc1')) addressType = 'Native SegWit (P2WPKH)';
      else if (address.startsWith('tb1')) addressType = 'Testnet Native SegWit';
      else if (address.startsWith('3')) addressType = 'Wrapped SegWit (P2SH)';
      else if (address.startsWith('2')) addressType = 'Testnet P2SH';
      else if (address.startsWith('1')) addressType = 'Legacy P2PKH';
      else if (address.startsWith('m') || address.startsWith('n')) addressType = 'Testnet P2PKH';

      res.json({
        valid: true,
        address,
        network,
        type: addressType,
        length: address.length,
      });
    } catch (e) {
      res.json({
        valid: false,
        address,
        network,
        error: 'Invalid address for this network',
      });
    }
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ========== Validate WIF ==========
router. post('/validate-wif', (req, res) => {
  try {
    const { wif, network = 'testnet' } = req.body;

    if (!wif || typeof wif !== 'string') {
      return res.status(400).json({ error: 'wif required' });
    }

    if (!NETWORKS[network]) {
      return res.status(400).json({ error: 'Invalid network' });
    }

    const net = NETWORKS[network];

    try {
      const keyPair = bitcoin.ECPair. fromWIF(wif, net);
      const p2wpkh = bitcoin.payments.p2wpkh({ pubkey: keyPair.publicKey, network: net });

      res.json({
        valid: true,
        network,
        address: p2wpkh.address,
        publicKey: keyPair.publicKey.toString('hex'),
        warning: 'WIF validation should be done offline for maximum security',
      });
    } catch (e) {
      res.json({
        valid: false,
        network,
        error: 'Invalid WIF for this network',
      });
    }
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

module.exports = router;
