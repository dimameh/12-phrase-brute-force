# 12-phrase-brute-force
This script iterates over all 2048 possible words for one missing position in a 12-word BIP-39 phrase, validates each candidate phrase, and for each valid phrase derives the first Bitcoin address for three derivation paths. Stops when it finds an address with non-empty balance
