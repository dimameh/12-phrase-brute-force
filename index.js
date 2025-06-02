/**
 * This script iterates over all 2048 possible words for one missing position in a 12-word BIP-39 phrase,
 * validates each candidate phrase, and for each valid phrase derives the first Bitcoin address for
 * three derivation paths:
 *   • BIP-44 P2PKH (m/44'/0'/0'/0/0) – Legacy (1...)
 *   • BIP-49 P2SH-P2WPKH (m/49'/0'/0'/0/0) – Nested SegWit (3...)
 *   • BIP-84 P2WPKH (m/84'/0'/0'/0/0) – Native SegWit (bc1...)
 * It then queries a public API to check the balance of each address. If any address has a balance > 0,
 * it prints the successful phrase and exits.
 */

const bip39 = require('bip39');
const bitcoin = require('bitcoinjs-lib');
const axios = require('axios');

// Import BIP32Factory and ECC implementation (tiny-secp256k1)
const { default: BIP32Factory } = require('bip32');
const ecc = require('tiny-secp256k1');

// Initialize bitcoinjs-lib with the ECC implementation
bitcoin.initEccLib(ecc);

// Create a bip32 instance using the ECC implementation
const bip32 = BIP32Factory(ecc);

(async () => {
  // === 1) Define your 11 known words and exactly one null placeholder ===
  // Replace the example words below with your actual words. Make sure there is exactly one null!
  const mnemonicWords = [
    'word1',    // [0]
    'word2',    // [1]
    'word3',    // [2]
    'word4',    // [3]
    'word5',    // [4]
    'word6',    // [5]
    'word7',    // [6]
    'word8',    // [7]
    'word9',    // [8]
    'word10',   // [9]
    'word11',   // [10]
    null        // [11] – this position will be brute-forced
  ];

  // Check there is exactly one null
  const nullCount = mnemonicWords.filter((x) => x === null).length;
  if (nullCount !== 1) {
    console.error('Error: There must be exactly one null placeholder in mnemonicWords.');
    process.exit(1);
  }

  const missingIndex = mnemonicWords.indexOf(null);
  console.log(`Starting to iterate over position index ${missingIndex} (0-11) in the 12-word phrase.`);

  // English BIP-39 wordlist (2048 words)
  const wordlist = bip39.wordlists.english;

  // Function: get the HD root node from a given mnemonic
  function getRootFromMnemonic(mnemonic) {
    const seed = bip39.mnemonicToSeedSync(mnemonic);
    return bip32.fromSeed(seed);
  }

  // Function: derive a public key and address from the root node, a derivation path, and address type
  function derivePubkeyAndAddress(root, path, addressType) {
    /**
     * addressType:
     *   'P2PKH'        → BIP-44 m/44'/0'/0'/0/i – Legacy addresses (1...)
     *   'P2SH-P2WPKH'  → BIP-49 m/49'/0'/0'/0/i – Nested SegWit addresses (3...)
     *   'P2WPKH'       → BIP-84 m/84'/0'/0'/0/i – Native SegWit addresses (bc1...)
     */
    const child = root.derivePath(path);
    const pubkeyBuffer = Buffer.from(child.publicKey);

    let addressObj;
    switch (addressType) {
      case 'P2PKH':
        addressObj = bitcoin.payments.p2pkh({
          pubkey: pubkeyBuffer,
          network: bitcoin.networks.bitcoin,
        });
        break;
      case 'P2SH-P2WPKH':
        const p2wpkh = bitcoin.payments.p2wpkh({
          pubkey: pubkeyBuffer,
          network: bitcoin.networks.bitcoin,
        });
        addressObj = bitcoin.payments.p2sh({
          redeem: p2wpkh,
          network: bitcoin.networks.bitcoin,
        });
        break;
      case 'P2WPKH':
        addressObj = bitcoin.payments.p2wpkh({
          pubkey: pubkeyBuffer,
          network: bitcoin.networks.bitcoin,
        });
        break;
      default:
        throw new Error(`Unsupported addressType: ${addressType}`);
    }

    return {
      pubkey: pubkeyBuffer,
      address: addressObj.address,
    };
  }

  // Function: query the balance (in satoshis) using blockchain.info API
  async function getBalanceSatoshis(address) {
    try {
      console.log(`   → Sending balance request for address: ${address}`);
      const resp = await axios.get(
        `https://blockchain.info/balance?active=${address}`,
        { timeout: 10000 }
      );
      const data = resp.data;
      if (data[address] && typeof data[address].final_balance === 'number') {
        console.log(`   ← Response received: balance = ${data[address].final_balance} satoshis`);
        return data[address].final_balance;
      } else {
        console.log(`   ← Response received but no final_balance field for ${address}`);
        return null;
      }
    } catch (err) {
      console.error(`   ← Error querying balance for ${address}: ${err.message}`);
      return null;
    }
  }

  // === 2) Main loop: iterate over all 2048 words for the missing position ===
  for (let i = 0; i < wordlist.length; i++) {
    // 2.1) Substitute the i-th word from the wordlist into the null position
    mnemonicWords[missingIndex] = wordlist[i];
    const candidatePhrase = mnemonicWords.join(' ');

    // 2.2) Validate the mnemonic checksum
    if (!bip39.validateMnemonic(candidatePhrase)) {
      // Invalid mnemonic, skip without logging
      continue;
    }

    // 2.3) Mnemonic passed checksum validation
    console.log('----------------------------------------------------');
    console.log(`Valid mnemonic found: "${candidatePhrase}"`);
    let root;
    try {
      root = getRootFromMnemonic(candidatePhrase);
    } catch (err) {
      console.error(`Error generating seed from mnemonic "${candidatePhrase}": ${err.message}`);
      continue;
    }

    // 2.4) Try multiple address types for index 0
    // If you need to check indices 0..N, expand this array, e.g. [0,1,2,3]
    const indicesToCheck = [0];
    const addressTypes = [
      { code: 'P2PKH', prefix: "m/44'/0'/0'/0/" },
      { code: 'P2SH-P2WPKH', prefix: "m/49'/0'/0'/0/" },
      { code: 'P2WPKH', prefix: "m/84'/0'/0'/0/" },
    ];

    for (const idx of indicesToCheck) {
      for (const { code, prefix } of addressTypes) {
        const path = `${prefix}${idx}`; // e.g. "m/44'/0'/0'/0/0"
        let addrData;
        try {
          addrData = derivePubkeyAndAddress(root, path, code);
        } catch (err) {
          console.error(`  Error deriving ${code} at path ${path}: ${err.message}`);
          continue;
        }

        console.log(`   → Derived ${code} (path=${path}): ${addrData.address}`);

        // 2.5) Check balance for the derived address
        const balanceSat = await getBalanceSatoshis(addrData.address);
        if (balanceSat === null) {
          console.log(`   → Could not get balance for ${addrData.address}.`);
          continue;
        }
        if (balanceSat > 0) {
          console.log('===================== FOUND! =====================');
          console.log(`Missing word position: ${missingIndex}`);
          console.log(`Word from wordlist: "${wordlist[i]}"`);
          console.log(`Full mnemonic: "${candidatePhrase}"`);
          console.log(`   → ${code} address (path=${path}): ${addrData.address}`);
          console.log(`   → Balance: ${balanceSat} satoshis (~${(balanceSat / 1e8).toFixed(8)} BTC)`);
          console.log('=================================================');
          process.exit(0);
        } else {
          console.log(`   → Address ${addrData.address} has zero balance.`);
        }
      }
    }
  }

  console.log('----------------------------------------------------');
  console.log('Iteration finished. No mnemonic with non-zero balance found.');
  console.log('----------------------------------------------------');
  process.exit(0);
})();